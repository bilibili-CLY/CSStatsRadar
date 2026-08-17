using System.Security.Cryptography;
using System.Text;
using Radar.Domain.Models;

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
    void DeletePlayer(string steamID);
    void DeleteAllPlayers();
    void DeletePlayerMatch(string steamID, string demoRecordID);
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
    private readonly PlayerStatsCalculator stats = new();

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

    public HistorySaveResult FollowParsedDemoPlayersAtSource(string fileName, string sourcePath, DemoData data, List<string>? allowedSteamIDs)
        => SaveParsedDemoForPlayersAtSourceInternal(fileName, sourcePath, data, allowedSteamIDs, followPlayers: true);

    public HistorySaveResult SaveParsedDemoForPlayersAtSource(string fileName, string sourcePath, DemoData data, List<string>? allowedSteamIDs)
        => SaveParsedDemoForPlayersAtSourceInternal(fileName, sourcePath, data, allowedSteamIDs, followPlayers: false);

    private HistorySaveResult SaveParsedDemoForPlayersAtSourceInternal(string fileName, string sourcePath, DemoData data, List<string>? allowedSteamIDs, bool followPlayers)
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
            .Select(p => PlayerStatsToMatchRecord(demoRecordID, p, stats.Calculate(data, p)))
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

    private static double? MetricValue(Dictionary<string, RadarMetric> metrics, string name)
        => metrics.TryGetValue(name, out var m) ? m.Value : null;

    private static List<RadarMetric> MetricsInOrder(Dictionary<string, RadarMetric> metrics)
        => MetricOrder.Values.Select(name => metrics.GetValueOrDefault(name) ?? new RadarMetric { Name = name }).ToList();

    private static List<RadarMetric> MetricsForOrder(Dictionary<string, RadarMetric> metrics, List<string> order)
        => order.Select(name => metrics.GetValueOrDefault(name) ?? new RadarMetric { Name = name }).ToList();
}