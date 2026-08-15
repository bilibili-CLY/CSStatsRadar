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
	RoundNumber   int            `json:"round_number"`
	WinnerSide    string         `json:"winner_side,omitempty"`
	BombPlanted   bool           `json:"bomb_planted,omitempty"`
	BombPlantTick int            `json:"bomb_plant_tick,omitempty"`
	BombPlanterID string         `json:"bomb_planter_id,omitempty"`
	BombDefuserID string         `json:"bomb_defuser_id,omitempty"`
	TeamEconomy   map[string]int `json:"team_economy,omitempty"`
}

type KillEvent struct {
	RoundNumber         int    `json:"round_number"`
	Tick                int    `json:"tick,omitempty"`
	AttackerSteamID     string `json:"attacker_steam_id,omitempty"`
	VictimSteamID       string `json:"victim_steam_id,omitempty"`
	AssisterSteamID     string `json:"assister_steam_id,omitempty"`
	TradedPlayerSteamID string `json:"traded_player_steam_id,omitempty"`
	AttackerSide        string `json:"attacker_side,omitempty"`
	VictimSide          string `json:"victim_side,omitempty"`
	Weapon              string `json:"weapon,omitempty"`
	VictimWeapon        string `json:"victim_weapon,omitempty"`
	AttackerArmor       bool   `json:"attacker_armor,omitempty"`
	VictimArmor         bool   `json:"victim_armor,omitempty"`
	AttackerEquipment   int    `json:"attacker_equipment,omitempty"`
	VictimEquipment     int    `json:"victim_equipment,omitempty"`
	AssistedFlash       bool   `json:"assisted_flash,omitempty"`
}

type DamageEvent struct {
	RoundNumber       int    `json:"round_number"`
	Tick              int    `json:"tick,omitempty"`
	AttackerSteamID   string `json:"attacker_steam_id,omitempty"`
	VictimSteamID     string `json:"victim_steam_id,omitempty"`
	Damage            int    `json:"damage"`
	AttackerSide      string `json:"attacker_side,omitempty"`
	VictimSide        string `json:"victim_side,omitempty"`
	Weapon            string `json:"weapon,omitempty"`
	VictimWeapon      string `json:"victim_weapon,omitempty"`
	AttackerArmor     bool   `json:"attacker_armor,omitempty"`
	VictimArmor       bool   `json:"victim_armor,omitempty"`
	AttackerEquipment int    `json:"attacker_equipment,omitempty"`
	VictimEquipment   int    `json:"victim_equipment,omitempty"`
}

type SurvivalState struct {
	RoundNumber int    `json:"round_number"`
	SteamID     string `json:"steam_id"`
	Survived    bool   `json:"survived"`
	Side        string `json:"side,omitempty"`
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

type NormalizedPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type ShowcaseLayout struct {
	RadarPosition NormalizedPoint `json:"radar_position"`
	NamePosition  NormalizedPoint `json:"name_position"`
	ImagePosition NormalizedPoint `json:"image_position"`
}

type ShowcaseConfig struct {
	DefaultDurationMS int                `json:"default_duration_ms"`
	Layout            ShowcaseLayout     `json:"layout"`
	MusicPath         string             `json:"music_path,omitempty"`
	ShowBestMarkers   bool               `json:"show_best_markers"`
	AudioOffsetMS     int                `json:"audio_offset_ms"`
	FFmpegPath        string             `json:"ffmpeg_path,omitempty"`
	RadarScaleMode    string             `json:"radar_scale_mode"`
	RadarScale        float64            `json:"radar_scale"`
	RadarAxisScale    map[string]float64 `json:"radar_axis_scale"`
}

type ShowcaseMusicInfo struct {
	URL        string `json:"url"`
	DurationMS int    `json:"duration_ms"`
}

type PlayerImageSourceType string

const (
	PlayerImageSourceUpload      PlayerImageSourceType = "upload"
	PlayerImageSourceExternalURL PlayerImageSourceType = "external_url"
)

type PlayerImage struct {
	SteamID         string                `json:"steam_id"`
	ImageSourceType PlayerImageSourceType `json:"image_source_type"`
	ImagePath       string                `json:"image_path,omitempty"`
	ImageURL        string                `json:"image_url,omitempty"`
	PublicURL       string                `json:"public_url,omitempty"`
	UpdatedAt       time.Time             `json:"updated_at"`
}

type PlayerMVPBackground struct {
	SteamID   string    `json:"steam_id"`
	ImagePath string    `json:"image_path,omitempty"`
	PublicURL string    `json:"public_url,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ShowcaseMusic struct {
	MusicPath string `json:"music_path,omitempty"`
	PublicURL string `json:"public_url,omitempty"`
}

type AppConfig struct {
	ExportWidth              int            `json:"export_width"`
	ExportHeight             int            `json:"export_height"`
	ThemeColor               string         `json:"theme_color"`
	ColorPreset              string         `json:"color_preset"`
	LastPlayerIdentifierType IdentifierType `json:"last_player_identifier_type"`
	DatabasePath             string         `json:"database_path"`
	Showcase                 ShowcaseConfig `json:"showcase"`
	ImportSources            []ImportSource `json:"import_sources,omitempty"`
	VideoFPS                 int            `json:"video_fps"`
	ReduceMotion             bool           `json:"reduce_motion"`
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
	Base             PlayerBaseStats        `json:"base"`
	Metrics          map[string]RadarMetric `json:"metrics"`
	Rating3Metrics   map[string]RadarMetric `json:"rating_3_metrics,omitempty"`
	RoundSwing       *float64               `json:"round_swing,omitempty"`
	Rating3Available bool                   `json:"rating_3_available"`
	Rating3Reason    string                 `json:"rating_3_reason,omitempty"`
}

type RadarPayload struct {
	Dimensions       []string      `json:"dimensions"`
	Values           []*float64    `json:"values"`
	DisplayTypes     []string      `json:"display_types"`
	MaxValues        []float64     `json:"max_values"`
	MinValues        []float64     `json:"min_values"`
	Note             string        `json:"note"`
	Metrics          []RadarMetric `json:"metrics"`
	RoundSwing       *float64      `json:"round_swing,omitempty"`
	AlgorithmVersion string        `json:"algorithm_version,omitempty"`
}

type RatingProfiles struct {
	Rating2 RadarPayload  `json:"rating_2"`
	Rating3 *RadarPayload `json:"rating_3,omitempty"`
}

type Rating3Status struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

type RadarResponse struct {
	Player        Player         `json:"player"`
	Radar         RadarPayload   `json:"radar"`
	Profiles      RatingProfiles `json:"profiles"`
	Rating3Status Rating3Status  `json:"rating_3_status"`
}

type DemoSaveStatus string

const (
	DemoSaveStatusSaved     DemoSaveStatus = "saved"
	DemoSaveStatusDuplicate DemoSaveStatus = "duplicate"
	DemoSaveStatusNotSaved  DemoSaveStatus = "not_saved"
)

type SavedDemo struct {
	DemoRecordID    string    `json:"demo_record_id"`
	FileName        string    `json:"file_name"`
	MatchTime       time.Time `json:"match_time"`
	MatchTimeSource string    `json:"match_time_source,omitempty"`
	MapName         string    `json:"map_name"`
	FileSHA256      string    `json:"file_sha256,omitempty"`
	SourcePath      string    `json:"source_path,omitempty"`
	PlayerSetHash   string    `json:"-"`
	DedupeKey       string    `json:"-"`
	ImportedAt      time.Time `json:"imported_at"`
}

type SavedPlayer struct {
	SteamID         string    `json:"steam_id"`
	Name            string    `json:"name"`
	MatchCount      int       `json:"match_count"`
	LatestMatchTime time.Time `json:"latest_match_time"`
	Followed        bool      `json:"followed"`
}

type PlayerMatchRecord struct {
	DemoRecordID    string        `json:"demo_record_id"`
	SteamID         string        `json:"-"`
	MatchTime       time.Time     `json:"match_time"`
	MatchTimeSource string        `json:"match_time_source,omitempty"`
	ImportedAt      time.Time     `json:"imported_at,omitempty"`
	MapName         string        `json:"map_name"`
	FileName        string        `json:"file_name"`
	SourcePath      string        `json:"source_path,omitempty"`
	Tags            []string      `json:"tags,omitempty"`
	Rounds          int           `json:"rounds"`
	Kills           int           `json:"kills"`
	Deaths          int           `json:"deaths"`
	Assists         int           `json:"assists"`
	TotalDamage     *int          `json:"total_damage,omitempty"`
	ADR             *float64      `json:"adr"`
	KAST            *float64      `json:"kast"`
	Impact          *float64      `json:"impact"`
	Rating          *float64      `json:"rating"`
	Rating3         *float64      `json:"rating_3,omitempty"`
	RoundSwing      *float64      `json:"round_swing,omitempty"`
	MultiKill       *float64      `json:"multi_kill,omitempty"`
	RatingAlgorithm string        `json:"rating_algorithm,omitempty"`
	Rating3Metrics  []RadarMetric `json:"rating_3_metrics,omitempty"`
	Metrics         []RadarMetric `json:"metrics,omitempty"`
}

type ImportSource struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	CreatedAt string `json:"created_at"`
}

type EditorDraft struct {
	Kind      string `json:"kind"`
	Payload   string `json:"payload"`
	UpdatedAt string `json:"updated_at"`
}

type ImportPlayerDetail struct {
	Name    string `json:"name"`
	SteamID string `json:"steam_id"`
	Team    string `json:"team"`
	Kills   int    `json:"kills"`
	Deaths  int    `json:"deaths"`
	Assists int    `json:"assists"`
}

type ImportItemResult struct {
	Path          string               `json:"path"`
	FileName      string               `json:"file_name"`
	Status        string               `json:"status"`
	Message       string               `json:"message,omitempty"`
	DemoID        string               `json:"demo_id,omitempty"`
	MapName       string               `json:"map_name,omitempty"`
	Rounds        int                  `json:"rounds,omitempty"`
	Players       []Player             `json:"players,omitempty"`
	PlayerDetails []ImportPlayerDetail `json:"player_details,omitempty"`
	SavedCount    int                  `json:"saved_count"`
}

type ImportSummary struct {
	JobID       string             `json:"job_id"`
	Status      string             `json:"status"`
	Total       int                `json:"total"`
	Processed   int                `json:"processed"`
	Imported    int                `json:"imported"`
	Duplicates  int                `json:"duplicates"`
	Failed      int                `json:"failed"`
	Items       []ImportItemResult `json:"items"`
	Discovered  []Player           `json:"discovered_players"`
	StartedAt   string             `json:"started_at"`
	CompletedAt string             `json:"completed_at,omitempty"`
}

type DesktopPlayerMedia struct {
	ImageURL      string `json:"image_url,omitempty"`
	BackgroundURL string `json:"background_url,omitempty"`
}

type AggregateRadarRequest struct {
	DemoRecordIDs []string `json:"demo_record_ids"`
}

type ShowcaseVideoExportRequest struct {
	Width         int      `json:"width"`
	Height        int      `json:"height"`
	FPS           int      `json:"fps"`
	DurationMS    int      `json:"duration_ms"`
	AudioOffsetMS int      `json:"audio_offset_ms"`
	Frames        []string `json:"frames"`
}

type AggregateRadarResponse struct {
	Player        Player         `json:"player"`
	MatchCount    int            `json:"match_count"`
	Radar         RadarPayload   `json:"radar"`
	Profiles      RatingProfiles `json:"profiles"`
	Rating3Status Rating3Status  `json:"rating_3_status"`
}

type WeaponMethodology struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Strength float64  `json:"strength"`
	Weapons  []string `json:"weapons"`
}

type RatingMethodology struct {
	AlgorithmVersion      string              `json:"algorithm_version"`
	Rating2Formula        string              `json:"rating_2_formula"`
	ImpactFormula         string              `json:"impact_formula"`
	Rating3Formula        string              `json:"rating_3_formula"`
	Rating3BaseFormula    string              `json:"rating_3_base_formula"`
	MultiKPRFormula       string              `json:"multi_kpr_formula"`
	MultiImpactFormula    string              `json:"multi_impact_formula"`
	SwingRatingFormula    string              `json:"swing_rating_formula"`
	SwingFormula          string              `json:"swing_formula"`
	WinProbabilityFormula string              `json:"win_probability_formula"`
	WeaponWeightFormula   string              `json:"weapon_weight_formula"`
	SniperDamageFormula   string              `json:"sniper_damage_formula"`
	WeaponCategories      []WeaponMethodology `json:"weapon_categories"`
	ContributionWeights   map[string]float64  `json:"contribution_weights"`
	Constants             map[string]float64  `json:"constants"`
	Limitations           []string            `json:"limitations"`
}

type UploadResponse struct {
	DemoID      string         `json:"demo_id"`
	Status      string         `json:"status"`
	Players     []Player       `json:"players"`
	SaveStatus  DemoSaveStatus `json:"save_status"`
	SaveMessage string         `json:"save_message,omitempty"`
	SavedDemo   *SavedDemo     `json:"saved_demo,omitempty"`
}
