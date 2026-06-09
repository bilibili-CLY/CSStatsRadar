package radar

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"
)

type HistoryService struct {
	repo    HistoryRepository
	manager *HistoryStoreManager
	stats   PlayerStatsCalculator
	now     func() time.Time
}

func NewHistoryService(repo HistoryRepository) *HistoryService {
	return &HistoryService{
		repo:  repo,
		stats: PlayerStatsCalculator{},
		now:   func() time.Time { return time.Now().UTC() },
	}
}

func NewManagedHistoryService(manager *HistoryStoreManager) *HistoryService {
	return &HistoryService{
		manager: manager,
		stats:   PlayerStatsCalculator{},
		now:     func() time.Time { return time.Now().UTC() },
	}
}

func (s *HistoryService) SaveParsedDemo(fileName string, data DemoData) (*HistorySaveResult, *AppError) {
	return s.SaveParsedDemoForPlayers(fileName, data, nil)
}

func (s *HistoryService) SaveParsedDemoForPlayers(fileName string, data DemoData, allowedSteamIDs []string) (*HistorySaveResult, *AppError) {
	fileHash := strings.TrimSpace(data.Meta.FileSHA256)
	if fileHash == "" {
		return nil, NewAppError("demo_fingerprint_missing", httpStatusUnprocessable, "", nil)
	}
	repo := s.currentRepo()
	if repo == nil {
		return &HistorySaveResult{SaveStatus: DemoSaveStatusNotSaved}, nil
	}
	allValidPlayers := uniquePlayersBySteamID(data.Players)
	validPlayers := filterPlayersBySteamID(allValidPlayers, allowedSteamIDs)
	if len(validPlayers) == 0 {
		return &HistorySaveResult{SaveStatus: DemoSaveStatusNotSaved}, nil
	}
	importedAt := s.now().UTC()
	recordTime := importedAt
	if data.Meta.MatchTime != nil {
		recordTime = data.Meta.MatchTime.UTC()
	}
	playerSetHash := BuildPlayerSetHash(allValidPlayers)
	dedupeKey := BuildDedupeKey(fileHash, data.Meta.MapName, playerSetHash)
	existing, appErr := repo.FindDemoByDedupeKey(dedupeKey)
	if appErr != nil {
		return nil, appErr
	}

	demoRecordID := fmt.Sprintf("demo_record_%s_%s", recordTime.Format("20060102_150405"), randomHex(4))
	demo := SavedDemo{
		DemoRecordID:  demoRecordID,
		FileName:      fileName,
		MatchTime:     recordTime,
		MapName:       strings.TrimSpace(data.Meta.MapName),
		PlayerSetHash: playerSetHash,
		DedupeKey:     dedupeKey,
		ImportedAt:    importedAt,
	}
	saveStatus := DemoSaveStatusSaved
	if existing != nil {
		demo = *existing
		saveStatus = DemoSaveStatusDuplicate
	}
	input := SaveParsedDemoInput{Demo: demo}
	for _, player := range validPlayers {
		input.Players = append(input.Players, DemoPlayerSnapshot{
			DemoRecordID: demoRecordID,
			SteamID:      strings.TrimSpace(player.SteamID),
			NameSnapshot: player.Name,
		})
		stats := s.stats.Calculate(data, player)
		input.MatchStats = append(input.MatchStats, playerStatsToMatchRecord(demo, player, stats))
	}
	saved, appErr := repo.SaveParsedDemo(input)
	if appErr != nil {
		return nil, appErr
	}
	return &HistorySaveResult{SaveStatus: saveStatus, SavedDemo: saved}, nil
}

func (s *HistoryService) ListPlayers() ([]SavedPlayer, *AppError) {
	repo := s.currentRepo()
	if repo == nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "", nil)
	}
	return repo.ListPlayers()
}

func (s *HistoryService) GetPlayer(steamID string) (*SavedPlayer, *AppError) {
	repo := s.currentRepo()
	if repo == nil {
		return nil, NewAppError("database_open_failed", httpStatusInternal, "", nil)
	}
	if strings.TrimSpace(steamID) == "" {
		return nil, NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	return repo.GetPlayer(strings.TrimSpace(steamID))
}

func (s *HistoryService) ListPlayerMatches(steamID string) ([]PlayerMatchRecord, *AppError) {
	if _, appErr := s.GetPlayer(steamID); appErr != nil {
		return nil, appErr
	}
	return s.currentRepo().ListPlayerMatches(strings.TrimSpace(steamID))
}

func (s *HistoryService) DeletePlayer(steamID string) *AppError {
	repo := s.currentRepo()
	if repo == nil {
		return NewAppError("database_open_failed", httpStatusInternal, "", nil)
	}
	steamID = strings.TrimSpace(steamID)
	if steamID == "" {
		return NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	return repo.DeletePlayer(steamID)
}

func (s *HistoryService) DeletePlayerMatch(steamID string, demoRecordID string) *AppError {
	repo := s.currentRepo()
	if repo == nil {
		return NewAppError("database_open_failed", httpStatusInternal, "", nil)
	}
	steamID = strings.TrimSpace(steamID)
	demoRecordID = strings.TrimSpace(demoRecordID)
	if steamID == "" || demoRecordID == "" {
		return NewAppError("match_record_not_found", httpStatusNotFound, "", nil)
	}
	return repo.DeletePlayerMatch(steamID, demoRecordID)
}

func (s *HistoryService) Repository() HistoryRepository {
	return s.currentRepo()
}

func (s *HistoryService) SwitchDatabase(path string) *AppError {
	if s == nil || s.manager == nil {
		return NewAppError("database_open_failed", httpStatusInternal, "", nil)
	}
	return s.manager.Switch(path)
}

func (s *HistoryService) currentRepo() HistoryRepository {
	if s == nil {
		return nil
	}
	if s.manager != nil {
		return s.manager.Current()
	}
	return s.repo
}

func BuildPlayerSetHash(players []Player) string {
	ids := make([]string, 0, len(players))
	seen := map[string]bool{}
	for _, player := range players {
		id := strings.TrimSpace(player.SteamID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	sort.Strings(ids)
	sum := sha256.Sum256([]byte(strings.Join(ids, "\n")))
	return hex.EncodeToString(sum[:])
}

func BuildDedupeKey(fileSHA256 string, mapName string, playerSetHash string) string {
	key := strings.Join([]string{
		strings.ToLower(strings.TrimSpace(fileSHA256)),
		strings.ToLower(strings.TrimSpace(mapName)),
		playerSetHash,
	}, "\n")
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func uniquePlayersBySteamID(players []Player) []Player {
	seen := map[string]bool{}
	result := make([]Player, 0, len(players))
	for _, player := range players {
		id := strings.TrimSpace(player.SteamID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		player.SteamID = id
		result = append(result, player)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].SteamID < result[j].SteamID })
	return result
}

func filterPlayersBySteamID(players []Player, allowedSteamIDs []string) []Player {
	if allowedSteamIDs == nil {
		return players
	}
	allowed := map[string]bool{}
	for _, steamID := range allowedSteamIDs {
		trimmed := strings.TrimSpace(steamID)
		if trimmed != "" {
			allowed[trimmed] = true
		}
	}
	if len(allowed) == 0 {
		return nil
	}
	filtered := make([]Player, 0, len(players))
	for _, player := range players {
		if allowed[player.SteamID] {
			filtered = append(filtered, player)
		}
	}
	return filtered
}

func playerStatsToMatchRecord(demo SavedDemo, player Player, stats PlayerStatsResult) PlayerMatchRecord {
	return PlayerMatchRecord{
		DemoRecordID: demo.DemoRecordID,
		SteamID:      player.SteamID,
		MatchTime:    demo.MatchTime,
		MapName:      demo.MapName,
		FileName:     demo.FileName,
		Rounds:       stats.Base.Rounds,
		Kills:        stats.Base.Kills,
		Deaths:       stats.Base.Deaths,
		Assists:      stats.Base.Assists,
		TotalDamage:  stats.Base.TotalDamage,
		ADR:          metricValue(stats.Metrics, "ADR"),
		KAST:         metricValue(stats.Metrics, "KAST"),
		Impact:       metricValue(stats.Metrics, "Impact"),
		Rating:       metricValue(stats.Metrics, "Rating"),
		Metrics:      metricsInOrder(stats.Metrics),
	}
}

func metricValue(metrics map[string]RadarMetric, name string) *float64 {
	metric := metrics[name]
	return metric.Value
}

func metricsInOrder(metrics map[string]RadarMetric) []RadarMetric {
	result := make([]RadarMetric, 0, len(MetricOrder))
	for _, name := range MetricOrder {
		result = append(result, metrics[name])
	}
	return result
}
