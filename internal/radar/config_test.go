package radar

import (
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

	saved := AppConfig{
		ExportWidth:              1280,
		ExportHeight:             720,
		ThemeColor:               "#7dff6a",
		ColorPreset:              "lime",
		LastPlayerIdentifierType: IdentifierSteamID,
	}
	if err := manager.Save(saved); err != nil {
		t.Fatalf("save config: %v", err)
	}
	cfg, err = manager.Read()
	if err != nil {
		t.Fatalf("read saved: %v", err)
	}
	if cfg.ExportHeight != 720 || cfg.LastPlayerIdentifierType != IdentifierSteamID {
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

func TestInvalidConfig(t *testing.T) {
	cases := []AppConfig{
		{ExportWidth: 0, ExportHeight: 1080, ThemeColor: "#00ffff", ColorPreset: "default", LastPlayerIdentifierType: IdentifierName},
		{ExportWidth: 1920, ExportHeight: -1, ThemeColor: "#00ffff", ColorPreset: "default", LastPlayerIdentifierType: IdentifierName},
		{ExportWidth: 1920, ExportHeight: 1080, ThemeColor: "cyan", ColorPreset: "default", LastPlayerIdentifierType: IdentifierName},
		{ExportWidth: 1920, ExportHeight: 1080, ThemeColor: "#00ffff", ColorPreset: "default", LastPlayerIdentifierType: "nickname"},
	}
	for _, cfg := range cases {
		if err := NewConfigManager(filepath.Join(t.TempDir(), "config.json")).Save(cfg); err == nil {
			t.Fatalf("expected invalid config to fail: %+v", cfg)
		}
	}
}
