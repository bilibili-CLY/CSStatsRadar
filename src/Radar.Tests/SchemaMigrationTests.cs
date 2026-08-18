using Microsoft.Data.Sqlite;
using Radar.Api;
using Xunit;

namespace Radar.Tests;

public class SchemaMigrationTests
{
    private const string DemoPath = "/Users/cly/Documents/CSPlayerStatsRadar/doc/g163-20260710230853627924450_de_dust2.dem";

    [Fact]
    public void Init_Migrates_Legacy_Go_Era_Db_And_ListDemos_Works()
    {
        var dir = CreateTempDir();
        try
        {
            var dbPath = Path.Combine(dir, "legacy.db");
            CreateLegacyGoEraDb(dbPath);

            using var app = new DesktopApp(Path.Combine(dir, "config.json"), dbPath);
            var demos = app.ListDemos();
            Assert.Single(demos);
            Assert.Equal("old_dust2.dem", demos[0].FileName);
            Assert.Equal("", demos[0].Note);
            Assert.False(demos[0].AnalysisReady);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Import_On_Legacy_Go_Era_Db_Completes()
    {
        if (!File.Exists(DemoPath)) return;
        var dir = CreateTempDir();
        try
        {
            var dbPath = Path.Combine(dir, "legacy.db");
            CreateLegacyGoEraDb(dbPath);

            using var app = new DesktopApp(Path.Combine(dir, "config.json"), dbPath);
            var jobID = app.StartFileImport(new List<string> { DemoPath });
            var summary = ImportServiceTests.WaitForJob(app, jobID);
            Assert.Equal("completed", summary.Status);
            Assert.Equal(1, summary.Processed);
            Assert.Equal(1, summary.Imported);
            var demos = app.ListDemos();
            Assert.Equal(2, demos.Count);
            Assert.Contains(demos, d => d.FileName == "g163-20260710230853627924450_de_dust2.dem");
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    private static void CreateLegacyGoEraDb(string path)
    {
        if (File.Exists(path)) File.Delete(path);
        using var conn = new SqliteConnection($"Data Source={path}");
        conn.Open();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
CREATE TABLE demos (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  match_time TEXT NOT NULL,
  map_name TEXT NOT NULL,
  player_set_hash TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  imported_at TEXT NOT NULL
);
CREATE TABLE player_match_stats (
  demo_id TEXT NOT NULL,
  steam_id TEXT NOT NULL,
  rounds INTEGER NOT NULL,
  kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  total_damage INTEGER,
  adr REAL,
  kast REAL,
  impact REAL,
  rating REAL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (demo_id, steam_id)
);
INSERT INTO demos (id, file_name, match_time, map_name, player_set_hash, dedupe_key, imported_at)
VALUES ('legacy_demo_1', 'old_dust2.dem', '2026-01-01T00:00:00+00:00', 'de_dust2', 'abc', 'legacy_key_1', '2026-01-01T00:00:00+00:00');
";
            cmd.ExecuteNonQuery();
        }
        conn.Close();
    }

    private static string CreateTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "radar-schema-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }
}