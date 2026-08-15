package radar

import (
	"math"
	"sort"
	"strings"
)

const Rating3AlgorithmVersion = "local-r3-2025.10-v1"

const (
	rating3SideBiasT          = -0.08
	rating3SideBiasCT         = 0.08
	rating3WeaponBeta         = 0.55
	rating3ArmorBonus         = 0.20
	rating3AliveCoefficient   = 0.88
	rating3EconomyCoefficient = 0.000055
	rating3BombCoefficient    = 1.10
)

type weaponCategory struct {
	ID, Label string
	Strength  float64
	Weapons   []string
}

var weaponCategories = []weaponCategory{
	{ID: "starter_pistol", Label: "初始手枪", Strength: 0, Weapons: []string{"glock", "glock-18", "usp-s", "usp", "p2000", "hkp2000"}},
	{ID: "upgraded_pistol", Label: "强化手枪", Strength: 0.55, Weapons: []string{"p250", "deagle", "desert eagle", "tec-9", "tec9", "five-seven", "fiveseven", "cz75-auto", "cz75 auto", "cz75a", "dual berettas", "elite", "r8 revolver", "revolver"}},
	{ID: "smg_shotgun", Label: "SMG / 霰弹枪", Strength: 1.05, Weapons: []string{"mp9", "mac-10", "mac10", "ump-45", "ump45", "mp7", "mp5-sd", "mp5sd", "p90", "pp-bizon", "bizon", "nova", "xm1014", "mag-7", "mag7", "sawed-off", "sawedoff", "m249", "negev"}},
	{ID: "tier2_rifle", Label: "二级步枪", Strength: 1.45, Weapons: []string{"galil ar", "galilar", "famas"}},
	{ID: "tier1_rifle", Label: "一级步枪", Strength: 2, Weapons: []string{"ak-47", "ak47", "m4a4", "m4a1-s", "m4a1", "aug", "sg 553", "sg553"}},
	{ID: "sniper", Label: "狙击枪", Strength: 2.59, Weapons: []string{"awp", "ssg 08", "ssg08", "scar-20", "scar20", "g3sg1"}},
}

func GetRatingMethodology() RatingMethodology {
	categories := make([]WeaponMethodology, 0, len(weaponCategories))
	for _, category := range weaponCategories {
		categories = append(categories, WeaponMethodology{ID: category.ID, Label: category.Label, Strength: category.Strength, Weapons: append([]string(nil), category.Weapons...)})
	}
	return RatingMethodology{
		AlgorithmVersion:      Rating3AlgorithmVersion,
		ImpactFormula:         "Impact = 2.13 × KPR + 0.42 × APR − 0.41",
		Rating2Formula:        "R2 = 0.0073 × KAST% + 0.3591 × KPR − 0.5329 × DPR + 0.2372 × Impact + 0.0032 × ADR + 0.1587",
		Rating3BaseFormula:    "base3 = 0.0073 × eKAST% + 0.3591 × eKPR − 0.5329 × eDPR + 0.2372 × multiImpact + 0.0032 × eADR + 0.1587",
		MultiKPRFormula:       "multiKPR = eKPR + 0.25 × Σmax(单回合击杀−1, 0) ÷ 有效回合数",
		MultiImpactFormula:    "multiImpact = 2.13 × multiKPR + 0.42 × eAPR − 0.41",
		SwingRatingFormula:    "swingRating = clamp(1 + Swing% ÷ 4, 0, 2.5)",
		Rating3Formula:        "R3 = max(0, 0.92 × base3 + 0.08 × clamp(1 + Swing% / 4, 0, 2.5))",
		SwingFormula:          "Swing% = 玩家累计回合胜率变化 ÷ 有效回合数 × 100",
		WinProbabilityFormula: "P(T) = sigmoid(logit(0.48) + 0.88 × (T存活−CT存活) + 0.000055 × (T经济−CT经济) + 1.10 × 已下包)",
		WeaponWeightFormula:   "weaponWeight = clamp(2 × (1 − sigmoid(sideBias + 0.55 × (攻击者强度−受害者强度))), 0.50, 1.50)",
		SniperDamageFormula:   "sniperDamageWeight = 0.75 × weaponWeight + 0.25",
		WeaponCategories:      categories,
		ContributionWeights:   map[string]float64{"damage": 0.50, "final_blow": 0.30, "flash_assist": 0.10, "trade": 0.10},
		Constants:             map[string]float64{"side_bias_t": rating3SideBiasT, "side_bias_ct": rating3SideBiasCT, "weapon_beta": rating3WeaponBeta, "armor_bonus": rating3ArmorBonus, "alive_coefficient": rating3AliveCoefficient, "economy_coefficient": rating3EconomyCoefficient, "bomb_coefficient": rating3BombCoefficient, "swing_weight": 0.08},
		Limitations:           []string{"并非 HLTV 官方公式或官方数据。", "v1 不使用 HLTV 未公开的地图专属胜率先验。", "结果依赖 DEM 是否包含完整的经济、阵营和事件时序。", "单图样本中的残局会显著放大 Swing。"},
	}
}

func normalizeWeaponName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "weapon_")
	return value
}

func categoryForWeapon(value string) (weaponCategory, bool) {
	value = normalizeWeaponName(value)
	for _, category := range weaponCategories {
		for _, weapon := range category.Weapons {
			if value == weapon {
				return category, true
			}
		}
	}
	return weaponCategory{}, false
}

func isSpecialWeapon(value string) bool {
	value = normalizeWeaponName(value)
	return strings.Contains(value, "knife") || value == "taser" || strings.Contains(value, "zeus") || value == "flashbang" || strings.Contains(value, "grenade") || strings.Contains(value, "molotov") || strings.Contains(value, "inferno")
}

func weaponDuelProbability(attackerWeapon, victimWeapon, attackerSide string, attackerArmor, victimArmor bool) float64 {
	attacker, attackerOK := categoryForWeapon(attackerWeapon)
	victim, victimOK := categoryForWeapon(victimWeapon)
	if !attackerOK {
		attacker = weaponCategories[0]
	}
	if !victimOK {
		victim = weaponCategories[0]
	}
	a, v := attacker.Strength, victim.Strength
	if attackerArmor {
		a += rating3ArmorBonus
	}
	if victimArmor {
		v += rating3ArmorBonus
	}
	bias := rating3SideBiasT
	if strings.EqualFold(attackerSide, "CT") {
		bias = rating3SideBiasCT
	}
	return sigmoid(bias + rating3WeaponBeta*(a-v))
}

func weaponEventWeight(attackerWeapon, victimWeapon, attackerSide string, attackerArmor, victimArmor bool) float64 {
	if isSpecialWeapon(attackerWeapon) {
		return 1.5
	}
	return clamp(2*(1-weaponDuelProbability(attackerWeapon, victimWeapon, attackerSide, attackerArmor, victimArmor)), 0.5, 1.5)
}

func calculateRating3(demo DemoData, player Player, base PlayerBaseStats) (map[string]RadarMetric, *float64, string) {
	if !enhancedRatingDataAvailable(demo) {
		return nil, nil, "Demo 缺少 Rating 3.0 所需的阵营、回合胜方或事件时序。"
	}
	rounds := float64(base.Rounds)
	weightedKills, weightedDeaths, weightedDamage, weightedAssists := 0.0, 0.0, 0.0, 0.0
	extraMulti := 0.0
	killsByRound := map[int]int{}
	for _, event := range demo.Kills {
		if event.AttackerSteamID == "" || event.VictimSteamID == "" || event.AttackerSteamID == event.VictimSteamID || strings.EqualFold(event.AttackerSide, event.VictimSide) {
			continue
		}
		weight := weaponEventWeight(event.Weapon, event.VictimWeapon, event.AttackerSide, event.AttackerArmor, event.VictimArmor)
		if event.AttackerSteamID == player.SteamID {
			weightedKills += weight
			killsByRound[event.RoundNumber]++
		}
		if event.VictimSteamID == player.SteamID {
			weightedDeaths += weight
		}
		if event.AssisterSteamID == player.SteamID {
			weightedAssists += weight
		}
	}
	for _, count := range killsByRound {
		if count > 1 {
			extraMulti += float64(count - 1)
		}
	}
	for _, event := range derefDamages(demo.Damages) {
		if event.AttackerSteamID != player.SteamID || event.Damage <= 0 || event.AttackerSteamID == event.VictimSteamID || strings.EqualFold(event.AttackerSide, event.VictimSide) {
			continue
		}
		weight := weaponEventWeight(event.Weapon, event.VictimWeapon, event.AttackerSide, event.AttackerArmor, event.VictimArmor)
		if category, ok := categoryForWeapon(event.Weapon); ok && category.ID == "sniper" {
			weight = 0.75*weight + 0.25
		}
		weightedDamage += float64(event.Damage) * weight
	}
	eKPR, eDPR, eADR, eAPR := weightedKills/rounds, weightedDeaths/rounds, weightedDamage/rounds, weightedAssists/rounds
	eKAST := economicKAST(demo, player.SteamID) / rounds
	multiKPR := eKPR + 0.25*extraMulti/rounds
	multiImpact := 2.13*multiKPR + 0.42*eAPR - 0.41
	swing := calculateRoundSwing(demo, player.SteamID)
	swingRating := clamp(1+swing/4, 0, 2.5)
	base3 := 0.0073*eKAST*100 + 0.3591*eKPR - 0.5329*eDPR + 0.2372*multiImpact + 0.0032*eADR + 0.1587
	rating3 := round3(math.Max(0, 0.92*base3+0.08*swingRating))
	multiRating := round3(math.Max(0, multiImpact))
	swing = math.Round(swing*100) / 100
	metrics := map[string]RadarMetric{
		"KPR":        okMetric("KPR", eKPR, "number", "已按枪械对位修正。"),
		"Surviving":  okMetric("Surviving", float64(base.SurvivedRounds)/rounds, "percentage", ""),
		"ADR":        okMetric("ADR", eADR, "number", "已按枪械对位修正。"),
		"KAST":       okMetric("KAST", eKAST, "percentage", ""),
		"Multi-Kill": okMetric("Multi-Kill", multiRating, "number", "经济修正后的多杀子评分。"),
		"Rating":     okMetric("Rating", rating3, "number", "Rating 3.0 本地近似。"),
	}
	return metrics, &swing, ""
}

func economicKAST(demo DemoData, steamID string) float64 {
	credits := map[int]float64{}
	for _, event := range demo.Kills {
		if event.AttackerSteamID == "" || event.VictimSteamID == "" || event.AttackerSteamID == event.VictimSteamID || strings.EqualFold(event.AttackerSide, event.VictimSide) {
			continue
		}
		weight := weaponEventWeight(event.Weapon, event.VictimWeapon, event.AttackerSide, event.AttackerArmor, event.VictimArmor)
		if event.AttackerSteamID == steamID || event.AssisterSteamID == steamID {
			credits[event.RoundNumber] = math.Max(credits[event.RoundNumber], weight)
		}
		if event.TradedPlayerSteamID == steamID {
			credits[event.RoundNumber] = math.Max(credits[event.RoundNumber], 1)
		}
	}
	for _, state := range demo.Survivals {
		if state.SteamID == steamID && state.Survived {
			credits[state.RoundNumber] = math.Max(credits[state.RoundNumber], 1)
		}
	}
	total := 0.0
	for _, credit := range credits {
		total += clamp(credit, .5, 1.5)
	}
	return total
}

func enhancedRatingDataAvailable(demo DemoData) bool {
	hasRoundContext := false
	for _, round := range demo.Rounds {
		if round.WinnerSide != "" && round.TeamEconomy != nil {
			hasRoundContext = true
			break
		}
	}
	if !hasRoundContext || demo.Damages == nil {
		return false
	}
	for _, event := range demo.Kills {
		if event.AttackerSteamID != "" && (event.Tick <= 0 || event.AttackerSide == "" || event.VictimSide == "" || event.Weapon == "") {
			return false
		}
	}
	return true
}

func derefDamages(value *[]DamageEvent) []DamageEvent {
	if value == nil {
		return nil
	}
	return *value
}

func calculateRoundSwing(demo DemoData, steamID string) float64 {
	total := map[string]float64{}
	killsByRound := map[int][]KillEvent{}
	damagesByRound := map[int][]DamageEvent{}
	for _, kill := range demo.Kills {
		killsByRound[kill.RoundNumber] = append(killsByRound[kill.RoundNumber], kill)
	}
	for _, damage := range derefDamages(demo.Damages) {
		damagesByRound[damage.RoundNumber] = append(damagesByRound[damage.RoundNumber], damage)
	}
	for _, round := range demo.Rounds {
		roundContribution := map[string]float64{}
		sideByID := map[string]string{}
		kills := killsByRound[round.RoundNumber]
		sort.SliceStable(kills, func(i, j int) bool { return kills[i].Tick < kills[j].Tick })
		tAlive, ctAlive := 5, 5
		tEco, ctEco := round.TeamEconomy["T"], round.TeamEconomy["CT"]
		for killIndex, kill := range kills {
			if kill.AttackerSteamID == "" || kill.VictimSteamID == "" || kill.AttackerSteamID == kill.VictimSteamID || strings.EqualFold(kill.AttackerSide, kill.VictimSide) {
				continue
			}
			planted := round.BombPlanted && round.BombPlantTick > 0 && kill.Tick >= round.BombPlantTick
			sideByID[kill.AttackerSteamID], sideByID[kill.VictimSteamID] = kill.AttackerSide, kill.VictimSide
			before := roundWinProbability(tAlive, ctAlive, tEco, ctEco, planted)
			if strings.EqualFold(kill.VictimSide, "T") {
				tAlive--
			} else {
				ctAlive--
			}
			after := roundWinProbability(tAlive, ctAlive, tEco, ctEco, planted)
			delta := math.Abs(after - before)
			credits := map[string]float64{}
			credits[kill.AttackerSteamID] += 0.30 * weaponEventWeight(kill.Weapon, kill.VictimWeapon, kill.AttackerSide, kill.AttackerArmor, kill.VictimArmor)
			damageTotal := 0.0
			damageCredits := map[string]float64{}
			for _, damage := range damagesByRound[round.RoundNumber] {
				if damage.VictimSteamID != kill.VictimSteamID || damage.Tick > kill.Tick || damage.AttackerSteamID == "" || strings.EqualFold(damage.AttackerSide, damage.VictimSide) {
					continue
				}
				weighted := float64(damage.Damage) * weaponEventWeight(damage.Weapon, damage.VictimWeapon, damage.AttackerSide, damage.AttackerArmor, damage.VictimArmor)
				damageCredits[damage.AttackerSteamID] += weighted
				damageTotal += weighted
			}
			if damageTotal > 0 {
				for id, value := range damageCredits {
					credits[id] += 0.50 * value / damageTotal
				}
			}
			if kill.AssistedFlash && kill.AssisterSteamID != "" {
				credits[kill.AssisterSteamID] += 0.10
			}
			if isTradeKill(kills, killIndex) {
				credits[kill.AttackerSteamID] += 0.10
			}
			creditTotal := 0.0
			for _, value := range credits {
				creditTotal += value
			}
			if creditTotal == 0 {
				credits[kill.AttackerSteamID], creditTotal = 1, 1
			}
			for id, value := range credits {
				share := delta * value / creditTotal
				total[id] += share
				roundContribution[id] += share
			}
			total[kill.VictimSteamID] -= delta
			roundContribution[kill.VictimSteamID] -= delta
		}
		finalProbability := roundWinProbability(tAlive, ctAlive, tEco, ctEco, round.BombPlanted)
		target := 0.0
		if strings.EqualFold(round.WinnerSide, "T") {
			target = 1
		}
		allocateRoundResidual(total, roundContribution, sideByID, demo.Survivals, round, math.Abs(target-finalProbability))
	}
	if len(demo.Rounds) == 0 {
		return 0
	}
	return total[steamID] / float64(len(demo.Rounds)) * 100
}

func allocateRoundResidual(total, contribution map[string]float64, sideByID map[string]string, survivals []SurvivalState, round RoundData, residual float64) {
	if residual <= 0 || round.WinnerSide == "" {
		return
	}
	winnerWeights, loserWeights := map[string]float64{}, map[string]float64{}
	for id, value := range contribution {
		if value > 0 && strings.EqualFold(sideByID[id], round.WinnerSide) {
			winnerWeights[id] += 2
		}
	}
	winnerSurvivors := 0
	for _, state := range survivals {
		if state.RoundNumber != round.RoundNumber || !state.Survived {
			continue
		}
		if sideByID[state.SteamID] == "" {
			sideByID[state.SteamID] = state.Side
		}
		if strings.EqualFold(sideByID[state.SteamID], round.WinnerSide) {
			winnerWeights[state.SteamID]++
			winnerSurvivors++
		} else if sideByID[state.SteamID] != "" {
			loserWeights[state.SteamID]++
		}
	}
	if winnerSurvivors == 1 {
		for id := range winnerWeights {
			if hasSurvival(survivals, round.RoundNumber, id) {
				winnerWeights[id]++
			}
		}
	}
	for _, id := range []string{round.BombPlanterID, round.BombDefuserID} {
		if id != "" && strings.EqualFold(sideByID[id], round.WinnerSide) {
			winnerWeights[id]++
		}
	}
	if len(winnerWeights) == 0 || len(loserWeights) == 0 {
		return
	}
	distributeResidual(total, winnerWeights, residual)
	distributeResidual(total, loserWeights, -residual)
}

func hasSurvival(states []SurvivalState, roundNumber int, steamID string) bool {
	for _, state := range states {
		if state.RoundNumber == roundNumber && state.SteamID == steamID && state.Survived {
			return true
		}
	}
	return false
}

func distributeResidual(total, weights map[string]float64, amount float64) {
	sum := 0.0
	for _, weight := range weights {
		sum += weight
	}
	for id, weight := range weights {
		total[id] += amount * weight / sum
	}
}

func isTradeKill(kills []KillEvent, index int) bool {
	current := kills[index]
	for previousIndex := index - 1; previousIndex >= 0; previousIndex-- {
		previous := kills[previousIndex]
		if current.Tick-previous.Tick > 5*64 {
			break
		}
		if previous.AttackerSteamID == current.VictimSteamID && strings.EqualFold(previous.VictimSide, current.AttackerSide) {
			return true
		}
	}
	return false
}

func roundWinProbability(tAlive, ctAlive, tEconomy, ctEconomy int, planted bool) float64 {
	if tAlive <= 0 {
		return 0
	}
	if ctAlive <= 0 {
		return 1
	}
	bomb := 0.0
	if planted {
		bomb = 1
	}
	base := math.Log(0.48 / 0.52)
	return clamp(sigmoid(base+rating3AliveCoefficient*float64(tAlive-ctAlive)+rating3EconomyCoefficient*float64(tEconomy-ctEconomy)+rating3BombCoefficient*bomb), 0.01, 0.99)
}

func sigmoid(value float64) float64 { return 1 / (1 + math.Exp(-value)) }
func clamp(value, minimum, maximum float64) float64 {
	return math.Min(maximum, math.Max(minimum, value))
}
