package radar

import (
	"encoding/json"
	"net/http"
)

type AppError struct {
	Code       string
	Message    string
	StatusCode int
	Extra      map[string]any
}

func (e *AppError) Error() string {
	return e.Message
}

var ErrorMessages = map[string]string{
	"invalid_file_type":   "仅支持已解压的 .dem 文件。",
	"demo_parse_failed":   "Demo 解析失败。",
	"demo_not_found":      "未找到该 Demo 会话，请重新上传。",
	"player_not_found":    "未在 Demo 中找到该玩家。",
	"player_ambiguous":    "玩家名匹配到多个候选，请选择明确的玩家。",
	"metric_unavailable":  "部分指标无法计算。",
	"invalid_export_size": "导出尺寸必须是合法正整数。",
	"config_read_failed":  "配置读取失败，已回退默认配置。",
	"config_write_failed": "配置保存失败。",
}

func NewAppError(code string, status int, message string, extra map[string]any) *AppError {
	if message == "" {
		message = ErrorMessages[code]
	}
	return &AppError{Code: code, Message: message, StatusCode: status, Extra: extra}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, err *AppError) {
	body := map[string]any{
		"error": map[string]any{
			"code":    err.Code,
			"message": err.Message,
		},
	}
	for key, value := range err.Extra {
		body["error"].(map[string]any)[key] = value
	}
	writeJSON(w, err.StatusCode, body)
}
