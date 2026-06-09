package radar

import "testing"

func TestAggregateRadarEqualAverageAndStatusPropagation(t *testing.T) {
	repo := newFakeHistoryRepository()
	repo.players["1"] = SavedPlayer{SteamID: "1", Name: "Alpha", MatchCount: 2}
	repo.matches["1"] = []PlayerMatchRecord{
		{DemoRecordID: "a", SteamID: "1", Rounds: 4, Metrics: aggregateTestMetrics(map[string]float64{"KPR": 0.5, "Surviving": 0.5, "ADR": 80, "KAST": 0.7, "Impact": 1, "Rating": 1})},
		{DemoRecordID: "b", SteamID: "1", Rounds: 30, Metrics: aggregateTestMetrics(map[string]float64{"KPR": 1, "Surviving": 0.4, "ADR": 100, "KAST": 0.6, "Impact": 1.4, "Rating": 1.2})},
	}
	response, appErr := NewAggregateRadarService(repo).Build("1", []string{"a", "b"})
	if appErr != nil {
		t.Fatalf("build aggregate: %v", appErr)
	}
	if response.MatchCount != 2 || *response.Radar.Metrics[0].Value != 0.75 {
		t.Fatalf("expected equal KPR average, got %+v", response)
	}

	repo.matches["1"][1].Metrics[2].Value = nil
	repo.matches["1"][1].Metrics[2].Status = "unavailable"
	response, appErr = NewAggregateRadarService(repo).Build("1", []string{"a", "b"})
	if appErr != nil {
		t.Fatalf("build with unavailable metric: %v", appErr)
	}
	if response.Radar.Metrics[2].Status != "unavailable" {
		t.Fatalf("ADR unavailable should propagate: %+v", response.Radar.Metrics[2])
	}

	repo.matches["1"][0].Metrics[3].Status = "approximate"
	response, appErr = NewAggregateRadarService(repo).Build("1", []string{"a", "b"})
	if appErr != nil {
		t.Fatalf("build with approximate metric: %v", appErr)
	}
	if response.Radar.Metrics[3].Status != "approximate" {
		t.Fatalf("KAST approximate should propagate: %+v", response.Radar.Metrics[3])
	}
}

func TestAggregateRadarUnavailableAndWrongPlayer(t *testing.T) {
	repo := newFakeHistoryRepository()
	repo.players["1"] = SavedPlayer{SteamID: "1", Name: "Alpha", MatchCount: 1}
	repo.matches["1"] = []PlayerMatchRecord{{DemoRecordID: "a", SteamID: "1", Metrics: unavailableTestMetrics()}}
	if _, appErr := NewAggregateRadarService(repo).Build("1", []string{"a"}); appErr == nil || appErr.Code != "aggregate_radar_unavailable" {
		t.Fatalf("expected aggregate unavailable, got %v", appErr)
	}
	if _, appErr := NewAggregateRadarService(repo).Build("1", []string{"missing"}); appErr == nil || appErr.Code != "match_record_not_found" {
		t.Fatalf("expected wrong match error, got %v", appErr)
	}
	if _, appErr := NewAggregateRadarService(repo).Build("", []string{"a"}); appErr == nil || appErr.Code != "player_record_not_found" {
		t.Fatalf("expected empty steam id error, got %v", appErr)
	}
	if _, appErr := NewAggregateRadarService(repo).Build("1", nil); appErr == nil || appErr.Code != "invalid_aggregate_request" {
		t.Fatalf("expected empty ids error, got %v", appErr)
	}
}

func aggregateTestMetrics(values map[string]float64) []RadarMetric {
	metrics := make([]RadarMetric, 0, len(MetricOrder))
	for _, name := range MetricOrder {
		value := values[name]
		metrics = append(metrics, RadarMetric{Name: name, Value: &value, DisplayType: displayTypeForMetric(name), MaxValue: maxValue(name), Status: "ok"})
	}
	return metrics
}

func unavailableTestMetrics() []RadarMetric {
	metrics := make([]RadarMetric, 0, len(MetricOrder))
	for _, name := range MetricOrder {
		metrics = append(metrics, RadarMetric{Name: name, DisplayType: displayTypeForMetric(name), MaxValue: maxValue(name), Status: "unavailable"})
	}
	return metrics
}
