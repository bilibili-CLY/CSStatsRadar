package radar

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func testServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := NewServer(ServerOptions{
		FrontendDir: filepath.Join("..", "..", "frontend"),
		Store:       NewSessionStore(t.TempDir()),
		Config:      NewConfigManager(filepath.Join(t.TempDir(), "config.json")),
	})
	return httptest.NewServer(server.Routes())
}

func uploadFixture(t *testing.T, baseURL string, fileName string) (map[string]any, int) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", fileName)
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(fixturePath(t))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := io.Copy(part, file); err != nil {
		t.Fatal(err)
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

func TestAPIUploadRadarAndErrors(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	upload, status := uploadFixture(t, ts.URL, "sample.dem")
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
