using System.Text.Json;
using System.Text.RegularExpressions;
using Radar.Domain.Models;

namespace Radar.Infrastructure;

public class ConfigManager
{
    public string Path { get; }

    public ConfigManager(string path)
    {
        Path = string.IsNullOrEmpty(path) ? DefaultConfigPath() : path;
    }

    public static string DefaultConfigPath()
    {
        var env = Environment.GetEnvironmentVariable("CS_RADAR_CONFIG_PATH");
        if (!string.IsNullOrEmpty(env)) return env;
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!string.IsNullOrEmpty(home)) return System.IO.Path.Combine(home, ".csplayerstatsradar", "config.json");
        return System.IO.Path.Combine(".", ".csplayerstatsradar", "config.json");
    }

    public static string DefaultDatabasePath()
    {
        var env = Environment.GetEnvironmentVariable("CS_RADAR_DB_PATH");
        if (!string.IsNullOrEmpty(env)) return env;
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!string.IsNullOrEmpty(home)) return System.IO.Path.Combine(home, ".csplayerstatsradar", "player_stats.db");
        return "player_stats.db";
    }

    public AppConfig DefaultConfig() => new()
    {
        ExportWidth = 1920,
        ExportHeight = 1080,
        ThemeColor = "#00ffff",
        ColorPreset = "default",
        LastPlayerIdentifierType = "name",
        DatabasePath = DefaultDatabasePath(),
        VideoFPS = 60,
        RatingVersion = "rating_2",
        ShowRatingWatermark = true,
        Showcase = new ShowcaseConfig
        {
            DefaultDurationMS = 4000,
            ShowBestMarkers = true,
            RadarScaleMode = "global",
            RadarScale = 1.0,
            RadarAxisScale = new Dictionary<string, double>(),
            Layout = new ShowcaseLayout
            {
                RadarPosition = new NormalizedPoint { X = 0.36, Y = 0.56 },
                NamePosition = new NormalizedPoint { X = 0.72, Y = 0.22 },
                ImagePosition = new NormalizedPoint { X = 0.72, Y = 0.54 },
            },
        },
    };

    private static readonly string[] WhitelistedKeys =
    {
        "export_width", "export_height", "theme_color", "color_preset",
        "last_player_identifier_type", "database_path", "showcase",
        "import_sources", "video_fps", "reduce_motion",
        "rating_version", "show_rating_watermark",
    };

    public AppConfig Read(out string? error)
    {
        error = null;
        var cfg = DefaultConfig();
        if (!File.Exists(Path)) return cfg;
        try
        {
            var raw = File.ReadAllText(Path);
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                throw new InvalidDataException("config root is not an object");
            var rawCfg = JsonSerializer.Deserialize<AppConfig>(raw);
            if (rawCfg == null) throw new InvalidDataException("config null");
            var merged = new AppConfig();
            foreach (var prop in typeof(AppConfig).GetProperties())
            {
                var attr = (System.Text.Json.Serialization.JsonPropertyNameAttribute?)prop
                    .GetCustomAttributes(typeof(System.Text.Json.Serialization.JsonPropertyNameAttribute), false)
                    .FirstOrDefault();
                var key = attr?.Name ?? prop.Name.ToLowerInvariant();
                if (!WhitelistedKeys.Contains(key)) continue;
                var value = prop.GetValue(rawCfg);
                if (value != null && !(value is string s && s == "")) prop.SetValue(merged, value);
            }
            return merged;
        }
        catch
        {
            error = "config_read_failed";
            return cfg;
        }
    }

    public string? Save(AppConfig cfg)
    {
        var validate = Validate(cfg);
        if (validate != null) return validate;
        try
        {
            var dir = System.IO.Path.GetDirectoryName(Path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var json = JsonSerializer.Serialize(cfg, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(Path, json);
            return null;
        }
        catch
        {
            return "config_write_failed";
        }
    }

    public static readonly Dictionary<string, (double Min, double Max)> RadarAxisLimitRanges = new()
    {
        ["KPR"] = (0.5, 2),
        ["Surviving"] = (0.3, 1),
        ["ADR"] = (50, 200),
        ["KAST"] = (0.35, 1),
        ["Impact"] = (1, 4),
        ["Rating"] = (0.75, 3),
    };

    public string? Validate(AppConfig cfg)
    {
        if (cfg.ExportWidth <= 0 || cfg.ExportWidth > 8192 || cfg.ExportHeight <= 0 || cfg.ExportHeight > 8192)
            return "invalid_export_size";
        if (!Regex.IsMatch(cfg.ThemeColor, "^#[0-9a-fA-F]{6}$"))
            return "主题色必须是 #RRGGBB 格式。";
        if (cfg.LastPlayerIdentifierType != "name" && cfg.LastPlayerIdentifierType != "steam_id")
            return "玩家标识类型必须是 name 或 steam_id。";
        if (string.IsNullOrEmpty(cfg.DatabasePath) || Directory.Exists(cfg.DatabasePath))
            return "数据库路径不能为空，且不能指向目录。";
        if (cfg.Showcase.DefaultDurationMS <= 0)
            return "默认展示时长必须大于 0。";
        if (cfg.VideoFPS != 30 && cfg.VideoFPS != 60)
            return "视频帧率必须是 30 或 60。";
        if (cfg.RatingVersion != "rating_2" && cfg.RatingVersion != "rating_3")
            return "评分算法必须是 rating_2 或 rating_3。";
        if (Math.Abs(cfg.Showcase.AudioOffsetMS) > 24 * 60 * 60 * 1000)
            return "音频偏移超出合理范围。";
        if (cfg.Showcase.RadarScaleMode != "global" && cfg.Showcase.RadarScaleMode != "axis")
            return "雷达缩放模式必须是 global 或 axis。";
        if (cfg.Showcase.RadarScale is < 0.5 or > 1.0)
            return "全局雷达缩放必须在 0.5 到 1.0 之间。";
        if (cfg.Showcase.RadarScaleMode == "axis")
        {
            foreach (var kv in cfg.Showcase.RadarAxisScale)
            {
                if (!RadarAxisLimitRanges.TryGetValue(kv.Key, out var range)) continue;
                if (kv.Value < range.Min || kv.Value > range.Max) return $"雷达轴 {kv.Key} 缩放超出范围。";
            }
        }
        foreach (var pos in new[] { cfg.Showcase.Layout.RadarPosition, cfg.Showcase.Layout.NamePosition, cfg.Showcase.Layout.ImagePosition })
            if (pos.X is < 0 or > 1 || pos.Y is < 0 or > 1) return "展示布局坐标必须在 0 到 1 之间。";
        return null;
    }
}