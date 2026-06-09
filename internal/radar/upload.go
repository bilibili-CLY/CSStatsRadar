package radar

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type SessionStore struct {
	tempDir  string
	mu       sync.RWMutex
	sessions map[string]*DemoSession
}

func NewSessionStore(tempDir string) *SessionStore {
	if tempDir == "" {
		tempDir = filepath.Join(os.TempDir(), "csplayerstatsradar")
	}
	return &SessionStore{
		tempDir:  tempDir,
		sessions: make(map[string]*DemoSession),
	}
}

func ValidateDemoFileName(fileName string) *AppError {
	lower := strings.ToLower(fileName)
	blocked := []string{".dem.gz", ".gz", ".bz2", ".zip", ".rar", ".7z"}
	for _, suffix := range blocked {
		if strings.HasSuffix(lower, suffix) {
			return NewAppError("invalid_file_type", httpStatusBadRequest, "", nil)
		}
	}
	if !strings.HasSuffix(lower, ".dem") {
		return NewAppError("invalid_file_type", httpStatusBadRequest, "", nil)
	}
	return nil
}

func (s *SessionStore) SaveUpload(reader io.Reader, fileName string) (*DemoSession, *AppError) {
	if err := ValidateDemoFileName(fileName); err != nil {
		return nil, err
	}
	demoID := "demo_" + time.Now().UTC().Format("20060102_150405") + "_" + randomHex(4)
	safeName := filepath.Base(fileName)
	targetDir := filepath.Join(s.tempDir, demoID)
	targetPath := filepath.Join(targetDir, safeName)
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return nil, NewAppError("demo_parse_failed", httpStatusInternal, "文件保存失败："+err.Error(), nil)
	}
	file, err := os.Create(targetPath)
	if err != nil {
		return nil, NewAppError("demo_parse_failed", httpStatusInternal, "文件保存失败："+err.Error(), nil)
	}
	defer file.Close()
	if _, err := io.Copy(file, reader); err != nil {
		return nil, NewAppError("demo_parse_failed", httpStatusInternal, "文件保存失败："+err.Error(), nil)
	}

	session := &DemoSession{
		DemoID:    demoID,
		FileName:  safeName,
		FilePath:  targetPath,
		Status:    "uploaded",
		CreatedAt: time.Now().UTC(),
	}
	s.mu.Lock()
	s.sessions[demoID] = session
	s.mu.Unlock()
	return session, nil
}

func (s *SessionStore) Get(demoID string) (*DemoSession, *AppError) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	session, ok := s.sessions[demoID]
	if !ok {
		return nil, NewAppError("demo_not_found", httpStatusNotFound, "", nil)
	}
	return session, nil
}

func (s *SessionStore) UpdateStatus(demoID, status, parseError string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if session, ok := s.sessions[demoID]; ok {
		session.Status = status
		session.ParseError = parseError
	}
}

func (s *SessionStore) AttachParseResult(demoID string, data DemoData) (*DemoSession, *AppError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[demoID]
	if !ok {
		return nil, NewAppError("demo_not_found", httpStatusNotFound, "", nil)
	}
	session.Status = "parsed"
	session.Players = data.Players
	session.Data = &data
	return session, nil
}

func randomHex(bytes int) string {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		return "00000000"
	}
	return hex.EncodeToString(buf)
}
