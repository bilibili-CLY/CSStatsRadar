package radar

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestConfigDefaultsSaveReadAndCorruptFallback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	manager := NewConfigManager(path)

	cfg, err := manager.Read()
	if err != nil {
		t.Fatalf("read default: %v", err)
	}
	if cfg.ExportWidth != 1920 || cfg.ExportHeight != 1080 || cfg.ThemeColor != "#00ffff" {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if cfg.DatabasePath == "" {
		t.Fatalf("missing default database path: %+v", cfg)
	}
	if cfg.Showcase.DefaultDurationMS != 4000 {
		t.Fatalf("unexpected default showcase duration: %+v", cfg.Showcase)
	}
	if !cfg.Showcase.ShowBestMarkers || cfg.Showcase.AudioOffsetMS != 0 || cfg.Showcase.FFmpegPath != "" {
		t.Fatalf("unexpected default showcase options: %+v", cfg.Showcase)
	}
	if cfg.Showcase.Layout.RadarPosition != (NormalizedPoint{X: 0.36, Y: 0.56}) {
		t.Fatalf("unexpected default radar position: %+v", cfg.Showcase.Layout)
	}

	saved := DefaultConfig()
	saved.ExportWidth = 1280
	saved.ExportHeight = 720
	saved.ThemeColor = "#7dff6a"
	saved.ColorPreset = "lime"
	saved.LastPlayerIdentifierType = IdentifierSteamID
	saved.DatabasePath = filepath.Join(t.TempDir(), "stats.db")
	if err := manager.Save(saved); err != nil {
		t.Fatalf("save config: %v", err)
	}
	cfg, err = manager.Read()
	if err != nil {
		t.Fatalf("read saved: %v", err)
	}
	if cfg.ExportHeight != 720 || cfg.LastPlayerIdentifierType != IdentifierSteamID || cfg.DatabasePath != saved.DatabasePath {
		t.Fatalf("config did not roundtrip: %+v", cfg)
	}

	if err := os.WriteFile(path, []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err = manager.Read()
	if err != nil {
		t.Fatalf("corrupt read should fall back: %v", err)
	}
	if cfg.ExportWidth != 1920 || cfg.Warning == "" {
		t.Fatalf("expected default warning fallback: %+v", cfg)
	}
}

func TestConfigReadBackfillsShowcaseForLegacyConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	raw := map[string]any{
		"export_width":                1280,
		"export_height":               720,
		"theme_color":                 "#00ffff",
		"color_preset":                "default",
		"last_player_identifier_type": "name",
		"database_path":               filepath.Join(t.TempDir(), "stats.db"),
	}
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, appErr := NewConfigManager(path).Read()
	if appErr != nil {
		t.Fatalf("read legacy config: %v", appErr)
	}
	if cfg.Showcase.DefaultDurationMS != 4000 {
		t.Fatalf("expected showcase duration fallback: %+v", cfg.Showcase)
	}
	if cfg.Showcase.Layout.NamePosition != (NormalizedPoint{X: 0.72, Y: 0.22}) {
		t.Fatalf("expected showcase layout fallback: %+v", cfg.Showcase.Layout)
	}
}

func TestShowcaseConfigSaveAndRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := DefaultConfig()
	cfg.DatabasePath = filepath.Join(t.TempDir(), "stats.db")
	cfg.Showcase = ShowcaseConfig{
		DefaultDurationMS: 8000,
		ShowBestMarkers:   false,
		AudioOffsetMS:     1250,
		FFmpegPath:        filepath.Join(t.TempDir(), "ffmpeg"),
		Layout: ShowcaseLayout{
			RadarPosition: NormalizedPoint{X: 0.2, Y: 0.3},
			NamePosition:  NormalizedPoint{X: 0.4, Y: 0.5},
			ImagePosition: NormalizedPoint{X: 0.6, Y: 0.7},
		},
	}
	manager := NewConfigManager(path)

	if appErr := manager.Save(cfg); appErr != nil {
		t.Fatalf("save showcase config: %v", appErr)
	}
	roundtrip, appErr := manager.Read()
	if appErr != nil {
		t.Fatalf("read showcase config: %v", appErr)
	}
	if roundtrip.Showcase.DefaultDurationMS != 8000 {
		t.Fatalf("showcase duration did not roundtrip: %+v", roundtrip.Showcase)
	}
	if roundtrip.Showcase.Layout.ImagePosition != (NormalizedPoint{X: 0.6, Y: 0.7}) {
		t.Fatalf("showcase layout did not roundtrip: %+v", roundtrip.Showcase.Layout)
	}
	if roundtrip.Showcase.ShowBestMarkers || roundtrip.Showcase.AudioOffsetMS != 1250 || roundtrip.Showcase.FFmpegPath != cfg.Showcase.FFmpegPath {
		t.Fatalf("showcase options did not roundtrip: %+v", roundtrip.Showcase)
	}
}

func TestConfigDatabasePathReadFallbackAndValidation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	raw := map[string]any{
		"export_width":                1280,
		"export_height":               720,
		"theme_color":                 "#00ffff",
		"color_preset":                "default",
		"last_player_identifier_type": "name",
	}
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, appErr := NewConfigManager(path).Read()
	if appErr != nil {
		t.Fatalf("read config: %v", appErr)
	}
	if cfg.DatabasePath == "" {
		t.Fatalf("expected database path fallback: %+v", cfg)
	}
	invalid := DefaultConfig()
	invalid.ExportWidth = 1280
	invalid.ExportHeight = 720
	invalid.DatabasePath = ""
	if err := NewConfigManager(path).Save(invalid); err == nil {
		t.Fatal("expected empty database path to fail")
	}
	dir := t.TempDir()
	invalid.DatabasePath = dir
	if err := NewConfigManager(path).Save(invalid); err == nil {
		t.Fatal("expected directory database path to fail")
	}
}

func TestInvalidConfig(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "stats.db")
	base := DefaultConfig()
	base.DatabasePath = dbPath
	cases := []AppConfig{}
	cfg := base
	cfg.ExportWidth = 0
	cases = append(cases, cfg)
	cfg = base
	cfg.ExportHeight = -1
	cases = append(cases, cfg)
	cfg = base
	cfg.ThemeColor = "cyan"
	cases = append(cases, cfg)
	cfg = base
	cfg.LastPlayerIdentifierType = "nickname"
	cases = append(cases, cfg)
	for _, cfg := range cases {
		if err := NewConfigManager(filepath.Join(t.TempDir(), "config.json")).Save(cfg); err == nil {
			t.Fatalf("expected invalid config to fail: %+v", cfg)
		}
	}
}

func TestInvalidShowcaseConfig(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "stats.db")
	base := DefaultConfig()
	base.DatabasePath = dbPath
	cases := []AppConfig{}
	cfg := base
	cfg.Showcase.DefaultDurationMS = 0
	cases = append(cases, cfg)
	cfg = base
	cfg.Showcase.DefaultDurationMS = -1
	cases = append(cases, cfg)
	cfg = base
	cfg.Showcase.Layout.RadarPosition.X = -0.1
	cases = append(cases, cfg)
	cfg = base
	cfg.Showcase.Layout.NamePosition.Y = 1.1
	cases = append(cases, cfg)
	cfg = base
	cfg.Showcase.Layout.ImagePosition.X = 2
	cases = append(cases, cfg)
	cfg = base
	cfg.Showcase.AudioOffsetMS = -60001
	cases = append(cases, cfg)
	cfg = base
	cfg.Showcase.AudioOffsetMS = 60001
	cases = append(cases, cfg)

	for _, cfg := range cases {
		appErr := NewConfigManager(filepath.Join(t.TempDir(), "config.json")).Save(cfg)
		if appErr == nil {
			t.Fatalf("expected invalid showcase config to fail: %+v", cfg.Showcase)
		}
		if appErr.Code != "config_write_failed" {
			t.Fatalf("expected config_write_failed, got %s", appErr.Code)
		}
	}
}
