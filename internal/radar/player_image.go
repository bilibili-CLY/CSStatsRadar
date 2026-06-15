package radar

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func DefaultPlayerImageDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".csplayerstatsradar", "player-images")
	}
	return filepath.Join(home, ".csplayerstatsradar", "player-images")
}

func DefaultPlayerMVPBackgroundDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".csplayerstatsradar", "player-mvp-backgrounds")
	}
	return filepath.Join(home, ".csplayerstatsradar", "player-mvp-backgrounds")
}

func DefaultShowcaseMusicDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".csplayerstatsradar", "showcase-music")
	}
	return filepath.Join(home, ".csplayerstatsradar", "showcase-music")
}

func playerImageFileName(steamID string, now time.Time, originalName string) string {
	ext := strings.ToLower(filepath.Ext(originalName))
	if ext == "" {
		ext = ".img"
	}
	return strings.TrimSpace(steamID) + "-" + strconv.FormatInt(now.UnixNano(), 10) + ext
}

func playerImageAssetPath(baseDir string, fileName string) (string, bool) {
	if fileName == "" || strings.Contains(fileName, "/") || strings.Contains(fileName, `\`) {
		return "", false
	}
	cleanBase, err := filepath.Abs(baseDir)
	if err != nil {
		return "", false
	}
	fullPath, err := filepath.Abs(filepath.Join(cleanBase, fileName))
	if err != nil {
		return "", false
	}
	if filepath.Dir(fullPath) != cleanBase {
		return "", false
	}
	return fullPath, true
}

func publicPlayerImageURL(imagePath string) string {
	name := filepath.Base(imagePath)
	if name == "." || name == string(filepath.Separator) || name == "" {
		return ""
	}
	return "/api/player-images/" + url.PathEscape(name)
}

func publicPlayerMVPBackgroundURL(imagePath string) string {
	name := filepath.Base(imagePath)
	if name == "." || name == string(filepath.Separator) || name == "" {
		return ""
	}
	return "/api/player-mvp-backgrounds/" + url.PathEscape(name)
}

func publicShowcaseMusicURL(musicPath string) string {
	name := filepath.Base(musicPath)
	if name == "." || name == string(filepath.Separator) || name == "" {
		return ""
	}
	return "/api/showcase-music/" + url.PathEscape(name)
}

func (s *Server) withPlayerImagePublicURL(image *PlayerImage) *PlayerImage {
	if image == nil {
		return nil
	}
	copy := *image
	if copy.ImageSourceType == PlayerImageSourceUpload {
		copy.PublicURL = publicPlayerImageURL(copy.ImagePath)
	}
	return &copy
}

func (s *Server) withPlayerMVPBackgroundPublicURL(background *PlayerMVPBackground) *PlayerMVPBackground {
	if background == nil {
		return nil
	}
	copy := *background
	copy.PublicURL = publicPlayerMVPBackgroundURL(copy.ImagePath)
	return &copy
}

func (s *Server) showcaseMusicFromConfig(cfg AppConfig) *ShowcaseMusic {
	musicPath := strings.TrimSpace(cfg.Showcase.MusicPath)
	if musicPath == "" {
		return nil
	}
	return &ShowcaseMusic{MusicPath: musicPath, PublicURL: publicShowcaseMusicURL(musicPath)}
}

func (s *Server) handlePlayerImageConfig(w http.ResponseWriter, r *http.Request, steamID string, action string) bool {
	repo := s.history.Repository()
	if repo == nil {
		writeError(w, NewAppError("database_open_failed", httpStatusInternal, "", nil))
		return true
	}
	switch {
	case action == "image" && r.Method == http.MethodGet:
		image, appErr := repo.GetPlayerImage(steamID)
		if appErr != nil {
			writeError(w, appErr)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"image": s.withPlayerImagePublicURL(image)})
		return true
	case action == "image" && r.Method == http.MethodDelete:
		if appErr := repo.DeletePlayerImage(steamID); appErr != nil {
			writeError(w, appErr)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return true
	case action == "image-url" && r.Method == http.MethodPut:
		var payload struct {
			ImageURL string `json:"image_url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, NewAppError("invalid_player_image", httpStatusBadRequest, "图片 URL 请求无效。", nil))
			return true
		}
		imageURL := strings.TrimSpace(payload.ImageURL)
		if imageURL == "" {
			writeError(w, NewAppError("invalid_player_image", httpStatusBadRequest, "图片 URL 不能为空。", nil))
			return true
		}
		image, appErr := repo.SavePlayerImage(PlayerImage{
			SteamID:         steamID,
			ImageSourceType: PlayerImageSourceExternalURL,
			ImageURL:        imageURL,
			UpdatedAt:       time.Now().UTC(),
		})
		if appErr != nil {
			writeError(w, appErr)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"image": s.withPlayerImagePublicURL(image)})
		return true
	case action == "image-upload" && r.Method == http.MethodPost:
		s.handlePlayerImageUpload(w, r, steamID, repo)
		return true
	case action == "mvp-background" && r.Method == http.MethodGet:
		background, appErr := repo.GetPlayerMVPBackground(steamID)
		if appErr != nil {
			writeError(w, appErr)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"background": s.withPlayerMVPBackgroundPublicURL(background)})
		return true
	case action == "mvp-background" && r.Method == http.MethodDelete:
		if appErr := repo.DeletePlayerMVPBackground(steamID); appErr != nil {
			writeError(w, appErr)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return true
	case action == "mvp-background" && r.Method == http.MethodPost:
		s.handlePlayerMVPBackgroundUpload(w, r, steamID, repo)
		return true
	}
	return false
}

func (s *Server) handlePlayerImageUpload(w http.ResponseWriter, r *http.Request, steamID string, repo HistoryRepository) {
	contentType := r.Header.Get("Content-Type")
	if !strings.HasPrefix(strings.ToLower(contentType), "multipart/form-data") {
		writeError(w, NewAppError("invalid_player_image", httpStatusBadRequest, "上传请求必须使用 multipart/form-data。", nil))
		return
	}
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeError(w, NewAppError("invalid_player_image", httpStatusBadRequest, "上传表单无效。", nil))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, NewAppError("invalid_player_image", httpStatusBadRequest, "缺少 file 上传字段。", nil))
		return
	}
	defer file.Close()
	if !strings.HasPrefix(strings.ToLower(header.Header.Get("Content-Type")), "image/") {
		writeError(w, NewAppError("invalid_player_image", httpStatusBadRequest, "上传文件必须是图片。", nil))
		return
	}
	if err := os.MkdirAll(s.playerImageDir, 0o755); err != nil {
		writeError(w, NewAppError("player_image_save_failed", httpStatusInternal, "玩家图片目录创建失败："+err.Error(), nil))
		return
	}
	fileName := playerImageFileName(steamID, time.Now().UTC(), header.Filename)
	targetPath, ok := playerImageAssetPath(s.playerImageDir, fileName)
	if !ok {
		writeError(w, NewAppError("player_image_save_failed", httpStatusInternal, "", nil))
		return
	}
	target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o644)
	if err != nil {
		writeError(w, NewAppError("player_image_save_failed", httpStatusInternal, "玩家图片保存失败："+err.Error(), nil))
		return
	}
	if _, err := io.Copy(target, file); err != nil {
		_ = target.Close()
		writeError(w, NewAppError("player_image_save_failed", httpStatusInternal, "玩家图片写入失败："+err.Error(), nil))
		return
	}
	if err := target.Close(); err != nil {
		writeError(w, NewAppError("player_image_save_failed", httpStatusInternal, "玩家图片关闭失败："+err.Error(), nil))
		return
	}
	image, appErr := repo.SavePlayerImage(PlayerImage{
		SteamID:         steamID,
		ImageSourceType: PlayerImageSourceUpload,
		ImagePath:       targetPath,
		UpdatedAt:       time.Now().UTC(),
	})
	if appErr != nil {
		writeError(w, appErr)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"image": s.withPlayerImagePublicURL(image)})
}

func (s *Server) handlePlayerMVPBackgroundUpload(w http.ResponseWriter, r *http.Request, steamID string, repo HistoryRepository) {
	targetPath, appErr := s.saveUploadedFile(r, s.playerMVPBackgroundDir, steamID, "image/", "MVP 背景")
	if appErr != nil {
		writeError(w, appErr)
		return
	}
	background, appErr := repo.SavePlayerMVPBackground(PlayerMVPBackground{
		SteamID:   steamID,
		ImagePath: targetPath,
		UpdatedAt: time.Now().UTC(),
	})
	if appErr != nil {
		writeError(w, appErr)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"background": s.withPlayerMVPBackgroundPublicURL(background)})
}

func (s *Server) saveUploadedFile(r *http.Request, dir string, prefix string, acceptedContentPrefix string, label string) (string, *AppError) {
	contentType := r.Header.Get("Content-Type")
	if !strings.HasPrefix(strings.ToLower(contentType), "multipart/form-data") {
		return "", NewAppError("invalid_player_image", httpStatusBadRequest, label+"上传请求必须使用 multipart/form-data。", nil)
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		return "", NewAppError("invalid_player_image", httpStatusBadRequest, label+"上传表单无效。", nil)
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return "", NewAppError("invalid_player_image", httpStatusBadRequest, "缺少 file 上传字段。", nil)
	}
	defer file.Close()
	if !strings.HasPrefix(strings.ToLower(header.Header.Get("Content-Type")), acceptedContentPrefix) {
		return "", NewAppError("invalid_player_image", httpStatusBadRequest, label+"文件类型无效。", nil)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", NewAppError("player_image_save_failed", httpStatusInternal, label+"目录创建失败："+err.Error(), nil)
	}
	fileName := playerImageFileName(prefix, time.Now().UTC(), header.Filename)
	targetPath, ok := playerImageAssetPath(dir, fileName)
	if !ok {
		return "", NewAppError("player_image_save_failed", httpStatusInternal, "", nil)
	}
	target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o644)
	if err != nil {
		return "", NewAppError("player_image_save_failed", httpStatusInternal, label+"保存失败："+err.Error(), nil)
	}
	if _, err := io.Copy(target, file); err != nil {
		_ = target.Close()
		return "", NewAppError("player_image_save_failed", httpStatusInternal, label+"写入失败："+err.Error(), nil)
	}
	if err := target.Close(); err != nil {
		return "", NewAppError("player_image_save_failed", httpStatusInternal, label+"关闭失败："+err.Error(), nil)
	}
	return targetPath, nil
}

func (s *Server) handlePlayerImageAsset(w http.ResponseWriter, r *http.Request) {
	s.serveLocalAsset(w, r, s.playerImageDir, "/api/player-images/")
}

func (s *Server) handlePlayerMVPBackgroundAsset(w http.ResponseWriter, r *http.Request) {
	s.serveLocalAsset(w, r, s.playerMVPBackgroundDir, "/api/player-mvp-backgrounds/")
}

func (s *Server) handleShowcaseMusicAsset(w http.ResponseWriter, r *http.Request) {
	s.serveLocalAsset(w, r, s.showcaseMusicDir, "/api/showcase-music/")
}

func (s *Server) serveLocalAsset(w http.ResponseWriter, r *http.Request, dir string, urlPrefix string) {
	if r.Method != http.MethodGet {
		http.NotFound(w, r)
		return
	}
	fileName := strings.TrimPrefix(r.URL.Path, urlPrefix)
	targetPath, ok := playerImageAssetPath(dir, fileName)
	if !ok {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(targetPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(targetPath)))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	http.ServeContent(w, r, filepath.Base(targetPath), time.Now(), file)
}

func (s *Server) handleShowcaseMusic(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg, appErr := s.config.Read()
		if appErr != nil {
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"music": s.showcaseMusicFromConfig(cfg)})
	case http.MethodPost:
		targetPath, appErr := s.saveUploadedFile(r, s.showcaseMusicDir, "showcase-music", "audio/", "背景音乐")
		if appErr != nil {
			writeError(w, appErr)
			return
		}
		cfg, appErr := s.config.Read()
		if appErr != nil {
			writeError(w, appErr)
			return
		}
		cfg.Showcase.MusicPath = targetPath
		if appErr := s.config.Save(cfg); appErr != nil {
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"music": s.showcaseMusicFromConfig(cfg)})
	case http.MethodDelete:
		cfg, appErr := s.config.Read()
		if appErr != nil {
			writeError(w, appErr)
			return
		}
		cfg.Showcase.MusicPath = ""
		if appErr := s.config.Save(cfg); appErr != nil {
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		http.NotFound(w, r)
	}
}
