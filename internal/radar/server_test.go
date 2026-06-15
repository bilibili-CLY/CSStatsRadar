package radar

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testServer(t *testing.T) *httptest.Server {
	t.Helper()
	tempDir := t.TempDir()
	return testServerWithPaths(t, filepath.Join(tempDir, "config.json"), filepath.Join(tempDir, "history.db"))
}

func testServerWithPaths(t *testing.T, configPath string, dbPath string) *httptest.Server {
	return testServerWithPathsAndImageDir(t, configPath, dbPath, filepath.Join(t.TempDir(), "player-images"))
}

func testServerWithPathsAndImageDir(t *testing.T, configPath string, dbPath string, imageDir string) *httptest.Server {
	return testServerWithAssetDirs(t, configPath, dbPath, imageDir, filepath.Join(t.TempDir(), "player-mvp-backgrounds"), filepath.Join(t.TempDir(), "showcase-music"))
}

func testServerWithAssetDirs(t *testing.T, configPath string, dbPath string, imageDir string, mvpBackgroundDir string, musicDir string) *httptest.Server {
	t.Helper()
	cfg := DefaultConfig()
	cfg.DatabasePath = dbPath
	if appErr := NewConfigManager(configPath).Save(cfg); appErr != nil {
		t.Fatalf("save test config: %v", appErr)
	}
	server := NewServer(ServerOptions{
		FrontendDir:            filepath.Join("..", "..", "frontend"),
		Store:                  NewSessionStore(t.TempDir()),
		Config:                 NewConfigManager(configPath),
		PlayerImageDir:         imageDir,
		PlayerMVPBackgroundDir: mvpBackgroundDir,
		ShowcaseMusicDir:       musicDir,
	})
	return httptest.NewServer(server.Routes())
}

func uploadFixture(t *testing.T, baseURL string, fileName string) (map[string]any, int) {
	return uploadFixtureWithWhitelist(t, baseURL, fileName, []string{"76561190000000001", "76561190000000002", "76561190000000003"})
}

func uploadFixtureWithWhitelist(t *testing.T, baseURL string, fileName string, whitelist []string) (map[string]any, int) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", fileName)
	if err != nil {
		t.Fatal(err)
	}
	sourcePath := fixturePath(t)
	if candidate := fixtureNamedPath(t, fileName); fileExists(candidate) {
		sourcePath = candidate
	}
	file, err := os.Open(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := io.Copy(part, file); err != nil {
		t.Fatal(err)
	}
	if whitelist != nil {
		data, err := json.Marshal(whitelist)
		if err != nil {
			t.Fatal(err)
		}
		if err := writer.WriteField("whitelist_steam_ids", string(data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	resp, err := http.Post(baseURL+"/api/demos", writer.FormDataContentType(), &body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	return payload, resp.StatusCode
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func TestAPIUploadRadarAndErrors(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	upload, status := uploadFixture(t, ts.URL, "history.dem")
	if status != http.StatusOK {
		t.Fatalf("upload status %d: %+v", status, upload)
	}
	demoID := upload["demo_id"].(string)
	if upload["status"] != "parsed" {
		t.Fatalf("bad upload payload: %+v", upload)
	}

	body := bytes.NewBufferString(`{"identifier_type":"steam_id","identifier":"76561190000000001"}`)
	resp, err := http.Post(ts.URL+"/api/demos/"+demoID+"/radar", "application/json", body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("radar status: %d", resp.StatusCode)
	}
	var radar RadarResponse
	if err := json.NewDecoder(resp.Body).Decode(&radar); err != nil {
		t.Fatal(err)
	}
	if radar.Radar.Dimensions[0] != "KPR" {
		t.Fatalf("bad radar: %+v", radar)
	}

	body = bytes.NewBufferString(`{"identifier_type":"name","identifier":"Alpha"}`)
	resp, err = http.Post(ts.URL+"/api/demos/"+demoID+"/radar", "application/json", body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != httpStatusConflict {
		t.Fatalf("expected ambiguous conflict, got %d", resp.StatusCode)
	}

	body = bytes.NewBufferString(`{"identifier_type":"name","identifier":"Nobody"}`)
	resp, err = http.Post(ts.URL+"/api/demos/"+demoID+"/radar", "application/json", body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != httpStatusNotFound {
		t.Fatalf("expected not found, got %d", resp.StatusCode)
	}
}

func TestAPIUploadMissingMatchTimeSavesByFileFingerprint(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	upload, status := uploadFixture(t, ts.URL, "no-match-time.dem")
	if status != http.StatusOK {
		t.Fatalf("expected no-match-time save status, got %d: %+v", status, upload)
	}
	if upload["save_status"] != string(DemoSaveStatusSaved) || upload["status"] != "parsed" {
		t.Fatalf("bad no-match-time save payload: %+v", upload)
	}
	duplicate, status := uploadFixture(t, ts.URL, "no-match-time.dem")
	if status != http.StatusOK || duplicate["save_status"] != string(DemoSaveStatusDuplicate) {
		t.Fatalf("expected no-match-time duplicate by file fingerprint, got %d: %+v", status, duplicate)
	}
}

func TestAPIUploadWithoutWhitelistDoesNotSaveHistory(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	upload, status := uploadFixtureWithWhitelist(t, ts.URL, "history.dem", []string{})
	if status != http.StatusOK {
		t.Fatalf("upload status %d: %+v", status, upload)
	}
	if upload["save_status"] != string(DemoSaveStatusNotSaved) {
		t.Fatalf("expected not_saved without whitelist, got %+v", upload)
	}
	resp, err := http.Get(ts.URL + "/api/players")
	if err != nil {
		t.Fatal(err)
	}
	var playersPayload map[string][]SavedPlayer
	if err := json.NewDecoder(resp.Body).Decode(&playersPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(playersPayload["players"]) != 0 {
		t.Fatalf("expected no saved players without whitelist: %+v", playersPayload)
	}
}

func TestAPIHistoryDuplicateRestartPlayersAggregateAndConfigSwitch(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.json")
	dbPath := filepath.Join(tempDir, "history.db")
	ts := testServerWithPaths(t, configPath, dbPath)

	upload, status := uploadFixture(t, ts.URL, "history.dem")
	if status != http.StatusOK || upload["save_status"] != string(DemoSaveStatusSaved) {
		t.Fatalf("expected saved upload, status %d payload %+v", status, upload)
	}
	duplicate, status := uploadFixture(t, ts.URL, "history.dem")
	if status != http.StatusOK || duplicate["save_status"] != string(DemoSaveStatusDuplicate) {
		t.Fatalf("expected duplicate upload, status %d payload %+v", status, duplicate)
	}

	resp, err := http.Get(ts.URL + "/api/players")
	if err != nil {
		t.Fatal(err)
	}
	var playersPayload map[string][]SavedPlayer
	if err := json.NewDecoder(resp.Body).Decode(&playersPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(playersPayload["players"]) != 3 {
		t.Fatalf("bad players payload: %+v", playersPayload)
	}
	steamID := "76561190000000001"
	resp, err = http.Get(ts.URL + "/api/players/" + steamID + "/matches")
	if err != nil {
		t.Fatal(err)
	}
	var matchesPayload struct {
		Player  SavedPlayer         `json:"player"`
		Matches []PlayerMatchRecord `json:"matches"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&matchesPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if matchesPayload.Player.SteamID != steamID || len(matchesPayload.Matches) != 1 {
		t.Fatalf("bad matches payload: %+v", matchesPayload)
	}
	radarReq := bytes.NewBufferString(`{"demo_record_ids":["` + matchesPayload.Matches[0].DemoRecordID + `"]}`)
	resp, err = http.Post(ts.URL+"/api/players/"+steamID+"/radar", "application/json", radarReq)
	if err != nil {
		t.Fatal(err)
	}
	var aggregate AggregateRadarResponse
	if err := json.NewDecoder(resp.Body).Decode(&aggregate); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if aggregate.MatchCount != 1 || aggregate.Radar.Dimensions[0] != "KPR" {
		t.Fatalf("bad aggregate response: %+v", aggregate)
	}
	ts.Close()

	restarted := testServerWithPaths(t, configPath, dbPath)
	defer restarted.Close()
	resp, err = http.Get(restarted.URL + "/api/players")
	if err != nil {
		t.Fatal(err)
	}
	playersPayload = map[string][]SavedPlayer{}
	if err := json.NewDecoder(resp.Body).Decode(&playersPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(playersPayload["players"]) != 3 {
		t.Fatalf("expected persisted players after restart: %+v", playersPayload)
	}

	newDBPath := filepath.Join(tempDir, "new-history.db")
	saveBody := bytes.NewBufferString(`{"export_width":1920,"export_height":1080,"theme_color":"#00ffff","color_preset":"default","last_player_identifier_type":"name","database_path":"` + filepath.ToSlash(newDBPath) + `"}`)
	req, _ := http.NewRequest(http.MethodPut, restarted.URL+"/api/config", saveBody)
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected config switch success, got %d", resp.StatusCode)
	}
	resp, err = http.Get(restarted.URL + "/api/players")
	if err != nil {
		t.Fatal(err)
	}
	playersPayload = map[string][]SavedPlayer{}
	if err := json.NewDecoder(resp.Body).Decode(&playersPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(playersPayload["players"]) != 0 {
		t.Fatalf("expected new empty database after switch: %+v", playersPayload)
	}

	badBody := bytes.NewBufferString(`{"export_width":1920,"export_height":1080,"theme_color":"#00ffff","color_preset":"default","last_player_identifier_type":"name","database_path":"` + filepath.ToSlash(tempDir) + `"}`)
	req, _ = http.NewRequest(http.MethodPut, restarted.URL+"/api/config", badBody)
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != httpStatusBadRequest {
		t.Fatalf("expected invalid config path failure, got %d", resp.StatusCode)
	}
	resp, err = http.Get(restarted.URL + "/api/players")
	if err != nil {
		t.Fatal(err)
	}
	playersPayload = map[string][]SavedPlayer{}
	if err := json.NewDecoder(resp.Body).Decode(&playersPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(playersPayload["players"]) != 0 {
		t.Fatalf("invalid switch should keep current new db: %+v", playersPayload)
	}
}

func TestAPIDeletePlayerRecord(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	if upload, status := uploadFixture(t, ts.URL, "history.dem"); status != http.StatusOK || upload["save_status"] != string(DemoSaveStatusSaved) {
		t.Fatalf("upload status %d payload %+v", status, upload)
	}
	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/players/76561190000000001", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete status: %d", resp.StatusCode)
	}
	resp, err = http.Get(ts.URL + "/api/players")
	if err != nil {
		t.Fatal(err)
	}
	var playersPayload map[string][]SavedPlayer
	if err := json.NewDecoder(resp.Body).Decode(&playersPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(playersPayload["players"]) != 2 {
		t.Fatalf("expected one deleted player: %+v", playersPayload)
	}
}

func TestAPIDeletePlayerMatchRecord(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	if upload, status := uploadFixture(t, ts.URL, "history.dem"); status != http.StatusOK || upload["save_status"] != string(DemoSaveStatusSaved) {
		t.Fatalf("upload status %d payload %+v", status, upload)
	}
	steamID := "76561190000000001"
	resp, err := http.Get(ts.URL + "/api/players/" + steamID + "/matches")
	if err != nil {
		t.Fatal(err)
	}
	var matchesPayload struct {
		Matches []PlayerMatchRecord `json:"matches"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&matchesPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(matchesPayload.Matches) != 1 {
		t.Fatalf("expected one match: %+v", matchesPayload)
	}
	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/players/"+steamID+"/matches/"+matchesPayload.Matches[0].DemoRecordID, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete match status: %d", resp.StatusCode)
	}
	resp, err = http.Get(ts.URL + "/api/players/" + steamID)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != httpStatusNotFound {
		t.Fatalf("expected player removed after deleting only match, got %d", resp.StatusCode)
	}
}

func TestAPIPlayerImages(t *testing.T) {
	tempDir := t.TempDir()
	ts := testServerWithPathsAndImageDir(t, filepath.Join(tempDir, "config.json"), filepath.Join(tempDir, "history.db"), filepath.Join(tempDir, "player-images"))
	defer ts.Close()

	if upload, status := uploadFixture(t, ts.URL, "history.dem"); status != http.StatusOK || upload["save_status"] != string(DemoSaveStatusSaved) {
		t.Fatalf("upload status %d payload %+v", status, upload)
	}
	steamID := "76561190000000001"

	resp, err := http.Get(ts.URL + "/api/players/" + steamID + "/image")
	if err != nil {
		t.Fatal(err)
	}
	var imagePayload struct {
		Image *PlayerImage `json:"image"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&imagePayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || imagePayload.Image != nil {
		t.Fatalf("expected empty image config, status %d payload %+v", resp.StatusCode, imagePayload)
	}

	req, err := http.NewRequest(http.MethodPut, ts.URL+"/api/players/"+steamID+"/image-url", strings.NewReader(`{"image_url":""}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != httpStatusBadRequest {
		t.Fatalf("expected empty image URL to fail, got %d", resp.StatusCode)
	}

	req, err = http.NewRequest(http.MethodPut, ts.URL+"/api/players/"+steamID+"/image-url", strings.NewReader(`{"image_url":"https://example.com/player.png"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	imagePayload = struct {
		Image *PlayerImage `json:"image"`
	}{}
	if err := json.NewDecoder(resp.Body).Decode(&imagePayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || imagePayload.Image == nil || imagePayload.Image.ImageURL != "https://example.com/player.png" || imagePayload.Image.PublicURL != "" {
		t.Fatalf("bad external image response, status %d payload %+v", resp.StatusCode, imagePayload)
	}

	uploadBody, contentType := playerImageUploadBody(t, "ignored-original.png", "image/png", []byte{0x89, 'P', 'N', 'G', '\r', '\n'})
	resp, err = http.Post(ts.URL+"/api/players/"+steamID+"/image-upload", contentType, uploadBody)
	if err != nil {
		t.Fatal(err)
	}
	imagePayload = struct {
		Image *PlayerImage `json:"image"`
	}{}
	if err := json.NewDecoder(resp.Body).Decode(&imagePayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || imagePayload.Image == nil || imagePayload.Image.ImageSourceType != PlayerImageSourceUpload || imagePayload.Image.PublicURL == "" {
		t.Fatalf("bad upload image response, status %d payload %+v", resp.StatusCode, imagePayload)
	}
	if strings.Contains(filepath.Base(imagePayload.Image.ImagePath), "ignored-original") {
		t.Fatalf("upload should not use original filename directly: %+v", imagePayload.Image)
	}

	resp, err = http.Get(ts.URL + imagePayload.Image.PublicURL)
	if err != nil {
		t.Fatal(err)
	}
	imageBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "image/png" || len(imageBytes) == 0 {
		t.Fatalf("bad public image response, status %d content-type %q len %d", resp.StatusCode, resp.Header.Get("Content-Type"), len(imageBytes))
	}

	req, err = http.NewRequest(http.MethodDelete, ts.URL+"/api/players/"+steamID+"/image", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete image status: %d", resp.StatusCode)
	}
	resp, err = http.Get(ts.URL + "/api/players/" + steamID + "/image")
	if err != nil {
		t.Fatal(err)
	}
	imagePayload = struct {
		Image *PlayerImage `json:"image"`
	}{}
	if err := json.NewDecoder(resp.Body).Decode(&imagePayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || imagePayload.Image != nil {
		t.Fatalf("expected cleared image, status %d payload %+v", resp.StatusCode, imagePayload)
	}

	req, err = http.NewRequest(http.MethodPut, ts.URL+"/api/players/missing/image-url", strings.NewReader(`{"image_url":"https://example.com/player.png"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != httpStatusNotFound {
		t.Fatalf("expected missing player failure, got %d", resp.StatusCode)
	}
}

func TestAPIPlayerImageUploadValidationAndAssetSafety(t *testing.T) {
	tempDir := t.TempDir()
	ts := testServerWithPathsAndImageDir(t, filepath.Join(tempDir, "config.json"), filepath.Join(tempDir, "history.db"), filepath.Join(tempDir, "player-images"))
	defer ts.Close()

	if upload, status := uploadFixture(t, ts.URL, "history.dem"); status != http.StatusOK || upload["save_status"] != string(DemoSaveStatusSaved) {
		t.Fatalf("upload status %d payload %+v", status, upload)
	}
	steamID := "76561190000000001"

	resp, err := http.Post(ts.URL+"/api/players/"+steamID+"/image-upload", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != httpStatusBadRequest {
		t.Fatalf("expected non-multipart upload failure, got %d", resp.StatusCode)
	}

	body, contentType := playerImageUploadBody(t, "not-image.txt", "text/plain", []byte("not image"))
	resp, err = http.Post(ts.URL+"/api/players/"+steamID+"/image-upload", contentType, body)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != httpStatusBadRequest {
		t.Fatalf("expected non-image upload failure, got %d", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/player-images/%2e%2e/secret.png")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != httpStatusNotFound {
		t.Fatalf("expected traversal to be rejected, got %d", resp.StatusCode)
	}
	resp, err = http.Get(ts.URL + "/api/player-images/missing.png")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != httpStatusNotFound {
		t.Fatalf("expected missing asset 404, got %d", resp.StatusCode)
	}
}

func TestAPIPlayerMVPBackgroundAndShowcaseMusic(t *testing.T) {
	tempDir := t.TempDir()
	ts := testServerWithAssetDirs(
		t,
		filepath.Join(tempDir, "config.json"),
		filepath.Join(tempDir, "history.db"),
		filepath.Join(tempDir, "player-images"),
		filepath.Join(tempDir, "player-mvp-backgrounds"),
		filepath.Join(tempDir, "showcase-music"),
	)
	defer ts.Close()

	if upload, status := uploadFixture(t, ts.URL, "history.dem"); status != http.StatusOK || upload["save_status"] != string(DemoSaveStatusSaved) {
		t.Fatalf("upload status %d payload %+v", status, upload)
	}
	steamID := "76561190000000001"

	body, contentType := playerImageUploadBody(t, "mvp.png", "image/png", []byte{0x89, 'P', 'N', 'G', '\r', '\n'})
	resp, err := http.Post(ts.URL+"/api/players/"+steamID+"/mvp-background", contentType, body)
	if err != nil {
		t.Fatal(err)
	}
	var backgroundPayload struct {
		Background *PlayerMVPBackground `json:"background"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&backgroundPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || backgroundPayload.Background == nil || backgroundPayload.Background.PublicURL == "" {
		t.Fatalf("bad MVP background upload response, status %d payload %+v", resp.StatusCode, backgroundPayload)
	}

	resp, err = http.Get(ts.URL + backgroundPayload.Background.PublicURL)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("bad MVP background asset response, status %d content-type %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	resp, err = http.Get(ts.URL + "/api/players/" + steamID + "/mvp-background")
	if err != nil {
		t.Fatal(err)
	}
	backgroundPayload = struct {
		Background *PlayerMVPBackground `json:"background"`
	}{}
	if err := json.NewDecoder(resp.Body).Decode(&backgroundPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || backgroundPayload.Background == nil {
		t.Fatalf("expected saved MVP background, status %d payload %+v", resp.StatusCode, backgroundPayload)
	}

	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/players/"+steamID+"/mvp-background", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete MVP background status: %d", resp.StatusCode)
	}
	resp, err = http.Get(ts.URL + "/api/players/" + steamID + "/mvp-background")
	if err != nil {
		t.Fatal(err)
	}
	backgroundPayload = struct {
		Background *PlayerMVPBackground `json:"background"`
	}{}
	if err := json.NewDecoder(resp.Body).Decode(&backgroundPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || backgroundPayload.Background != nil {
		t.Fatalf("expected cleared MVP background, status %d payload %+v", resp.StatusCode, backgroundPayload)
	}

	body, contentType = playerImageUploadBody(t, "track.mp3", "audio/mpeg", []byte("id3 data"))
	resp, err = http.Post(ts.URL+"/api/showcase/music", contentType, body)
	if err != nil {
		t.Fatal(err)
	}
	var musicPayload struct {
		Music *ShowcaseMusic `json:"music"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&musicPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || musicPayload.Music == nil || musicPayload.Music.PublicURL == "" {
		t.Fatalf("bad showcase music upload response, status %d payload %+v", resp.StatusCode, musicPayload)
	}
	resp, err = http.Get(ts.URL + musicPayload.Music.PublicURL)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "audio/") {
		t.Fatalf("bad showcase music asset response, status %d content-type %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	resp, err = http.Get(ts.URL + "/api/showcase/music")
	if err != nil {
		t.Fatal(err)
	}
	musicPayload = struct {
		Music *ShowcaseMusic `json:"music"`
	}{}
	if err := json.NewDecoder(resp.Body).Decode(&musicPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || musicPayload.Music == nil {
		t.Fatalf("expected saved showcase music, status %d payload %+v", resp.StatusCode, musicPayload)
	}
	req, err = http.NewRequest(http.MethodDelete, ts.URL+"/api/showcase/music", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete showcase music status: %d", resp.StatusCode)
	}
	resp, err = http.Get(ts.URL + "/api/showcase/music")
	if err != nil {
		t.Fatal(err)
	}
	musicPayload = struct {
		Music *ShowcaseMusic `json:"music"`
	}{}
	if err := json.NewDecoder(resp.Body).Decode(&musicPayload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || musicPayload.Music != nil {
		t.Fatalf("expected cleared showcase music, status %d payload %+v", resp.StatusCode, musicPayload)
	}

	resp, err = http.Get(ts.URL + "/api/player-mvp-backgrounds/%2e%2e/secret.png")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != httpStatusNotFound {
		t.Fatalf("expected MVP background traversal rejection, got %d", resp.StatusCode)
	}
	resp, err = http.Get(ts.URL + "/api/showcase-music/%2e%2e/secret.mp3")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != httpStatusNotFound {
		t.Fatalf("expected showcase music traversal rejection, got %d", resp.StatusCode)
	}
}

func playerImageUploadBody(t *testing.T, fileName string, contentType string, content []byte) (io.Reader, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="`+fileName+`"`)
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return &body, writer.FormDataContentType()
}

func TestAPIInvalidFileDemoNotFoundAndConfig(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	_, status := uploadFixture(t, ts.URL, "bad.txt")
	if status != httpStatusBadRequest {
		t.Fatalf("expected invalid file status, got %d", status)
	}

	resp, err := http.Post(ts.URL+"/api/demos/nope/radar", "application/json", bytes.NewBufferString(`{"identifier_type":"name","identifier":"Alpha"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != httpStatusNotFound {
		t.Fatalf("expected demo_not_found, got %d", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/config")
	if err != nil {
		t.Fatal(err)
	}
	var cfg AppConfig
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if cfg.ExportWidth != 1920 {
		t.Fatalf("bad default config: %+v", cfg)
	}

	save := bytes.NewBufferString(`{"export_width":1280,"export_height":720,"theme_color":"#7dff6a","color_preset":"lime","last_player_identifier_type":"steam_id"}`)
	req, err := http.NewRequest(http.MethodPut, ts.URL+"/api/config", save)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save config status: %d", resp.StatusCode)
	}

	bad := bytes.NewBufferString(`{"export_width":0,"export_height":720,"theme_color":"#7dff6a","color_preset":"lime","last_player_identifier_type":"steam_id"}`)
	req, _ = http.NewRequest(http.MethodPut, ts.URL+"/api/config", bad)
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != httpStatusBadRequest {
		t.Fatalf("expected invalid size, got %d", resp.StatusCode)
	}
}
