package radar

import (
	"math"
	"os"
	"strings"
)

const AggregateRadarNote = "综合雷达为所选比赛等权平均结果。Rating 2.0 为公开逆向公式的本地计算。"

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
	rating2 := RadarPayload{
		Dimensions: MetricOrder, Values: values, DisplayTypes: DisplayTypes, MaxValues: MaxValues,
		MinValues: MinValues, Note: AggregateRadarNote, Metrics: metrics,
	}
	var rating3 *RadarPayload
	rating3Available := true
	for _, record := range records {
		if len(record.Rating3Metrics) == 0 || record.RoundSwing == nil {
			rating3Available = false
			break
		}
	}
	if rating3Available {
		r3Metrics := aggregateMetricsForOrder(records, Rating3MetricOrder, true)
		r3Values := make([]*float64, 0, len(r3Metrics))
		swingTotal := 0.0
		for _, metric := range r3Metrics {
			r3Values = append(r3Values, metric.Value)
		}
		for _, record := range records {
			swingTotal += *record.RoundSwing
		}
		swing := math.Round(swingTotal/float64(len(records))*100) / 100
		payload := RadarPayload{Dimensions: Rating3MetricOrder, Values: r3Values,
			DisplayTypes: []string{"number", "percentage", "number", "percentage", "number", "number"},
			MaxValues:    []float64{1, .6, 100, .7, 2, 1.5}, MinValues: MinValues,
			Note: "综合雷达为所选比赛等权平均结果。" + Rating3RadarNote, Metrics: r3Metrics,
			RoundSwing: &swing, AlgorithmVersion: Rating3AlgorithmVersion}
		rating3 = &payload
	}
	status := Rating3Status{Available: rating3 != nil}
	if !status.Available {
		status.Reason = "部分比赛尚无完整 Rating 3.0 事件数据。"
		for _, record := range records {
			if strings.TrimSpace(record.SourcePath) == "" {
				status.Reason = "源 DEM 路径缺失，无法补算 Rating 3.0。"
				break
			}
			if _, err := os.Stat(record.SourcePath); err != nil {
				status.Reason = "源 DEM 已移动或丢失，无法补算 Rating 3.0。"
				break
			}
		}
	}
	return AggregateRadarResponse{
		Player:        Player{Name: player.Name, SteamID: player.SteamID},
		MatchCount:    len(records),
		Radar:         rating2,
		Profiles:      RatingProfiles{Rating2: rating2, Rating3: rating3},
		Rating3Status: status,
	}, nil
}

func aggregateMetrics(records []PlayerMatchRecord) []RadarMetric {
	return aggregateMetricsForOrder(records, MetricOrder, false)
}

func aggregateMetricsForOrder(records []PlayerMatchRecord, order []string, rating3 bool) []RadarMetric {
	result := make([]RadarMetric, 0, len(MetricOrder))
	for _, name := range order {
		var displayType string
		var metricMaxValue float64
		var minValue float64
		sum := 0.0
		count := 0
		hasUnavailable := false
		hasApproximate := false
		for _, record := range records {
			source := record.Metrics
			if rating3 {
				source = record.Rating3Metrics
			}
			metric := findMetric(source, name)
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
