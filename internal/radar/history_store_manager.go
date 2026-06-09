package radar

import "sync"

type HistoryStoreManager struct {
	mu   sync.RWMutex
	repo HistoryRepository
}

func NewHistoryStoreManager(repo HistoryRepository) *HistoryStoreManager {
	return &HistoryStoreManager{repo: repo}
}

func (m *HistoryStoreManager) Current() HistoryRepository {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.repo
}

func (m *HistoryStoreManager) Switch(path string) *AppError {
	next := NewSQLiteHistoryRepository(path)
	if appErr := next.Init(); appErr != nil {
		_ = next.Close()
		return appErr
	}
	m.mu.Lock()
	old := m.repo
	m.repo = next
	m.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	return nil
}

func (m *HistoryStoreManager) Close() error {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.repo == nil {
		return nil
	}
	err := m.repo.Close()
	m.repo = nil
	return err
}
