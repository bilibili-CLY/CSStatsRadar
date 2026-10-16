using System.Text.Json;
using Microsoft.Data.Sqlite;
using Radar.Application;
using Radar.Domain.Models;

namespace Radar.Infrastructure;

public partial class SQLiteHistoryRepository : IDisposable, IHistoryRepository
{
    private readonly string path;
    private readonly object mu = new();
    private SqliteConnection? db;

    public SQLiteHistoryRepository(string? path = null)
    {
        this.path = string.IsNullOrEmpty(path) ? ConfigManager.DefaultDatabasePath() : path;
    }

    public string Path() => path;

    private const string Schema = @"
CREATE TABLE IF NOT EXISTS demos (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  match_time TEXT NOT NULL,
  map_name TEXT NOT NULL,
  player_set_hash TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  imported_at TEXT NOT NULL,
  file_sha256 TEXT NOT NULL DEFAULT '',
  source_path TEXT NOT NULL DEFAULT '',
  match_time_source TEXT NOT NULL DEFAULT 'unknown',
  note TEXT NOT NULL DEFAULT '',
  analysis_version TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS followed_players (
  steam_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  followed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS discovered_players (
  steam_id TEXT PRIMARY KEY,
  latest_name TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS demo_participants (
  demo_id TEXT NOT NULL,
  steam_id TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  PRIMARY KEY (demo_id, steam_id),
  FOREIGN KEY (demo_id) REFERENCES demos(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tags (
  name TEXT PRIMARY KEY COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS demo_tags (
  demo_id TEXT NOT NULL,
  tag_name TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (demo_id, tag_name),
  FOREIGN KEY (demo_id) REFERENCES demos(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_name) REFERENCES tags(name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS editor_drafts (
  kind TEXT PRIMARY KEY CHECK(kind IN ('radar', 'overlay', 'showcase')),
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  steam_id TEXT PRIMARY KEY,
  latest_name TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS player_images (
  steam_id TEXT PRIMARY KEY,
  image_source_type TEXT NOT NULL,
  image_path TEXT,
  image_url TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (steam_id) REFERENCES players(steam_id)
);
CREATE TABLE IF NOT EXISTS player_mvp_backgrounds (
  steam_id TEXT PRIMARY KEY,
  image_path TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (steam_id) REFERENCES players(steam_id)
);
CREATE TABLE IF NOT EXISTS player_avatars (
  steam_id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL DEFAULT '',
  cache_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'failed',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS demo_players (
  demo_id TEXT NOT NULL,
  steam_id TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  PRIMARY KEY (demo_id, steam_id),
  FOREIGN KEY (demo_id) REFERENCES demos(id),
  FOREIGN KEY (steam_id) REFERENCES players(steam_id)
);
CREATE TABLE IF NOT EXISTS player_match_stats (
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
  rating_3 REAL,
  round_swing REAL,
  multi_kill REAL,
  rating_algorithm TEXT NOT NULL DEFAULT '',
  rating_3_metrics_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (demo_id, steam_id),
  FOREIGN KEY (demo_id) REFERENCES demos(id),
  FOREIGN KEY (steam_id) REFERENCES players(steam_id)
);
CREATE TABLE IF NOT EXISTS demo_analysis (
  demo_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  FOREIGN KEY (demo_id) REFERENCES demos(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS match_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steam_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS match_group_items (
  group_id INTEGER NOT NULL,
  demo_id TEXT NOT NULL,
  steam_id TEXT NOT NULL,
  PRIMARY KEY (group_id, demo_id, steam_id),
  FOREIGN KEY (group_id) REFERENCES match_groups(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_match_groups_steam_id ON match_groups(steam_id);
CREATE INDEX IF NOT EXISTS idx_match_group_items_demo_id ON match_group_items(demo_id);
CREATE INDEX IF NOT EXISTS idx_demos_match_time ON demos(match_time);
CREATE INDEX IF NOT EXISTS idx_demo_players_steam_id ON demo_players(steam_id);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_steam_id ON player_match_stats(steam_id);
";

    /// <summary>
    /// 全新 schema 初始化（refactor/app-shell-v3 起）：直接建表，不做旧库列迁移，
    /// 不创建 .bak 备份。旧库如表结构兼容可直接打开，否则请重扫 Demo 建新库。
    /// </summary>
    public const int SchemaVersion = 1;

    public string? Init()
    {
        lock (mu)
        {
            try
            {
                if (string.IsNullOrEmpty(path)) return "database_open_failed";
                if (Directory.Exists(path)) return "database_open_failed";
                var dir = System.IO.Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                db = new SqliteConnection($"Data Source={path}");
                db.Open();
                using (var cmd = db.CreateCommand())
                {
                    cmd.CommandText = "PRAGMA foreign_keys = ON;";
                    cmd.ExecuteNonQuery();
                }
                using (var cmd = db.CreateCommand())
                {
                    cmd.CommandText = Schema;
                    cmd.ExecuteNonQuery();
                }
                using (var cmd = db.CreateCommand())
                {
                    cmd.CommandText = $"PRAGMA user_version = {SchemaVersion};";
                    cmd.ExecuteNonQuery();
                }
                return null;
            }
            catch
            {
                return "database_open_failed";
            }
        }
    }

    public void Close()
    {
        lock (mu)
        {
            db?.Close();
            db?.Dispose();
            db = null;
        }
    }

    private SqliteConnection Conn()
    {
        if (db == null) throw new InvalidOperationException("database not initialized");
        return db;
    }

    public void Dispose() => Close();
}