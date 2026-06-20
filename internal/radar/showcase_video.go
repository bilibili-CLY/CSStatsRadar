package radar

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const maxShowcaseVideoFrames = 7200

func (s *Server) handleShowcaseVideo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	cfg, appErr := s.config.Read()
	if appErr != nil {
		writeError(w, appErr)
		return
	}
	ffmpegPath := strings.TrimSpace(cfg.Showcase.FFmpegPath)
	if ffmpegPath == "" {
		writeError(w, NewAppError("showcase_video_unavailable", httpStatusBadRequest, "请先配置 ffmpeg 路径后再下载 MP4。", nil))
		return
	}
	if err := validateFFmpegPath(ffmpegPath); err != nil {
		writeError(w, NewAppError("showcase_video_unavailable", httpStatusBadRequest, "ffmpeg 路径不可用："+err.Error(), nil))
		return
	}

	var payload ShowcaseVideoExportRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, int64(3)<<30)).Decode(&payload); err != nil {
		writeError(w, NewAppError("invalid_showcase_video", httpStatusBadRequest, "视频导出请求无效或过大。", nil))
		return
	}
	if appErr := validateShowcaseVideoRequest(payload); appErr != nil {
		writeError(w, appErr)
		return
	}

	tempDir, err := os.MkdirTemp("", "cs-radar-video-*")
	if err != nil {
		writeError(w, NewAppError("showcase_video_failed", httpStatusInternal, "临时目录创建失败："+err.Error(), nil))
		return
	}
	defer os.RemoveAll(tempDir)

	if err := writeShowcaseFrames(tempDir, payload.Frames); err != nil {
		writeError(w, NewAppError("showcase_video_failed", httpStatusInternal, "视频帧写入失败："+err.Error(), nil))
		return
	}
	outputPath := filepath.Join(tempDir, "showcase.mp4")
	if err := encodeShowcaseMP4(ffmpegPath, tempDir, outputPath, cfg.Showcase.MusicPath, payload); err != nil {
		writeError(w, NewAppError("showcase_video_failed", httpStatusInternal, "ffmpeg 导出失败："+err.Error(), nil))
		return
	}
	file, err := os.Open(outputPath)
	if err != nil {
		writeError(w, NewAppError("showcase_video_failed", httpStatusInternal, "视频文件读取失败："+err.Error(), nil))
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Content-Disposition", `attachment; filename="cs2-showcase.mp4"`)
	http.ServeContent(w, r, "cs2-showcase.mp4", fileModTime(file), file)
}

func validateFFmpegPath(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("路径是目录")
	}
	if info.Mode()&0o111 == 0 {
		return fmt.Errorf("文件不可执行")
	}
	cmd := exec.Command(path, "-version")
	if err := cmd.Run(); err != nil {
		return err
	}
	return nil
}

func validateShowcaseVideoRequest(payload ShowcaseVideoExportRequest) *AppError {
	if payload.Width <= 0 || payload.Width > 8192 || payload.Height <= 0 || payload.Height > 8192 {
		return NewAppError("invalid_export_size", httpStatusBadRequest, "", nil)
	}
	if payload.FPS <= 0 || payload.FPS > 120 {
		return NewAppError("invalid_showcase_video", httpStatusBadRequest, "视频帧率必须在 1 到 120 之间。", nil)
	}
	if payload.DurationMS <= 0 {
		return NewAppError("invalid_showcase_video", httpStatusBadRequest, "视频时长必须大于 0。", nil)
	}
	if payload.AudioOffsetMS < -60000 || payload.AudioOffsetMS > 60000 {
		return NewAppError("invalid_showcase_video", httpStatusBadRequest, "音乐偏移必须在 -60 到 60 秒之间。", nil)
	}
	if len(payload.Frames) == 0 || len(payload.Frames) > maxShowcaseVideoFrames {
		return NewAppError("invalid_showcase_video", httpStatusBadRequest, "视频帧数量无效。", nil)
	}
	return nil
}

func writeShowcaseFrames(tempDir string, frames []string) error {
	for index, raw := range frames {
		data, err := decodePNGDataURL(raw)
		if err != nil {
			return err
		}
		name := filepath.Join(tempDir, fmt.Sprintf("frame_%06d.png", index+1))
		if err := os.WriteFile(name, data, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func decodePNGDataURL(raw string) ([]byte, error) {
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(raw, prefix) {
		return nil, fmt.Errorf("只支持 PNG data URL")
	}
	return base64.StdEncoding.DecodeString(strings.TrimPrefix(raw, prefix))
}

func encodeShowcaseMP4(ffmpegPath string, tempDir string, outputPath string, musicPath string, payload ShowcaseVideoExportRequest) error {
	durationSeconds := float64(payload.DurationMS) / 1000
	args := []string{
		"-y",
		"-framerate", strconv.Itoa(payload.FPS),
		"-i", filepath.Join(tempDir, "frame_%06d.png"),
	}
	hasAudio := strings.TrimSpace(musicPath) != ""
	if hasAudio {
		if _, err := os.Stat(musicPath); err != nil {
			hasAudio = false
		}
	}
	if hasAudio {
		args = append(args, "-stream_loop", "-1", "-i", musicPath)
		filter := audioFilter(payload.AudioOffsetMS, durationSeconds)
		args = append(args, "-filter_complex", filter, "-map", "0:v:0", "-map", "[a]", "-c:a", "aac", "-b:a", "192k")
	}
	args = append(args,
		"-c:v", "libx264",
		"-pix_fmt", "yuv420p",
		"-r", strconv.Itoa(payload.FPS),
		"-t", fmt.Sprintf("%.3f", durationSeconds),
		"-movflags", "+faststart",
		outputPath,
	)
	cmd := exec.Command(ffmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 800 {
			message = message[len(message)-800:]
		}
		return fmt.Errorf("%w: %s", err, message)
	}
	return nil
}

func audioFilter(offsetMS int, durationSeconds float64) string {
	duration := fmt.Sprintf("%.3f", durationSeconds)
	if offsetMS > 0 {
		return fmt.Sprintf("[1:a]adelay=%d:all=1,atrim=duration=%s,asetpts=N/SR/TB[a]", offsetMS, duration)
	}
	if offsetMS < 0 {
		return fmt.Sprintf("[1:a]atrim=start=%.3f,asetpts=PTS-STARTPTS,atrim=duration=%s[a]", float64(-offsetMS)/1000, duration)
	}
	return fmt.Sprintf("[1:a]atrim=duration=%s,asetpts=PTS-STARTPTS[a]", duration)
}

func fileModTime(file *os.File) time.Time {
	info, _ := file.Stat()
	if info == nil {
		return time.Now()
	}
	return info.ModTime()
}
