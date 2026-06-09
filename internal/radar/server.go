package radar

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
)

type ServerOptions struct {
	FrontendDir string
	StaticFS    fs.FS
	Store       *SessionStore
	Parser      DemoParser
	Config      *ConfigManager
}

type Server struct {
	frontendDir string
	staticFS    fs.FS
	store       *SessionStore
	parser      DemoParser
	config      *ConfigManager
	resolver    PlayerResolver
	stats       PlayerStatsCalculator
	assembler   RadarAssembler
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
	return &Server{
		frontendDir: frontendDir,
		staticFS:    options.StaticFS,
		store:       store,
		parser:      parser,
		config:      config,
		resolver:    PlayerResolver{},
		stats:       PlayerStatsCalculator{},
		assembler:   RadarAssembler{},
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/demos", s.handleDemos)
	mux.HandleFunc("/api/demos/", s.handleDemoSubroutes)
	mux.HandleFunc("/api/config", s.handleConfig)
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
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
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
	writeJSON(w, http.StatusOK, UploadResponse{DemoID: parsed.DemoID, Status: parsed.Status, Players: parsed.Players})
}

func (s *Server) handleDemoSubroutes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/demos/")
	parts := strings.Split(path, "/")
	if len(parts) != 2 || parts[1] != "radar" {
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
		var cfg AppConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			writeError(w, NewAppError("config_write_failed", httpStatusBadRequest, "配置请求无效。", nil))
			return
		}
		if appErr := s.config.Save(cfg); appErr != nil {
			writeError(w, appErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
	default:
		http.NotFound(w, r)
	}
}
