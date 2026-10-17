using Microsoft.Data.Sqlite;
using Radar.Api;
using Radar.Infrastructure;
using Xunit;

namespace Radar.Tests;

/// <summary>
/// 全新 schema 测试（refactor/app-shell-v3 起）：不再做旧库列迁移与 .bak 备份，
/// Init 只建表并标记 SchemaVersion。下面断言覆盖建表完整性、幂等与真实导入。
/// </summary>
public class SchemaFreshTests
{
    private const string DemoPath = "/Users/cly/Documents/CSPlayerStatsRadar/doc/perfect-world.dem";

    [Fact]
    public void Init_Creates_All_Tables_With_Expected_Columns()
    {
        var dir = CreateTempDir();
        try
        {
            var dbPath = Path.Combine(dir, "fresh.db");
            using var repo = new SQLiteHistoryRepository(dbPath);
            Assert.Null(repo.Init());

            Assert.Equal(SQLiteHistoryRepository.SchemaVersion, ReadUserVersion(dbPath));
            AssertColumns(dbPath, "demos",
                "id", "file_name", "match_time", "map_name", "player_set_hash", "dedupe_key",
                "imported_at", "file_sha256", "source_path", "match_time_source", "note", "analysis_version");
            AssertColumns(dbPath, "player_match_stats",
                "demo_id", "steam_id", "rounds", "kills", "deaths", "assists",
                "total_damage", "adr", "kast", "impact", "rating", "metrics_json",
                "rating_3", "round_swing", "multi_kill", "rating_algorithm", "rating_3_metrics_json");
            foreach (var table in new[] { "followed_players", "discovered_players", "demo_participants",
                         "editor_drafts", "players", "player_images", "player_mvp_backgrounds",
                         "player_avatars", "demo_players", "demo_analysis",
                         "match_groups", "match_group_items" })
                AssertTableExists(dbPath, table);

            using var app = new DesktopApp(Path.Combine(dir, "config.json"), dbPath);
            Assert.Empty(app.ListDemos());
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Init_IsIdempotent_And_PreservesData()
    {
        var dir = CreateTempDir();
        try
        {
            var dbPath = Path.Combine(dir, "fresh.db");
            using (var repo = new SQLiteHistoryRepository(dbPath))
                Assert.Null(repo.Init());
            using (var repo = new SQLiteHistoryRepository(dbPath))
                Assert.Null(repo.Init());
            Assert.Equal(SQLiteHistoryRepository.SchemaVersion, ReadUserVersion(dbPath));
            // 无 .bak 备份产生。
            Assert.Empty(Directory.GetFiles(dir, "*.bak-*"));
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Import_On_Fresh_Db_Completes()
    {
        if (!File.Exists(DemoPath)) return;
        var dir = CreateTempDir();
        try
        {
            var dbPath = Path.Combine(dir, "fresh.db");
            using var app = new DesktopApp(Path.Combine(dir, "config.json"), dbPath);
            var jobID = app.StartFileImport(new List<string> { DemoPath });
            var summary = ImportServiceTests.WaitForJob(app, jobID);
            Assert.Equal("completed", summary.Status);
            Assert.Equal(1, summary.Processed);
            Assert.Equal(1, summary.Imported);
            var demos = app.ListDemos();
            Assert.Single(demos);
            Assert.Contains(demos, d => d.FileName == "perfect-world.dem");
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    private static long ReadUserVersion(string dbPath)
    {
        using var conn = new SqliteConnection($"Data Source={dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        return (long)(cmd.ExecuteScalar() ?? 0L);
    }

    private static void AssertTableExists(string dbPath, string table)
    {
        using var conn = new SqliteConnection($"Data Source={dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $t";
        cmd.Parameters.AddWithValue("$t", table);
        Assert.Equal(1L, (long)(cmd.ExecuteScalar() ?? 0L));
    }

    private static void AssertColumns(string dbPath, string table, params string[] expected)
    {
        using var conn = new SqliteConnection($"Data Source={dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info({table})";
        using var reader = cmd.ExecuteReader();
        var actual = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (reader.Read()) actual.Add(reader.GetString(1));
        foreach (var col in expected)
            Assert.Contains(col, actual);
    }

    private static string CreateTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "radar-schema-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }
}
