using System.Security.Cryptography;
using System.Text;
using Cs2Demo.Analytics;
using Radar.Domain.Models;
using Radar.Parser;

namespace Radar.Application;

public class HistorySaveResult
{
    public string SaveStatus { get; set; } = "not_saved";
    public SavedDemo? SavedDemo { get; set; }
}

public interface IHistoryRepository
{
    string? Init();
    void Close();
    string Path();
    SavedDemo? FindDemoByDedupeKey(string dedupeKey);
    List<SavedPlayer> ListPlayers();
    SavedPlayer? GetPlayer(string steamID);
    List<PlayerMatchRecord> ListPlayerMatches(string steamID);
    List<PlayerMatchRecord> GetMetricSnapshots(string steamID, List<string> demoRecordIDs);
    SavedDemo SaveParsedDemo(SavedDemo demo, List<DemoPlayerSnapshot> participants, List<DemoPlayerSnapshot> players, List<PlayerMatchRecord> matchStats, DemoAnalysis? analysis, bool followPlayers);
    List<Player> ListFollowedPlayers();
    void SetPlayerFollowed(Player player, bool followed);
    void RenamePlayer(string steamID, string newName);
    void DeletePlayer(string steamID);
    void DeleteAllPlayers();
    void DeletePlayerMatch(string steamID, string demoRecordID);
    List<MatchGroup> ListMatchGroups(string steamID);
    MatchGroup CreateMatchGroup(string steamID, string name);
    void RenameMatchGroup(long groupID, string name);
    void DeleteMatchGroup(long groupID);
    void AssignMatchGroup(string steamID, string demoRecordID, long? groupID);
    void UpdateRating3Stats(PlayerMatchRecord record);
    void SavePlayerAvatar(PlayerAvatarCache avatar);
    PlayerAvatarCache? GetPlayerAvatar(string steamID);
    void SaveEditorDraft(EditorDraft draft);
    EditorDraft? GetEditorDraft(string kind);
    List<SavedDemo> ListDemos();
    SavedDemo? GetDemo(string demoID);
    void UpdateDemoNote(string demoID, string note);
    void UpdateDemoSourcePath(string demoID, string sourcePath);
    void DeleteDemos(List<string> demoIDs);
    void SaveDemoAnalysis(string demoID, DemoAnalysis analysis);
    DemoAnalysis? GetDemoAnalysis(string demoID);
    PlayerImage? GetPlayerImage(string steamID);
    PlayerImage SavePlayerImage(PlayerImage image);
    void DeletePlayerImage(string steamID);
    PlayerMVPBackground? GetPlayerMVPBackground(string steamID);
    PlayerMVPBackground SavePlayerMVPBackground(PlayerMVPBackground background);
    void DeletePlayerMVPBackground(string steamID);
}

public class HistoryService
{
    private readonly IHistoryRepository repo;

    public HistoryService(IHistoryRepository repo) => this.repo = repo;

    public IHistoryRepository Repository() => repo;

    public static string BuildPlayerSetHash(List<Player> players)
    {
        var ids = players.Select(p => p.SteamID.Trim()).Where(id => id != "").Distinct().OrderBy(id => id, StringComparer.Ordinal).ToList();
        var joined = string.Join("\n", ids);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(joined))).ToLowerInvariant();
    }

    public static string BuildDedupeKey(string fileSHA256, string mapName, string playerSetHash)
    {
        var joined = string.Join("\n", fileSHA256.ToLowerInvariant(), mapName.ToLowerInvariant(), playerSetHash);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(joined))).ToLowerInvariant();
    }

    public HistorySaveResult FollowParsedDemoPlayersAtSource(string fileName, string sourcePath, ParsedDemo parsed, List<string>? allowedSteamIDs)
        => SaveParsedDemoForPlayersAtSourceInternal(fileName, sourcePath, parsed.Demo, parsed.Match, allowedSteamIDs, followPlayers: true);

    public HistorySaveResult SaveParsedDemoForPlayersAtSource(string fileName, string sourcePath, ParsedDemo parsed, List<string>? allowedSteamIDs)
        => SaveParsedDemoForPlayersAtSourceInternal(fileName, sourcePath, parsed.Demo, parsed.Match, allowedSteamIDs, followPlayers: false);

    private HistorySaveResult SaveParsedDemoForPlayersAtSourceInternal(string fileName, string sourcePath, DemoData data, MatchData match, List<string>? allowedSteamIDs, bool followPlayers)
    {
        var result = new HistorySaveResult();
        var fileHash = data.Meta.FileSHA256;
        if (string.IsNullOrEmpty(fileHash)) return result;

        var allValidPlayers = data.Players
            .Select(p => new Player { Name = p.Name.Trim(), SteamID = p.SteamID.Trim() })
            .Where(p => p.SteamID != "")
            .GroupBy(p => p.SteamID)
            .Select(g => g.First())
            .OrderBy(p => p.SteamID, StringComparer.Ordinal)
            .ToList();

        List<Player> validPlayers;
        if (allowedSteamIDs == null)
            validPlayers = allValidPlayers;
        else if (allowedSteamIDs.Count == 0)
            validPlayers = new List<Player>();
        else
            validPlayers = allValidPlayers.Where(p => allowedSteamIDs.Contains(p.SteamID)).ToList();

        if (allValidPlayers.Count == 0) return result;

        var now = DateTimeOffset.UtcNow;
        var matchTime = data.Meta.MatchTime;
        var matchTimeSource = "demo";
        if (matchTime == null)
        {
            if (!string.IsNullOrEmpty(sourcePath) && File.Exists(sourcePath))
            {
                matchTime = File.GetLastWriteTimeUtc(sourcePath);
                matchTimeSource = "file_mtime";
            }
            else
            {
                matchTime = now;
                matchTimeSource = "legacy_import_time";
            }
        }

        var playerSetHash = BuildPlayerSetHash(allValidPlayers);
        var dedupeKey = BuildDedupeKey(fileHash, data.Meta.MapName, playerSetHash);
        var existing = repo.FindDemoByDedupeKey(dedupeKey);

        var recordTime = matchTime.Value;
        var demoRecordID = "demo_record_" + recordTime.ToString("yyyyMMdd_HHmmss") + "_" + RandomHex(4);
        if (existing != null)
        {
            demoRecordID = existing.DemoRecordID;
            result.SaveStatus = validPlayers.Count > 0 ? "duplicate" : "not_saved";
        }
        else
        {
            result.SaveStatus = validPlayers.Count > 0 ? "saved" : "not_saved";
        }

        var savedDemo = new SavedDemo
        {
            DemoRecordID = demoRecordID,
            FileName = fileName,
            MatchTime = matchTime.Value,
            MatchTimeSource = matchTimeSource,
            MapName = data.Meta.MapName,
            FileSHA256 = fileHash,
            SourcePath = sourcePath,
            PlayerSetHash = playerSetHash,
            DedupeKey = dedupeKey,
            ImportedAt = now,
        };

        var analysis = DemoAnalysisBuilder.Build(demoRecordID, data);
        var participants = allValidPlayers
            .Select(p => new DemoPlayerSnapshot { DemoRecordID = demoRecordID, SteamID = p.SteamID, NameSnapshot = p.Name })
            .ToList();
        var playerSnapshots = validPlayers
            .Select(p => new DemoPlayerSnapshot { DemoRecordID = demoRecordID, SteamID = p.SteamID, NameSnapshot = p.Name })
            .ToList();
        var matchStats = validPlayers
            .Select(p => PlayerPackageStatsToMatchRecord(demoRecordID, p, match, data))
            .ToList();

        repo.SaveParsedDemo(savedDemo, participants, playerSnapshots, matchStats, analysis, followPlayers);
        result.SavedDemo = savedDemo;
        return result;
    }

    public static string RandomHex(int length)
    {
        var bytes = RandomNumberGenerator.GetBytes((length + 1) / 2);
        var hex = Convert.ToHexString(bytes).ToLowerInvariant();
        return hex.Substring(0, length);
    }

    public static PlayerMatchRecord PlayerStatsToMatchRecord(string demoRecordID, Player player, PlayerStatsResult stats)
    {
        var record = new PlayerMatchRecord
        {
            DemoRecordID = demoRecordID,
            SteamID = player.SteamID,
            Rounds = stats.Base.Rounds,
            Kills = stats.Base.Kills,
            Deaths = stats.Base.Deaths,
            Assists = stats.Base.Assists,
            TotalDamage = stats.Base.TotalDamage,
            ADR = MetricValue(stats.Metrics, "ADR"),
            KAST = MetricValue(stats.Metrics, "KAST"),
            Impact = MetricValue(stats.Metrics, "Impact"),
            Rating = MetricValue(stats.Metrics, "Rating"),
            Metrics = MetricsInOrder(stats.Metrics),
        };
        if (stats.Rating3Available && stats.Rating3Metrics != null)
        {
            record.Rating3 = MetricValue(stats.Rating3Metrics, "Rating");
            record.MultiKill = MetricValue(stats.Rating3Metrics, "Multi-Kill");
            record.RoundSwing = stats.RoundSwing;
            record.RatingAlgorithm = Rating3.AlgorithmVersion;
            record.Rating3Metrics = MetricsForOrder(stats.Rating3Metrics, MetricOrder.Rating3.ToList());
        }
        return record;
    }

    /// <summary>
    /// match 级统计来自 Cs2Demo.Analytics（csda）口径。
    /// 注意：Multi-Kill 仍按本项目口径（每回合 ≥2 杀的回合占比）在映射后的 DemoData 上本地计算；
    /// 包 0.4.0 的 PlayerMatchStats30.MultiKill 也是同一占比口径 ×100，保留本地计算以与 DemoData 映射保持一致。
    /// Rating3Metrics 的 KPR/ADR 必须与 Rating 2.0 剖面完全一致（csda 原始口径）；
    /// 包的 s3.EKpr/s3.EAdr 是包内 Rating30 公式的对枪难度加权输入，仅用于计算 Rating，
    /// 绝不可再作为 KPR/ADR 对外显示（否则两版剖面会出现「切到 3.0 数值变小」的观感）。
    /// </summary>
    public static PlayerMatchRecord PlayerPackageStatsToMatchRecord(string demoRecordID, Player player, MatchData match, DemoData demo)
    {
        var s1 = StatsCalculator.Calculate(match, player.SteamID);
        var s3 = StatsCalculator.Calculate30(match, player.SteamID);

        var multiKill = MultiKillRoundShare(demo, player.SteamID);

        var record = new PlayerMatchRecord
        {
            DemoRecordID = demoRecordID,
            SteamID = player.SteamID,
            Rounds = s1?.Rounds ?? 0,
            Kills = s1?.Kills ?? 0,
            Deaths = s1?.Deaths ?? 0,
            Assists = s1?.Assists ?? 0,
            TotalDamage = s1?.TotalDamage,
            ADR = s1?.Adr,
            KAST = s1?.Kast != null ? s1.Kast.Value / 100.0 : null,
            Impact = s1?.Impact,
            Rating = s1?.Rating20,
            Metrics = BuildPackageMetrics(s1),
        };

        if (s1 != null && s3 != null && s3.Rounds > 0)
        {
            record.Rating3 = s3.Rating30;
            record.RoundSwing = s3.RoundSwing;
            record.MultiKill = multiKill;
            record.RatingAlgorithm = "cs2demo-analytics/" + s3.Version;
            record.Rating3Metrics = BuildPackageRating3Metrics(s1, s3, multiKill);
        }
        return record;
    }

    private static List<RadarMetric> BuildPackageMetrics(PlayerMatchStats? s1)
    {
        var metrics = new Dictionary<string, RadarMetric>();
        if (s1 == null || s1.Rounds <= 0)
        {
            foreach (var name in MetricOrder.Values)
            {
                var displayType = "number";
                if (name == "Surviving" || name == "KAST") displayType = "percentage";
                metrics[name] = new RadarMetric
                {
                    Name = name,
                    Value = null,
                    DisplayType = displayType,
                    MaxValue = PlayerStatsCalculator.MaxValue(name),
                    MinValue = 0,
                    Status = "unavailable",
                    Reason = "Demo 中没有可统计回合。",
                };
            }
        }
        else
        {
            metrics["KPR"] = PlayerStatsCalculator.OkMetric("KPR", s1.Kpr ?? 0, "number", "");
            metrics["Surviving"] = PlayerStatsCalculator.OkMetric("Surviving", (s1.Surviving ?? 0) / 100.0, "percentage", "");
            metrics["ADR"] = PlayerStatsCalculator.OkMetric("ADR", s1.Adr ?? 0, "number", "");
            metrics["KAST"] = PlayerStatsCalculator.OkMetric("KAST", (s1.Kast ?? 0) / 100.0, "percentage", "");
            metrics["Impact"] = PlayerStatsCalculator.OkMetric("Impact", s1.Impact ?? 0, "number", "");
            metrics["Rating"] = PlayerStatsCalculator.OkMetric("Rating", s1.Rating20 ?? 0, "number", "");
        }
        return MetricsInOrder(metrics);
    }

    private static List<RadarMetric> BuildPackageRating3Metrics(PlayerMatchStats s1, PlayerMatchStats30 s3, double? multiKill)
        => MetricsForOrder(new Dictionary<string, RadarMetric>
        {
            // KPR/ADR 与 Rating 2.0 剖面同源（csda 原始口径），两个剖面必须显示相同的数值。
            // s3.EKpr/s3.EAdr 只参与包内 Rating30 公式，不再外露。
            ["KPR"] = PlayerStatsCalculator.OkMetric("KPR", s1.Kpr ?? 0, "number", ""),
            ["Surviving"] = PlayerStatsCalculator.OkMetric("Surviving", (s1.Surviving ?? 0) / 100.0, "percentage", ""),
            ["ADR"] = PlayerStatsCalculator.OkMetric("ADR", s1.Adr ?? 0, "number", ""),
            ["KAST"] = PlayerStatsCalculator.OkMetric("KAST", (s1.Kast ?? 0) / 100.0, "percentage", ""),
            ["Multi-Kill"] = PlayerStatsCalculator.OkMetric("Multi-Kill", multiKill ?? 0, "percentage", "多杀回合占比（每回合≥2杀）。"),
            ["Rating"] = PlayerStatsCalculator.OkMetric("Rating", s3.Rating30 ?? 0, "number", ""),
        }, MetricOrder.Rating3.ToList());

    private static double? MultiKillRoundShare(DemoData demo, string steamID)
    {
        var rounds = demo.Rounds.Count;
        if (rounds == 0) return null;
        var killsByRound = new Dictionary<int, int>();
        foreach (var evt in demo.Kills)
        {
            if (evt.AttackerSteamID != steamID)
                continue;
            if (evt.AttackerSteamID == "" || evt.VictimSteamID == "" || evt.AttackerSteamID == evt.VictimSteamID || Rating3.SameSide(evt.AttackerSide, evt.VictimSide))
                continue;
            killsByRound[evt.RoundNumber] = killsByRound.GetValueOrDefault(evt.RoundNumber) + 1;
        }
        var multiKillRounds = killsByRound.Count(kv => kv.Value > 1);
        return PlayerStatsCalculator.Round3((double)multiKillRounds / rounds);
    }

    private static double? MetricValue(Dictionary<string, RadarMetric> metrics, string name)
        => metrics.TryGetValue(name, out var m) ? m.Value : null;

    private static List<RadarMetric> MetricsInOrder(Dictionary<string, RadarMetric> metrics)
        => MetricOrder.Values.Select(name => metrics.GetValueOrDefault(name) ?? new RadarMetric { Name = name }).ToList();

    private static List<RadarMetric> MetricsForOrder(Dictionary<string, RadarMetric> metrics, List<string> order)
        => order.Select(name => metrics.GetValueOrDefault(name) ?? new RadarMetric { Name = name }).ToList();
}