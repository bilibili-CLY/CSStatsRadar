package radar

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type SQLiteHistoryRepository struct {
	path string
	mu   sync.RWMutex
	db   *sql.DB
}

func NewSQLiteHistoryRepository(path string) *SQLiteHistoryRepository {
	if path == "" {
		path = DefaultDatabasePath()
	}
	return &SQLiteHistoryRepository{path: path}
}

func (r *SQLiteHistoryRepository) Init() *AppError {
	if r.path == "" {
		return NewAppError("database_open_failed", httpStatusBadRequest, "数据库路径不能为空。", nil)
	}
	if info, err := os.Stat(r.path); err == nil && info.IsDir() {
		return NewAppError("database_open_failed", httpStatusBadRequest, "数据库路径不能是目录。", nil)
	}
	if err := os.MkdirAll(filepath.Dir(r.path), 0o755); err != nil {
		return NewAppError("database_open_failed", httpStatusBadRequest, "数据库目录创建失败："+err.Error(), nil)
	}
	db, err := sql.Open("sqlite", r.path)
	if err != nil {
		return NewAppError("database_open_failed", httpStatusBadRequest, "数据库打开失败："+err.Error(), nil)
	}
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		db.Close()
		return NewAppError("database_open_failed", httpStatusInternal, "数据库初始化失败："+err.Error(), nil)
	}
	if _, err := db.Exec(sqliteSchema); err != nil {
		db.Close()
		return NewAppError("database_open_failed", httpStatusInternal, "数据库 schema 初始化失败："+err.Error(), nil)
	}
	r.mu.Lock()
	old := r.db
	r.db = db
	r.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	return nil
}

func (r *SQLiteHistoryRepository) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.db == nil {
		return nil
	}
	err := r.db.Close()
	r.db = nil
	return err
}

func (r *SQLiteHistoryRepository) Path() string {
	return r.path
}

func (r *SQLiteHistoryRepository) FindDemoByDedupeKey(dedupeKey string) (*SavedDemo, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	row := db.QueryRow(`SELECT id, file_name, match_time, map_name, player_set_hash, dedupe_key, imported_at FROM demos WHERE dedupe_key = ?`, dedupeKey)
	return scanSavedDemo(row)
}

func (r *SQLiteHistoryRepository) SaveParsedDemo(input SaveParsedDemoInput) (*SavedDemo, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "数据库事务启动失败："+err.Error(), nil)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`INSERT OR IGNORE INTO demos (id, file_name, match_time, map_name, player_set_hash, dedupe_key, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		input.Demo.DemoRecordID,
		input.Demo.FileName,
		formatDBTime(input.Demo.MatchTime),
		input.Demo.MapName,
		input.Demo.PlayerSetHash,
		input.Demo.DedupeKey,
		formatDBTime(input.Demo.ImportedAt),
	); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			if existing, findErr := r.FindDemoByDedupeKey(input.Demo.DedupeKey); findErr == nil && existing != nil {
				return existing, NewAppError("demo_duplicate", httpStatusConflict, "", nil)
			}
		}
		return nil, NewAppError("database_open_failed", httpStatusInternal, "Demo 保存失败："+err.Error(), nil)
	}
	for _, player := range input.Players {
		if _, err := tx.Exec(
			`INSERT INTO players (steam_id, latest_name, first_seen_at, last_seen_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(steam_id) DO UPDATE SET
			   latest_name = CASE WHEN excluded.last_seen_at >= players.last_seen_at THEN excluded.latest_name ELSE players.latest_name END,
			   last_seen_at = CASE WHEN excluded.last_seen_at >= players.last_seen_at THEN excluded.last_seen_at ELSE players.last_seen_at END`,
			player.SteamID,
			player.NameSnapshot,
			formatDBTime(input.Demo.MatchTime),
			formatDBTime(input.Demo.MatchTime),
		); err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "玩家保存失败："+err.Error(), nil)
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO demo_players (demo_id, steam_id, name_snapshot) VALUES (?, ?, ?)`,
			input.Demo.DemoRecordID,
			player.SteamID,
			player.NameSnapshot,
		); err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "Demo 玩家关联保存失败："+err.Error(), nil)
		}
	}
	for _, stat := range input.MatchStats {
		metricsJSON, err := json.Marshal(stat.Metrics)
		if err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "指标序列化失败："+err.Error(), nil)
		}
		if stat.SteamID == "" {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "比赛统计缺少 SteamID。", nil)
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO player_match_stats
			 (demo_id, steam_id, rounds, kills, deaths, assists, total_damage, adr, kast, impact, rating, metrics_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			stat.DemoRecordID,
			stat.SteamID,
			stat.Rounds,
			stat.Kills,
			stat.Deaths,
			stat.Assists,
			nullableInt(stat.TotalDamage),
			nullableFloat(stat.ADR),
			nullableFloat(stat.KAST),
			nullableFloat(stat.Impact),
			nullableFloat(stat.Rating),
			string(metricsJSON),
		); err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "比赛统计保存失败："+err.Error(), nil)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "数据库提交失败："+err.Error(), nil)
	}
	return &input.Demo, nil
}

func (r *SQLiteHistoryRepository) DeletePlayer(steamID string) *AppError {
	db, appErr := r.currentDB()
	if appErr != nil {
		return appErr
	}
	tx, err := db.Begin()
	if err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "数据库事务启动失败："+err.Error(), nil)
	}
	defer tx.Rollback()

	result, err := tx.Exec(`DELETE FROM player_match_stats WHERE steam_id = ?`, steamID)
	if err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "玩家比赛统计删除失败："+err.Error(), nil)
	}
	if _, err := tx.Exec(`DELETE FROM demo_players WHERE steam_id = ?`, steamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "Demo 玩家关联删除失败："+err.Error(), nil)
	}
	if _, err := tx.Exec(`DELETE FROM players WHERE steam_id = ?`, steamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "玩家记录删除失败："+err.Error(), nil)
	}
	if _, err := tx.Exec(`DELETE FROM demos WHERE NOT EXISTS (SELECT 1 FROM demo_players dp WHERE dp.demo_id = demos.id)`); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "空 Demo 记录清理失败："+err.Error(), nil)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	if err := tx.Commit(); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "数据库提交失败："+err.Error(), nil)
	}
	return nil
}

func (r *SQLiteHistoryRepository) DeletePlayerMatch(steamID string, demoRecordID string) *AppError {
	db, appErr := r.currentDB()
	if appErr != nil {
		return appErr
	}
	tx, err := db.Begin()
	if err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "数据库事务启动失败："+err.Error(), nil)
	}
	defer tx.Rollback()

	result, err := tx.Exec(`DELETE FROM player_match_stats WHERE steam_id = ? AND demo_id = ?`, steamID, demoRecordID)
	if err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "比赛统计删除失败："+err.Error(), nil)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return NewAppError("match_record_not_found", httpStatusNotFound, "", nil)
	}
	if _, err := tx.Exec(`DELETE FROM demo_players WHERE steam_id = ? AND demo_id = ?`, steamID, demoRecordID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "Demo 玩家关联删除失败："+err.Error(), nil)
	}
	if _, err := tx.Exec(`DELETE FROM players WHERE steam_id = ? AND NOT EXISTS (SELECT 1 FROM demo_players dp WHERE dp.steam_id = players.steam_id)`, steamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "空玩家记录清理失败："+err.Error(), nil)
	}
	if _, err := tx.Exec(`DELETE FROM demos WHERE id = ? AND NOT EXISTS (SELECT 1 FROM demo_players dp WHERE dp.demo_id = demos.id)`, demoRecordID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "空 Demo 记录清理失败："+err.Error(), nil)
	}
	if err := tx.Commit(); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "数据库提交失败："+err.Error(), nil)
	}
	return nil
}

func (r *SQLiteHistoryRepository) ListPlayers() ([]SavedPlayer, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	rows, err := db.Query(`
		SELECT p.steam_id, p.latest_name, COUNT(DISTINCT d.id) AS match_count, MAX(d.match_time) AS latest_match_time
		FROM players p
		JOIN demo_players dp ON dp.steam_id = p.steam_id
		JOIN demos d ON d.id = dp.demo_id
		GROUP BY p.steam_id, p.latest_name
		ORDER BY latest_match_time DESC`)
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "玩家列表读取失败："+err.Error(), nil)
	}
	defer rows.Close()
	return scanSavedPlayers(rows)
}

func (r *SQLiteHistoryRepository) GetPlayer(steamID string) (*SavedPlayer, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	row := db.QueryRow(`
		SELECT p.steam_id, p.latest_name, COUNT(DISTINCT d.id), MAX(d.match_time)
		FROM players p
		JOIN demo_players dp ON dp.steam_id = p.steam_id
		JOIN demos d ON d.id = dp.demo_id
		WHERE p.steam_id = ?
		GROUP BY p.steam_id, p.latest_name`, steamID)
	player, err := scanSavedPlayer(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "玩家读取失败："+err.Error(), nil)
	}
	return player, nil
}

func (r *SQLiteHistoryRepository) ListPlayerMatches(steamID string) ([]PlayerMatchRecord, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	rows, err := db.Query(playerMatchSelectSQL+` WHERE s.steam_id = ? ORDER BY d.match_time DESC`, steamID)
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "比赛记录读取失败："+err.Error(), nil)
	}
	defer rows.Close()
	return scanPlayerMatchRecords(rows)
}

func (r *SQLiteHistoryRepository) GetMetricSnapshots(steamID string, demoRecordIDs []string) ([]PlayerMatchRecord, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	ids := uniqueStrings(demoRecordIDs)
	if len(ids) == 0 {
		return nil, NewAppError("invalid_aggregate_request", httpStatusBadRequest, "", nil)
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, 0, len(ids)+1)
	args = append(args, steamID)
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := db.Query(playerMatchSelectSQL+fmt.Sprintf(` WHERE s.steam_id = ? AND s.demo_id IN (%s)`, placeholders), args...)
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "指标快照读取失败："+err.Error(), nil)
	}
	defer rows.Close()
	records, appErr := scanPlayerMatchRecords(rows)
	if appErr != nil {
		return nil, appErr
	}
	if len(records) != len(ids) {
		return nil, NewAppError("match_record_not_found", httpStatusNotFound, "", nil)
	}
	sort.Slice(records, func(i, j int) bool { return records[i].DemoRecordID < records[j].DemoRecordID })
	return records, nil
}

func (r *SQLiteHistoryRepository) currentDB() (*sql.DB, *AppError) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.db == nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "", nil)
	}
	return r.db, nil
}

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS demos (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  match_time TEXT NOT NULL,
  map_name TEXT NOT NULL,
  player_set_hash TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  steam_id TEXT PRIMARY KEY,
  latest_name TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
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
  PRIMARY KEY (demo_id, steam_id),
  FOREIGN KEY (demo_id) REFERENCES demos(id),
  FOREIGN KEY (steam_id) REFERENCES players(steam_id)
);
CREATE INDEX IF NOT EXISTS idx_demos_match_time ON demos(match_time);
CREATE INDEX IF NOT EXISTS idx_demo_players_steam_id ON demo_players(steam_id);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_steam_id ON player_match_stats(steam_id);
`

const playerMatchSelectSQL = `
SELECT d.id, d.match_time, d.map_name, d.file_name,
       s.rounds, s.kills, s.deaths, s.assists, s.total_damage,
       s.adr, s.kast, s.impact, s.rating, s.metrics_json
FROM player_match_stats s
JOIN demos d ON d.id = s.demo_id`

func scanSavedDemo(row interface{ Scan(dest ...any) error }) (*SavedDemo, *AppError) {
	var demo SavedDemo
	var matchTime, importedAt string
	err := row.Scan(&demo.DemoRecordID, &demo.FileName, &matchTime, &demo.MapName, &demo.PlayerSetHash, &demo.DedupeKey, &importedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "Demo 读取失败："+err.Error(), nil)
	}
	parsedMatchTime, err := parseDBTime(matchTime)
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "记录时间读取失败："+err.Error(), nil)
	}
	parsedImportedAt, err := parseDBTime(importedAt)
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "导入时间读取失败："+err.Error(), nil)
	}
	demo.MatchTime = parsedMatchTime
	demo.ImportedAt = parsedImportedAt
	return &demo, nil
}

func scanSavedPlayers(rows *sql.Rows) ([]SavedPlayer, *AppError) {
	players := []SavedPlayer{}
	for rows.Next() {
		player, err := scanSavedPlayer(rows)
		if err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "玩家列表解析失败："+err.Error(), nil)
		}
		players = append(players, *player)
	}
	if err := rows.Err(); err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "玩家列表读取失败："+err.Error(), nil)
	}
	return players, nil
}

func scanSavedPlayer(row interface{ Scan(dest ...any) error }) (*SavedPlayer, error) {
	var player SavedPlayer
	var latestMatchTime string
	if err := row.Scan(&player.SteamID, &player.Name, &player.MatchCount, &latestMatchTime); err != nil {
		return nil, err
	}
	parsed, err := parseDBTime(latestMatchTime)
	if err != nil {
		return nil, err
	}
	player.LatestMatchTime = parsed
	return &player, nil
}

func scanPlayerMatchRecords(rows *sql.Rows) ([]PlayerMatchRecord, *AppError) {
	var records []PlayerMatchRecord
	for rows.Next() {
		var record PlayerMatchRecord
		var matchTime string
		var totalDamage sql.NullInt64
		var adr, kast, impact, rating sql.NullFloat64
		var metricsJSON string
		if err := rows.Scan(
			&record.DemoRecordID, &matchTime, &record.MapName, &record.FileName,
			&record.Rounds, &record.Kills, &record.Deaths, &record.Assists, &totalDamage,
			&adr, &kast, &impact, &rating, &metricsJSON,
		); err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "比赛记录解析失败："+err.Error(), nil)
		}
		parsed, err := parseDBTime(matchTime)
		if err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "记录时间解析失败："+err.Error(), nil)
		}
		record.MatchTime = parsed
		if totalDamage.Valid {
			value := int(totalDamage.Int64)
			record.TotalDamage = &value
		}
		record.ADR = floatPtrFromNull(adr)
		record.KAST = floatPtrFromNull(kast)
		record.Impact = floatPtrFromNull(impact)
		record.Rating = floatPtrFromNull(rating)
		if err := json.Unmarshal([]byte(metricsJSON), &record.Metrics); err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "指标反序列化失败："+err.Error(), nil)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "比赛记录读取失败："+err.Error(), nil)
	}
	return records, nil
}

func formatDBTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func parseDBTime(value string) (time.Time, error) {
	return time.Parse(time.RFC3339Nano, value)
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func floatPtrFromNull(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	return &value.Float64
}
