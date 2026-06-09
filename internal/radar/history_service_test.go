package radar

import (
	"testing"
)

func TestHistoryServiceSaveMissingFingerprintNoMatchTimeAndDuplicate(t *testing.T) {
	repo := newFakeHistoryRepository()
	service := NewHistoryService(repo)
	data := historyDemoData(t)
	data.Meta.FileSHA256 = ""
	if _, appErr := service.SaveParsedDemo("history.dem", data); appErr == nil || appErr.Code != "demo_fingerprint_missing" {
		t.Fatalf("expected missing fingerprint error, got %v", appErr)
	}
	if repo.saveCalls != 0 {
		t.Fatalf("save should not be called without file fingerprint")
	}

	data = historyDemoData(t)
	data.Meta.MatchTime = nil
	data.Meta.FileSHA256 = "no-match-time-test-hash"
	if _, appErr := service.SaveParsedDemo("history-no-time.dem", data); appErr != nil {
		t.Fatalf("missing demo match time should still save with file fingerprint: %v", appErr)
	}

	data = historyDemoData(t)
	result, appErr := service.SaveParsedDemo("history.dem", data)
	if appErr != nil {
		t.Fatalf("save parsed demo: %v", appErr)
	}
	if result.SaveStatus != DemoSaveStatusSaved || result.SavedDemo == nil {
		t.Fatalf("bad save result: %+v", result)
	}
	duplicate, appErr := service.SaveParsedDemo("history.dem", data)
	if appErr != nil {
		t.Fatalf("duplicate should not be fatal: %v", appErr)
	}
	if duplicate.SaveStatus != DemoSaveStatusDuplicate || duplicate.SavedDemo.DemoRecordID != result.SavedDemo.DemoRecordID {
		t.Fatalf("bad duplicate result: %+v", duplicate)
	}
}

func TestHistoryServiceDedupeKeyAndStatsConversion(t *testing.T) {
	a := []Player{{SteamID: "2"}, {SteamID: "1"}, {SteamID: ""}, {SteamID: "1"}}
	b := []Player{{SteamID: "1"}, {SteamID: "2"}}
	if BuildPlayerSetHash(a) != BuildPlayerSetHash(b) {
		t.Fatal("player set hash should ignore order, empty ids, and duplicates")
	}
	keyA := BuildDedupeKey("ABCDEF", " DE_MIRAGE ", BuildPlayerSetHash(a))
	keyB := BuildDedupeKey("abcdef", "de_mirage", BuildPlayerSetHash(b))
	if keyA != keyB {
		t.Fatal("dedupe key should normalize map name and player order")
	}

	repo := newFakeHistoryRepository()
	service := NewHistoryService(repo)
	result, appErr := service.SaveParsedDemo("history.dem", historyDemoData(t))
	if appErr != nil {
		t.Fatalf("save parsed demo: %v", appErr)
	}
	input := repo.savedInputs[result.SavedDemo.DemoRecordID]
	if len(input.Players) != 3 || len(input.MatchStats) != 3 {
		t.Fatalf("bad saved input counts: %+v", input)
	}
	stat := input.MatchStats[0]
	if stat.SteamID == "" || len(stat.Metrics) != len(MetricOrder) || stat.Rounds != 4 {
		t.Fatalf("bad stat conversion: %+v", stat)
	}
}

func TestHistoryServiceWhitelistFiltersSavedPlayers(t *testing.T) {
	repo := newFakeHistoryRepository()
	service := NewHistoryService(repo)
	result, appErr := service.SaveParsedDemoForPlayers("history.dem", historyDemoData(t), []string{"76561190000000001"})
	if appErr != nil {
		t.Fatalf("save with whitelist: %v", appErr)
	}
	input := repo.savedInputs[result.SavedDemo.DemoRecordID]
	if len(input.Players) != 1 || input.Players[0].SteamID != "76561190000000001" || len(input.MatchStats) != 1 {
		t.Fatalf("whitelist did not filter saved players: %+v", input)
	}
	empty, appErr := service.SaveParsedDemoForPlayers("history.dem", historyDemoData(t), []string{"missing"})
	if appErr != nil {
		t.Fatalf("missing whitelist player should not be fatal: %v", appErr)
	}
	if empty.SaveStatus != DemoSaveStatusNotSaved {
		t.Fatalf("expected not_saved for absent whitelist player, got %+v", empty)
	}
}

func historyDemoData(t *testing.T) DemoData {
	t.Helper()
	data, appErr := JSONFixtureParser{}.Parse(fixtureNamedPath(t, "history.dem"))
	if appErr != nil {
		t.Fatalf("parse history fixture: %v", appErr)
	}
	return data
}

type fakeHistoryRepository struct {
	demos       map[string]SavedDemo
	dedupe      map[string]string
	players     map[string]SavedPlayer
	matches     map[string][]PlayerMatchRecord
	savedInputs map[string]SaveParsedDemoInput
	saveCalls   int
}

func newFakeHistoryRepository() *fakeHistoryRepository {
	return &fakeHistoryRepository{
		demos:       map[string]SavedDemo{},
		dedupe:      map[string]string{},
		players:     map[string]SavedPlayer{},
		matches:     map[string][]PlayerMatchRecord{},
		savedInputs: map[string]SaveParsedDemoInput{},
	}
}

func (r *fakeHistoryRepository) Init() *AppError { return nil }
func (r *fakeHistoryRepository) Close() error    { return nil }
func (r *fakeHistoryRepository) Path() string    { return "" }

func (r *fakeHistoryRepository) FindDemoByDedupeKey(dedupeKey string) (*SavedDemo, *AppError) {
	id := r.dedupe[dedupeKey]
	if id == "" {
		return nil, nil
	}
	demo := r.demos[id]
	return &demo, nil
}

func (r *fakeHistoryRepository) SaveParsedDemo(input SaveParsedDemoInput) (*SavedDemo, *AppError) {
	r.saveCalls++
	r.demos[input.Demo.DemoRecordID] = input.Demo
	r.dedupe[input.Demo.DedupeKey] = input.Demo.DemoRecordID
	r.savedInputs[input.Demo.DemoRecordID] = input
	for _, player := range input.Players {
		r.players[player.SteamID] = SavedPlayer{SteamID: player.SteamID, Name: player.NameSnapshot, MatchCount: 1, LatestMatchTime: input.Demo.MatchTime}
	}
	for _, match := range input.MatchStats {
		r.matches[match.SteamID] = append(r.matches[match.SteamID], match)
	}
	return &input.Demo, nil
}

func (r *fakeHistoryRepository) ListPlayers() ([]SavedPlayer, *AppError) {
	players := make([]SavedPlayer, 0, len(r.players))
	for _, player := range r.players {
		players = append(players, player)
	}
	return players, nil
}

func (r *fakeHistoryRepository) GetPlayer(steamID string) (*SavedPlayer, *AppError) {
	player, ok := r.players[steamID]
	if !ok {
		return nil, NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	return &player, nil
}

func (r *fakeHistoryRepository) ListPlayerMatches(steamID string) ([]PlayerMatchRecord, *AppError) {
	return r.matches[steamID], nil
}

func (r *fakeHistoryRepository) GetMetricSnapshots(steamID string, demoRecordIDs []string) ([]PlayerMatchRecord, *AppError) {
	byID := map[string]PlayerMatchRecord{}
	for _, match := range r.matches[steamID] {
		byID[match.DemoRecordID] = match
	}
	var result []PlayerMatchRecord
	for _, id := range demoRecordIDs {
		if match, ok := byID[id]; ok {
			result = append(result, match)
		}
	}
	if len(result) != len(uniqueStrings(demoRecordIDs)) {
		return nil, NewAppError("match_record_not_found", httpStatusNotFound, "", nil)
	}
	return result, nil
}

func (r *fakeHistoryRepository) DeletePlayer(steamID string) *AppError {
	if _, ok := r.players[steamID]; !ok {
		return NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	delete(r.players, steamID)
	delete(r.matches, steamID)
	return nil
}

func (r *fakeHistoryRepository) DeletePlayerMatch(steamID string, demoRecordID string) *AppError {
	matches := r.matches[steamID]
	for i, match := range matches {
		if match.DemoRecordID == demoRecordID {
			r.matches[steamID] = append(matches[:i], matches[i+1:]...)
			return nil
		}
	}
	return NewAppError("match_record_not_found", httpStatusNotFound, "", nil)
}
