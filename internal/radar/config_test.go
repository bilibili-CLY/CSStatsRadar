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

	saved := AppConfig{
		ExportWidth:              1280,
		ExportHeight:             720,
		ThemeColor:               "#7dff6a",
		ColorPreset:              "lime",
		LastPlayerIdentifierType: IdentifierSteamID,
		DatabasePath:             filepath.Join(t.TempDir(), "stats.db"),
	}
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
	if err := NewConfigManager(path).Save(AppConfig{
		ExportWidth:              1280,
		ExportHeight:             720,
		ThemeColor:               "#00ffff",
		ColorPreset:              "default",
		LastPlayerIdentifierType: IdentifierName,
		DatabasePath:             "",
	}); err == nil {
		t.Fatal("expected empty database path to fail")
	}
	dir := t.TempDir()
	if err := NewConfigManager(path).Save(AppConfig{
		ExportWidth:              1280,
		ExportHeight:             720,
		ThemeColor:               "#00ffff",
		ColorPreset:              "default",
		LastPlayerIdentifierType: IdentifierName,
		DatabasePath:             dir,
	}); err == nil {
		t.Fatal("expected directory database path to fail")
	}
}

func TestInvalidConfig(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "stats.db")
	cases := []AppConfig{
		{ExportWidth: 0, ExportHeight: 1080, ThemeColor: "#00ffff", ColorPreset: "default", LastPlayerIdentifierType: IdentifierName, DatabasePath: dbPath},
		{ExportWidth: 1920, ExportHeight: -1, ThemeColor: "#00ffff", ColorPreset: "default", LastPlayerIdentifierType: IdentifierName, DatabasePath: dbPath},
		{ExportWidth: 1920, ExportHeight: 1080, ThemeColor: "cyan", ColorPreset: "default", LastPlayerIdentifierType: IdentifierName, DatabasePath: dbPath},
		{ExportWidth: 1920, ExportHeight: 1080, ThemeColor: "#00ffff", ColorPreset: "default", LastPlayerIdentifierType: "nickname", DatabasePath: dbPath},
	}
	for _, cfg := range cases {
		if err := NewConfigManager(filepath.Join(t.TempDir(), "config.json")).Save(cfg); err == nil {
			t.Fatalf("expected invalid config to fail: %+v", cfg)
		}
	}
}
