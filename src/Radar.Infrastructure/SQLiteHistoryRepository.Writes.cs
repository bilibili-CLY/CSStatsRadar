using System.Text.Json;
using Microsoft.Data.Sqlite;
using Radar.Domain.Models;

namespace Radar.Infrastructure;

public partial class SQLiteHistoryRepository
{
    public SavedDemo SaveParsedDemo(SavedDemo demo, List<DemoPlayerSnapshot> participants, List<DemoPlayerSnapshot> players, List<PlayerMatchRecord> matchStats, DemoAnalysis? analysis, bool followPlayers)
    {
        lock (mu)
        {
            using var tx = Conn().BeginTransaction();
            try
            {
                using (var cmd = NewCmd("INSERT OR IGNORE INTO demos (id, file_name, match_time, map_name, player_set_hash, dedupe_key, imported_at, file_sha256, source_path, match_time_source) VALUES ($id, $fn, $mt, $map, $psh, $dk, $ia, $sha, $sp, $mts)"))
                {
                    cmd.Transaction = tx;
                    cmd.Parameters.AddWithValue("$id", demo.DemoRecordID);
                    cmd.Parameters.AddWithValue("$fn", demo.FileName);
                    cmd.Parameters.AddWithValue("$mt", FormatDBTime(demo.MatchTime));
                    cmd.Parameters.AddWithValue("$map", demo.MapName);
                    cmd.Parameters.AddWithValue("$psh", demo.PlayerSetHash);
                    cmd.Parameters.AddWithValue("$dk", demo.DedupeKey);
                    cmd.Parameters.AddWithValue("$ia", FormatDBTime(demo.ImportedAt));
                    cmd.Parameters.AddWithValue("$sha", demo.FileSHA256);
                    cmd.Parameters.AddWithValue("$sp", demo.SourcePath);
                    cmd.Parameters.AddWithValue("$mts", demo.MatchTimeSource);
                    cmd.ExecuteNonQuery();
                }

                using (var lookup = NewCmd("SELECT id FROM demos WHERE dedupe_key = $dk"))
                {
                    lookup.Transaction = tx;
                    lookup.Parameters.AddWithValue("$dk", demo.DedupeKey);
                    var existingID = Convert.ToString(lookup.ExecuteScalar());
                    if (!string.IsNullOrEmpty(existingID) && existingID != demo.DemoRecordID)
                        demo.DemoRecordID = existingID;
                }

                foreach (var p in participants)
                    using (var cmd = NewCmd("INSERT OR IGNORE INTO demo_participants (demo_id, steam_id, name_snapshot) VALUES ($did, $sid, $name)"))
                    {
                        cmd.Transaction = tx;
                        cmd.Parameters.AddWithValue("$did", demo.DemoRecordID);
                        cmd.Parameters.AddWithValue("$sid", p.SteamID);
                        cmd.Parameters.AddWithValue("$name", p.NameSnapshot);
                        cmd.ExecuteNonQuery();
                    }

                foreach (var p in players)
                {
                    var now = FormatDBTime(DateTimeOffset.UtcNow);
                    using (var cmd = NewCmd(@"INSERT INTO players (steam_id, latest_name, first_seen_at, last_seen_at)
VALUES ($sid, $name, $t, $t)
ON CONFLICT(steam_id) DO UPDATE SET
  latest_name = CASE WHEN excluded.last_seen_at >= players.last_seen_at THEN excluded.latest_name ELSE players.latest_name END,
  last_seen_at = CASE WHEN excluded.last_seen_at >= players.last_seen_at THEN excluded.last_seen_at ELSE players.last_seen_at END"))
                    {
                        cmd.Transaction = tx;
                        cmd.Parameters.AddWithValue("$sid", p.SteamID);
                        cmd.Parameters.AddWithValue("$name", p.NameSnapshot);
                        cmd.Parameters.AddWithValue("$t", now);
                        cmd.ExecuteNonQuery();
                    }
                    using (var cmd = NewCmd("INSERT OR IGNORE INTO demo_players (demo_id, steam_id, name_snapshot) VALUES ($did, $sid, $name)"))
                    {
                        cmd.Transaction = tx;
                        cmd.Parameters.AddWithValue("$did", demo.DemoRecordID);
                        cmd.Parameters.AddWithValue("$sid", p.SteamID);
                        cmd.Parameters.AddWithValue("$name", p.NameSnapshot);
                        cmd.ExecuteNonQuery();
                    }
                    if (followPlayers)
                        using (var cmd = NewCmd("INSERT INTO followed_players (steam_id, display_name, followed_at) VALUES ($sid, $name, $t) ON CONFLICT(steam_id) DO UPDATE SET display_name=excluded.display_name"))
                        {
                            cmd.Transaction = tx;
                            cmd.Parameters.AddWithValue("$sid", p.SteamID);
                            cmd.Parameters.AddWithValue("$name", p.NameSnapshot);
                            cmd.Parameters.AddWithValue("$t", now);
                            cmd.ExecuteNonQuery();
                        }
                }

                foreach (var m in matchStats)
                    using (var cmd = NewCmd(@"INSERT OR IGNORE INTO player_match_stats
(demo_id, steam_id, rounds, kills, deaths, assists, total_damage, adr, kast, impact, rating, metrics_json,
 rating_3, round_swing, multi_kill, rating_algorithm, rating_3_metrics_json)
VALUES ($did, $sid, $rounds, $kills, $deaths, $assists, $td, $adr, $kast, $impact, $rating, $metrics,
 $r3, $swing, $mk, $algo, $r3metrics)"))
                    {
                        cmd.Transaction = tx;
                        cmd.Parameters.AddWithValue("$did", demo.DemoRecordID);
                        cmd.Parameters.AddWithValue("$sid", m.SteamID);
                        cmd.Parameters.AddWithValue("$rounds", m.Rounds);
                        cmd.Parameters.AddWithValue("$kills", m.Kills);
                        cmd.Parameters.AddWithValue("$deaths", m.Deaths);
                        cmd.Parameters.AddWithValue("$assists", m.Assists);
                        cmd.Parameters.AddWithValue("$td", (object?)m.TotalDamage ?? DBNull.Value);
                        cmd.Parameters.AddWithValue("$adr", (object?)m.ADR ?? DBNull.Value);
                        cmd.Parameters.AddWithValue("$kast", (object?)m.KAST ?? DBNull.Value);
                        cmd.Parameters.AddWithValue("$impact", (object?)m.Impact ?? DBNull.Value);
                        cmd.Parameters.AddWithValue("$rating", (object?)m.Rating ?? DBNull.Value);
                        cmd.Parameters.AddWithValue("$metrics", JsonSerializer.Serialize(m.Metrics));
                        cmd.Parameters.AddWithValue("$r3", (object?)m.Rating3 ?? DBNull.Value);
                        cmd.Parameters.AddWithValue("$swing", (object?)m.RoundSwing ?? DBNull.Value);
                        cmd.Parameters.AddWithValue("$mk", (object?)m.MultiKill ?? DBNull.Value);
                        cmd.Parameters.AddWithValue("$algo", m.RatingAlgorithm);
                        cmd.Parameters.AddWithValue("$r3metrics", JsonSerializer.Serialize(m.Rating3Metrics));
                        cmd.ExecuteNonQuery();
                    }

                if (analysis != null)
                {
                    var json = JsonSerializer.Serialize(analysis);
                    using (var cmd = NewCmd("INSERT INTO demo_analysis (demo_id, version, payload_json, generated_at) VALUES ($id, $ver, $json, $t) ON CONFLICT(demo_id) DO UPDATE SET version=excluded.version, payload_json=excluded.payload_json, generated_at=excluded.generated_at"))
                    {
                        cmd.Transaction = tx;
                        cmd.Parameters.AddWithValue("$id", demo.DemoRecordID);
                        cmd.Parameters.AddWithValue("$ver", analysis.Version);
                        cmd.Parameters.AddWithValue("$json", json);
                        cmd.Parameters.AddWithValue("$t", FormatDBTime(DateTimeOffset.UtcNow));
                        cmd.ExecuteNonQuery();
                    }
                    using (var cmd = NewCmd("UPDATE demos SET analysis_version = $ver WHERE id = $id"))
                    {
                        cmd.Transaction = tx;
                        cmd.Parameters.AddWithValue("$ver", analysis.Version);
                        cmd.Parameters.AddWithValue("$id", demo.DemoRecordID);
                        cmd.ExecuteNonQuery();
                    }
                }
                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
            return demo;
        }
    }

    public void DeleteDemos(List<string> demoIDs)
    {
        lock (mu)
        {
            using var tx = Conn().BeginTransaction();
            try
            {
                foreach (var id in demoIDs)
                {
                    using (var cmd = NewCmd("DELETE FROM player_match_stats WHERE demo_id = $id")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$id", id); cmd.ExecuteNonQuery(); }
                    using (var cmd = NewCmd("DELETE FROM match_group_items WHERE demo_id = $id")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$id", id); cmd.ExecuteNonQuery(); }
                    using (var cmd = NewCmd("DELETE FROM demo_players WHERE demo_id = $id")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$id", id); cmd.ExecuteNonQuery(); }
                    using (var cmd = NewCmd("DELETE FROM demo_participants WHERE demo_id = $id")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$id", id); cmd.ExecuteNonQuery(); }
                    using (var cmd = NewCmd("DELETE FROM demo_tags WHERE demo_id = $id")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$id", id); cmd.ExecuteNonQuery(); }
                    using (var cmd = NewCmd("DELETE FROM demo_analysis WHERE demo_id = $id")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$id", id); cmd.ExecuteNonQuery(); }
                    using (var cmd = NewCmd("DELETE FROM demos WHERE id = $id")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$id", id); cmd.ExecuteNonQuery(); }
                }
                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }
    }

    public void DeletePlayer(string steamID)
    {
        lock (mu)
        {
            using var tx = Conn().BeginTransaction();
            try
            {
                using (var cmd = NewCmd("DELETE FROM player_match_stats WHERE steam_id = $sid")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$sid", steamID); cmd.ExecuteNonQuery(); }
                using (var cmd = NewCmd("DELETE FROM match_group_items WHERE steam_id = $sid")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$sid", steamID); cmd.ExecuteNonQuery(); }
                using (var cmd = NewCmd("DELETE FROM match_groups WHERE steam_id = $sid")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$sid", steamID); cmd.ExecuteNonQuery(); }
                using (var cmd = NewCmd("DELETE FROM player_images WHERE steam_id = $sid")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$sid", steamID); cmd.ExecuteNonQuery(); }
                using (var cmd = NewCmd("DELETE FROM player_mvp_backgrounds WHERE steam_id = $sid")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$sid", steamID); cmd.ExecuteNonQuery(); }
                using (var cmd = NewCmd("DELETE FROM demo_players WHERE steam_id = $sid")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$sid", steamID); cmd.ExecuteNonQuery(); }
                using (var cmd = NewCmd("DELETE FROM players WHERE steam_id = $sid")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$sid", steamID); cmd.ExecuteNonQuery(); }
                using (var cmd = NewCmd("DELETE FROM demos WHERE NOT EXISTS (SELECT 1 FROM demo_players dp WHERE dp.demo_id = demos.id)")) { cmd.Transaction = tx; cmd.ExecuteNonQuery(); }
                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }
    }

    public void DeleteAllPlayers()
    {
        lock (mu)
        {
            using var tx = Conn().BeginTransaction();
            try
            {
                var tables = new[]
                {
                    "editor_drafts", "player_match_stats", "match_group_items", "match_groups", "demo_analysis", "player_images",
                    "player_mvp_backgrounds", "player_avatars", "demo_players", "demo_participants",
                    "demo_tags", "players", "demos", "discovered_players", "followed_players", "tags",
                };
                foreach (var table in tables)
                {
                    using var cmd = NewCmd($"DELETE FROM {table}");
                    cmd.Transaction = tx;
                    cmd.ExecuteNonQuery();
                }
                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }
    }

    public void DeletePlayerMatch(string steamID, string demoRecordID)
    {
        lock (mu)
        {
            using var tx = Conn().BeginTransaction();
            try
            {
                using (var cmd = NewCmd("DELETE FROM player_match_stats WHERE demo_id = $did AND steam_id = $sid"))
                {
                    cmd.Transaction = tx;
                    cmd.Parameters.AddWithValue("$did", demoRecordID);
                    cmd.Parameters.AddWithValue("$sid", steamID);
                    cmd.ExecuteNonQuery();
                }
                using (var cmd = NewCmd("DELETE FROM match_group_items WHERE demo_id = $did AND steam_id = $sid"))
                {
                    cmd.Transaction = tx;
                    cmd.Parameters.AddWithValue("$did", demoRecordID);
                    cmd.Parameters.AddWithValue("$sid", steamID);
                    cmd.ExecuteNonQuery();
                }
                using (var cmd = NewCmd("DELETE FROM demo_players WHERE demo_id = $did AND steam_id = $sid"))
                {
                    cmd.Transaction = tx;
                    cmd.Parameters.AddWithValue("$did", demoRecordID);
                    cmd.Parameters.AddWithValue("$sid", steamID);
                    cmd.ExecuteNonQuery();
                }
                using (var cmd = NewCmd(@"DELETE FROM players WHERE steam_id = $sid AND NOT EXISTS (SELECT 1 FROM demo_players dp WHERE dp.steam_id = players.steam_id)"))
                {
                    cmd.Transaction = tx;
                    cmd.Parameters.AddWithValue("$sid", steamID);
                    cmd.ExecuteNonQuery();
                }
                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }
    }

    public void UpdateRating3Stats(PlayerMatchRecord record)
    {
        lock (mu)
        {
            using var cmd = NewCmd(@"UPDATE player_match_stats SET rating_3 = $r3, round_swing = $swing, multi_kill = $mk, rating_algorithm = $algo, rating_3_metrics_json = $json WHERE demo_id = $did AND steam_id = $sid");
            cmd.Parameters.AddWithValue("$r3", (object?)record.Rating3 ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$swing", (object?)record.RoundSwing ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$mk", (object?)record.MultiKill ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$algo", record.RatingAlgorithm);
            cmd.Parameters.AddWithValue("$json", JsonSerializer.Serialize(record.Rating3Metrics));
            cmd.Parameters.AddWithValue("$did", record.DemoRecordID);
            cmd.Parameters.AddWithValue("$sid", record.SteamID);
            cmd.ExecuteNonQuery();
        }
    }

    public void SavePlayerAvatar(PlayerAvatarCache avatar)
    {
        lock (mu)
        {
            using var cmd = NewCmd(@"INSERT INTO player_avatars (steam_id, source_url, cache_path, status, updated_at) VALUES ($sid, $url, $path, $status, $t)
ON CONFLICT(steam_id) DO UPDATE SET source_url=excluded.source_url, cache_path=excluded.cache_path, status=excluded.status, updated_at=excluded.updated_at");
            cmd.Parameters.AddWithValue("$sid", avatar.SteamID);
            cmd.Parameters.AddWithValue("$url", avatar.SourceURL);
            cmd.Parameters.AddWithValue("$path", avatar.CachePath);
            cmd.Parameters.AddWithValue("$status", avatar.Status);
            cmd.Parameters.AddWithValue("$t", FormatDBTime(avatar.UpdatedAt));
            cmd.ExecuteNonQuery();
        }
    }

    public PlayerAvatarCache? GetPlayerAvatar(string steamID)
    {
        lock (mu)
        {
            using var cmd = NewCmd("SELECT steam_id, source_url, cache_path, status, updated_at FROM player_avatars WHERE steam_id = $sid");
            cmd.Parameters.AddWithValue("$sid", steamID);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return null;
            return new PlayerAvatarCache
            {
                SteamID = reader.GetString(0),
                SourceURL = reader.GetString(1),
                CachePath = reader.GetString(2),
                Status = reader.GetString(3),
                UpdatedAt = ParseDBTime(reader.GetString(4)),
            };
        }
    }

    public PlayerImage? GetPlayerImage(string steamID)
    {
        lock (mu)
        {
            if (GetPlayer(steamID) == null)
                throw new InvalidOperationException("player_record_not_found");
            using var cmd = NewCmd("SELECT steam_id, image_source_type, image_path, image_url, updated_at FROM player_images WHERE steam_id = $sid");
            cmd.Parameters.AddWithValue("$sid", steamID);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return null;
            return new PlayerImage
            {
                SteamID = reader.GetString(0),
                ImageSourceType = reader.GetString(1),
                ImagePath = reader.IsDBNull(2) ? "" : reader.GetString(2),
                ImageURL = reader.IsDBNull(3) ? "" : reader.GetString(3),
                UpdatedAt = ParseDBTime(reader.GetString(4)),
            };
        }
    }

    public PlayerImage SavePlayerImage(PlayerImage image)
    {
        lock (mu)
        {
            if (GetPlayer(image.SteamID) == null)
                throw new InvalidOperationException("player_record_not_found");
            if (image.UpdatedAt == default) image.UpdatedAt = DateTimeOffset.UtcNow;
            using var cmd = NewCmd(@"INSERT INTO player_images (steam_id, image_source_type, image_path, image_url, updated_at)
VALUES ($sid, $type, $path, $url, $t)
ON CONFLICT(steam_id) DO UPDATE SET
  image_source_type = excluded.image_source_type,
  image_path = excluded.image_path,
  image_url = excluded.image_url,
  updated_at = excluded.updated_at");
            cmd.Parameters.AddWithValue("$sid", image.SteamID);
            cmd.Parameters.AddWithValue("$type", image.ImageSourceType);
            cmd.Parameters.AddWithValue("$path", (object?)image.ImagePath ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$url", (object?)image.ImageURL ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$t", FormatDBTime(image.UpdatedAt));
            cmd.ExecuteNonQuery();
            return image;
        }
    }

    public void DeletePlayerImage(string steamID)
    {
        lock (mu)
        {
            if (GetPlayer(steamID) == null)
                throw new InvalidOperationException("player_record_not_found");
            using var cmd = NewCmd("DELETE FROM player_images WHERE steam_id = $sid");
            cmd.Parameters.AddWithValue("$sid", steamID);
            cmd.ExecuteNonQuery();
        }
    }

    public PlayerMVPBackground? GetPlayerMVPBackground(string steamID)
    {
        lock (mu)
        {
            if (GetPlayer(steamID) == null)
                throw new InvalidOperationException("player_record_not_found");
            using var cmd = NewCmd("SELECT steam_id, image_path, updated_at FROM player_mvp_backgrounds WHERE steam_id = $sid");
            cmd.Parameters.AddWithValue("$sid", steamID);
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return null;
            return new PlayerMVPBackground
            {
                SteamID = reader.GetString(0),
                ImagePath = reader.GetString(1),
                UpdatedAt = ParseDBTime(reader.GetString(2)),
            };
        }
    }

    public PlayerMVPBackground SavePlayerMVPBackground(PlayerMVPBackground background)
    {
        lock (mu)
        {
            if (GetPlayer(background.SteamID) == null)
                throw new InvalidOperationException("player_record_not_found");
            if (string.IsNullOrWhiteSpace(background.ImagePath))
                throw new InvalidOperationException("invalid_player_image");
            if (background.UpdatedAt == default) background.UpdatedAt = DateTimeOffset.UtcNow;
            using var cmd = NewCmd(@"INSERT INTO player_mvp_backgrounds (steam_id, image_path, updated_at)
VALUES ($sid, $path, $t)
ON CONFLICT(steam_id) DO UPDATE SET
  image_path = excluded.image_path,
  updated_at = excluded.updated_at");
            cmd.Parameters.AddWithValue("$sid", background.SteamID);
            cmd.Parameters.AddWithValue("$path", background.ImagePath);
            cmd.Parameters.AddWithValue("$t", FormatDBTime(background.UpdatedAt));
            cmd.ExecuteNonQuery();
            return background;
        }
    }

    public void DeletePlayerMVPBackground(string steamID)
    {
        lock (mu)
        {
            if (GetPlayer(steamID) == null)
                throw new InvalidOperationException("player_record_not_found");
            using var cmd = NewCmd("DELETE FROM player_mvp_backgrounds WHERE steam_id = $sid");
            cmd.Parameters.AddWithValue("$sid", steamID);
            cmd.ExecuteNonQuery();
        }
    }
}