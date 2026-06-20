package radar

type HistoryRepository interface {
	Init() *AppError
	Close() error
	Path() string

	FindDemoByDedupeKey(dedupeKey string) (*SavedDemo, *AppError)
	SaveParsedDemo(input SaveParsedDemoInput) (*SavedDemo, *AppError)

	ListPlayers() ([]SavedPlayer, *AppError)
	GetPlayer(steamID string) (*SavedPlayer, *AppError)
	ListPlayerMatches(steamID string) ([]PlayerMatchRecord, *AppError)
	GetMetricSnapshots(steamID string, demoRecordIDs []string) ([]PlayerMatchRecord, *AppError)
	GetPlayerImage(steamID string) (*PlayerImage, *AppError)
	SavePlayerImage(image PlayerImage) (*PlayerImage, *AppError)
	DeletePlayerImage(steamID string) *AppError
	GetPlayerMVPBackground(steamID string) (*PlayerMVPBackground, *AppError)
	SavePlayerMVPBackground(background PlayerMVPBackground) (*PlayerMVPBackground, *AppError)
	DeletePlayerMVPBackground(steamID string) *AppError
	DeletePlayer(steamID string) *AppError
	DeleteAllPlayers() *AppError
	DeletePlayerMatch(steamID string, demoRecordID string) *AppError
}

type SaveParsedDemoInput struct {
	Demo       SavedDemo
	Players    []DemoPlayerSnapshot
	MatchStats []PlayerMatchRecord
}

type DemoPlayerSnapshot struct {
	DemoRecordID string
	SteamID      string
	NameSnapshot string
}

type HistorySaveResult struct {
	SaveStatus DemoSaveStatus `json:"save_status"`
	SavedDemo  *SavedDemo     `json:"saved_demo,omitempty"`
}
