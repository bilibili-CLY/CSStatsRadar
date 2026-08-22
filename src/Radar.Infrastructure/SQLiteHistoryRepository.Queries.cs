using System.Text.Json;
using Microsoft.Data.Sqlite;
using Radar.Domain.Models;

namespace Radar.Infrastructure;

public partial class SQLiteHistoryRepository
{
    public static string FormatDBTime(DateTimeOffset value) => value.ToUniversalTime().ToString("o");
    public static DateTimeOffset ParseDBTime(string value) => DateTimeOffset.Parse(value);

    private SqliteCommand NewCmd(string sql)
    {
        var cmd = Conn().CreateCommand();
        cmd.CommandText = sql;
        return cmd;
    }

    public List<Player> ListFollowedPlayers()
    {
        lock (mu)
        {
            var result = new List<Player>();
            using var cmd = NewCmd("SELECT display_name, steam_id FROM followed_players ORDER BY display_name COLLATE NOCASE");
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
                result.Add(new Player { Name = reader.GetString(0), SteamID = reader.GetString(1) });
            return result;
        }
    }

    public void SetPlayerFollowed(Player player, bool followed)
    {
        lock (mu)
        {
            using var cmd = NewCmd(followed
                ? "INSERT INTO followed_players (steam_id, display_name, followed_at) VALUES ($sid, $name, $t) ON CONFLICT(steam_id) DO UPDATE SET display_name=excluded.display_name"
                : "DELETE FROM followed_players WHERE steam_id = $sid");
            cmd.Parameters.AddWithValue("$sid", player.SteamID);
            if (followed)
            {
                cmd.Parameters.AddWithValue("$name", player.Name);
                cmd.Parameters.AddWithValue("$t", FormatDBTime(DateTimeOffset.UtcNow));
            }
            cmd.ExecuteNonQuery();
        }
    }

    public void SaveEditorDraft(EditorDraft draft)
    {
        lock (mu)
        {
            using var cmd = NewCmd("INSERT INTO editor_drafts (kind, payload_json, updated_at) VALUES ($kind, $payload, $t) ON CONFLICT(kind) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at");
            cmd.Parameters.AddWithValue("$kind", draft.Kind);
            cmd.Parameters.AddWithValue("$payload", draft.Payload);
            cmd.Parameters.AddWithValue("$t", FormatDBTime(DateTimeOffset.UtcNow));
            cmd.ExecuteNonQuery();
        }
    }

    public EditorDraft? GetEditorDraft(string kind)
    {
        lock (mu)
        {
            using var cmd = NewCmd("SELECT kind, payload_json, updated_at FROM editor_drafts WHERE kind = $kind");
            cmd.Parameters.AddWithValue("$kind", kind);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return null;
            return new EditorDraft { Kind = reader.GetString(0), Payload = reader.GetString(1), UpdatedAt = reader.GetString(2) };
        }
    }

    public SavedDemo? FindDemoByDedupeKey(string dedupeKey)
    {
        lock (mu)
        {
            using var cmd = NewCmd("SELECT id, file_name, match_time, map_name, player_set_hash, dedupe_key, imported_at, file_sha256, source_path, match_time_source FROM demos WHERE dedupe_key = $key");
            cmd.Parameters.AddWithValue("$key", dedupeKey);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return null;
            return new SavedDemo
            {
                DemoRecordID = reader.GetString(0),
                FileName = reader.GetString(1),
                MatchTime = ParseDBTime(reader.GetString(2)),
                MapName = reader.GetString(3),
                PlayerSetHash = reader.GetString(4),
                DedupeKey = reader.GetString(5),
                ImportedAt = ParseDBTime(reader.GetString(6)),
                FileSHA256 = reader.GetString(7),
                SourcePath = reader.GetString(8),
                MatchTimeSource = reader.GetString(9),
            };
        }
    }

    public List<SavedDemo> ListDemos()
    {
        lock (mu)
        {
            var result = new List<SavedDemo>();
            using (var cmd = NewCmd("SELECT id, file_name, match_time, match_time_source, map_name, file_sha256, source_path, imported_at, note, analysis_version FROM demos ORDER BY match_time DESC"))
            using (var reader = cmd.ExecuteReader())
            {
                while (reader.Read())
                    result.Add(new SavedDemo
                    {
                        DemoRecordID = reader.GetString(0),
                        FileName = reader.GetString(1),
                        MatchTime = ParseDBTime(reader.GetString(2)),
                        MatchTimeSource = reader.GetString(3),
                        MapName = reader.GetString(4),
                        FileSHA256 = reader.GetString(5),
                        SourcePath = reader.GetString(6),
                        ImportedAt = ParseDBTime(reader.GetString(7)),
                        Note = reader.GetString(8),
                        AnalysisVersion = reader.GetString(9),
                        Participants = new List<Player>(),
                        AnalysisReady = reader.GetString(9) != "",
                    });
            }
            foreach (var demo in result)
            {
                using var cmd = NewCmd("SELECT name_snapshot, steam_id FROM demo_participants WHERE demo_id = $id ORDER BY name_snapshot COLLATE NOCASE");
                cmd.Parameters.AddWithValue("$id", demo.DemoRecordID);
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                    demo.Participants.Add(new Player { Name = reader.GetString(0), SteamID = reader.GetString(1) });
            }
            var byDemoID = result.ToDictionary(demo => demo.DemoRecordID, StringComparer.Ordinal);
            using (var cmd = NewCmd("SELECT demo_id, steam_id FROM player_match_stats"))
            using (var reader = cmd.ExecuteReader())
                while (reader.Read())
                    if (byDemoID.TryGetValue(reader.GetString(0), out var demo))
                        demo.PlayerStatSteamIDs.Add(reader.GetString(1));
            return result;
        }
    }

    public SavedDemo? GetDemo(string demoID)
    {
        lock (mu)
        {
            using var cmd = NewCmd("SELECT id, file_name, match_time, match_time_source, map_name, file_sha256, source_path, imported_at, note, analysis_version FROM demos WHERE id = $id");
            cmd.Parameters.AddWithValue("$id", demoID);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return null;
            var demo = new SavedDemo
            {
                DemoRecordID = reader.GetString(0),
                FileName = reader.GetString(1),
                MatchTime = ParseDBTime(reader.GetString(2)),
                MatchTimeSource = reader.GetString(3),
                MapName = reader.GetString(4),
                FileSHA256 = reader.GetString(5),
                SourcePath = reader.GetString(6),
                ImportedAt = ParseDBTime(reader.GetString(7)),
                Note = reader.GetString(8),
                AnalysisVersion = reader.GetString(9),
                AnalysisReady = reader.GetString(9) != "",
            };
            using (var pc = NewCmd("SELECT name_snapshot, steam_id FROM demo_participants WHERE demo_id = $id ORDER BY name_snapshot COLLATE NOCASE"))
            {
                pc.Parameters.AddWithValue("$id", demoID);
                using var preader = pc.ExecuteReader();
                while (preader.Read())
                    demo.Participants.Add(new Player { Name = preader.GetString(0), SteamID = preader.GetString(1) });
            }
            using (var stats = NewCmd("SELECT steam_id FROM player_match_stats WHERE demo_id = $id"))
            {
                stats.Parameters.AddWithValue("$id", demoID);
                using var statsReader = stats.ExecuteReader();
                while (statsReader.Read()) demo.PlayerStatSteamIDs.Add(statsReader.GetString(0));
            }
            return demo;
        }
    }

    public void UpdateDemoNote(string demoID, string note)
    {
        lock (mu)
        {
            using var cmd = NewCmd("UPDATE demos SET note = $note WHERE id = $id");
            cmd.Parameters.AddWithValue("$note", note);
            cmd.Parameters.AddWithValue("$id", demoID);
            cmd.ExecuteNonQuery();
        }
    }

    public void UpdateDemoSourcePath(string demoID, string sourcePath)
    {
        lock (mu)
        {
            using var cmd = NewCmd("UPDATE demos SET source_path = $path WHERE id = $id");
            cmd.Parameters.AddWithValue("$path", sourcePath);
            cmd.Parameters.AddWithValue("$id", demoID);
            cmd.ExecuteNonQuery();
        }
    }

    public void SaveDemoAnalysis(string demoID, DemoAnalysis analysis)
    {
        lock (mu)
        {
            var json = JsonSerializer.Serialize(analysis);
            using (var cmd = NewCmd("INSERT INTO demo_analysis (demo_id, version, payload_json, generated_at) VALUES ($id, $ver, $json, $t) ON CONFLICT(demo_id) DO UPDATE SET version=excluded.version, payload_json=excluded.payload_json, generated_at=excluded.generated_at"))
            {
                cmd.Parameters.AddWithValue("$id", demoID);
                cmd.Parameters.AddWithValue("$ver", analysis.Version);
                cmd.Parameters.AddWithValue("$json", json);
                cmd.Parameters.AddWithValue("$t", FormatDBTime(DateTimeOffset.UtcNow));
                cmd.ExecuteNonQuery();
            }
            using (var cmd = NewCmd("UPDATE demos SET analysis_version = $ver WHERE id = $id"))
            {
                cmd.Parameters.AddWithValue("$ver", analysis.Version);
                cmd.Parameters.AddWithValue("$id", demoID);
                cmd.ExecuteNonQuery();
            }
        }
    }

    public DemoAnalysis? GetDemoAnalysis(string demoID)
    {
        lock (mu)
        {
            using var cmd = NewCmd("SELECT version, payload_json, generated_at FROM demo_analysis WHERE demo_id = $id");
            cmd.Parameters.AddWithValue("$id", demoID);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return null;
            var analysis = JsonSerializer.Deserialize<DemoAnalysis>(reader.GetString(1));
            if (analysis == null) return null;
            analysis.DemoID = demoID;
            analysis.Version = reader.GetString(0);
            analysis.GeneratedAt = reader.GetString(2);
            return analysis;
        }
    }

    public List<SavedPlayer> ListPlayers()
    {
        lock (mu)
        {
            const string sql = @"SELECT p.steam_id, p.latest_name, COUNT(DISTINCT d.id) AS match_count,
       COALESCE(MAX(d.match_time), p.last_seen_at) AS latest_match_time,
       COALESCE(MAX(d.imported_at), p.last_seen_at) AS latest_imported_at,
       EXISTS(SELECT 1 FROM followed_players fp WHERE fp.steam_id = p.steam_id)
FROM players p
LEFT JOIN demo_players dp ON dp.steam_id = p.steam_id
LEFT JOIN demos d ON d.id = dp.demo_id
GROUP BY p.steam_id, p.latest_name
ORDER BY latest_match_time DESC";
            var result = new List<SavedPlayer>();
            using var cmd = NewCmd(sql);
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
                result.Add(new SavedPlayer
                {
                    SteamID = reader.GetString(0),
                    Name = reader.GetString(1),
                    MatchCount = reader.GetInt32(2),
                    LatestMatchTime = ParseDBTime(reader.GetString(3)),
                    LatestImportedAt = ParseDBTime(reader.GetString(4)),
                    Followed = reader.GetInt64(5) != 0,
                });
            return result;
        }
    }

    public SavedPlayer? GetPlayer(string steamID)
    {
        lock (mu)
        {
            const string sql = @"SELECT p.steam_id, p.latest_name, COUNT(DISTINCT d.id) AS match_count,
       COALESCE(MAX(d.match_time), p.last_seen_at) AS latest_match_time,
       COALESCE(MAX(d.imported_at), p.last_seen_at) AS latest_imported_at,
       EXISTS(SELECT 1 FROM followed_players fp WHERE fp.steam_id = p.steam_id)
FROM players p
LEFT JOIN demo_players dp ON dp.steam_id = p.steam_id
LEFT JOIN demos d ON d.id = dp.demo_id
WHERE p.steam_id = $sid
GROUP BY p.steam_id, p.latest_name";
            using var cmd = NewCmd(sql);
            cmd.Parameters.AddWithValue("$sid", steamID);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return null;
            return new SavedPlayer
            {
                SteamID = reader.GetString(0),
                Name = reader.GetString(1),
                MatchCount = reader.GetInt32(2),
                LatestMatchTime = ParseDBTime(reader.GetString(3)),
                LatestImportedAt = ParseDBTime(reader.GetString(4)),
                Followed = reader.GetInt64(5) != 0,
            };
        }
    }

    private const string MatchSelect = @"SELECT d.id, d.match_time, d.match_time_source, d.imported_at, d.map_name, d.file_name, d.source_path,
       s.rounds, s.kills, s.deaths, s.assists, s.total_damage,
       s.adr, s.kast, s.impact, s.rating, s.metrics_json,
       s.rating_3, s.round_swing, s.multi_kill, s.rating_algorithm, s.rating_3_metrics_json,
       COALESCE((SELECT GROUP_CONCAT(dt.tag_name, ',') FROM demo_tags dt WHERE dt.demo_id = d.id), '')
FROM player_match_stats s
JOIN demos d ON d.id = s.demo_id";

    public List<PlayerMatchRecord> ListPlayerMatches(string steamID)
    {
        lock (mu)
        {
            var result = new List<PlayerMatchRecord>();
            using var cmd = NewCmd(MatchSelect + " WHERE s.steam_id = $sid ORDER BY d.match_time DESC");
            cmd.Parameters.AddWithValue("$sid", steamID);
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
                result.Add(ReadMatchRecord(reader));
            return result;
        }
    }

    public List<PlayerMatchRecord> GetMetricSnapshots(string steamID, List<string> demoRecordIDs)
    {
        lock (mu)
        {
            var result = new List<PlayerMatchRecord>();
            var placeholders = string.Join(",", demoRecordIDs.Select((_, i) => "$id" + i));
            using var cmd = NewCmd(MatchSelect + $" WHERE s.steam_id = $sid AND s.demo_id IN ({placeholders})");
            cmd.Parameters.AddWithValue("$sid", steamID);
            for (var i = 0; i < demoRecordIDs.Count; i++)
                cmd.Parameters.AddWithValue("$id" + i, demoRecordIDs[i]);
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
                result.Add(ReadMatchRecord(reader));
            return result;
        }
    }

    private static PlayerMatchRecord ReadMatchRecord(SqliteDataReader reader)
    {
        var record = new PlayerMatchRecord
        {
            DemoRecordID = reader.GetString(0),
            MatchTime = ParseDBTime(reader.GetString(1)),
            MatchTimeSource = reader.GetString(2),
            ImportedAt = ParseDBTime(reader.GetString(3)),
            MapName = reader.GetString(4),
            FileName = reader.GetString(5),
            SourcePath = reader.GetString(6),
            Rounds = reader.GetInt32(7),
            Kills = reader.GetInt32(8),
            Deaths = reader.GetInt32(9),
            Assists = reader.GetInt32(10),
            TotalDamage = reader.IsDBNull(11) ? null : reader.GetInt32(11),
            ADR = reader.IsDBNull(12) ? null : reader.GetDouble(12),
            KAST = reader.IsDBNull(13) ? null : reader.GetDouble(13),
            Impact = reader.IsDBNull(14) ? null : reader.GetDouble(14),
            Rating = reader.IsDBNull(15) ? null : reader.GetDouble(15),
            Metrics = JsonSerializer.Deserialize<List<RadarMetric>>(reader.GetString(16)) ?? new List<RadarMetric>(),
            Rating3 = reader.IsDBNull(17) ? null : reader.GetDouble(17),
            RoundSwing = reader.IsDBNull(18) ? null : reader.GetDouble(18),
            MultiKill = reader.IsDBNull(19) ? null : reader.GetDouble(19),
            RatingAlgorithm = reader.GetString(20),
            Rating3Metrics = JsonSerializer.Deserialize<List<RadarMetric>>(reader.GetString(21)) ?? new List<RadarMetric>(),
        };
        var tags = reader.GetString(22);
        if (!string.IsNullOrEmpty(tags))
            record.Tags = tags.Split(',').ToList();
        return record;
    }
}
