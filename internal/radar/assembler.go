package radar

var DisplayTypes = []string{"number", "percentage", "number", "percentage", "number", "number"}
var MaxValues = []float64{1, 0.6, 100, 0.7, 2, 1.5}
var MinValues = []float64{0, 0, 0, 0, 0, 0}

const RadarNote = "Rating 和 Impact 为本地自制近似算法，不等同于 HLTV 官方数据。"

type RadarAssembler struct{}

func (a RadarAssembler) Assemble(player Player, stats PlayerStatsResult) (RadarResponse, *AppError) {
	metrics := make([]RadarMetric, 0, len(MetricOrder))
	values := make([]*float64, 0, len(MetricOrder))
	unavailable := make([]RadarMetric, 0)
	for _, name := range MetricOrder {
		metric := stats.Metrics[name]
		metrics = append(metrics, metric)
		values = append(values, metric.Value)
		if metric.Status == "unavailable" {
			unavailable = append(unavailable, metric)
		}
	}
	if len(unavailable) == len(MetricOrder) {
		return RadarResponse{}, NewAppError("metric_unavailable", httpStatusUnprocessable, "", map[string]any{"metrics": unavailable})
	}
	return RadarResponse{
		Player: player,
		Radar: RadarPayload{
			Dimensions:   MetricOrder,
			Values:       values,
			DisplayTypes: DisplayTypes,
			MaxValues:    MaxValues,
			MinValues:    MinValues,
			Note:         RadarNote,
			Metrics:      metrics,
		},
	}, nil
}
