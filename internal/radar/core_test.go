package radar

import (
	"os"
	"path/filepath"
	"testing"
)

func fixturePath(t *testing.T) string {
	t.Helper()
	return filepath.Join("..", "..", "tests", "fixtures", "sample.dem")
}

func TestUploadParserResolverStatsAndRadar(t *testing.T) {
	store := NewSessionStore(t.TempDir())
	file, err := os.Open(fixturePath(t))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	session, appErr := store.SaveUpload(file, "sample.dem")
	if appErr != nil {
		t.Fatalf("save upload: %v", appErr)
	}
	if session.DemoID == "" {
		t.Fatal("missing demo id")
	}

	for _, name := range []string{"bad.txt", "bad.dem.gz", "bad.zip", "bad.bz2"} {
		if err := ValidateDemoFileName(name); err == nil {
			t.Fatalf("expected invalid suffix rejection for %s", name)
		}
	}

	data, appErr := JSONFixtureParser{}.Parse(session.FilePath)
	if appErr != nil {
		t.Fatalf("parse fixture: %v", appErr)
	}
	if len(data.Players) != 3 || len(data.Rounds) != 4 || len(data.Kills) != 3 {
		t.Fatalf("unexpected fixture parse: %+v", data)
	}

	resolver := PlayerResolver{}
	player, appErr := resolver.Resolve(data.Players, IdentifierSteamID, "76561190000000001")
	if appErr != nil {
		t.Fatalf("resolve steam id: %v", appErr)
	}
	if player.Name != "Alpha" {
		t.Fatalf("wrong player: %+v", player)
	}
	if _, appErr := resolver.Resolve(data.Players, IdentifierName, "Alpha"); appErr == nil || appErr.Code != "player_ambiguous" {
		t.Fatalf("expected ambiguous name, got %v", appErr)
	}
	if _, appErr := resolver.Resolve(data.Players, IdentifierName, "Missing"); appErr == nil || appErr.Code != "player_not_found" {
		t.Fatalf("expected not found, got %v", appErr)
	}

	stats := PlayerStatsCalculator{}.Calculate(data, player)
	if stats.Base.Rounds != 4 || stats.Base.Kills != 2 || stats.Base.Deaths != 1 {
		t.Fatalf("bad base stats: %+v", stats.Base)
	}
	if value := *stats.Metrics["KPR"].Value; value != 0.5 {
		t.Fatalf("bad KPR: %v", value)
	}
	if value := *stats.Metrics["ADR"].Value; value != 58.25 {
		t.Fatalf("bad ADR: %v", value)
	}
	if stats.Metrics["KAST"].Status != "approximate" {
		t.Fatalf("expected approximate KAST: %+v", stats.Metrics["KAST"])
	}

	radar, appErr := RadarAssembler{}.Assemble(player, stats)
	if appErr != nil {
		t.Fatalf("assemble radar: %v", appErr)
	}
	if radar.Radar.Dimensions[0] != "KPR" || radar.Radar.MaxValues[0] != 1 || radar.Radar.MaxValues[2] != 100 || radar.Radar.MaxValues[4] != 2 || radar.Radar.MaxValues[5] != 1.5 {
		t.Fatalf("bad radar payload: %+v", radar.Radar)
	}
	if radar.Radar.Note != RadarNote {
		t.Fatalf("missing note: %s", radar.Radar.Note)
	}
}

func TestMetricUnavailableAndMissingDamage(t *testing.T) {
	player := Player{Name: "Zero", SteamID: "1"}
	zero := DemoData{Players: []Player{player}}
	stats := PlayerStatsCalculator{}.Calculate(zero, player)
	if stats.Metrics["KPR"].Status != "unavailable" {
		t.Fatalf("expected unavailable metrics: %+v", stats.Metrics["KPR"])
	}
	if _, appErr := (RadarAssembler{}).Assemble(player, stats); appErr == nil || appErr.Code != "metric_unavailable" {
		t.Fatalf("expected metric_unavailable, got %v", appErr)
	}

	noDamage := DemoData{
		Players:            []Player{player},
		Rounds:             []RoundData{{RoundNumber: 1}},
		Damages:            nil,
		TradeDataAvailable: true,
	}
	stats = PlayerStatsCalculator{}.Calculate(noDamage, player)
	if stats.Metrics["ADR"].Status != "unavailable" {
		t.Fatalf("expected ADR unavailable: %+v", stats.Metrics["ADR"])
	}
}

func TestBrokenBinaryDemoReturnsParseFailed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "broken.dem")
	if err := os.WriteFile(path, []byte{0, 1, 2, 3}, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, appErr := (JSONFixtureParser{}).Parse(path); appErr == nil || appErr.Code != "demo_parse_failed" {
		t.Fatalf("expected parse failed, got %v", appErr)
	}
}
