package radar

import (
	"path/filepath"
	"testing"
	"time"
)

func TestSQLiteHistoryRepositorySaveAndQuery(t *testing.T) {
	repo := NewSQLiteHistoryRepository(filepath.Join(t.TempDir(), "history.db"))
	if appErr := repo.Init(); appErr != nil {
		t.Fatalf("init repo: %v", appErr)
	}
	defer repo.Close()

	service := NewHistoryService(repo)
	if _, appErr := service.SaveParsedDemo("history.dem", historyDemoData(t)); appErr != nil {
		t.Fatalf("save parsed demo: %v", appErr)
	}
	players, appErr := repo.ListPlayers()
	if appErr != nil {
		t.Fatalf("list players: %v", appErr)
	}
	if len(players) != 3 {
		t.Fatalf("expected 3 players, got %+v", players)
	}
	player, appErr := repo.GetPlayer("76561190000000001")
	if appErr != nil {
		t.Fatalf("get player: %v", appErr)
	}
	if player.MatchCount != 1 || player.Name != "Alpha" {
		t.Fatalf("bad player aggregate: %+v", player)
	}
	matches, appErr := repo.ListPlayerMatches(player.SteamID)
	if appErr != nil {
		t.Fatalf("list matches: %v", appErr)
	}
	if len(matches) != 1 || len(matches[0].Metrics) != len(MetricOrder) || matches[0].ADR == nil {
		t.Fatalf("bad match records: %+v", matches)
	}
	snapshots, appErr := repo.GetMetricSnapshots(player.SteamID, []string{matches[0].DemoRecordID})
	if appErr != nil {
		t.Fatalf("get metric snapshots: %v", appErr)
	}
	if len(snapshots) != 1 {
		t.Fatalf("bad snapshot count: %+v", snapshots)
	}
}

func TestSQLiteHistoryRepositoryDuplicateAndInvalidPath(t *testing.T) {
	repo := NewSQLiteHistoryRepository(filepath.Join(t.TempDir(), "history.db"))
	if appErr := repo.Init(); appErr != nil {
		t.Fatalf("init repo: %v", appErr)
	}
	defer repo.Close()
	service := NewHistoryService(repo)
	first, appErr := service.SaveParsedDemo("history.dem", historyDemoData(t))
	if appErr != nil {
		t.Fatalf("first save: %v", appErr)
	}
	second, appErr := service.SaveParsedDemo("history.dem", historyDemoData(t))
	if appErr != nil {
		t.Fatalf("duplicate save: %v", appErr)
	}
	if second.SaveStatus != DemoSaveStatusDuplicate || second.SavedDemo.DemoRecordID != first.SavedDemo.DemoRecordID {
		t.Fatalf("bad duplicate save: %+v", second)
	}
	if appErr := NewSQLiteHistoryRepository(t.TempDir()).Init(); appErr == nil || appErr.Code != "database_open_failed" {
		t.Fatalf("expected invalid directory path error, got %v", appErr)
	}
}

func TestSQLiteHistoryRepositoryPlayerImagesSchema(t *testing.T) {
	repo := newTestSQLiteHistoryRepository(t)

	db, appErr := repo.currentDB()
	if appErr != nil {
		t.Fatalf("current db: %v", appErr)
	}
	rows, err := db.Query(`PRAGMA table_info(player_images)`)
	if err != nil {
		t.Fatalf("read player_images columns: %v", err)
	}
	defer rows.Close()
	columns := map[string]int{}
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			t.Fatalf("scan column: %v", err)
		}
		columns[name] = pk
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate columns: %v", err)
	}
	for _, name := range []string{"steam_id", "image_source_type", "image_path", "image_url", "updated_at"} {
		if _, ok := columns[name]; !ok {
			t.Fatalf("expected player_images.%s column, got %+v", name, columns)
		}
	}
	if columns["steam_id"] != 1 {
		t.Fatalf("expected steam_id to be primary key, got pk=%d", columns["steam_id"])
	}

	fkRows, err := db.Query(`PRAGMA foreign_key_list(player_images)`)
	if err != nil {
		t.Fatalf("read player_images foreign keys: %v", err)
	}
	defer fkRows.Close()
	foundPlayerFK := false
	for fkRows.Next() {
		var id, seq int
		var table, from, to, onUpdate, onDelete, match string
		if err := fkRows.Scan(&id, &seq, &table, &from, &to, &onUpdate, &onDelete, &match); err != nil {
			t.Fatalf("scan foreign key: %v", err)
		}
		if table == "players" && from == "steam_id" && to == "steam_id" {
			foundPlayerFK = true
		}
	}
	if err := fkRows.Err(); err != nil {
		t.Fatalf("iterate foreign keys: %v", err)
	}
	if !foundPlayerFK {
		t.Fatal("expected player_images.steam_id foreign key to players.steam_id")
	}
}

func TestSQLiteHistoryRepositoryPlayerImageSaveReadOverwriteDelete(t *testing.T) {
	repo := newTestSQLiteHistoryRepositoryWithDemo(t)
	steamID := "76561190000000001"

	missing, appErr := repo.GetPlayerImage(steamID)
	if appErr != nil {
		t.Fatalf("get missing image: %v", appErr)
	}
	if missing != nil {
		t.Fatalf("expected missing image to be nil, got %+v", missing)
	}

	uploadTime := time.Date(2026, 6, 15, 10, 0, 0, 0, time.UTC)
	upload, appErr := repo.SavePlayerImage(PlayerImage{
		SteamID:         steamID,
		ImageSourceType: PlayerImageSourceUpload,
		ImagePath:       "/tmp/player.png",
		ImageURL:        "https://example.invalid/ignored.png",
		UpdatedAt:       uploadTime,
	})
	if appErr != nil {
		t.Fatalf("save upload image: %v", appErr)
	}
	if upload.ImageSourceType != PlayerImageSourceUpload || upload.ImagePath != "/tmp/player.png" || upload.ImageURL != "" {
		t.Fatalf("bad normalized upload image: %+v", upload)
	}
	readUpload, appErr := repo.GetPlayerImage(steamID)
	if appErr != nil {
		t.Fatalf("read upload image: %v", appErr)
	}
	if readUpload == nil || readUpload.ImagePath != "/tmp/player.png" || !readUpload.UpdatedAt.Equal(uploadTime) {
		t.Fatalf("bad upload image read: %+v", readUpload)
	}

	externalTime := uploadTime.Add(time.Hour)
	external, appErr := repo.SavePlayerImage(PlayerImage{
		SteamID:         steamID,
		ImageSourceType: PlayerImageSourceExternalURL,
		ImagePath:       "/tmp/ignored.png",
		ImageURL:        "https://example.com/player.jpg",
		UpdatedAt:       externalTime,
	})
	if appErr != nil {
		t.Fatalf("save external image: %v", appErr)
	}
	if external.ImageSourceType != PlayerImageSourceExternalURL || external.ImagePath != "" || external.ImageURL != "https://example.com/player.jpg" {
		t.Fatalf("bad normalized external image: %+v", external)
	}
	readExternal, appErr := repo.GetPlayerImage(steamID)
	if appErr != nil {
		t.Fatalf("read external image: %v", appErr)
	}
	if readExternal == nil || readExternal.ImageSourceType != PlayerImageSourceExternalURL || readExternal.ImageURL != "https://example.com/player.jpg" || readExternal.ImagePath != "" {
		t.Fatalf("bad external image read: %+v", readExternal)
	}
	if imageCount(t, repo, steamID) != 1 {
		t.Fatalf("expected overwrite to keep one binding, got %d", imageCount(t, repo, steamID))
	}

	if appErr := repo.DeletePlayerImage(steamID); appErr != nil {
		t.Fatalf("delete player image: %v", appErr)
	}
	deleted, appErr := repo.GetPlayerImage(steamID)
	if appErr != nil {
		t.Fatalf("read deleted image: %v", appErr)
	}
	if deleted != nil {
		t.Fatalf("expected deleted image to be nil, got %+v", deleted)
	}
	if appErr := repo.DeletePlayerImage(steamID); appErr != nil {
		t.Fatalf("delete absent player image should not fail: %v", appErr)
	}

	if _, appErr := repo.GetPlayerImage("missing"); appErr == nil || appErr.Code != "player_record_not_found" {
		t.Fatalf("expected missing player error, got %v", appErr)
	}
	if _, appErr := repo.SavePlayerImage(PlayerImage{SteamID: steamID, ImageSourceType: PlayerImageSourceUpload}); appErr == nil || appErr.Code != "invalid_player_image" {
		t.Fatalf("expected invalid upload image error, got %v", appErr)
	}
}

func TestSQLiteHistoryRepositoryPlayerImageCleanupOnDeletePlayer(t *testing.T) {
	repo := newTestSQLiteHistoryRepositoryWithDemo(t)
	steamID := "76561190000000001"
	if _, appErr := repo.SavePlayerImage(PlayerImage{SteamID: steamID, ImageSourceType: PlayerImageSourceUpload, ImagePath: "/tmp/player.png"}); appErr != nil {
		t.Fatalf("save player image: %v", appErr)
	}
	if appErr := repo.DeletePlayer(steamID); appErr != nil {
		t.Fatalf("delete player: %v", appErr)
	}
	if count := imageCount(t, repo, steamID); count != 0 {
		t.Fatalf("expected image binding to be cleaned, got %d", count)
	}
}

func TestSQLiteHistoryRepositoryPlayerImageCleanupOnDeleteLastPlayerMatch(t *testing.T) {
	repo := newTestSQLiteHistoryRepositoryWithDemo(t)
	steamID := "76561190000000001"
	if _, appErr := repo.SavePlayerImage(PlayerImage{SteamID: steamID, ImageSourceType: PlayerImageSourceUpload, ImagePath: "/tmp/player.png"}); appErr != nil {
		t.Fatalf("save player image: %v", appErr)
	}
	matches, appErr := repo.ListPlayerMatches(steamID)
	if appErr != nil {
		t.Fatalf("list matches: %v", appErr)
	}
	if len(matches) != 1 {
		t.Fatalf("expected one match in fixture, got %+v", matches)
	}
	if appErr := repo.DeletePlayerMatch(steamID, matches[0].DemoRecordID); appErr != nil {
		t.Fatalf("delete last player match: %v", appErr)
	}
	if count := imageCount(t, repo, steamID); count != 0 {
		t.Fatalf("expected image binding to be cleaned, got %d", count)
	}
}

func TestSQLiteHistoryRepositoryPlayerMVPBackgroundSaveReadOverwriteDelete(t *testing.T) {
	repo := newTestSQLiteHistoryRepositoryWithDemo(t)
	steamID := "76561190000000001"

	missing, appErr := repo.GetPlayerMVPBackground(steamID)
	if appErr != nil {
		t.Fatalf("get missing MVP background: %v", appErr)
	}
	if missing != nil {
		t.Fatalf("expected missing MVP background to be nil, got %+v", missing)
	}

	firstTime := time.Date(2026, 6, 16, 9, 0, 0, 0, time.UTC)
	first, appErr := repo.SavePlayerMVPBackground(PlayerMVPBackground{
		SteamID:   steamID,
		ImagePath: "/tmp/mvp-first.png",
		UpdatedAt: firstTime,
	})
	if appErr != nil {
		t.Fatalf("save first MVP background: %v", appErr)
	}
	if first.ImagePath != "/tmp/mvp-first.png" || !first.UpdatedAt.Equal(firstTime) {
		t.Fatalf("bad first MVP background: %+v", first)
	}

	secondTime := firstTime.Add(time.Hour)
	second, appErr := repo.SavePlayerMVPBackground(PlayerMVPBackground{
		SteamID:   steamID,
		ImagePath: "/tmp/mvp-second.png",
		UpdatedAt: secondTime,
	})
	if appErr != nil {
		t.Fatalf("save second MVP background: %v", appErr)
	}
	if second.ImagePath != "/tmp/mvp-second.png" || !second.UpdatedAt.Equal(secondTime) {
		t.Fatalf("bad second MVP background: %+v", second)
	}
	read, appErr := repo.GetPlayerMVPBackground(steamID)
	if appErr != nil {
		t.Fatalf("read MVP background: %v", appErr)
	}
	if read == nil || read.ImagePath != "/tmp/mvp-second.png" || backgroundCount(t, repo, steamID) != 1 {
		t.Fatalf("bad overwritten MVP background read: %+v", read)
	}

	if appErr := repo.DeletePlayerMVPBackground(steamID); appErr != nil {
		t.Fatalf("delete MVP background: %v", appErr)
	}
	deleted, appErr := repo.GetPlayerMVPBackground(steamID)
	if appErr != nil {
		t.Fatalf("read deleted MVP background: %v", appErr)
	}
	if deleted != nil {
		t.Fatalf("expected deleted MVP background to be nil, got %+v", deleted)
	}
	if _, appErr := repo.GetPlayerMVPBackground("missing"); appErr == nil || appErr.Code != "player_record_not_found" {
		t.Fatalf("expected missing player error, got %v", appErr)
	}
	if _, appErr := repo.SavePlayerMVPBackground(PlayerMVPBackground{SteamID: steamID}); appErr == nil || appErr.Code != "invalid_player_image" {
		t.Fatalf("expected invalid MVP background error, got %v", appErr)
	}
}

func TestSQLiteHistoryRepositoryPlayerMVPBackgroundCleanupOnDeletePlayer(t *testing.T) {
	repo := newTestSQLiteHistoryRepositoryWithDemo(t)
	steamID := "76561190000000001"
	if _, appErr := repo.SavePlayerMVPBackground(PlayerMVPBackground{SteamID: steamID, ImagePath: "/tmp/mvp.png"}); appErr != nil {
		t.Fatalf("save MVP background: %v", appErr)
	}
	if appErr := repo.DeletePlayer(steamID); appErr != nil {
		t.Fatalf("delete player: %v", appErr)
	}
	if count := backgroundCount(t, repo, steamID); count != 0 {
		t.Fatalf("expected MVP background binding to be cleaned, got %d", count)
	}
}

func newTestSQLiteHistoryRepository(t *testing.T) *SQLiteHistoryRepository {
	t.Helper()
	repo := NewSQLiteHistoryRepository(filepath.Join(t.TempDir(), "history.db"))
	if appErr := repo.Init(); appErr != nil {
		t.Fatalf("init repo: %v", appErr)
	}
	t.Cleanup(func() {
		if err := repo.Close(); err != nil {
			t.Fatalf("close repo: %v", err)
		}
	})
	return repo
}

func newTestSQLiteHistoryRepositoryWithDemo(t *testing.T) *SQLiteHistoryRepository {
	t.Helper()
	repo := newTestSQLiteHistoryRepository(t)
	service := NewHistoryService(repo)
	if _, appErr := service.SaveParsedDemo("history.dem", historyDemoData(t)); appErr != nil {
		t.Fatalf("save parsed demo: %v", appErr)
	}
	return repo
}

func imageCount(t *testing.T, repo *SQLiteHistoryRepository, steamID string) int {
	t.Helper()
	db, appErr := repo.currentDB()
	if appErr != nil {
		t.Fatalf("current db: %v", appErr)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM player_images WHERE steam_id = ?`, steamID).Scan(&count); err != nil {
		t.Fatalf("count player image: %v", err)
	}
	return count
}

func backgroundCount(t *testing.T, repo *SQLiteHistoryRepository, steamID string) int {
	t.Helper()
	db, appErr := repo.currentDB()
	if appErr != nil {
		t.Fatalf("current db: %v", appErr)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM player_mvp_backgrounds WHERE steam_id = ?`, steamID).Scan(&count); err != nil {
		t.Fatalf("count player MVP background: %v", err)
	}
	return count
}
