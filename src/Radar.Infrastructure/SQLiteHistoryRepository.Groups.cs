using Microsoft.Data.Sqlite;
using Radar.Domain.Models;

namespace Radar.Infrastructure;

public partial class SQLiteHistoryRepository
{
    public List<MatchGroup> ListMatchGroups(string steamID)
    {
        lock (mu)
        {
            var groups = new List<MatchGroup>();
            using (var cmd = NewCmd("SELECT id, steam_id, name FROM match_groups WHERE steam_id = $sid ORDER BY position, id"))
            {
                cmd.Parameters.AddWithValue("$sid", steamID);
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                    groups.Add(new MatchGroup
                    {
                        ID = reader.GetInt64(0),
                        SteamID = reader.GetString(1),
                        Name = reader.GetString(2),
                    });
            }
            if (groups.Count == 0) return groups;
            var byID = groups.ToDictionary(group => group.ID);
            var placeholders = string.Join(",", byID.Keys.Select((_, i) => "$g" + i));
            using (var cmd = NewCmd($"SELECT group_id, demo_id FROM match_group_items WHERE group_id IN ({placeholders})"))
            {
                var i = 0;
                foreach (var id in byID.Keys) cmd.Parameters.AddWithValue("$g" + i++, id);
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                    if (byID.TryGetValue(reader.GetInt64(0), out var group))
                        group.DemoIDs.Add(reader.GetString(1));
            }
            return groups;
        }
    }

    public MatchGroup CreateMatchGroup(string steamID, string name)
    {
        lock (mu)
        {
            if (GetPlayer(steamID) == null)
                throw new InvalidOperationException("player_record_not_found");
            long position;
            using (var cmd = NewCmd("SELECT COALESCE(MAX(position), -1) FROM match_groups WHERE steam_id = $sid"))
            {
                cmd.Parameters.AddWithValue("$sid", steamID);
                position = Convert.ToInt64(cmd.ExecuteScalar() ?? -1L) + 1;
            }
            using var insert = NewCmd("INSERT INTO match_groups (steam_id, name, position, created_at) VALUES ($sid, $name, $pos, $t); SELECT last_insert_rowid();");
            insert.Parameters.AddWithValue("$sid", steamID);
            insert.Parameters.AddWithValue("$name", name);
            insert.Parameters.AddWithValue("$pos", position);
            insert.Parameters.AddWithValue("$t", FormatDBTime(DateTimeOffset.UtcNow));
            var id = Convert.ToInt64(insert.ExecuteScalar() ?? 0L);
            return new MatchGroup { ID = id, SteamID = steamID, Name = name };
        }
    }

    public void RenameMatchGroup(long groupID, string name)
    {
        lock (mu)
        {
            using var cmd = NewCmd("UPDATE match_groups SET name = $name WHERE id = $id");
            cmd.Parameters.AddWithValue("$name", name);
            cmd.Parameters.AddWithValue("$id", groupID);
            cmd.ExecuteNonQuery();
        }
    }

    public void DeleteMatchGroup(long groupID)
    {
        lock (mu)
        {
            using var tx = Conn().BeginTransaction();
            try
            {
                using (var cmd = NewCmd("DELETE FROM match_group_items WHERE group_id = $id")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$id", groupID); cmd.ExecuteNonQuery(); }
                using (var cmd = NewCmd("DELETE FROM match_groups WHERE id = $id")) { cmd.Transaction = tx; cmd.Parameters.AddWithValue("$id", groupID); cmd.ExecuteNonQuery(); }
                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }
    }

    /// <summary>把某玩家的一场比赛移入分组；groupID 为 null 时移回未分组。同一场只能属于一个组。</summary>
    public void AssignMatchGroup(string steamID, string demoRecordID, long? groupID)
    {
        lock (mu)
        {
            using var tx = Conn().BeginTransaction();
            try
            {
                if (groupID != null)
                {
                    long ownerSteamMatches;
                    using (var cmd = NewCmd("SELECT COUNT(*) FROM match_groups WHERE id = $gid AND steam_id = $sid"))
                    {
                        cmd.Transaction = tx;
                        cmd.Parameters.AddWithValue("$gid", groupID.Value);
                        cmd.Parameters.AddWithValue("$sid", steamID);
                        ownerSteamMatches = Convert.ToInt64(cmd.ExecuteScalar() ?? 0L);
                    }
                    if (ownerSteamMatches == 0)
                        throw new InvalidOperationException("match_group_not_found");
                    long belongsToPlayer;
                    using (var cmd = NewCmd("SELECT COUNT(*) FROM player_match_stats WHERE demo_id = $did AND steam_id = $sid"))
                    {
                        cmd.Transaction = tx;
                        cmd.Parameters.AddWithValue("$did", demoRecordID);
                        cmd.Parameters.AddWithValue("$sid", steamID);
                        belongsToPlayer = Convert.ToInt64(cmd.ExecuteScalar() ?? 0L);
                    }
                    if (belongsToPlayer == 0)
                        throw new InvalidOperationException("match_record_not_found");
                }
                using (var cmd = NewCmd("DELETE FROM match_group_items WHERE demo_id = $did AND steam_id = $sid"))
                {
                    cmd.Transaction = tx;
                    cmd.Parameters.AddWithValue("$did", demoRecordID);
                    cmd.Parameters.AddWithValue("$sid", steamID);
                    cmd.ExecuteNonQuery();
                }
                if (groupID != null)
                    using (var cmd = NewCmd("INSERT INTO match_group_items (group_id, demo_id, steam_id) VALUES ($gid, $did, $sid)"))
                    {
                        cmd.Transaction = tx;
                        cmd.Parameters.AddWithValue("$gid", groupID.Value);
                        cmd.Parameters.AddWithValue("$did", demoRecordID);
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
}