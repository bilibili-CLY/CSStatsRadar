package radar

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type BootstrapState struct {
	Config   AppConfig     `json:"config"`
	Players  []SavedPlayer `json:"players"`
	Followed []Player      `json:"followed_players"`
	FFmpeg   string        `json:"ffmpeg_path,omitempty"`
}

type DesktopApp struct {
	ctx          context.Context
	mu           sync.RWMutex
	config       *ConfigManager
	cfg          AppConfig
	repo         *SQLiteHistoryRepository
	history      *HistoryService
	imports      *ImportService
	videoMu      sync.Mutex
	videoExports map[string]*desktopVideoExport
}

type desktopVideoExport struct {
	TempDir, OutputPath string
	Request             ShowcaseVideoExportRequest
	ctx                 context.Context
	cancel              context.CancelFunc
	mu                  sync.Mutex
	finishing           bool
}

func NewDesktopApp() (*DesktopApp, error) {
	config := NewConfigManager("")
	cfg, appErr := config.Read()
	if appErr != nil {
		return nil, appErr
	}
	repo := NewSQLiteHistoryRepository(cfg.DatabasePath)
	if appErr := repo.Init(); appErr != nil {
		return nil, appErr
	}
	history := NewHistoryService(repo)
	app := &DesktopApp{config: config, cfg: cfg, repo: repo, history: history, videoExports: map[string]*desktopVideoExport{}}
	app.imports = NewImportService(history, repo)
	return app, nil
}

func (a *DesktopApp) Startup(ctx context.Context) {
	a.ctx = ctx
	a.imports.SetProgressHandler(func(summary ImportSummary) { runtime.EventsEmit(ctx, "import:progress", summary) })
}

func (a *DesktopApp) Shutdown(context.Context) { _ = a.repo.Close() }

func (a *DesktopApp) Bootstrap() (BootstrapState, error) {
	players, appErr := a.repo.ListPlayers()
	if appErr != nil {
		return BootstrapState{}, appErr
	}
	followed, appErr := a.repo.ListFollowedPlayers()
	if appErr != nil {
		return BootstrapState{}, appErr
	}
	ffmpegPath, _ := a.DetectFFmpeg()
	a.mu.RLock()
	cfg := a.cfg
	a.mu.RUnlock()
	return BootstrapState{Config: cfg, Players: players, Followed: followed, FFmpeg: ffmpegPath}, nil
}

func (a *DesktopApp) ChooseImportDirectory() (string, error) {
	if a.ctx == nil {
		return "", errors.New("应用尚未启动")
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择 Demo 素材目录"})
}

func (a *DesktopApp) ChooseImportFiles() ([]string, error) {
	if a.ctx == nil {
		return nil, errors.New("应用尚未启动")
	}
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择 DEM 或 ZIP", Filters: []runtime.FileFilter{{DisplayName: "CS2 Demo", Pattern: "*.dem;*.zip"}}})
}

func (a *DesktopApp) AddImportSource(path string) ([]ImportSource, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("素材目录不存在或不可读取")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, source := range a.cfg.ImportSources {
		if filepath.Clean(source.Path) == path {
			return a.cfg.ImportSources, nil
		}
	}
	a.cfg.ImportSources = append(a.cfg.ImportSources, ImportSource{ID: "source_" + randomHex(6), Name: filepath.Base(path), Path: path, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
	if appErr := a.config.Save(a.cfg); appErr != nil {
		return nil, appErr
	}
	return a.cfg.ImportSources, nil
}

func (a *DesktopApp) RemoveImportSource(id string) ([]ImportSource, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	next := []ImportSource{}
	for _, source := range a.cfg.ImportSources {
		if source.ID != id {
			next = append(next, source)
		}
	}
	a.cfg.ImportSources = next
	if appErr := a.config.Save(a.cfg); appErr != nil {
		return nil, appErr
	}
	return next, nil
}

func (a *DesktopApp) StartSourceScan(sourceIDs []string) (string, error) {
	a.mu.RLock()
	sources := append([]ImportSource(nil), a.cfg.ImportSources...)
	a.mu.RUnlock()
	if len(sourceIDs) > 0 {
		selected := map[string]bool{}
		for _, id := range sourceIDs {
			selected[id] = true
		}
		filtered := []ImportSource{}
		for _, source := range sources {
			if selected[source.ID] {
				filtered = append(filtered, source)
			}
		}
		sources = filtered
	}
	paths, appErr := ScanSourcePaths(sources)
	if appErr != nil {
		return "", appErr
	}
	jobID, appErr := a.imports.Start(paths)
	if appErr != nil {
		return "", appErr
	}
	return jobID, nil
}

func (a *DesktopApp) StartFileImport(paths []string) (string, error) {
	jobID, appErr := a.imports.Start(paths)
	if appErr != nil {
		return "", appErr
	}
	return jobID, nil
}
func (a *DesktopApp) ImportSummary(jobID string) (*ImportSummary, error) {
	value, appErr := a.imports.Summary(jobID)
	if appErr != nil {
		return nil, appErr
	}
	return value, nil
}
func (a *DesktopApp) CancelImport(jobID string) error {
	if appErr := a.imports.Cancel(jobID); appErr != nil {
		return appErr
	}
	return nil
}
func (a *DesktopApp) FollowAndBackfill(jobID string, players []Player) (*ImportSummary, error) {
	value, appErr := a.imports.Backfill(jobID, players)
	if appErr != nil {
		return nil, appErr
	}
	return value, nil
}

func (a *DesktopApp) ListPlayers() ([]SavedPlayer, error) {
	values, appErr := a.repo.ListPlayers()
	if appErr != nil {
		return nil, appErr
	}
	return values, nil
}
func (a *DesktopApp) GetPlayerMatches(steamID string) ([]PlayerMatchRecord, error) {
	values, appErr := a.repo.ListPlayerMatches(steamID)
	if appErr != nil {
		return nil, appErr
	}
	return values, nil
}
func (a *DesktopApp) SetPlayerFollowed(player Player, followed bool) error {
	if appErr := a.repo.SetPlayerFollowed(player, followed); appErr != nil {
		return appErr
	}
	return nil
}
func (a *DesktopApp) UpdateMatchMetadata(demoID, matchTime string, tags []string) error {
	if appErr := a.repo.UpdateMatchMetadata(demoID, matchTime, tags); appErr != nil {
		return appErr
	}
	return nil
}
func (a *DesktopApp) DeletePlayerData(steamID string) error {
	if appErr := a.repo.DeletePlayerStats(steamID); appErr != nil {
		return appErr
	}
	return nil
}
func (a *DesktopApp) DeletePlayerMatches(steamID string, demoIDs []string) error {
	for _, id := range uniqueStrings(demoIDs) {
		if appErr := a.repo.DeletePlayerMatchStats(steamID, id); appErr != nil {
			return appErr
		}
	}
	return nil
}
func (a *DesktopApp) ClearAllData() error {
	if appErr := a.repo.DeleteAllPlayers(); appErr != nil {
		return appErr
	}
	return nil
}

func (a *DesktopApp) BuildRadar(steamID string, demoRecordIDs []string) (AggregateRadarResponse, error) {
	value, appErr := NewAggregateRadarService(a.repo).Build(steamID, demoRecordIDs)
	if appErr != nil {
		return AggregateRadarResponse{}, appErr
	}
	return value, nil
}

func (a *DesktopApp) LoadDraft(kind string) (*EditorDraft, error) {
	value, appErr := a.repo.GetEditorDraft(kind)
	if appErr != nil {
		return nil, appErr
	}
	return value, nil
}
func (a *DesktopApp) SaveDraft(kind, payload string) error {
	if appErr := a.repo.SaveEditorDraft(EditorDraft{Kind: kind, Payload: payload}); appErr != nil {
		return appErr
	}
	return nil
}

func (a *DesktopApp) SavePreferences(exportWidth, exportHeight, videoFPS int, ffmpegPath string, reduceMotion, showBestMarkers bool, audioOffsetMS int) (AppConfig, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cfg.ExportWidth, a.cfg.ExportHeight, a.cfg.VideoFPS = exportWidth, exportHeight, videoFPS
	a.cfg.Showcase.FFmpegPath, a.cfg.ReduceMotion = strings.TrimSpace(ffmpegPath), reduceMotion
	a.cfg.Showcase.ShowBestMarkers = showBestMarkers
	a.cfg.Showcase.AudioOffsetMS = audioOffsetMS
	if appErr := a.config.Save(a.cfg); appErr != nil {
		return AppConfig{}, appErr
	}
	return a.cfg, nil
}

func (a *DesktopApp) ChooseDatabase() (AppConfig, error) {
	a.mu.RLock()
	current := a.cfg.DatabasePath
	a.mu.RUnlock()
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:                "选择或创建 SQLite 数据库",
		DefaultDirectory:     filepath.Dir(current),
		DefaultFilename:      filepath.Base(current),
		CanCreateDirectories: true,
		Filters:              []runtime.FileFilter{{DisplayName: "SQLite 数据库", Pattern: "*.db;*.sqlite;*.sqlite3"}},
	})
	if err != nil || path == "" {
		a.mu.RLock()
		cfg := a.cfg
		a.mu.RUnlock()
		return cfg, err
	}
	return a.SwitchDatabase(path)
}

func (a *DesktopApp) SwitchDatabase(path string) (AppConfig, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "." || path == "" {
		return AppConfig{}, errors.New("数据库路径不能为空")
	}
	nextRepo := NewSQLiteHistoryRepository(path)
	if appErr := nextRepo.Init(); appErr != nil {
		_ = nextRepo.Close()
		return AppConfig{}, appErr
	}

	a.mu.Lock()
	nextConfig := a.cfg
	nextConfig.DatabasePath = path
	if appErr := a.config.Save(nextConfig); appErr != nil {
		a.mu.Unlock()
		_ = nextRepo.Close()
		return AppConfig{}, appErr
	}
	oldRepo := a.repo
	a.cfg = nextConfig
	a.repo = nextRepo
	a.history = NewHistoryService(nextRepo)
	a.imports = NewImportService(a.history, nextRepo)
	if a.ctx != nil {
		ctx := a.ctx
		a.imports.SetProgressHandler(func(summary ImportSummary) { runtime.EventsEmit(ctx, "import:progress", summary) })
	}
	a.mu.Unlock()
	if oldRepo != nil {
		_ = oldRepo.Close()
	}
	return nextConfig, nil
}

func (a *DesktopApp) DetectFFmpeg() (string, error) {
	a.mu.RLock()
	configured := a.cfg.Showcase.FFmpegPath
	a.mu.RUnlock()
	candidates := []string{configured, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"}
	if path, err := exec.LookPath("ffmpeg"); err == nil {
		candidates = append([]string{path}, candidates...)
	}
	for _, candidate := range candidates {
		if candidate != "" && validateFFmpeg(candidate) == nil {
			return candidate, nil
		}
	}
	return "", errors.New("未检测到 ffmpeg")
}

func (a *DesktopApp) ChooseFFmpeg() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择 ffmpeg 可执行文件"})
	if err != nil || path == "" {
		return path, err
	}
	if err := validateFFmpeg(path); err != nil {
		return "", err
	}
	a.mu.Lock()
	a.cfg.Showcase.FFmpegPath = path
	saveErr := a.config.Save(a.cfg)
	a.mu.Unlock()
	if saveErr != nil {
		return "", saveErr
	}
	return path, nil
}

func validateFFmpeg(path string) error {
	command := exec.Command(path, "-version")
	if err := command.Run(); err != nil {
		return fmt.Errorf("所选文件不是可用的 ffmpeg")
	}
	return nil
}

func (a *DesktopApp) ExportPNG(dataURL, suggestedName string) (string, error) {
	comma := strings.Index(dataURL, ",")
	if comma < 0 {
		return "", errors.New("PNG 数据无效")
	}
	data, err := base64.StdEncoding.DecodeString(dataURL[comma+1:])
	if err != nil {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(suggestedName), ".png") {
		suggestedName += ".png"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "导出 PNG", DefaultFilename: suggestedName, Filters: []runtime.FileFilter{{DisplayName: "PNG 图片", Pattern: "*.png"}}})
	if err != nil || path == "" {
		return path, err
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func (a *DesktopApp) GetPlayerMedia(steamID string) (DesktopPlayerMedia, error) {
	result := DesktopPlayerMedia{}
	image, appErr := a.repo.GetPlayerImage(steamID)
	if appErr != nil {
		return result, appErr
	}
	if image != nil {
		if image.ImageSourceType == PlayerImageSourceExternalURL {
			result.ImageURL = image.ImageURL
		} else {
			result.ImageURL, _ = fileDataURL(image.ImagePath)
		}
	}
	background, appErr := a.repo.GetPlayerMVPBackground(steamID)
	if appErr != nil {
		return result, appErr
	}
	if background != nil {
		result.BackgroundURL, _ = fileDataURL(background.ImagePath)
	}
	return result, nil
}

func (a *DesktopApp) ChoosePlayerMedia(steamID, kind string) (DesktopPlayerMedia, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择图片", Filters: []runtime.FileFilter{{DisplayName: "图片", Pattern: "*.png;*.jpg;*.jpeg;*.webp"}}})
	if err != nil || path == "" {
		return a.GetPlayerMedia(steamID)
	}
	baseDir := DefaultPlayerImageDir()
	if kind == "background" {
		baseDir = DefaultPlayerMVPBackgroundDir()
	}
	target, err := copyMediaFile(baseDir, steamID, path)
	if err != nil {
		return DesktopPlayerMedia{}, err
	}
	if kind == "background" {
		if _, appErr := a.repo.SavePlayerMVPBackground(PlayerMVPBackground{SteamID: steamID, ImagePath: target, UpdatedAt: time.Now().UTC()}); appErr != nil {
			return DesktopPlayerMedia{}, appErr
		}
	} else {
		if _, appErr := a.repo.SavePlayerImage(PlayerImage{SteamID: steamID, ImageSourceType: PlayerImageSourceUpload, ImagePath: target, UpdatedAt: time.Now().UTC()}); appErr != nil {
			return DesktopPlayerMedia{}, appErr
		}
	}
	return a.GetPlayerMedia(steamID)
}

func (a *DesktopApp) SetPlayerImageURL(steamID, imageURL string) (DesktopPlayerMedia, error) {
	imageURL = strings.TrimSpace(imageURL)
	if imageURL == "" {
		return DesktopPlayerMedia{}, errors.New("图片 URL 不能为空")
	}
	if _, appErr := a.repo.SavePlayerImage(PlayerImage{SteamID: steamID, ImageSourceType: PlayerImageSourceExternalURL, ImageURL: imageURL, UpdatedAt: time.Now().UTC()}); appErr != nil {
		return DesktopPlayerMedia{}, appErr
	}
	return a.GetPlayerMedia(steamID)
}

func (a *DesktopApp) ClearPlayerMedia(steamID, kind string) (DesktopPlayerMedia, error) {
	var appErr *AppError
	if kind == "background" {
		appErr = a.repo.DeletePlayerMVPBackground(steamID)
	} else {
		appErr = a.repo.DeletePlayerImage(steamID)
	}
	if appErr != nil {
		return DesktopPlayerMedia{}, appErr
	}
	return a.GetPlayerMedia(steamID)
}

func (a *DesktopApp) ChooseShowcaseMusic() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择背景音乐", Filters: []runtime.FileFilter{{DisplayName: "音频", Pattern: "*.mp3;*.wav;*.m4a;*.aac"}}})
	if err != nil || path == "" {
		return "", err
	}
	target, err := copyMediaFile(DefaultShowcaseMusicDir(), "showcase", path)
	if err != nil {
		return "", err
	}
	a.mu.Lock()
	a.cfg.Showcase.MusicPath = target
	saveErr := a.config.Save(a.cfg)
	a.mu.Unlock()
	if saveErr != nil {
		return "", saveErr
	}
	return fileDataURL(target)
}

func (a *DesktopApp) GetShowcaseMusic() (string, error) {
	a.mu.RLock()
	path := a.cfg.Showcase.MusicPath
	a.mu.RUnlock()
	if path == "" {
		return "", nil
	}
	return fileDataURL(path)
}

func copyMediaFile(baseDir, steamID, sourcePath string) (string, error) {
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return "", err
	}
	name := playerImageFileName(steamID, time.Now().UTC(), filepath.Base(sourcePath))
	target, ok := playerImageAssetPath(baseDir, name)
	if !ok {
		return "", errors.New("媒体目标路径无效")
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		return "", err
	}
	defer source.Close()
	dest, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(dest, source); err != nil {
		_ = dest.Close()
		return "", err
	}
	return target, dest.Close()
}
func fileDataURL(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	content := mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	if content == "" {
		content = "application/octet-stream"
	}
	return "data:" + content + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func (a *DesktopApp) BeginVideoExport(width, height, fps, durationMS, audioOffsetMS int, suggestedName string) (string, error) {
	ffmpegPath, err := a.DetectFFmpeg()
	if err != nil {
		return "", err
	}
	_ = ffmpegPath
	request := ShowcaseVideoExportRequest{Width: width, Height: height, FPS: fps, DurationMS: durationMS, AudioOffsetMS: audioOffsetMS, Frames: []string{"placeholder"}}
	if appErr := validateShowcaseVideoRequest(request); appErr != nil && !strings.Contains(appErr.Message, "帧数量") {
		return "", appErr
	}
	if !strings.HasSuffix(strings.ToLower(suggestedName), ".mp4") {
		suggestedName += ".mp4"
	}
	outputPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "导出 MP4", DefaultFilename: suggestedName, Filters: []runtime.FileFilter{{DisplayName: "MP4 视频", Pattern: "*.mp4"}}})
	if err != nil || outputPath == "" {
		return "", err
	}
	tempDir, err := os.MkdirTemp("", "cs-radar-video-*")
	if err != nil {
		return "", err
	}
	id := "video_" + randomHex(8)
	ctx, cancel := context.WithCancel(context.Background())
	a.videoMu.Lock()
	a.videoExports[id] = &desktopVideoExport{TempDir: tempDir, OutputPath: outputPath, Request: request, ctx: ctx, cancel: cancel}
	a.videoMu.Unlock()
	return id, nil
}

func (a *DesktopApp) AppendVideoFrames(exportID string, startIndex int, frames []string) error {
	a.videoMu.Lock()
	session := a.videoExports[exportID]
	a.videoMu.Unlock()
	if session == nil {
		return errors.New("视频导出任务不存在")
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	select {
	case <-session.ctx.Done():
		return errors.New("视频导出已取消")
	default:
	}
	if startIndex < 0 || startIndex+len(frames) > maxShowcaseVideoFrames {
		return errors.New("视频帧数量超过限制")
	}
	for offset, raw := range frames {
		data, err := decodePNGDataURL(raw)
		if err != nil {
			return err
		}
		path := filepath.Join(session.TempDir, fmt.Sprintf("frame_%06d.png", startIndex+offset+1))
		if err := os.WriteFile(path, data, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func (a *DesktopApp) FinishVideoExport(exportID string) (string, error) {
	a.videoMu.Lock()
	session := a.videoExports[exportID]
	a.videoMu.Unlock()
	if session == nil {
		return "", errors.New("视频导出任务不存在")
	}
	session.mu.Lock()
	session.finishing = true
	session.mu.Unlock()
	defer func() {
		session.cancel()
		a.videoMu.Lock()
		delete(a.videoExports, exportID)
		a.videoMu.Unlock()
		_ = os.RemoveAll(session.TempDir)
	}()
	ffmpegPath, err := a.DetectFFmpeg()
	if err != nil {
		return "", err
	}
	a.mu.RLock()
	musicPath := a.cfg.Showcase.MusicPath
	a.mu.RUnlock()
	if err := encodeShowcaseMP4Context(session.ctx, ffmpegPath, session.TempDir, session.OutputPath, musicPath, session.Request); err != nil {
		if errors.Is(session.ctx.Err(), context.Canceled) {
			return "", errors.New("视频导出已取消")
		}
		return "", err
	}
	return session.OutputPath, nil
}

func (a *DesktopApp) CancelVideoExport(exportID string) error {
	a.videoMu.Lock()
	session := a.videoExports[exportID]
	if session == nil {
		a.videoMu.Unlock()
		return nil
	}
	session.mu.Lock()
	session.cancel()
	finishing := session.finishing
	if !finishing {
		delete(a.videoExports, exportID)
	}
	session.mu.Unlock()
	a.videoMu.Unlock()
	if finishing {
		return nil
	}
	return os.RemoveAll(session.TempDir)
}
