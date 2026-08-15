package radar

import (
	"math"
	"testing"
)

func TestRating3WeaponCategoriesAndMatchupWeights(t *testing.T) {
	tests := map[string]string{"Glock-18": "starter_pistol", "Desert Eagle": "upgraded_pistol", "MP9": "smg_shotgun", "FAMAS": "tier2_rifle", "AK-47": "tier1_rifle", "AWP": "sniper"}
	for weapon, want := range tests {
		category, ok := categoryForWeapon(weapon)
		if !ok || category.ID != want {
			t.Fatalf("%s category = %q, %v; want %q", weapon, category.ID, ok, want)
		}
	}
	if got := weaponEventWeight("knife", "AWP", "T", false, true); got != 1.5 {
		t.Fatalf("special weapon weight = %v, want 1.5", got)
	}
	weak := weaponEventWeight("Glock-18", "AWP", "T", false, true)
	strong := weaponEventWeight("AWP", "Glock-18", "T", true, false)
	if weak <= strong || weak > 1.5 || strong < .5 {
		t.Fatalf("unexpected weak/strong weights: %v / %v", weak, strong)
	}
	if weaponDuelProbability("AK-47", "AK-47", "CT", true, true) <= weaponDuelProbability("AK-47", "AK-47", "T", true, true) {
		t.Fatal("CT side bias must increase duel probability")
	}
}

func TestRoundWinProbabilityMonotonicity(t *testing.T) {
	base := roundWinProbability(3, 3, 15000, 15000, false)
	if roundWinProbability(4, 3, 15000, 15000, false) <= base {
		t.Fatal("more T survivors must improve T probability")
	}
	if roundWinProbability(3, 3, 20000, 15000, false) <= base {
		t.Fatal("more T economy must improve T probability")
	}
	if roundWinProbability(3, 3, 15000, 15000, true) <= base {
		t.Fatal("bomb planted must improve T probability")
	}
}

func TestSwingKillIsZeroSum(t *testing.T) {
	demo := DemoData{
		Rounds: []RoundData{{RoundNumber: 1, WinnerSide: "T", TeamEconomy: map[string]int{"T": 15000, "CT": 15000}}},
		Kills:  []KillEvent{{RoundNumber: 1, Tick: 100, AttackerSteamID: "a", VictimSteamID: "b", AttackerSide: "T", VictimSide: "CT", Weapon: "AK-47", VictimWeapon: "M4A4"}},
	}
	if sum := calculateRoundSwing(demo, "a") + calculateRoundSwing(demo, "b"); math.Abs(sum) > 1e-9 {
		t.Fatalf("swing is not zero sum: %v", sum)
	}
}

func TestMethodologyUsesCalculationConstants(t *testing.T) {
	methodology := GetRatingMethodology()
	checks := map[string]float64{"side_bias_t": rating3SideBiasT, "side_bias_ct": rating3SideBiasCT, "weapon_beta": rating3WeaponBeta, "armor_bonus": rating3ArmorBonus, "alive_coefficient": rating3AliveCoefficient, "economy_coefficient": rating3EconomyCoefficient, "bomb_coefficient": rating3BombCoefficient}
	for key, want := range checks {
		if got := methodology.Constants[key]; got != want {
			t.Fatalf("methodology constant %s = %v, want %v", key, got, want)
		}
	}
	if methodology.AlgorithmVersion != Rating3AlgorithmVersion || len(methodology.WeaponCategories) != len(weaponCategories) {
		t.Fatal("methodology metadata drifted from calculation")
	}
}
