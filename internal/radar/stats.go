package radar

import "math"

var MetricOrder = []string{"KPR", "Surviving", "ADR", "KAST", "Impact", "Rating"}

type PlayerStatsCalculator struct{}

func (c PlayerStatsCalculator) Calculate(demo DemoData, player Player) PlayerStatsResult {
	totalRounds := len(demo.Rounds)
	steamID := player.SteamID
	kills := 0
	deaths := 0
	assists := 0
	for _, event := range demo.Kills {
		if event.AttackerSteamID == steamID && event.VictimSteamID != steamID {
			kills++
		}
		if event.VictimSteamID == steamID {
			deaths++
		}
		if event.AssisterSteamID == steamID {
			assists++
		}
	}

	var totalDamage *int
	if demo.Damages != nil {
		sum := 0
		for _, event := range *demo.Damages {
			if event.AttackerSteamID == steamID && event.Damage > 0 {
				sum += event.Damage
			}
		}
		totalDamage = &sum
	}

	survivedRounds := 0
	for _, state := range demo.Survivals {
		if state.SteamID == steamID && state.Survived {
			survivedRounds++
		}
	}

	kastSet := map[int]bool{}
	for _, kill := range demo.Kills {
		if kill.AttackerSteamID == steamID || kill.AssisterSteamID == steamID || kill.TradedPlayerSteamID == steamID {
			kastSet[kill.RoundNumber] = true
		}
	}
	for _, state := range demo.Survivals {
		if state.SteamID == steamID && state.Survived {
			kastSet[state.RoundNumber] = true
		}
	}

	base := PlayerBaseStats{
		Rounds:         totalRounds,
		Kills:          kills,
		Deaths:         deaths,
		Assists:        assists,
		TotalDamage:    totalDamage,
		SurvivedRounds: survivedRounds,
		KASTRounds:     len(kastSet),
	}
	return PlayerStatsResult{Base: base, Metrics: buildMetrics(base, demo.TradeDataAvailable)}
}

func buildMetrics(base PlayerBaseStats, tradeDataAvailable bool) map[string]RadarMetric {
	if base.Rounds <= 0 {
		metrics := map[string]RadarMetric{}
		for _, name := range MetricOrder {
			displayType := "number"
			if name == "Surviving" || name == "KAST" {
				displayType = "percentage"
			}
			metrics[name] = RadarMetric{
				Name:        name,
				Value:       nil,
				DisplayType: displayType,
				MaxValue:    maxValue(name),
				MinValue:    0,
				Status:      "unavailable",
				Reason:      "Demo 中没有可统计回合。",
			}
		}
		return metrics
	}

	rounds := float64(base.Rounds)
	kpr := float64(base.Kills) / rounds
	surviving := float64(base.SurvivedRounds) / rounds
	kast := float64(base.KASTRounds) / rounds
	var adr *float64
	if base.TotalDamage != nil {
		value := float64(*base.TotalDamage) / rounds
		adr = &value
	}
	impact := 2.13*kpr + 0.42*(float64(base.Assists)/rounds) - 0.41
	adrValue := 0.0
	if adr != nil {
		adrValue = *adr
	}
	rating := 0.0073*adrValue + 0.3591*kpr - 0.5329*(float64(base.Deaths)/rounds) + 0.2372*impact + 0.0032*kast*100 + 0.1587

	metrics := map[string]RadarMetric{
		"KPR":       okMetric("KPR", kpr, "number", ""),
		"Surviving": okMetric("Surviving", surviving, "percentage", ""),
		"KAST":      okMetric("KAST", kast, "percentage", ""),
		"Impact":    okMetric("Impact", impact, "number", "本地自制影响力算法第一版。"),
		"Rating":    okMetric("Rating", rating, "number", "本地自制综合评分算法第一版。"),
	}
	if adr == nil {
		metrics["ADR"] = RadarMetric{Name: "ADR", DisplayType: "number", MaxValue: 70, MinValue: 0, Status: "unavailable", Reason: "伤害事件数据缺失。"}
	} else {
		metrics["ADR"] = okMetric("ADR", *adr, "number", "")
	}
	if !tradeDataAvailable {
		metric := metrics["KAST"]
		metric.Status = "approximate"
		metric.Reason = "Trade 数据不足，KAST 使用击杀/助攻/存活近似。"
		metrics["KAST"] = metric
	}
	return metrics
}

func okMetric(name string, value float64, displayType string, note string) RadarMetric {
	rounded := round3(math.Max(0, value))
	return RadarMetric{
		Name:        name,
		Value:       &rounded,
		DisplayType: displayType,
		MaxValue:    maxValue(name),
		MinValue:    0,
		Status:      "ok",
		Note:        note,
	}
}

func maxValue(name string) float64 {
	switch name {
	case "KPR":
		return 1
	case "Surviving":
		return 0.6
	case "ADR":
		return 100
	case "KAST":
		return 0.7
	case "Impact":
		return 2
	case "Rating":
		return 1.5
	default:
		return 1
	}
}

func round3(value float64) float64 {
	return math.Round(value*1000) / 1000
}
