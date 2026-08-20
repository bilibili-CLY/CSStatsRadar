using Radar.Domain.Models;

namespace Radar.Application;

public static class MetricOrder
{
    public static readonly string[] Values = { "KPR", "Surviving", "ADR", "KAST", "Impact", "Rating" };
    public static readonly string[] Rating3 = { "KPR", "Surviving", "ADR", "KAST", "Multi-Kill", "Rating" };
}

public class PlayerStatsCalculator
{
    public PlayerStatsResult Calculate(DemoData demo, Player player)
    {
        var totalRounds = demo.Rounds.Count;
        var steamID = player.SteamID;
        var kills = 0;
        var deaths = 0;
        var assists = 0;
        foreach (var evt in demo.Kills)
        {
            if (evt.AttackerSteamID == steamID && evt.VictimSteamID != steamID) kills++;
            if (evt.VictimSteamID == steamID) deaths++;
            if (evt.AssisterSteamID == steamID) assists++;
        }

        int? totalDamage = null;
        if (demo.Damages != null)
        {
            var sum = 0;
            foreach (var evt in demo.Damages)
                if (evt.AttackerSteamID == steamID && evt.Damage > 0) sum += evt.Damage;
            totalDamage = sum;
        }

        var survivedRounds = 0;
        foreach (var state in demo.Survivals)
            if (state.SteamID == steamID && state.Survived) survivedRounds++;

        var kastSet = new HashSet<int>();
        foreach (var kill in demo.Kills)
            if (kill.AttackerSteamID == steamID || kill.AssisterSteamID == steamID || kill.TradedPlayerSteamID == steamID)
                kastSet.Add(kill.RoundNumber);
        foreach (var state in demo.Survivals)
            if (state.SteamID == steamID && state.Survived) kastSet.Add(state.RoundNumber);

        var baseStats = new PlayerBaseStats
        {
            Rounds = totalRounds,
            Kills = kills,
            Deaths = deaths,
            Assists = assists,
            TotalDamage = totalDamage,
            SurvivedRounds = survivedRounds,
            KASTRounds = kastSet.Count,
        };
        var result = new PlayerStatsResult { Base = baseStats, Metrics = BuildMetrics(baseStats, demo.TradeDataAvailable) };
        var (r3metrics, swing, reason) = Rating3Calculator.Calculate(demo, player, baseStats);
        result.Rating3Metrics = r3metrics;
        result.RoundSwing = swing;
        result.Rating3Reason = reason;
        result.Rating3Available = r3metrics != null;
        return result;
    }

    public static Dictionary<string, RadarMetric> BuildMetrics(PlayerBaseStats baseStats, bool tradeDataAvailable)
    {
        if (baseStats.Rounds <= 0)
        {
            var metrics = new Dictionary<string, RadarMetric>();
            foreach (var name in MetricOrder.Values)
            {
                var displayType = "number";
                if (name == "Surviving" || name == "KAST") displayType = "percentage";
                metrics[name] = new RadarMetric
                {
                    Name = name,
                    Value = null,
                    DisplayType = displayType,
                    MaxValue = MaxValue(name),
                    MinValue = 0,
                    Status = "unavailable",
                    Reason = "Demo 中没有可统计回合。",
                };
            }
            return metrics;
        }

        var rounds = (double)baseStats.Rounds;
        var kpr = baseStats.Kills / rounds;
        var surviving = baseStats.SurvivedRounds / rounds;
        var kast = baseStats.KASTRounds / rounds;
        double? adr = baseStats.TotalDamage != null ? baseStats.TotalDamage.Value / rounds : null;
        var impact = 2.13 * kpr + 0.42 * (baseStats.Assists / rounds) - 0.41;
        var adrValue = adr ?? 0.0;
        var rating = 0.0073 * kast * 100 + 0.3591 * kpr - 0.5329 * (baseStats.Deaths / rounds) + 0.2372 * impact + 0.0032 * adrValue + 0.1587;

        var result = new Dictionary<string, RadarMetric>
        {
            ["KPR"] = OkMetric("KPR", kpr, "number", ""),
            ["Surviving"] = OkMetric("Surviving", surviving, "percentage", ""),
            ["KAST"] = OkMetric("KAST", kast, "percentage", ""),
            ["Impact"] = OkMetric("Impact", impact, "number", "本地自制影响力算法第一版。"),
            ["Rating"] = OkMetric("Rating", rating, "number", "本地自制综合评分算法第一版。"),
        };
        if (adr == null)
            result["ADR"] = new RadarMetric { Name = "ADR", DisplayType = "number", MaxValue = 70, MinValue = 0, Status = "unavailable", Reason = "伤害事件数据缺失。" };
        else
            result["ADR"] = OkMetric("ADR", adr.Value, "number", "");
        if (!tradeDataAvailable)
        {
            var metric = result["KAST"];
            metric.Status = "approximate";
            metric.Reason = "Trade 数据不足，KAST 使用击杀/助攻/存活近似。";
            result["KAST"] = metric;
        }
        return result;
    }

    public static RadarMetric OkMetric(string name, double value, string displayType, string note)
    {
        var rounded = Round3(Math.Max(0, value));
        return new RadarMetric
        {
            Name = name,
            Value = rounded,
            DisplayType = displayType,
            MaxValue = MaxValue(name),
            MinValue = 0,
            Status = "ok",
            Note = note,
        };
    }

    public static double MaxValue(string name) => name switch
    {
        "KPR" => 1,
        "Surviving" => 0.6,
        "ADR" => 100,
        "KAST" => 0.7,
        "Impact" => 2,
        "Multi-Kill" => 0.2,
        "Rating" => 1.5,
        _ => 1,
    };

    public static double Round3(double value) => Math.Round(value * 1000) / 1000;
}
