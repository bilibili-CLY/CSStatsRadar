package radar

var DisplayTypes = []string{"number", "percentage", "number", "percentage", "number", "number"}
var MaxValues = []float64{1, 0.6, 100, 0.7, 2, 1.5}
var MinValues = []float64{0, 0, 0, 0, 0, 0}

const RadarNote = "Rating 和 Impact 为本地自制近似算法，不等同于 HLTV 官方数据。"
const Rating3RadarNote = "Rating 3.0、Multi-Kill 与 Round Swing 为本地透明近似，不等同于 HLTV 官方数据。"

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
	rating2 := RadarPayload{
		Dimensions: MetricOrder, Values: values, DisplayTypes: DisplayTypes, MaxValues: MaxValues,
		MinValues: MinValues, Note: RadarNote, Metrics: metrics,
	}
	var rating3 *RadarPayload
	if stats.Rating3Available {
		rating3Metrics, rating3Values := orderedMetrics(stats.Rating3Metrics, Rating3MetricOrder)
		payload := RadarPayload{
			Dimensions: Rating3MetricOrder, Values: rating3Values,
			DisplayTypes: []string{"number", "percentage", "number", "percentage", "number", "number"},
			MaxValues:    []float64{1, .6, 100, .7, 2, 1.5}, MinValues: MinValues,
			Note: Rating3RadarNote, Metrics: rating3Metrics, RoundSwing: stats.RoundSwing,
			AlgorithmVersion: Rating3AlgorithmVersion,
		}
		rating3 = &payload
	}
	return RadarResponse{
		Player:        player,
		Radar:         rating2,
		Profiles:      RatingProfiles{Rating2: rating2, Rating3: rating3},
		Rating3Status: Rating3Status{Available: rating3 != nil, Reason: stats.Rating3Reason},
	}, nil
}

func orderedMetrics(source map[string]RadarMetric, order []string) ([]RadarMetric, []*float64) {
	metrics := make([]RadarMetric, 0, len(order))
	values := make([]*float64, 0, len(order))
	for _, name := range order {
		metric := source[name]
		metrics = append(metrics, metric)
		values = append(values, metric.Value)
	}
	return metrics, values
}
