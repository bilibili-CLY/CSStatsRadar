package radar

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxImportFileSize    = int64(4 << 30)
	maxExtractedDemoSize = int64(2 << 30)
	maxZipRatio          = uint64(200)
)

type ImportService struct {
	parser     DemoParser
	history    *HistoryService
	repo       *SQLiteHistoryRepository
	mu         sync.RWMutex
	jobs       map[string]*importJob
	onProgress func(ImportSummary)
}

type importJob struct {
	ctx     context.Context
	cancel  context.CancelFunc
	mu      sync.RWMutex
	summary ImportSummary
	paths   []string
}

func NewImportService(history *HistoryService, repo *SQLiteHistoryRepository) *ImportService {
	return &ImportService{parser: JSONFixtureParser{}, history: history, repo: repo, jobs: map[string]*importJob{}}
}

func (s *ImportService) SetProgressHandler(handler func(ImportSummary)) { s.onProgress = handler }

func ScanSourcePaths(sources []ImportSource) ([]string, *AppError) {
	seen := map[string]bool{}
	paths := []string{}
	for _, source := range sources {
		entries, err := os.ReadDir(source.Path)
		if err != nil {
			return nil, NewAppError("invalid_file_type", httpStatusBadRequest, "素材目录无法读取："+source.Path, nil)
		}
		for _, entry := range entries {
			if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			lower := strings.ToLower(entry.Name())
			if !strings.HasSuffix(lower, ".dem") && !strings.HasSuffix(lower, ".zip") {
				continue
			}
			path := filepath.Join(source.Path, entry.Name())
			if !seen[path] {
				seen[path] = true
				paths = append(paths, path)
			}
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func (s *ImportService) Start(paths []string) (string, *AppError) {
	paths = uniqueStrings(paths)
	if len(paths) == 0 {
		return "", NewAppError("invalid_file_type", httpStatusBadRequest, "没有可导入的 DEM 或 ZIP。", nil)
	}
	ctx, cancel := context.WithCancel(context.Background())
	jobID := "import_" + time.Now().UTC().Format("20060102_150405") + "_" + randomHex(4)
	job := &importJob{ctx: ctx, cancel: cancel, paths: paths, summary: ImportSummary{JobID: jobID, Status: "running", Total: len(paths), Items: []ImportItemResult{}, Discovered: []Player{}, StartedAt: time.Now().UTC().Format(time.RFC3339)}}
	s.mu.Lock()
	s.jobs[jobID] = job
	s.mu.Unlock()
	go s.run(job)
	return jobID, nil
}

func (s *ImportService) run(job *importJob) {
	workers := 2
	queue := make(chan string)
	results := make(chan ImportItemResult)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for path := range queue {
				select {
				case <-job.ctx.Done():
					return
				default:
				}
				results <- s.processPath(job.ctx, path, nil)
			}
		}()
	}
	go func() {
		defer close(queue)
		for _, path := range job.paths {
			select {
			case <-job.ctx.Done():
				return
			case queue <- path:
			}
		}
	}()
	go func() { wg.Wait(); close(results) }()
	discovered := map[string]Player{}
	for result := range results {
		job.mu.Lock()
		job.summary.Items = append(job.summary.Items, result)
		job.summary.Processed++
		switch result.Status {
		case "imported":
			job.summary.Imported++
		case "duplicate":
			job.summary.Duplicates++
		case "failed", "needs_attention":
			job.summary.Failed++
		}
		for _, player := range result.Players {
			if player.SteamID != "" {
				discovered[player.SteamID] = player
			}
		}
		job.summary.Discovered = mapPlayers(discovered)
		snapshot := job.summary
		job.mu.Unlock()
		s.emit(snapshot)
	}
	job.mu.Lock()
	if job.ctx.Err() != nil {
		job.summary.Status = "cancelled"
	} else {
		job.summary.Status = "completed"
	}
	job.summary.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	snapshot := job.summary
	job.mu.Unlock()
	s.emit(snapshot)
}

func (s *ImportService) processPath(ctx context.Context, path string, allowedOverride []string) ImportItemResult {
	result := ImportItemResult{Path: path, FileName: filepath.Base(path)}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		result.Status = "failed"
		result.Message = "文件不可读取或不是普通文件。"
		return result
	}
	if info.Size() > maxImportFileSize {
		result.Status = "failed"
		result.Message = "文件超过 4GB 安全限制。"
		return result
	}
	demoPath := path
	cleanup := func() {}
	if strings.EqualFold(filepath.Ext(path), ".zip") {
		demoPath, cleanup, err = extractSingleDemo(path)
		if err != nil {
			result.Status = "needs_attention"
			result.Message = err.Error()
			return result
		}
		defer cleanup()
	} else if !strings.EqualFold(filepath.Ext(path), ".dem") {
		result.Status = "failed"
		result.Message = "仅支持 .dem 和 .zip。"
		return result
	}
	select {
	case <-ctx.Done():
		result.Status = "cancelled"
		return result
	default:
	}
	data, appErr := s.parser.Parse(demoPath)
	if appErr != nil {
		result.Status = "failed"
		result.Message = appErr.Message
		return result
	}
	result.Players = data.Players
	result.PlayerDetails = buildImportPlayerDetails(data)
	result.MapName = data.Meta.MapName
	result.Rounds = len(data.Rounds)
	allowed := allowedOverride
	if allowed == nil {
		allowed = []string{}
		followed, appErr := s.repo.ListFollowedPlayers()
		if appErr != nil {
			result.Status = "failed"
			result.Message = appErr.Message
			return result
		}
		for _, player := range followed {
			allowed = append(allowed, player.SteamID)
		}
	}
	saveResult, appErr := s.history.SaveParsedDemoForPlayersAtSource(filepath.Base(demoPath), path, data, allowed)
	if appErr != nil {
		result.Status = "failed"
		result.Message = appErr.Message
		return result
	}
	if saveResult.SavedDemo != nil {
		result.DemoID = saveResult.SavedDemo.DemoRecordID
	}
	for _, player := range data.Players {
		for _, steamID := range allowed {
			if player.SteamID == steamID {
				result.SavedCount++
				break
			}
		}
	}
	if saveResult.SaveStatus == DemoSaveStatusDuplicate {
		result.Status = "duplicate"
	} else {
		result.Status = "imported"
	}
	return result
}

func extractSingleDemo(path string) (string, func(), error) {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return "", func() {}, fmt.Errorf("ZIP 无法打开：%w", err)
	}
	defer reader.Close()
	var demo *zip.File
	for _, entry := range reader.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		if !strings.EqualFold(filepath.Ext(entry.Name), ".dem") {
			continue
		}
		if demo != nil {
			return "", func() {}, fmt.Errorf("ZIP 中包含多个 DEM，请先整理压缩包")
		}
		demo = entry
	}
	if demo == nil {
		return "", func() {}, fmt.Errorf("ZIP 中没有 DEM 文件")
	}
	if demo.UncompressedSize64 > uint64(maxExtractedDemoSize) {
		return "", func() {}, fmt.Errorf("ZIP 中的 DEM 超过 2GB 安全限制")
	}
	if demo.CompressedSize64 > 0 && demo.UncompressedSize64/demo.CompressedSize64 > maxZipRatio {
		return "", func() {}, fmt.Errorf("ZIP 压缩比异常，已拒绝解压")
	}
	tempDir, err := os.MkdirTemp("", "cs-radar-import-*")
	if err != nil {
		return "", func() {}, err
	}
	cleanup := func() { _ = os.RemoveAll(tempDir) }
	targetPath := filepath.Join(tempDir, filepath.Base(demo.Name))
	source, err := demo.Open()
	if err != nil {
		cleanup()
		return "", func() {}, err
	}
	defer source.Close()
	target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		cleanup()
		return "", func() {}, err
	}
	written, copyErr := io.Copy(target, io.LimitReader(source, maxExtractedDemoSize+1))
	closeErr := target.Close()
	if copyErr != nil || closeErr != nil || written > maxExtractedDemoSize {
		cleanup()
		return "", func() {}, fmt.Errorf("ZIP 解压失败或超过安全限制")
	}
	return targetPath, cleanup, nil
}

func (s *ImportService) Summary(jobID string) (*ImportSummary, *AppError) {
	s.mu.RLock()
	job := s.jobs[jobID]
	s.mu.RUnlock()
	if job == nil {
		return nil, NewAppError("demo_not_found", httpStatusNotFound, "导入任务不存在。", nil)
	}
	job.mu.RLock()
	defer job.mu.RUnlock()
	snapshot := job.summary
	return &snapshot, nil
}

func (s *ImportService) Cancel(jobID string) *AppError {
	s.mu.RLock()
	job := s.jobs[jobID]
	s.mu.RUnlock()
	if job == nil {
		return NewAppError("demo_not_found", httpStatusNotFound, "导入任务不存在。", nil)
	}
	job.cancel()
	return nil
}

func (s *ImportService) Backfill(jobID, path string, players []Player) (*ImportSummary, *AppError) {
	s.mu.RLock()
	job := s.jobs[jobID]
	s.mu.RUnlock()
	if job == nil {
		return nil, NewAppError("demo_not_found", httpStatusNotFound, "导入任务不存在。", nil)
	}
	found := false
	for _, candidate := range job.paths {
		if candidate == path {
			found = true
			break
		}
	}
	if !found {
		return nil, NewAppError("demo_not_found", httpStatusNotFound, "当前导入任务中没有这个 Demo。", nil)
	}
	ids := []string{}
	for _, player := range players {
		if appErr := s.repo.SetPlayerFollowed(player, true); appErr != nil {
			return nil, appErr
		}
		ids = append(ids, player.SteamID)
	}
	_ = s.processPath(context.Background(), path, ids)
	followedPlayers, appErr := s.repo.ListFollowedPlayers()
	if appErr != nil {
		return nil, appErr
	}
	followedIDs := map[string]bool{}
	for _, player := range followedPlayers {
		followedIDs[player.SteamID] = true
	}
	job.mu.Lock()
	for index := range job.summary.Items {
		if job.summary.Items[index].Path != path {
			continue
		}
		savedCount := 0
		for _, player := range job.summary.Items[index].Players {
			if followedIDs[player.SteamID] {
				savedCount++
			}
		}
		job.summary.Items[index].SavedCount = savedCount
		break
	}
	snapshot := job.summary
	job.mu.Unlock()
	s.emit(snapshot)
	return s.Summary(jobID)
}

func (s *ImportService) emit(summary ImportSummary) {
	if s.onProgress != nil {
		s.onProgress(summary)
	}
}

func mapPlayers(values map[string]Player) []Player {
	result := make([]Player, 0, len(values))
	for _, player := range values {
		result = append(result, player)
	}
	sort.Slice(result, func(i, j int) bool { return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name) })
	return result
}

func buildImportPlayerDetails(data DemoData) []ImportPlayerDetail {
	type sideObservation struct {
		round int
		side  string
	}
	observed := map[string]sideObservation{}
	observe := func(steamID, side string, round int) {
		if steamID == "" || (side != "T" && side != "CT") {
			return
		}
		current, ok := observed[steamID]
		if !ok || round < current.round {
			observed[steamID] = sideObservation{round: round, side: side}
		}
	}
	for _, state := range data.Survivals {
		observe(state.SteamID, state.Side, state.RoundNumber)
	}
	for _, event := range data.Kills {
		observe(event.AttackerSteamID, event.AttackerSide, event.RoundNumber)
		observe(event.VictimSteamID, event.VictimSide, event.RoundNumber)
	}

	details := make([]ImportPlayerDetail, 0, len(data.Players))
	teamCounts := map[string]int{"A": 0, "B": 0}
	for _, player := range data.Players {
		team := ""
		if observation, ok := observed[player.SteamID]; ok {
			if observation.side == "T" {
				team = "A"
			} else {
				team = "B"
			}
			teamCounts[team]++
		}
		detail := ImportPlayerDetail{Name: player.Name, SteamID: player.SteamID, Team: team}
		for _, event := range data.Kills {
			if event.AttackerSteamID == player.SteamID && event.VictimSteamID != player.SteamID {
				detail.Kills++
			}
			if event.VictimSteamID == player.SteamID {
				detail.Deaths++
			}
			if event.AssisterSteamID == player.SteamID {
				detail.Assists++
			}
		}
		details = append(details, detail)
	}

	sort.SliceStable(details, func(i, j int) bool {
		if details[i].Team != details[j].Team {
			return details[i].Team < details[j].Team
		}
		return strings.ToLower(details[i].Name) < strings.ToLower(details[j].Name)
	})
	for index := range details {
		if details[index].Team != "" {
			continue
		}
		team := "A"
		if teamCounts["A"] > teamCounts["B"] {
			team = "B"
		}
		details[index].Team = team
		teamCounts[team]++
	}
	sort.SliceStable(details, func(i, j int) bool {
		if details[i].Team != details[j].Team {
			return details[i].Team < details[j].Team
		}
		return strings.ToLower(details[i].Name) < strings.ToLower(details[j].Name)
	})
	return details
}
