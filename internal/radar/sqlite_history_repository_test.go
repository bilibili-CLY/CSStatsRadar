package radar

import (
	"path/filepath"
	"testing"
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
