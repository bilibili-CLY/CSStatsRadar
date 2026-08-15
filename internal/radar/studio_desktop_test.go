package radar

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestScanSourcePathsIsNonRecursiveAndSkipsSymlinks(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "one.dem"), []byte("demo"))
	writeTestFile(t, filepath.Join(dir, "two.zip"), []byte("zip"))
	writeTestFile(t, filepath.Join(dir, "ignore.txt"), []byte("text"))
	if err := os.Mkdir(filepath.Join(dir, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(dir, "nested", "three.dem"), []byte("demo"))
	if err := os.Symlink(filepath.Join(dir, "one.dem"), filepath.Join(dir, "linked.dem")); err != nil {
		t.Fatal(err)
	}
	paths, appErr := ScanSourcePaths([]ImportSource{{ID: "one", Path: dir}})
	if appErr != nil {
		t.Fatal(appErr)
	}
	if len(paths) != 2 || filepath.Base(paths[0]) != "one.dem" || filepath.Base(paths[1]) != "two.zip" {
		t.Fatalf("unexpected scan result: %v", paths)
	}
}

func TestExtractSingleDemoZIPValidationAndCleanup(t *testing.T) {
	dir := t.TempDir()
	valid := filepath.Join(dir, "valid.zip")
	writeZIP(t, valid, map[string][]byte{"../../safe.dem": []byte("demo"), "readme.txt": []byte("text")})
	path, cleanup, err := extractSingleDemo(valid)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "safe.dem" {
		t.Fatalf("archive path was not sanitised: %s", path)
	}
	if _, err := os.Stat(filepath.Join(dir, "safe.dem")); !os.IsNotExist(err) {
		t.Fatal("zip entry escaped the temporary directory")
	}
	cleanup()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("temporary demo was not removed")
	}
	empty := filepath.Join(dir, "empty.zip")
	writeZIP(t, empty, map[string][]byte{"readme.txt": []byte("text")})
	if _, _, err := extractSingleDemo(empty); err == nil {
		t.Fatal("expected empty zip error")
	}
	multiple := filepath.Join(dir, "multiple.zip")
	writeZIP(t, multiple, map[string][]byte{"one.dem": []byte("1"), "two.dem": []byte("2")})
	if _, _, err := extractSingleDemo(multiple); err == nil {
		t.Fatal("expected multiple demo error")
	}
}

func TestDuplicateDemoCanBackfillNewFollowedPlayer(t *testing.T) {
	repo := NewSQLiteHistoryRepository(filepath.Join(t.TempDir(), "history.db"))
	if appErr := repo.Init(); appErr != nil {
		t.Fatal(appErr)
	}
	defer repo.Close()
	service := NewHistoryService(repo)
	data := historyDemoData(t)
	firstID := data.Players[0].SteamID
	secondID := data.Players[1].SteamID
	first, appErr := service.SaveParsedDemoForPlayersAtSource("history.dem", "/source/history.dem", data, []string{firstID})
	if appErr != nil {
		t.Fatal(appErr)
	}
	second, appErr := service.SaveParsedDemoForPlayersAtSource("history.dem", "/source/history.dem", data, []string{secondID})
	if appErr != nil {
		t.Fatal(appErr)
	}
	if second.SaveStatus != DemoSaveStatusDuplicate || second.SavedDemo.DemoRecordID != first.SavedDemo.DemoRecordID {
		t.Fatalf("bad duplicate backfill result: %+v", second)
	}
	matches, appErr := repo.ListPlayerMatches(secondID)
	if appErr != nil {
		t.Fatal(appErr)
	}
	if len(matches) != 1 {
		t.Fatalf("expected backfilled player match, got %d", len(matches))
	}
}

func TestImportWithoutFollowedPlayersCatalogsDemoWithoutStats(t *testing.T) {
	repo := NewSQLiteHistoryRepository(filepath.Join(t.TempDir(), "history.db"))
	if appErr := repo.Init(); appErr != nil {
		t.Fatal(appErr)
	}
	defer repo.Close()
	service := NewImportService(NewHistoryService(repo), repo)
	result := service.processPath(context.Background(), fixtureNamedPath(t, "history.dem"), nil)
	if result.Status != "imported" || result.SavedCount != 0 {
		t.Fatalf("unexpected import result: %+v", result)
	}
	players, appErr := repo.ListPlayers()
	if appErr != nil {
		t.Fatal(appErr)
	}
	if len(players) != 0 {
		t.Fatalf("unfollowed players should not have stats: %+v", players)
	}
	var demoCount, participantCount int
	if err := repo.db.QueryRow(`SELECT COUNT(*) FROM demos`).Scan(&demoCount); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.QueryRow(`SELECT COUNT(*) FROM demo_participants`).Scan(&participantCount); err != nil {
		t.Fatal(err)
	}
	if demoCount != 1 || participantCount == 0 {
		t.Fatalf("expected catalog metadata, demos=%d participants=%d", demoCount, participantCount)
	}
}

func TestImportPlayerDetailsGroupTeamsAndExposeKDA(t *testing.T) {
	data := DemoData{
		Players: []Player{
			{Name: "Alpha", SteamID: "1"},
			{Name: "Bravo", SteamID: "2"},
			{Name: "Charlie", SteamID: "3"},
			{Name: "Delta", SteamID: "4"},
		},
		Survivals: []SurvivalState{
			{RoundNumber: 1, SteamID: "1", Side: "T"},
			{RoundNumber: 1, SteamID: "2", Side: "T"},
			{RoundNumber: 1, SteamID: "3", Side: "CT"},
			{RoundNumber: 1, SteamID: "4", Side: "CT"},
		},
		Kills: []KillEvent{
			{RoundNumber: 1, AttackerSteamID: "1", VictimSteamID: "3", AssisterSteamID: "2", AttackerSide: "T", VictimSide: "CT"},
		},
	}
	details := buildImportPlayerDetails(data)
	if len(details) != 4 {
		t.Fatalf("expected four player details, got %+v", details)
	}
	byID := map[string]ImportPlayerDetail{}
	for _, detail := range details {
		byID[detail.SteamID] = detail
	}
	if byID["1"].Team != "A" || byID["2"].Team != "A" || byID["3"].Team != "B" || byID["4"].Team != "B" {
		t.Fatalf("unexpected team grouping: %+v", byID)
	}
	if byID["1"].Kills != 1 || byID["2"].Assists != 1 || byID["3"].Deaths != 1 {
		t.Fatalf("unexpected KDA summaries: %+v", byID)
	}
}

func TestFollowDraftAndMatchMetadataPersistence(t *testing.T) {
	repo := newTestSQLiteHistoryRepositoryWithDemo(t)
	player, appErr := repo.ListPlayers()
	if appErr != nil || len(player) == 0 {
		t.Fatalf("players: %v %v", player, appErr)
	}
	if appErr := repo.SetPlayerFollowed(Player{Name: player[0].Name, SteamID: player[0].SteamID}, false); appErr != nil {
		t.Fatal(appErr)
	}
	updated, appErr := repo.ListPlayers()
	if appErr != nil {
		t.Fatal(appErr)
	}
	if updated[0].Followed {
		t.Fatal("unfollow should persist without deleting data")
	}
	if appErr := repo.SaveEditorDraft(EditorDraft{Kind: "overlay", Payload: `{"players":[]}`}); appErr != nil {
		t.Fatal(appErr)
	}
	draft, appErr := repo.GetEditorDraft("overlay")
	if appErr != nil || draft == nil || draft.Payload != `{"players":[]}` {
		t.Fatalf("draft: %+v %v", draft, appErr)
	}
	matches, appErr := repo.ListPlayerMatches(player[0].SteamID)
	if appErr != nil || len(matches) == 0 {
		t.Fatalf("matches: %v %v", matches, appErr)
	}
	if appErr := repo.UpdateMatchMetadata(matches[0].DemoRecordID, "2026-08-03T12:00:00Z", []string{"赛事 A", "半决赛"}); appErr != nil {
		t.Fatal(appErr)
	}
	matches, appErr = repo.ListPlayerMatches(player[0].SteamID)
	if appErr != nil {
		t.Fatal(appErr)
	}
	if matches[0].MatchTimeSource != "manual" || len(matches[0].Tags) != 2 {
		t.Fatalf("metadata not persisted: %+v", matches[0])
	}
}

func TestDesktopAppSwitchDatabaseUpdatesServicesAndConfig(t *testing.T) {
	dir := t.TempDir()
	config := NewConfigManager(filepath.Join(dir, "config.json"))
	cfg := DefaultConfig()
	cfg.DatabasePath = filepath.Join(dir, "first.db")
	if appErr := config.Save(cfg); appErr != nil {
		t.Fatal(appErr)
	}
	first := NewSQLiteHistoryRepository(cfg.DatabasePath)
	if appErr := first.Init(); appErr != nil {
		t.Fatal(appErr)
	}
	app := &DesktopApp{config: config, cfg: cfg, repo: first, history: NewHistoryService(first), videoExports: map[string]*desktopVideoExport{}}
	app.imports = NewImportService(app.history, first)
	nextPath := filepath.Join(dir, "second.db")
	next, err := app.SwitchDatabase(nextPath)
	if err != nil {
		t.Fatal(err)
	}
	defer app.repo.Close()
	if next.DatabasePath != nextPath || app.repo.path != nextPath {
		t.Fatalf("database was not switched: config=%s repo=%s", next.DatabasePath, app.repo.path)
	}
	if app.imports.repo != app.repo || app.history.repo != app.repo {
		t.Fatal("desktop services still point at the old database")
	}
	persisted, appErr := config.Read()
	if appErr != nil {
		t.Fatal(appErr)
	}
	if persisted.DatabasePath != nextPath {
		t.Fatalf("database path was not persisted: %s", persisted.DatabasePath)
	}
}

func TestCancelVideoExportCleansPendingFrames(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	app := &DesktopApp{videoExports: map[string]*desktopVideoExport{
		"video": {TempDir: dir, ctx: ctx, cancel: cancel},
	}}
	writeTestFile(t, filepath.Join(dir, "frame_000001.png"), []byte("png"))
	if err := app.CancelVideoExport("video"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("cancelled video export did not remove its temporary directory")
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("cancelled video export did not cancel its context")
	}
}

func TestDesktopStatsDeletionPreservesFollowAndDemoCatalog(t *testing.T) {
	repo := newTestSQLiteHistoryRepositoryWithDemo(t)
	players, appErr := repo.ListPlayers()
	if appErr != nil || len(players) == 0 {
		t.Fatalf("players: %v %v", players, appErr)
	}
	player := Player{Name: players[0].Name, SteamID: players[0].SteamID}
	if appErr := repo.SetPlayerFollowed(player, true); appErr != nil {
		t.Fatal(appErr)
	}
	matches, appErr := repo.ListPlayerMatches(player.SteamID)
	if appErr != nil || len(matches) == 0 {
		t.Fatalf("matches: %v %v", matches, appErr)
	}
	if appErr := repo.DeletePlayerMatchStats(player.SteamID, matches[0].DemoRecordID); appErr != nil {
		t.Fatal(appErr)
	}
	var demoCount, participantCount, followedCount int
	if err := repo.db.QueryRow(`SELECT COUNT(*) FROM demos`).Scan(&demoCount); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.QueryRow(`SELECT COUNT(*) FROM demo_participants`).Scan(&participantCount); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.QueryRow(`SELECT COUNT(*) FROM followed_players WHERE steam_id = ?`, player.SteamID).Scan(&followedCount); err != nil {
		t.Fatal(err)
	}
	if demoCount == 0 || participantCount == 0 || followedCount != 1 {
		t.Fatalf("stats deletion removed catalog data: demos=%d participants=%d followed=%d", demoCount, participantCount, followedCount)
	}
}

func writeTestFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}
func writeZIP(t *testing.T, path string, files map[string][]byte) {
	t.Helper()
	target, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(target)
	for name, data := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := target.Close(); err != nil {
		t.Fatal(err)
	}
}
