package radar

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
)

var themeColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func DefaultConfig() AppConfig {
	return AppConfig{
		ExportWidth:              1920,
		ExportHeight:             1080,
		ThemeColor:               "#00ffff",
		ColorPreset:              "default",
		LastPlayerIdentifierType: IdentifierName,
		DatabasePath:             DefaultDatabasePath(),
	}
}

func DefaultDatabasePath() string {
	if value := os.Getenv("CS_RADAR_DB_PATH"); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".csplayerstatsradar", "player_stats.db")
	}
	return filepath.Join(home, ".csplayerstatsradar", "player_stats.db")
}

func DefaultConfigPath() string {
	if value := os.Getenv("CS_RADAR_CONFIG_PATH"); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".csplayerstatsradar", "config.json")
	}
	return filepath.Join(home, ".csplayerstatsradar", "config.json")
}

type ConfigManager struct {
	Path string
}

func NewConfigManager(path string) *ConfigManager {
	if path == "" {
		path = DefaultConfigPath()
	}
	return &ConfigManager{Path: path}
}

func (m *ConfigManager) Read() (AppConfig, *AppError) {
	cfg := DefaultConfig()
	data, err := os.ReadFile(m.Path)
	if errors.Is(err, os.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return cfg, NewAppError("config_read_failed", httpStatusInternal, "", nil)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		cfg.Warning = ErrorMessages["config_read_failed"]
		return cfg, nil
	}
	merged := map[string]any{
		"export_width":                cfg.ExportWidth,
		"export_height":               cfg.ExportHeight,
		"theme_color":                 cfg.ThemeColor,
		"color_preset":                cfg.ColorPreset,
		"last_player_identifier_type": cfg.LastPlayerIdentifierType,
		"database_path":               cfg.DatabasePath,
	}
	for key, value := range raw {
		if _, ok := merged[key]; ok {
			merged[key] = value
		}
	}
	validated, appErr := ValidateConfigMap(merged, "config_read_failed")
	if appErr != nil {
		cfg.Warning = ErrorMessages["config_read_failed"]
		return cfg, nil
	}
	return validated, nil
}

func (m *ConfigManager) Save(cfg AppConfig) *AppError {
	if err := ValidateConfig(cfg, "config_write_failed"); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return NewAppError("config_write_failed", httpStatusInternal, "", nil)
	}
	if err := os.MkdirAll(filepath.Dir(m.Path), 0o755); err != nil {
		return NewAppError("config_write_failed", httpStatusInternal, "", nil)
	}
	if err := os.WriteFile(m.Path, data, 0o644); err != nil {
		return NewAppError("config_write_failed", httpStatusInternal, "", nil)
	}
	return nil
}

func ValidateConfigMap(raw map[string]any, errorCode string) (AppConfig, *AppError) {
	cfg := DefaultConfig()
	if value, ok := raw["export_width"].(float64); ok {
		cfg.ExportWidth = int(value)
	} else if value, ok := raw["export_width"].(int); ok {
		cfg.ExportWidth = value
	}
	if value, ok := raw["export_height"].(float64); ok {
		cfg.ExportHeight = int(value)
	} else if value, ok := raw["export_height"].(int); ok {
		cfg.ExportHeight = value
	}
	if value, ok := raw["theme_color"].(string); ok {
		cfg.ThemeColor = value
	}
	if value, ok := raw["color_preset"].(string); ok && value != "" {
		cfg.ColorPreset = value
	}
	if value, ok := raw["last_player_identifier_type"].(string); ok {
		cfg.LastPlayerIdentifierType = IdentifierType(value)
	}
	if value, ok := raw["database_path"].(string); ok {
		cfg.DatabasePath = value
	}
	return cfg, ValidateConfig(cfg, errorCode)
}

func ValidateConfig(cfg AppConfig, errorCode string) *AppError {
	if cfg.ExportWidth <= 0 || cfg.ExportWidth > 8192 || cfg.ExportHeight <= 0 || cfg.ExportHeight > 8192 {
		return NewAppError("invalid_export_size", httpStatusBadRequest, "", nil)
	}
	if !themeColorPattern.MatchString(cfg.ThemeColor) {
		return NewAppError(errorCode, httpStatusBadRequest, "主题色必须是 #RRGGBB 格式。", nil)
	}
	if cfg.LastPlayerIdentifierType != IdentifierName && cfg.LastPlayerIdentifierType != IdentifierSteamID {
		return NewAppError(errorCode, httpStatusBadRequest, "玩家标识类型必须是 name 或 steam_id。", nil)
	}
	if cfg.DatabasePath == "" {
		return NewAppError(errorCode, httpStatusBadRequest, "数据库路径不能为空。", nil)
	}
	if info, err := os.Stat(cfg.DatabasePath); err == nil && info.IsDir() {
		return NewAppError(errorCode, httpStatusBadRequest, "数据库路径不能是目录。", nil)
	}
	return nil
}

const (
	httpStatusBadRequest    = 400
	httpStatusNotFound      = 404
	httpStatusConflict      = 409
	httpStatusUnprocessable = 422
	httpStatusInternal      = 500
)
