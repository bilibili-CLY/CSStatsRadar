package radar

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
)

type ServerOptions struct {
	FrontendDir            string
	StaticFS               fs.FS
	Store                  *SessionStore
	Parser                 DemoParser
	Config                 *ConfigManager
	History                *HistoryService
	PlayerImageDir         string
	PlayerMVPBackgroundDir string
	ShowcaseMusicDir       string
}

type Server struct {
	frontendDir            string
	staticFS               fs.FS
	store                  *SessionStore
	parser                 DemoParser
	config                 *ConfigManager
	history                *HistoryService
	playerImageDir         string
	playerMVPBackgroundDir string
	showcaseMusicDir       string
	resolver               PlayerResolver
	stats                  PlayerStatsCalculator
	assembler              RadarAssembler
}

func NewServer(options ServerOptions) *Server {
	frontendDir := options.FrontendDir
	if frontendDir == "" {
		frontendDir = "frontend"
	}
	store := options.Store
	if store == nil {
		store = NewSessionStore("")
	}
	parser := options.Parser
	if parser == nil {
		parser = JSONFixtureParser{}
	}
	config := options.Config
	if config == nil {
		config = NewConfigManager("")
	}
	history := options.History
	if history == nil {
		cfg, _ := config.Read()
		repo := NewSQLiteHistoryRepository(cfg.DatabasePath)
		if appErr := repo.Init(); appErr == nil {
			history = NewManagedHistoryService(NewHistoryStoreManager(repo))
		} else {
			history = NewManagedHistoryService(NewHistoryStoreManager(nil))
		}
	}
	playerImageDir := options.PlayerImageDir
	if playerImageDir == "" {
		playerImageDir = DefaultPlayerImageDir()
	}
	playerMVPBackgroundDir := options.PlayerMVPBackgroundDir
	if playerMVPBackgroundDir == "" {
		playerMVPBackgroundDir = DefaultPlayerMVPBackgroundDir()
	}
	showcaseMusicDir := options.ShowcaseMusicDir
	if showcaseMusicDir == "" {
		showcaseMusicDir = DefaultShowcaseMusicDir()
	}
	return &Server{
		frontendDir:            frontendDir,
		staticFS:               options.StaticFS,
		store:                  store,
		parser:                 parser,
		config:                 config,
		history:                history,
		playerImageDir:         playerImageDir,
		playerMVPBackgroundDir: playerMVPBackgroundDir,
		showcaseMusicDir:       showcaseMusicDir,
		resolver:               PlayerResolver{},
		stats:                  PlayerStatsCalculator{},
		assembler:              RadarAssembler{},
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/demos", s.handleDemos)
	mux.HandleFunc("/api/demos/", s.handleDemoSubroutes)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/players", s.handlePlayers)
	mux.HandleFunc("/api/players/", s.handlePlayerSubroutes)
	mux.HandleFunc("/api/player-images/", s.handlePlayerImageAsset)
	mux.HandleFunc("/api/player-mvp-backgrounds/", s.handlePlayerMVPBackgroundAsset)
	mux.HandleFunc("/api/showcase/music", s.handleShowcaseMusic)
	mux.HandleFunc("/api/showcase-music/", s.handleShowcaseMusicAsset)
	if s.staticFS != nil {
		mux.Handle("/", http.FileServer(http.FS(s.staticFS)))
	} else {
		mux.Handle("/", http.FileServer(http.Dir(s.frontendDir)))
	}
	return withCORS(mux)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleDemos(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	if err := r.ParseMultipartForm(128 << 20); err != nil {
		writeError(w, NewAppError("invalid_file_type", httpStatusBadRequest, "上传表单无效。", nil))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, NewAppError("invalid_file_type", httpStatusBadRequest, "", nil))
		return
	}
	defer file.Close()

	session, appErr := s.store.SaveUpload(file, header.Filename)
	if appErr != nil {
		writeError(w, appErr)
		return
	}
	s.store.UpdateStatus(session.DemoID, "parsing", "")
	data, appErr := s.parser.Parse(session.FilePath)
	if appErr != nil {
		s.store.UpdateStatus(session.DemoID, "failed", appErr.Message)
		writeError(w, appErr)
		return
	}
	parsed, appErr := s.store.AttachParseResult(session.DemoID, data)
	if appErr != nil {
		writeError(w, appErr)
		return
	}
	saveStatus := DemoSaveStatusNotSaved
	saveMessage := ""
	var savedDemo *SavedDemo
	if s.history != nil {
		whitelist := parseWhitelistSteamIDs(r.FormValue("whitelist_steam_ids"))
		saveResult, appErr := s.history.SaveParsedDemoForPlayers(parsed.FileName, data, whitelist)
		if appErr != nil {
			if appErr.Code == "demo_fingerprint_missing" {
				appErr.Extra = map[string]any{
					"demo_id":     parsed.DemoID,
					"status":      parsed.Status,
					"players":     parsed.Players,
					"save_status": DemoSaveStatusNotSaved,
				}
			}
			writeError(w, appErr)
			return
		}
		if saveResult != nil {
			saveStatus = saveResult.SaveStatus
			savedDemo = saveResult.SavedDemo
		}
		if saveStatus == DemoSaveStatusNotSaved && len(whitelist) == 0 {
			saveMessage = "未配置白名单玩家，历史记录未保存。"
		} else if saveStatus == DemoSaveStatusNotSaved {
			saveMessage = "本 Demo 中没有白名单玩家，历史记录未保存。"
		}
	}
	writeJSON(w, http.StatusOK, UploadResponse{DemoID: parsed.DemoID, Status: parsed.Status, Players: parsed.Players, SaveStatus: saveStatus, SaveMessage: saveMessage, SavedDemo: savedDemo})
}

func (s *Server) handleDemoSubroutes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/demos/")
	parts := strings.Split(path, "/")
	if len(parts) != 2 || (parts[1] != "radar" && parts[1] != "history") {
		http.NotFound(w, r)
		return
	}
	demoID := parts[0]
	session, appErr := s.store.Get(demoID)
	if appErr != nil {
		writeError(w, appErr)
		return
	}
	if session.Data == nil {
		writeError(w, NewAppError("demo_parse_failed", httpStatusBadRequest, session.ParseError, nil))
		return
	}
	if parts[1] == "history" {
		if s.history == nil {
			writeError(w, NewAppError("database_open_failed", httpStatusInternal, "", nil))
			return
		}
		var payload struct {
			WhitelistSteamIDs []string `json:"whitelist_steam_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, NewAppError("config_write_failed", httpStatusBadRequest, "白名单请求无效。", nil))
			return
		}
		if payload.WhitelistSteamIDs == nil {
			payload.WhitelistSteamIDs = []string{}
		}
		result, appErr := s.history.SaveParsedDemoForPlayers(session.FileName, *session.Data, payload.WhitelistSteamIDs)
		if appErr != nil {
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	var payload ResolveRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, NewAppError("player_not_found", httpStatusNotFound, "玩家标识请求无效。", map[string]any{"candidates": session.Players}))
		return
	}
	player, appErr := s.resolver.Resolve(session.Data.Players, payload.IdentifierType, payload.Identifier)
	if appErr != nil {
		writeError(w, appErr)
		return
	}
	stats := s.stats.Calculate(*session.Data, player)
	radar, appErr := s.assembler.Assemble(player, stats)
	if appErr != nil {
		writeError(w, appErr)
		return
	}
	writeJSON(w, http.StatusOK, radar)
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg, appErr := s.config.Read()
		if appErr != nil {
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	case http.MethodPut:
		current, appErr := s.config.Read()
		if appErr != nil {
			writeError(w, appErr)
			return
		}
		cfg := current
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			writeError(w, NewAppError("config_write_failed", httpStatusBadRequest, "配置请求无效。", nil))
			return
		}
		if appErr := ValidateConfig(cfg, "config_write_failed"); appErr != nil {
			writeError(w, appErr)
			return
		}
		if s.history != nil && cfg.DatabasePath != current.DatabasePath {
			if appErr := s.history.SwitchDatabase(cfg.DatabasePath); appErr != nil {
				writeError(w, appErr)
				return
			}
		}
		if appErr := s.config.Save(cfg); appErr != nil {
			if s.history != nil && cfg.DatabasePath != current.DatabasePath {
				_ = s.history.SwitchDatabase(current.DatabasePath)
			}
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handlePlayers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.NotFound(w, r)
		return
	}
	if s.history == nil {
		writeError(w, NewAppError("database_open_failed", httpStatusInternal, "", nil))
		return
	}
	players, appErr := s.history.ListPlayers()
	if appErr != nil {
		writeError(w, appErr)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"players": players})
}

func (s *Server) handlePlayerSubroutes(w http.ResponseWriter, r *http.Request) {
	if s.history == nil {
		writeError(w, NewAppError("database_open_failed", httpStatusInternal, "", nil))
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/players/")
	parts := strings.Split(path, "/")
	if len(parts) == 2 && parts[0] != "" && (parts[1] == "image" || parts[1] == "image-url" || parts[1] == "image-upload" || parts[1] == "mvp-background") {
		if s.handlePlayerImageConfig(w, r, parts[0], parts[1]) {
			return
		}
	}
	if len(parts) == 1 && parts[0] != "" && r.Method == http.MethodGet {
		player, appErr := s.history.GetPlayer(parts[0])
		if appErr != nil {
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, player)
		return
	}
	if len(parts) == 1 && parts[0] != "" && r.Method == http.MethodDelete {
		if appErr := s.history.DeletePlayer(parts[0]); appErr != nil {
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "matches" && r.Method == http.MethodGet {
		player, appErr := s.history.GetPlayer(parts[0])
		if appErr != nil {
			writeError(w, appErr)
			return
		}
		matches, appErr := s.history.ListPlayerMatches(parts[0])
		if appErr != nil {
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"player": player, "matches": matches})
		return
	}
	if len(parts) == 3 && parts[0] != "" && parts[1] == "matches" && parts[2] != "" && r.Method == http.MethodDelete {
		if appErr := s.history.DeletePlayerMatch(parts[0], parts[2]); appErr != nil {
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "radar" && r.Method == http.MethodPost {
		var payload AggregateRadarRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, NewAppError("invalid_aggregate_request", httpStatusBadRequest, "综合雷达请求无效。", nil))
			return
		}
		radar, appErr := NewAggregateRadarService(s.history.Repository()).Build(parts[0], payload.DemoRecordIDs)
		if appErr != nil {
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, radar)
		return
	}
	http.NotFound(w, r)
}

func parseWhitelistSteamIDs(raw string) []string {
	var values []string
	if strings.TrimSpace(raw) == "" {
		return values
	}
	if err := json.Unmarshal([]byte(raw), &values); err == nil {
		return values
	}
	for _, part := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			values = append(values, trimmed)
		}
	}
	return values
}
