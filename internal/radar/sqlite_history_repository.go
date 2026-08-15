package radar

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	_, statErr := os.Stat(r.path)
	db, err := sql.Open("sqlite", r.path)
	if err != nil {
		return NewAppError("database_open_failed", httpStatusBadRequest, "数据库打开失败："+err.Error(), nil)
	}
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		db.Close()
		return NewAppError("database_open_failed", httpStatusInternal, "数据库初始化失败："+err.Error(), nil)
	}
	var schemaVersion int
	if err := db.QueryRow("PRAGMA user_version").Scan(&schemaVersion); err != nil {
		db.Close()
		return NewAppError("database_open_failed", httpStatusInternal, "数据库版本读取失败："+err.Error(), nil)
	}
	if schemaVersion < 2 && statErr == nil {
		_ = db.Close()
		if err := backupDatabaseFile(r.path); err != nil {
			return NewAppError("database_open_failed", httpStatusInternal, "数据库备份失败："+err.Error(), nil)
		}
		db, err = sql.Open("sqlite", r.path)
		if err != nil {
			return NewAppError("database_open_failed", httpStatusBadRequest, "数据库重新打开失败："+err.Error(), nil)
		}
		_, _ = db.Exec("PRAGMA foreign_keys = ON")
	}
	if _, err := db.Exec(sqliteSchema); err != nil {
		db.Close()
		return NewAppError("database_open_failed", httpStatusInternal, "数据库 schema 初始化失败："+err.Error(), nil)
	}
	if err := migrateStudioSchema(db); err != nil {
		db.Close()
		return NewAppError("database_open_failed", httpStatusInternal, "数据库迁移失败："+err.Error(), nil)
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

func backupDatabaseFile(path string) error {
	source, err := os.Open(path)
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenFile(path+".bak-"+time.Now().UTC().Format("20060102-150405"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(target, source); err != nil {
		_ = target.Close()
		return err
	}
	return target.Close()
}

func migrateStudioSchema(db *sql.DB) error {
	columns := []struct{ name, definition string }{
		{"file_sha256", "TEXT NOT NULL DEFAULT ''"},
		{"source_path", "TEXT NOT NULL DEFAULT ''"},
		{"match_time_source", "TEXT NOT NULL DEFAULT 'unknown'"},
	}
	for _, column := range columns {
		exists, err := sqliteColumnExists(db, "demos", column.name)
		if err != nil {
			return err
		}
		if !exists {
			if _, err := db.Exec("ALTER TABLE demos ADD COLUMN " + column.name + " " + column.definition); err != nil {
				return err
			}
		}
	}
	statColumns := []struct{ name, definition string }{
		{"rating_3", "REAL"}, {"round_swing", "REAL"}, {"multi_kill", "REAL"},
		{"rating_algorithm", "TEXT NOT NULL DEFAULT ''"}, {"rating_3_metrics_json", "TEXT NOT NULL DEFAULT '[]'"},
	}
	for _, column := range statColumns {
		exists, err := sqliteColumnExists(db, "player_match_stats", column.name)
		if err != nil {
			return err
		}
		if !exists {
			if _, err := db.Exec("ALTER TABLE player_match_stats ADD COLUMN " + column.name + " " + column.definition); err != nil {
				return err
			}
		}
	}
	if _, err := db.Exec(`
		UPDATE demos SET match_time_source = CASE WHEN match_time = imported_at THEN 'unknown' ELSE 'demo' END
		WHERE match_time_source = '' OR match_time_source = 'unknown';
		INSERT OR IGNORE INTO followed_players (steam_id, display_name, followed_at)
		SELECT steam_id, latest_name, CURRENT_TIMESTAMP FROM players;
		UPDATE player_match_stats
		SET rating = CASE WHEN rounds > 0 AND adr IS NOT NULL AND kast IS NOT NULL AND impact IS NOT NULL
		THEN 0.0073 * kast * 100.0 + 0.3591 * kills / rounds - 0.5329 * deaths / rounds + 0.2372 * impact + 0.0032 * adr + 0.1587
		ELSE rating END;
		PRAGMA user_version = 3;`); err != nil {
		return err
	}
	return nil
}

func sqliteColumnExists(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, dataType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
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

func (r *SQLiteHistoryRepository) ListFollowedPlayers() ([]Player, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	rows, err := db.Query(`SELECT display_name, steam_id FROM followed_players ORDER BY display_name COLLATE NOCASE`)
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "关注玩家读取失败："+err.Error(), nil)
	}
	defer rows.Close()
	players := []Player{}
	for rows.Next() {
		var player Player
		if err := rows.Scan(&player.Name, &player.SteamID); err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "关注玩家解析失败："+err.Error(), nil)
		}
		players = append(players, player)
	}
	return players, nil
}

func (r *SQLiteHistoryRepository) SetPlayerFollowed(player Player, followed bool) *AppError {
	db, appErr := r.currentDB()
	if appErr != nil {
		return appErr
	}
	player.SteamID = strings.TrimSpace(player.SteamID)
	if player.SteamID == "" {
		return NewAppError("player_not_found", httpStatusBadRequest, "SteamID 不能为空。", nil)
	}
	if followed {
		_, err := db.Exec(`INSERT INTO followed_players (steam_id, display_name, followed_at) VALUES (?, ?, ?)
			ON CONFLICT(steam_id) DO UPDATE SET display_name = excluded.display_name`, player.SteamID, strings.TrimSpace(player.Name), formatDBTime(time.Now().UTC()))
		if err != nil {
			return NewAppError("database_open_failed", httpStatusInternal, "关注玩家保存失败："+err.Error(), nil)
		}
		return nil
	}
	if _, err := db.Exec(`DELETE FROM followed_players WHERE steam_id = ?`, player.SteamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "取消关注失败："+err.Error(), nil)
	}
	return nil
}

func (r *SQLiteHistoryRepository) SaveEditorDraft(draft EditorDraft) *AppError {
	db, appErr := r.currentDB()
	if appErr != nil {
		return appErr
	}
	if draft.Kind != "radar" && draft.Kind != "overlay" && draft.Kind != "showcase" {
		return NewAppError("config_write_failed", httpStatusBadRequest, "草稿类型无效。", nil)
	}
	if !json.Valid([]byte(draft.Payload)) {
		return NewAppError("config_write_failed", httpStatusBadRequest, "草稿内容必须是有效 JSON。", nil)
	}
	_, err := db.Exec(`INSERT INTO editor_drafts (kind, payload_json, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(kind) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`, draft.Kind, draft.Payload, formatDBTime(time.Now().UTC()))
	if err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "草稿保存失败："+err.Error(), nil)
	}
	return nil
}

func (r *SQLiteHistoryRepository) GetEditorDraft(kind string) (*EditorDraft, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	var draft EditorDraft
	if err := db.QueryRow(`SELECT kind, payload_json, updated_at FROM editor_drafts WHERE kind = ?`, kind).Scan(&draft.Kind, &draft.Payload, &draft.UpdatedAt); errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "草稿读取失败："+err.Error(), nil)
	}
	return &draft, nil
}

func (r *SQLiteHistoryRepository) UpdateMatchMetadata(demoID, matchTime string, tags []string) *AppError {
	db, appErr := r.currentDB()
	if appErr != nil {
		return appErr
	}
	tx, err := db.Begin()
	if err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "元数据事务启动失败："+err.Error(), nil)
	}
	defer tx.Rollback()
	if strings.TrimSpace(matchTime) != "" {
		parsed, err := time.Parse(time.RFC3339, matchTime)
		if err != nil {
			return NewAppError("config_write_failed", httpStatusBadRequest, "比赛时间格式无效。", nil)
		}
		if _, err := tx.Exec(`UPDATE demos SET match_time = ?, match_time_source = 'manual' WHERE id = ?`, formatDBTime(parsed), demoID); err != nil {
			return NewAppError("database_open_failed", httpStatusInternal, "比赛时间保存失败："+err.Error(), nil)
		}
	}
	if tags != nil {
		if _, err := tx.Exec(`DELETE FROM demo_tags WHERE demo_id = ?`, demoID); err != nil {
			return NewAppError("database_open_failed", httpStatusInternal, "标签清理失败："+err.Error(), nil)
		}
		for _, tag := range uniqueStrings(tags) {
			tag = strings.TrimSpace(tag)
			if tag == "" {
				continue
			}
			if _, err := tx.Exec(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, tag); err != nil {
				return NewAppError("database_open_failed", httpStatusInternal, "标签保存失败："+err.Error(), nil)
			}
			if _, err := tx.Exec(`INSERT OR IGNORE INTO demo_tags (demo_id, tag_name) VALUES (?, ?)`, demoID, tag); err != nil {
				return NewAppError("database_open_failed", httpStatusInternal, "标签关联失败："+err.Error(), nil)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "元数据提交失败："+err.Error(), nil)
	}
	return nil
}

func (r *SQLiteHistoryRepository) FindDemoByDedupeKey(dedupeKey string) (*SavedDemo, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	row := db.QueryRow(`SELECT id, file_name, match_time, map_name, player_set_hash, dedupe_key, imported_at, file_sha256, source_path, match_time_source FROM demos WHERE dedupe_key = ?`, dedupeKey)
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
		`INSERT OR IGNORE INTO demos (id, file_name, match_time, map_name, player_set_hash, dedupe_key, imported_at, file_sha256, source_path, match_time_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.Demo.DemoRecordID,
		input.Demo.FileName,
		formatDBTime(input.Demo.MatchTime),
		input.Demo.MapName,
		input.Demo.PlayerSetHash,
		input.Demo.DedupeKey,
		formatDBTime(input.Demo.ImportedAt),
		input.Demo.FileSHA256,
		input.Demo.SourcePath,
		input.Demo.MatchTimeSource,
	); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			if existing, findErr := r.FindDemoByDedupeKey(input.Demo.DedupeKey); findErr == nil && existing != nil {
				return existing, NewAppError("demo_duplicate", httpStatusConflict, "", nil)
			}
		}
		return nil, NewAppError("database_open_failed", httpStatusInternal, "Demo 保存失败："+err.Error(), nil)
	}
	for _, participant := range input.Participants {
		participant.DemoRecordID = input.Demo.DemoRecordID
		if _, err := tx.Exec(`INSERT INTO discovered_players (steam_id, latest_name, last_seen_at) VALUES (?, ?, ?)
			ON CONFLICT(steam_id) DO UPDATE SET latest_name = excluded.latest_name, last_seen_at = excluded.last_seen_at`, participant.SteamID, participant.NameSnapshot, formatDBTime(input.Demo.ImportedAt)); err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "参赛玩家保存失败："+err.Error(), nil)
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO demo_participants (demo_id, steam_id, name_snapshot) VALUES (?, ?, ?)`, participant.DemoRecordID, participant.SteamID, participant.NameSnapshot); err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "参赛关系保存失败："+err.Error(), nil)
		}
	}
	for _, player := range input.Players {
		player.DemoRecordID = input.Demo.DemoRecordID
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
		stat.DemoRecordID = input.Demo.DemoRecordID
		metricsJSON, err := json.Marshal(stat.Metrics)
		if err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "指标序列化失败："+err.Error(), nil)
		}
		rating3MetricsJSON, err := json.Marshal(stat.Rating3Metrics)
		if err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "Rating 3.0 指标序列化失败："+err.Error(), nil)
		}
		if stat.SteamID == "" {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "比赛统计缺少 SteamID。", nil)
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO player_match_stats
			 (demo_id, steam_id, rounds, kills, deaths, assists, total_damage, adr, kast, impact, rating, metrics_json,
			  rating_3, round_swing, multi_kill, rating_algorithm, rating_3_metrics_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
			nullableFloat(stat.Rating3), nullableFloat(stat.RoundSwing), nullableFloat(stat.MultiKill), stat.RatingAlgorithm, string(rating3MetricsJSON),
		); err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "比赛统计保存失败："+err.Error(), nil)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "数据库提交失败："+err.Error(), nil)
	}
	return &input.Demo, nil
}

func (r *SQLiteHistoryRepository) GetPlayerImage(steamID string) (*PlayerImage, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	steamID = strings.TrimSpace(steamID)
	exists, err := playerExists(db, steamID)
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "玩家读取失败："+err.Error(), nil)
	}
	if !exists {
		return nil, NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	row := db.QueryRow(`
		SELECT steam_id, image_source_type, image_path, image_url, updated_at
		FROM player_images
		WHERE steam_id = ?`, steamID)
	image, err := scanPlayerImage(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "玩家图片读取失败："+err.Error(), nil)
	}
	return image, nil
}

func (r *SQLiteHistoryRepository) SavePlayerImage(image PlayerImage) (*PlayerImage, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "数据库事务启动失败："+err.Error(), nil)
	}
	defer tx.Rollback()

	image.SteamID = strings.TrimSpace(image.SteamID)
	exists, err := playerExists(tx, image.SteamID)
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "玩家读取失败："+err.Error(), nil)
	}
	if !exists {
		return nil, NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	normalized, appErr := normalizePlayerImageForSave(image)
	if appErr != nil {
		return nil, appErr
	}
	if normalized.UpdatedAt.IsZero() {
		normalized.UpdatedAt = time.Now().UTC()
	} else {
		normalized.UpdatedAt = normalized.UpdatedAt.UTC()
	}
	if _, err := tx.Exec(`
		INSERT INTO player_images (steam_id, image_source_type, image_path, image_url, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(steam_id) DO UPDATE SET
		  image_source_type = excluded.image_source_type,
		  image_path = excluded.image_path,
		  image_url = excluded.image_url,
		  updated_at = excluded.updated_at`,
		normalized.SteamID,
		string(normalized.ImageSourceType),
		normalized.ImagePath,
		normalized.ImageURL,
		formatDBTime(normalized.UpdatedAt),
	); err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "玩家图片保存失败："+err.Error(), nil)
	}
	if err := tx.Commit(); err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "数据库提交失败："+err.Error(), nil)
	}
	return &normalized, nil
}

func (r *SQLiteHistoryRepository) DeletePlayerImage(steamID string) *AppError {
	db, appErr := r.currentDB()
	if appErr != nil {
		return appErr
	}
	steamID = strings.TrimSpace(steamID)
	exists, err := playerExists(db, steamID)
	if err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "玩家读取失败："+err.Error(), nil)
	}
	if !exists {
		return NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	if _, err := db.Exec(`DELETE FROM player_images WHERE steam_id = ?`, steamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "玩家图片删除失败："+err.Error(), nil)
	}
	return nil
}

func (r *SQLiteHistoryRepository) GetPlayerMVPBackground(steamID string) (*PlayerMVPBackground, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	steamID = strings.TrimSpace(steamID)
	exists, err := playerExists(db, steamID)
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "玩家读取失败："+err.Error(), nil)
	}
	if !exists {
		return nil, NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	row := db.QueryRow(`
		SELECT steam_id, image_path, updated_at
		FROM player_mvp_backgrounds
		WHERE steam_id = ?`, steamID)
	background, err := scanPlayerMVPBackground(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "MVP 背景读取失败："+err.Error(), nil)
	}
	return background, nil
}

func (r *SQLiteHistoryRepository) SavePlayerMVPBackground(background PlayerMVPBackground) (*PlayerMVPBackground, *AppError) {
	db, appErr := r.currentDB()
	if appErr != nil {
		return nil, appErr
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "数据库事务启动失败："+err.Error(), nil)
	}
	defer tx.Rollback()

	background.SteamID = strings.TrimSpace(background.SteamID)
	background.ImagePath = strings.TrimSpace(background.ImagePath)
	if background.ImagePath == "" {
		return nil, NewAppError("invalid_player_image", httpStatusBadRequest, "MVP 背景图片不能为空。", nil)
	}
	exists, err := playerExists(tx, background.SteamID)
	if err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "玩家读取失败："+err.Error(), nil)
	}
	if !exists {
		return nil, NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	if background.UpdatedAt.IsZero() {
		background.UpdatedAt = time.Now().UTC()
	} else {
		background.UpdatedAt = background.UpdatedAt.UTC()
	}
	if _, err := tx.Exec(`
		INSERT INTO player_mvp_backgrounds (steam_id, image_path, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(steam_id) DO UPDATE SET
		  image_path = excluded.image_path,
		  updated_at = excluded.updated_at`,
		background.SteamID,
		background.ImagePath,
		formatDBTime(background.UpdatedAt),
	); err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "MVP 背景保存失败："+err.Error(), nil)
	}
	if err := tx.Commit(); err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "数据库提交失败："+err.Error(), nil)
	}
	return &background, nil
}

func (r *SQLiteHistoryRepository) DeletePlayerMVPBackground(steamID string) *AppError {
	db, appErr := r.currentDB()
	if appErr != nil {
		return appErr
	}
	steamID = strings.TrimSpace(steamID)
	exists, err := playerExists(db, steamID)
	if err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "玩家读取失败："+err.Error(), nil)
	}
	if !exists {
		return NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	if _, err := db.Exec(`DELETE FROM player_mvp_backgrounds WHERE steam_id = ?`, steamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "MVP 背景删除失败："+err.Error(), nil)
	}
	return nil
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
	if _, err := tx.Exec(`DELETE FROM player_images WHERE steam_id = ?`, steamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "玩家图片删除失败："+err.Error(), nil)
	}
	if _, err := tx.Exec(`DELETE FROM player_mvp_backgrounds WHERE steam_id = ?`, steamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "MVP 背景删除失败："+err.Error(), nil)
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

// DeletePlayerStats removes only the player's detailed statistics. Follow state,
// lightweight Demo catalog entries, participant identities and media are retained.
func (r *SQLiteHistoryRepository) DeletePlayerStats(steamID string) *AppError {
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
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	if _, err := tx.Exec(`DELETE FROM demo_players WHERE steam_id = ?`, steamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "Demo 玩家关联删除失败："+err.Error(), nil)
	}
	if _, err := tx.Exec(`DELETE FROM players WHERE steam_id = ?`, steamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "玩家记录删除失败："+err.Error(), nil)
	}
	if err := tx.Commit(); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "数据库提交失败："+err.Error(), nil)
	}
	return nil
}

func (r *SQLiteHistoryRepository) DeleteAllPlayers() *AppError {
	db, appErr := r.currentDB()
	if appErr != nil {
		return appErr
	}
	tx, err := db.Begin()
	if err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "数据库事务启动失败："+err.Error(), nil)
	}
	defer tx.Rollback()

	statements := []struct {
		sql   string
		label string
	}{
		{`DELETE FROM editor_drafts`, "编辑草稿清空失败："},
		{`DELETE FROM player_match_stats`, "玩家比赛统计清空失败："},
		{`DELETE FROM player_images`, "玩家图片清空失败："},
		{`DELETE FROM player_mvp_backgrounds`, "MVP 背景清空失败："},
		{`DELETE FROM demo_players`, "Demo 玩家关联清空失败："},
		{`DELETE FROM demo_participants`, "Demo 参赛者清空失败："},
		{`DELETE FROM demo_tags`, "Demo 标签清空失败："},
		{`DELETE FROM players`, "玩家记录清空失败："},
		{`DELETE FROM demos`, "Demo 记录清空失败："},
		{`DELETE FROM discovered_players`, "发现玩家清空失败："},
		{`DELETE FROM followed_players`, "关注玩家清空失败："},
		{`DELETE FROM tags`, "标签清空失败："},
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement.sql); err != nil {
			return NewAppError("database_open_failed", httpStatusInternal, statement.label+err.Error(), nil)
		}
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
	if _, err := tx.Exec(`DELETE FROM player_images WHERE steam_id = ? AND NOT EXISTS (SELECT 1 FROM demo_players dp WHERE dp.steam_id = ?)`, steamID, steamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "玩家图片清理失败："+err.Error(), nil)
	}
	if _, err := tx.Exec(`DELETE FROM player_mvp_backgrounds WHERE steam_id = ? AND NOT EXISTS (SELECT 1 FROM demo_players dp WHERE dp.steam_id = ?)`, steamID, steamID); err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "MVP 背景清理失败："+err.Error(), nil)
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

// DeletePlayerMatchStats removes one detailed player-match record while keeping
// the imported Demo's catalog and participants available for future backfill.
func (r *SQLiteHistoryRepository) DeletePlayerMatchStats(steamID string, demoRecordID string) *AppError {
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
		SELECT p.steam_id, p.latest_name, COUNT(DISTINCT d.id) AS match_count, MAX(d.match_time) AS latest_match_time,
		       EXISTS(SELECT 1 FROM followed_players fp WHERE fp.steam_id = p.steam_id)
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
		SELECT p.steam_id, p.latest_name, COUNT(DISTINCT d.id), MAX(d.match_time),
		       EXISTS(SELECT 1 FROM followed_players fp WHERE fp.steam_id = p.steam_id)
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

func (r *SQLiteHistoryRepository) UpdateRating3Stats(record PlayerMatchRecord) *AppError {
	db, appErr := r.currentDB()
	if appErr != nil {
		return appErr
	}
	metricsJSON, err := json.Marshal(record.Rating3Metrics)
	if err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "Rating 3.0 指标序列化失败："+err.Error(), nil)
	}
	_, err = db.Exec(`UPDATE player_match_stats SET rating_3 = ?, round_swing = ?, multi_kill = ?, rating_algorithm = ?, rating_3_metrics_json = ? WHERE demo_id = ? AND steam_id = ?`,
		nullableFloat(record.Rating3), nullableFloat(record.RoundSwing), nullableFloat(record.MultiKill), record.RatingAlgorithm, string(metricsJSON), record.DemoRecordID, record.SteamID)
	if err != nil {
		return NewAppError("database_open_failed", httpStatusInternal, "Rating 3.0 指标保存失败："+err.Error(), nil)
	}
	return nil
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
CREATE INDEX IF NOT EXISTS idx_demos_match_time ON demos(match_time);
CREATE INDEX IF NOT EXISTS idx_demo_players_steam_id ON demo_players(steam_id);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_steam_id ON player_match_stats(steam_id);
`

const playerMatchSelectSQL = `
SELECT d.id, d.match_time, d.match_time_source, d.imported_at, d.map_name, d.file_name, d.source_path,
       s.rounds, s.kills, s.deaths, s.assists, s.total_damage,
	   s.adr, s.kast, s.impact, s.rating, s.metrics_json,
	   s.rating_3, s.round_swing, s.multi_kill, s.rating_algorithm, s.rating_3_metrics_json,
       COALESCE((SELECT GROUP_CONCAT(dt.tag_name, ',') FROM demo_tags dt WHERE dt.demo_id = d.id), '')
FROM player_match_stats s
JOIN demos d ON d.id = s.demo_id`

func scanSavedDemo(row interface{ Scan(dest ...any) error }) (*SavedDemo, *AppError) {
	var demo SavedDemo
	var matchTime, importedAt string
	err := row.Scan(&demo.DemoRecordID, &demo.FileName, &matchTime, &demo.MapName, &demo.PlayerSetHash, &demo.DedupeKey, &importedAt, &demo.FileSHA256, &demo.SourcePath, &demo.MatchTimeSource)
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
	if err := row.Scan(&player.SteamID, &player.Name, &player.MatchCount, &latestMatchTime, &player.Followed); err != nil {
		return nil, err
	}
	parsed, err := parseDBTime(latestMatchTime)
	if err != nil {
		return nil, err
	}
	player.LatestMatchTime = parsed
	return &player, nil
}

func scanPlayerImage(row interface{ Scan(dest ...any) error }) (*PlayerImage, error) {
	var image PlayerImage
	var sourceType, updatedAt string
	var imagePath, imageURL sql.NullString
	if err := row.Scan(&image.SteamID, &sourceType, &imagePath, &imageURL, &updatedAt); err != nil {
		return nil, err
	}
	parsed, err := parseDBTime(updatedAt)
	if err != nil {
		return nil, err
	}
	image.ImageSourceType = PlayerImageSourceType(sourceType)
	if imagePath.Valid {
		image.ImagePath = imagePath.String
	}
	if imageURL.Valid {
		image.ImageURL = imageURL.String
	}
	image.UpdatedAt = parsed
	return &image, nil
}

func scanPlayerMVPBackground(row interface{ Scan(dest ...any) error }) (*PlayerMVPBackground, error) {
	var background PlayerMVPBackground
	var updatedAt string
	if err := row.Scan(&background.SteamID, &background.ImagePath, &updatedAt); err != nil {
		return nil, err
	}
	parsed, err := parseDBTime(updatedAt)
	if err != nil {
		return nil, err
	}
	background.UpdatedAt = parsed
	return &background, nil
}

func scanPlayerMatchRecords(rows *sql.Rows) ([]PlayerMatchRecord, *AppError) {
	var records []PlayerMatchRecord
	for rows.Next() {
		var record PlayerMatchRecord
		var matchTime, importedAt, tags string
		var totalDamage sql.NullInt64
		var adr, kast, impact, rating, rating3, roundSwing, multiKill sql.NullFloat64
		var metricsJSON, rating3MetricsJSON string
		if err := rows.Scan(
			&record.DemoRecordID, &matchTime, &record.MatchTimeSource, &importedAt, &record.MapName, &record.FileName, &record.SourcePath,
			&record.Rounds, &record.Kills, &record.Deaths, &record.Assists, &totalDamage,
			&adr, &kast, &impact, &rating, &metricsJSON,
			&rating3, &roundSwing, &multiKill, &record.RatingAlgorithm, &rating3MetricsJSON, &tags,
		); err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "比赛记录解析失败："+err.Error(), nil)
		}
		parsed, err := parseDBTime(matchTime)
		if err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "记录时间解析失败："+err.Error(), nil)
		}
		record.MatchTime = parsed
		if parsedImportedAt, err := parseDBTime(importedAt); err == nil {
			record.ImportedAt = parsedImportedAt
		}
		if tags != "" {
			record.Tags = strings.Split(tags, ",")
		}
		if totalDamage.Valid {
			value := int(totalDamage.Int64)
			record.TotalDamage = &value
		}
		record.ADR = floatPtrFromNull(adr)
		record.KAST = floatPtrFromNull(kast)
		record.Impact = floatPtrFromNull(impact)
		record.Rating = floatPtrFromNull(rating)
		record.Rating3 = floatPtrFromNull(rating3)
		record.RoundSwing = floatPtrFromNull(roundSwing)
		record.MultiKill = floatPtrFromNull(multiKill)
		if err := json.Unmarshal([]byte(metricsJSON), &record.Metrics); err != nil {
			return nil, NewAppError("database_open_failed", httpStatusInternal, "指标反序列化失败："+err.Error(), nil)
		}
		if record.Rating != nil {
			for index := range record.Metrics {
				if record.Metrics[index].Name == "Rating" {
					value := round3(*record.Rating)
					record.Metrics[index].Value = &value
				}
			}
		}
		if rating3MetricsJSON != "" {
			_ = json.Unmarshal([]byte(rating3MetricsJSON), &record.Rating3Metrics)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "比赛记录读取失败："+err.Error(), nil)
	}
	return records, nil
}

type playerExistsQueryer interface {
	QueryRow(query string, args ...any) *sql.Row
}

func playerExists(q playerExistsQueryer, steamID string) (bool, error) {
	var found int
	err := q.QueryRow(`SELECT 1 FROM players WHERE steam_id = ?`, steamID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func normalizePlayerImageForSave(image PlayerImage) (PlayerImage, *AppError) {
	image.ImagePath = strings.TrimSpace(image.ImagePath)
	image.ImageURL = strings.TrimSpace(image.ImageURL)
	switch image.ImageSourceType {
	case PlayerImageSourceUpload:
		if image.ImagePath == "" {
			return PlayerImage{}, NewAppError("invalid_player_image", httpStatusBadRequest, "", nil)
		}
		image.ImageURL = ""
	case PlayerImageSourceExternalURL:
		if image.ImageURL == "" {
			return PlayerImage{}, NewAppError("invalid_player_image", httpStatusBadRequest, "", nil)
		}
		image.ImagePath = ""
	default:
		return PlayerImage{}, NewAppError("invalid_player_image", httpStatusBadRequest, "", nil)
	}
	return image, nil
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
