package radar

import "time"

type IdentifierType string

const (
	IdentifierName    IdentifierType = "name"
	IdentifierSteamID IdentifierType = "steam_id"
)

type Player struct {
	Name    string `json:"name"`
	SteamID string `json:"steam_id"`
}

type RoundData struct {
	RoundNumber int `json:"round_number"`
}

type KillEvent struct {
	RoundNumber         int    `json:"round_number"`
	AttackerSteamID     string `json:"attacker_steam_id,omitempty"`
	VictimSteamID       string `json:"victim_steam_id,omitempty"`
	AssisterSteamID     string `json:"assister_steam_id,omitempty"`
	TradedPlayerSteamID string `json:"traded_player_steam_id,omitempty"`
}

type DamageEvent struct {
	RoundNumber     int    `json:"round_number"`
	AttackerSteamID string `json:"attacker_steam_id,omitempty"`
	VictimSteamID   string `json:"victim_steam_id,omitempty"`
	Damage          int    `json:"damage"`
}

type SurvivalState struct {
	RoundNumber int    `json:"round_number"`
	SteamID     string `json:"steam_id"`
	Survived    bool   `json:"survived"`
}

type DemoMeta struct {
	MatchTime  *time.Time `json:"match_time,omitempty"`
	MapName    string     `json:"map_name,omitempty"`
	ServerName string     `json:"server_name,omitempty"`
	FileSHA256 string     `json:"-"`
}

type DemoData struct {
	Players            []Player        `json:"players"`
	Rounds             []RoundData     `json:"rounds"`
	Kills              []KillEvent     `json:"kills"`
	Damages            *[]DamageEvent  `json:"damages,omitempty"`
	Survivals          []SurvivalState `json:"survivals"`
	TradeDataAvailable bool            `json:"trade_data_available"`
	Source             string          `json:"source"`
	Meta               DemoMeta        `json:"meta"`
}

type DemoSession struct {
	DemoID     string    `json:"demo_id"`
	FileName   string    `json:"file_name"`
	FilePath   string    `json:"file_path"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
	Players    []Player  `json:"players"`
	ParseError string    `json:"parse_error,omitempty"`
	Data       *DemoData `json:"-"`
}

type AppConfig struct {
	ExportWidth              int            `json:"export_width"`
	ExportHeight             int            `json:"export_height"`
	ThemeColor               string         `json:"theme_color"`
	ColorPreset              string         `json:"color_preset"`
	LastPlayerIdentifierType IdentifierType `json:"last_player_identifier_type"`
	DatabasePath             string         `json:"database_path"`
	Warning                  string         `json:"warning,omitempty"`
}

type ResolveRequest struct {
	IdentifierType IdentifierType `json:"identifier_type"`
	Identifier     string         `json:"identifier"`
}

type PlayerBaseStats struct {
	Rounds         int  `json:"rounds"`
	Kills          int  `json:"kills"`
	Deaths         int  `json:"deaths"`
	Assists        int  `json:"assists"`
	TotalDamage    *int `json:"total_damage"`
	SurvivedRounds int  `json:"survived_rounds"`
	KASTRounds     int  `json:"kast_rounds"`
}

type RadarMetric struct {
	Name        string   `json:"name"`
	Value       *float64 `json:"value"`
	DisplayType string   `json:"display_type"`
	MaxValue    float64  `json:"max_value"`
	MinValue    float64  `json:"min_value"`
	Status      string   `json:"status"`
	Reason      string   `json:"reason,omitempty"`
	Note        string   `json:"note,omitempty"`
}

type PlayerStatsResult struct {
	Base    PlayerBaseStats        `json:"base"`
	Metrics map[string]RadarMetric `json:"metrics"`
}

type RadarPayload struct {
	Dimensions   []string      `json:"dimensions"`
	Values       []*float64    `json:"values"`
	DisplayTypes []string      `json:"display_types"`
	MaxValues    []float64     `json:"max_values"`
	MinValues    []float64     `json:"min_values"`
	Note         string        `json:"note"`
	Metrics      []RadarMetric `json:"metrics"`
}

type RadarResponse struct {
	Player Player       `json:"player"`
	Radar  RadarPayload `json:"radar"`
}

type DemoSaveStatus string

const (
	DemoSaveStatusSaved     DemoSaveStatus = "saved"
	DemoSaveStatusDuplicate DemoSaveStatus = "duplicate"
	DemoSaveStatusNotSaved  DemoSaveStatus = "not_saved"
)

type SavedDemo struct {
	DemoRecordID  string    `json:"demo_record_id"`
	FileName      string    `json:"file_name"`
	MatchTime     time.Time `json:"match_time"`
	MapName       string    `json:"map_name"`
	PlayerSetHash string    `json:"-"`
	DedupeKey     string    `json:"-"`
	ImportedAt    time.Time `json:"imported_at"`
}

type SavedPlayer struct {
	SteamID         string    `json:"steam_id"`
	Name            string    `json:"name"`
	MatchCount      int       `json:"match_count"`
	LatestMatchTime time.Time `json:"latest_match_time"`
}

type PlayerMatchRecord struct {
	DemoRecordID string        `json:"demo_record_id"`
	SteamID      string        `json:"-"`
	MatchTime    time.Time     `json:"match_time"`
	MapName      string        `json:"map_name"`
	FileName     string        `json:"file_name"`
	Rounds       int           `json:"rounds"`
	Kills        int           `json:"kills"`
	Deaths       int           `json:"deaths"`
	Assists      int           `json:"assists"`
	TotalDamage  *int          `json:"total_damage,omitempty"`
	ADR          *float64      `json:"adr"`
	KAST         *float64      `json:"kast"`
	Impact       *float64      `json:"impact"`
	Rating       *float64      `json:"rating"`
	Metrics      []RadarMetric `json:"metrics,omitempty"`
}

type AggregateRadarRequest struct {
	DemoRecordIDs []string `json:"demo_record_ids"`
}

type AggregateRadarResponse struct {
	Player     Player       `json:"player"`
	MatchCount int          `json:"match_count"`
	Radar      RadarPayload `json:"radar"`
}

type UploadResponse struct {
	DemoID      string         `json:"demo_id"`
	Status      string         `json:"status"`
	Players     []Player       `json:"players"`
	SaveStatus  DemoSaveStatus `json:"save_status"`
	SaveMessage string         `json:"save_message,omitempty"`
	SavedDemo   *SavedDemo     `json:"saved_demo,omitempty"`
}
