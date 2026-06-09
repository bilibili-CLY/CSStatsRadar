package radar

import "strings"

const AggregateRadarNote = "综合雷达为所选比赛等权平均结果。Rating 和 Impact 为本地自制近似算法，不等同于 HLTV 官方数据。"

type AggregateRadarService struct {
	repo HistoryRepository
}

func NewAggregateRadarService(repo HistoryRepository) AggregateRadarService {
	return AggregateRadarService{repo: repo}
}

func (s AggregateRadarService) Build(steamID string, demoRecordIDs []string) (AggregateRadarResponse, *AppError) {
	steamID = strings.TrimSpace(steamID)
	if steamID == "" {
		return AggregateRadarResponse{}, NewAppError("player_record_not_found", httpStatusNotFound, "", nil)
	}
	ids := uniqueStrings(demoRecordIDs)
	if len(ids) == 0 {
		return AggregateRadarResponse{}, NewAppError("invalid_aggregate_request", httpStatusBadRequest, "", nil)
	}
	player, appErr := s.repo.GetPlayer(steamID)
	if appErr != nil {
		return AggregateRadarResponse{}, appErr
	}
	records, appErr := s.repo.GetMetricSnapshots(steamID, ids)
	if appErr != nil {
		return AggregateRadarResponse{}, appErr
	}
	if len(records) != len(ids) {
		return AggregateRadarResponse{}, NewAppError("match_record_not_found", httpStatusNotFound, "", nil)
	}
	metrics := aggregateMetrics(records)
	unavailable := 0
	values := make([]*float64, 0, len(metrics))
	for _, metric := range metrics {
		values = append(values, metric.Value)
		if metric.Status == "unavailable" {
			unavailable++
		}
	}
	if unavailable == len(MetricOrder) {
		return AggregateRadarResponse{}, NewAppError("aggregate_radar_unavailable", httpStatusUnprocessable, "", map[string]any{"metrics": metrics})
	}
	return AggregateRadarResponse{
		Player:     Player{Name: player.Name, SteamID: player.SteamID},
		MatchCount: len(records),
		Radar: RadarPayload{
			Dimensions:   MetricOrder,
			Values:       values,
			DisplayTypes: DisplayTypes,
			MaxValues:    MaxValues,
			MinValues:    MinValues,
			Note:         AggregateRadarNote,
			Metrics:      metrics,
		},
	}, nil
}

func aggregateMetrics(records []PlayerMatchRecord) []RadarMetric {
	result := make([]RadarMetric, 0, len(MetricOrder))
	for _, name := range MetricOrder {
		var displayType string
		var metricMaxValue float64
		var minValue float64
		sum := 0.0
		count := 0
		hasUnavailable := false
		hasApproximate := false
		for _, record := range records {
			metric := findMetric(record.Metrics, name)
			if displayType == "" {
				displayType = metric.DisplayType
				metricMaxValue = metric.MaxValue
				minValue = metric.MinValue
			}
			if metric.Value == nil || metric.Status == "unavailable" {
				hasUnavailable = true
				continue
			}
			if metric.Status == "approximate" {
				hasApproximate = true
			}
			sum += *metric.Value
			count++
		}
		if displayType == "" {
			displayType = displayTypeForMetric(name)
			metricMaxValue = maxValue(name)
		}
		metric := RadarMetric{
			Name:        name,
			DisplayType: displayType,
			MaxValue:    metricMaxValue,
			MinValue:    minValue,
			Status:      "ok",
		}
		if hasUnavailable || count != len(records) {
			metric.Status = "unavailable"
			metric.Reason = "所选比赛中存在不可用指标。"
		} else {
			value := round3(sum / float64(count))
			metric.Value = &value
			if hasApproximate {
				metric.Status = "approximate"
				metric.Reason = "所选比赛中存在近似指标。"
			}
		}
		result = append(result, metric)
	}
	return result
}

func findMetric(metrics []RadarMetric, name string) RadarMetric {
	for _, metric := range metrics {
		if metric.Name == name {
			return metric
		}
	}
	return RadarMetric{Name: name, DisplayType: displayTypeForMetric(name), MaxValue: maxValue(name), MinValue: 0, Status: "unavailable"}
}

func displayTypeForMetric(name string) string {
	if name == "Surviving" || name == "KAST" {
		return "percentage"
	}
	return "number"
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		result = append(result, trimmed)
	}
	return result
}
