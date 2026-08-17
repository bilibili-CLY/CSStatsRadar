using Radar.Domain.Models;

namespace Radar.Application;

public static class Rating3Calculator
{
    public static (Dictionary<string, RadarMetric>?, double?, string) Calculate(DemoData demo, Player player, PlayerBaseStats baseStats)
    {
        if (!EnhancedRatingDataAvailable(demo))
            return (null, null, "Demo 缺少 Rating 3.0 所需的阵营、回合胜方或事件时序。");

        var rounds = (double)baseStats.Rounds;
        double weightedKills = 0, weightedDeaths = 0, weightedDamage = 0, weightedAssists = 0;
        double extraMulti = 0;
        var killsByRound = new Dictionary<int, int>();
        foreach (var evt in demo.Kills)
        {
            if (evt.AttackerSteamID == "" || evt.VictimSteamID == "" || evt.AttackerSteamID == evt.VictimSteamID || Rating3.SameSide(evt.AttackerSide, evt.VictimSide)) continue;
            var weight = Rating3.WeaponEventWeight(evt.Weapon, evt.VictimWeapon, evt.AttackerSide, evt.AttackerArmor, evt.VictimArmor);
            if (evt.AttackerSteamID == player.SteamID)
            {
                weightedKills += weight;
                killsByRound[evt.RoundNumber] = killsByRound.GetValueOrDefault(evt.RoundNumber) + 1;
            }
            if (evt.VictimSteamID == player.SteamID) weightedDeaths += weight;
            if (evt.AssisterSteamID == player.SteamID) weightedAssists += weight;
        }
        foreach (var kv in killsByRound)
            if (kv.Value > 1) extraMulti += kv.Value - 1;

        if (demo.Damages != null)
            foreach (var evt in demo.Damages)
            {
                if (evt.AttackerSteamID != player.SteamID || evt.Damage <= 0 || evt.AttackerSteamID == evt.VictimSteamID || Rating3.SameSide(evt.AttackerSide, evt.VictimSide)) continue;
                var weight = Rating3.WeaponEventWeight(evt.Weapon, evt.VictimWeapon, evt.AttackerSide, evt.AttackerArmor, evt.VictimArmor);
                var (cat, ok) = Rating3.CategoryForWeapon(evt.Weapon);
                if (ok && cat.ID == "sniper") weight = 0.75 * weight + 0.25;
                weightedDamage += evt.Damage * weight;
            }

        var eKPR = weightedKills / rounds;
        var eDPR = weightedDeaths / rounds;
        var eADR = weightedDamage / rounds;
        var eAPR = weightedAssists / rounds;
        var eKAST = EconomicKAST(demo, player.SteamID) / rounds;
        var multiKPR = eKPR + 0.25 * extraMulti / rounds;
        var multiImpact = 2.13 * multiKPR + 0.42 * eAPR - 0.41;
        var swing = SwingCalculator.CalculateRoundSwing(demo, player.SteamID);
        var swingRating = Rating3.Clamp(1 + swing / 4, 0, 2.5);
        var base3 = 0.0073 * eKAST * 100 + 0.3591 * eKPR - 0.5329 * eDPR + 0.2372 * multiImpact + 0.0032 * eADR + 0.1587;
        var rating3 = Rating3.Round3(Math.Max(0, 0.92 * base3 + 0.08 * swingRating));
        var multiRating = Rating3.Round3(Math.Max(0, multiImpact));
        swing = Math.Round(swing * 100) / 100;

        var metrics = new Dictionary<string, RadarMetric>
        {
            ["KPR"] = PlayerStatsCalculator.OkMetric("KPR", eKPR, "number", "已按枪械对位修正。"),
            ["Surviving"] = PlayerStatsCalculator.OkMetric("Surviving", baseStats.SurvivedRounds / rounds, "percentage", ""),
            ["ADR"] = PlayerStatsCalculator.OkMetric("ADR", eADR, "number", "已按枪械对位修正。"),
            ["KAST"] = PlayerStatsCalculator.OkMetric("KAST", eKAST, "percentage", ""),
            ["Multi-Kill"] = PlayerStatsCalculator.OkMetric("Multi-Kill", multiRating, "number", "经济修正后的多杀子评分。"),
            ["Rating"] = PlayerStatsCalculator.OkMetric("Rating", rating3, "number", "Rating 3.0 本地近似。"),
        };
        return (metrics, swing, "");
    }

    public static double EconomicKAST(DemoData demo, string steamID)
    {
        var credits = new Dictionary<int, double>();
        foreach (var evt in demo.Kills)
        {
            if (evt.AttackerSteamID == "" || evt.VictimSteamID == "" || evt.AttackerSteamID == evt.VictimSteamID || Rating3.SameSide(evt.AttackerSide, evt.VictimSide)) continue;
            var weight = Rating3.WeaponEventWeight(evt.Weapon, evt.VictimWeapon, evt.AttackerSide, evt.AttackerArmor, evt.VictimArmor);
            if (evt.AttackerSteamID == steamID || evt.AssisterSteamID == steamID)
                credits[evt.RoundNumber] = Math.Max(credits.GetValueOrDefault(evt.RoundNumber), weight);
            if (evt.TradedPlayerSteamID == steamID)
                credits[evt.RoundNumber] = Math.Max(credits.GetValueOrDefault(evt.RoundNumber), 1);
        }
        foreach (var state in demo.Survivals)
            if (state.SteamID == steamID && state.Survived)
                credits[state.RoundNumber] = Math.Max(credits.GetValueOrDefault(state.RoundNumber), 1);
        var total = 0.0;
        foreach (var credit in credits.Values)
            total += Rating3.Clamp(credit, 0.5, 1.5);
        return total;
    }

    public static bool EnhancedRatingDataAvailable(DemoData demo)
    {
        var hasRoundContext = false;
        foreach (var round in demo.Rounds)
            if (round.WinnerSide != "" && round.TeamEconomy != null) { hasRoundContext = true; break; }
        if (!hasRoundContext || demo.Damages == null) return false;
        foreach (var evt in demo.Kills)
            if (evt.AttackerSteamID != "" && (evt.Tick <= 0 || evt.AttackerSide == "" || evt.VictimSide == "" || evt.Weapon == ""))
                return false;
        return true;
    }
}
