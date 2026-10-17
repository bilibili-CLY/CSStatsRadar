using System.Text.Json.Serialization;

namespace Radar.Domain.Models;

public class ImportSource
{
    [JsonPropertyName("id")] public string ID { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("path")] public string Path { get; set; } = "";
    [JsonPropertyName("created_at")] public string CreatedAt { get; set; } = "";
}

public class ImportItemResult
{
    [JsonPropertyName("path")] public string Path { get; set; } = "";
    [JsonPropertyName("file_name")] public string FileName { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("message")] public string Message { get; set; } = "";
    [JsonPropertyName("demo_id")] public string DemoID { get; set; } = "";
    [JsonPropertyName("map_name")] public string MapName { get; set; } = "";
    [JsonPropertyName("rounds")] public int Rounds { get; set; }
    [JsonPropertyName("players")] public List<Player> Players { get; set; } = new();
    [JsonPropertyName("player_details")] public List<ImportPlayerDetail> PlayerDetails { get; set; } = new();
    [JsonPropertyName("saved_count")] public int SavedCount { get; set; }
}

public class ImportPlayerDetail
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
    [JsonPropertyName("team")] public string Team { get; set; } = "";
    [JsonPropertyName("kills")] public int Kills { get; set; }
    [JsonPropertyName("deaths")] public int Deaths { get; set; }
    [JsonPropertyName("assists")] public int Assists { get; set; }
}

/// <summary>批量清洗战队前缀的单个玩家结果（CleanTeamPrefixNames）。</summary>
public class TeamPrefixCleanResult
{
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
    [JsonPropertyName("old_name")] public string OldName { get; set; } = "";
    [JsonPropertyName("new_name")] public string NewName { get; set; } = "";
    /// <summary>renamed / skipped / failed</summary>
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("reason")] public string Reason { get; set; } = "";
}

public class ImportSummary
{
    [JsonPropertyName("job_id")] public string JobID { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("total")] public int Total { get; set; }
    [JsonPropertyName("processed")] public int Processed { get; set; }
    [JsonPropertyName("imported")] public int Imported { get; set; }
    [JsonPropertyName("duplicates")] public int Duplicates { get; set; }
    [JsonPropertyName("failed")] public int Failed { get; set; }
    [JsonPropertyName("items")] public List<ImportItemResult> Items { get; set; } = new();
    [JsonPropertyName("discovered_players")] public List<Player> Discovered { get; set; } = new();
    [JsonPropertyName("started_at")] public string StartedAt { get; set; } = "";
    [JsonPropertyName("completed_at")] public string CompletedAt { get; set; } = "";
}

public class SavedDemo
{
    [JsonPropertyName("demo_record_id")] public string DemoRecordID { get; set; } = "";
    [JsonPropertyName("file_name")] public string FileName { get; set; } = "";
    [JsonPropertyName("match_time")] public DateTimeOffset MatchTime { get; set; }
    [JsonPropertyName("match_time_source")] public string MatchTimeSource { get; set; } = "";
    [JsonPropertyName("map_name")] public string MapName { get; set; } = "";
    [JsonPropertyName("file_sha256")] public string FileSHA256 { get; set; } = "";
    [JsonPropertyName("source_path")] public string SourcePath { get; set; } = "";
    [JsonIgnore] public string PlayerSetHash { get; set; } = "";
    [JsonIgnore] public string DedupeKey { get; set; } = "";
    [JsonPropertyName("imported_at")] public DateTimeOffset ImportedAt { get; set; }
    [JsonPropertyName("note")] public string Note { get; set; } = "";
    [JsonPropertyName("analysis_version")] public string AnalysisVersion { get; set; } = "";
    [JsonPropertyName("participants")] public List<Player> Participants { get; set; } = new();
    [JsonPropertyName("player_stat_steam_ids")] public List<string> PlayerStatSteamIDs { get; set; } = new();
    [JsonPropertyName("rounds")] public int Rounds { get; set; }
    [JsonPropertyName("score_a")] public int ScoreA { get; set; }
    [JsonPropertyName("score_b")] public int ScoreB { get; set; }
    [JsonPropertyName("analysis_ready")] public bool AnalysisReady { get; set; }
}

public class SavedPlayer
{
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("match_count")] public int MatchCount { get; set; }
    [JsonPropertyName("latest_match_time")] public DateTimeOffset LatestMatchTime { get; set; }
    [JsonPropertyName("latest_imported_at")] public DateTimeOffset LatestImportedAt { get; set; }
    [JsonPropertyName("followed")] public bool Followed { get; set; }
}

public class MatchGroup
{
    [JsonPropertyName("id")] public long ID { get; set; }
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("demo_ids")] public List<string> DemoIDs { get; set; } = new();
}

public class PlayerAvatar
{
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
    [JsonPropertyName("data_url")] public string DataURL { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("updated_at")] public string UpdatedAt { get; set; } = "";
}

public class PlayerAvatarCache
{
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
    [JsonPropertyName("source_url")] public string SourceURL { get; set; } = "";
    [JsonIgnore] public string CachePath { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("updated_at")] public DateTimeOffset UpdatedAt { get; set; }
}

public class DesktopPlayerMedia
{
    [JsonPropertyName("image_url")] public string ImageURL { get; set; } = "";
    [JsonPropertyName("background_url")] public string BackgroundURL { get; set; } = "";
}

public class EditorDraft
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("payload")] public string Payload { get; set; } = "";
    [JsonPropertyName("updated_at")] public string UpdatedAt { get; set; } = "";
}

public class NormalizedPoint
{
    [JsonPropertyName("x")] public double X { get; set; }
    [JsonPropertyName("y")] public double Y { get; set; }
}

public class ShowcaseLayout
{
    [JsonPropertyName("radar_position")] public NormalizedPoint RadarPosition { get; set; } = new();
    [JsonPropertyName("name_position")] public NormalizedPoint NamePosition { get; set; } = new();
    [JsonPropertyName("image_position")] public NormalizedPoint ImagePosition { get; set; } = new();
}

public class ShowcaseConfig
{
    [JsonPropertyName("default_duration_ms")] public int DefaultDurationMS { get; set; }
    [JsonPropertyName("layout")] public ShowcaseLayout Layout { get; set; } = new();
    [JsonPropertyName("music_path")] public string MusicPath { get; set; } = "";
    [JsonPropertyName("show_best_markers")] public bool ShowBestMarkers { get; set; }
    [JsonPropertyName("show_intro_animation")] public bool ShowIntroAnimation { get; set; } = true;
    [JsonPropertyName("show_best_entrance_animation")] public bool ShowBestEntranceAnimation { get; set; } = true;
    [JsonPropertyName("audio_offset_ms")] public int AudioOffsetMS { get; set; }
    [JsonPropertyName("ffmpeg_path")] public string FFmpegPath { get; set; } = "";
    [JsonPropertyName("radar_scale_mode")] public string RadarScaleMode { get; set; } = "global";
    [JsonPropertyName("radar_scale")] public double RadarScale { get; set; } = 1.0;
    [JsonPropertyName("radar_axis_scale")] public Dictionary<string, double> RadarAxisScale { get; set; } = new();
    [JsonPropertyName("radar_floor")] public Dictionary<string, double> RadarFloor { get; set; } = new();
}

public class AppConfig
{
    [JsonPropertyName("export_width")] public int ExportWidth { get; set; }
    [JsonPropertyName("export_height")] public int ExportHeight { get; set; }
    [JsonPropertyName("theme_color")] public string ThemeColor { get; set; } = "";
    [JsonPropertyName("color_preset")] public string ColorPreset { get; set; } = "";
    [JsonPropertyName("last_player_identifier_type")] public string LastPlayerIdentifierType { get; set; } = "name";
    [JsonPropertyName("database_path")] public string DatabasePath { get; set; } = "";
    [JsonPropertyName("showcase")] public ShowcaseConfig Showcase { get; set; } = new();
    [JsonPropertyName("import_sources")] public List<ImportSource> ImportSources { get; set; } = new();
    [JsonPropertyName("video_fps")] public int VideoFPS { get; set; }
    [JsonPropertyName("reduce_motion")] public bool ReduceMotion { get; set; }
    [JsonPropertyName("rating_version")] public string RatingVersion { get; set; } = "rating_2";
    [JsonPropertyName("show_rating_watermark")] public bool ShowRatingWatermark { get; set; } = true;
    [JsonPropertyName("team_tags")] public string TeamTags { get; set; } = "";
    [JsonPropertyName("warning")] public string Warning { get; set; } = "";
}

public class BootstrapState
{
    [JsonPropertyName("config")] public AppConfig Config { get; set; } = new();
    [JsonPropertyName("players")] public List<SavedPlayer> Players { get; set; } = new();
    [JsonPropertyName("followed_players")] public List<Player> Followed { get; set; } = new();
    [JsonPropertyName("ffmpeg_path")] public string FFmpeg { get; set; } = "";
}

public class PlayerImage
{
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
    [JsonPropertyName("image_source_type")] public string ImageSourceType { get; set; } = "";
    [JsonPropertyName("image_path")] public string ImagePath { get; set; } = "";
    [JsonPropertyName("image_url")] public string ImageURL { get; set; } = "";
    [JsonPropertyName("public_url")] public string PublicURL { get; set; } = "";
    [JsonPropertyName("updated_at")] public DateTimeOffset UpdatedAt { get; set; }
}

public class PlayerMVPBackground
{
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
    [JsonPropertyName("image_path")] public string ImagePath { get; set; } = "";
    [JsonPropertyName("public_url")] public string PublicURL { get; set; } = "";
    [JsonPropertyName("updated_at")] public DateTimeOffset UpdatedAt { get; set; }
}

public class ShowcaseMusicInfo
{
    [JsonPropertyName("url")] public string URL { get; set; } = "";
    [JsonPropertyName("duration_ms")] public int DurationMS { get; set; }
}

public class AggregateRadarRequest
{
    [JsonPropertyName("demo_record_ids")] public List<string> DemoRecordIDs { get; set; } = new();
}

public class DemoPlayerSnapshot
{
    public string DemoRecordID { get; set; } = "";
    public string SteamID { get; set; } = "";
    public string NameSnapshot { get; set; } = "";
}
