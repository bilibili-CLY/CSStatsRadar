using System.Text.Json;
using System.Text.Json.Serialization;
using Radar.Application;
using Radar.Domain.Models;
using Xunit;

namespace Radar.Tests;

public class StatsParityTests
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
    };

    private static string TestDataPath(string name) => Path.Combine(AppContext.BaseDirectory, "TestData", name);

    private static DemoData LoadDemo(string name)
    {
        var json = File.ReadAllText(TestDataPath(name));
        return JsonSerializer.Deserialize<DemoData>(json, JsonOpts)!;
    }

    [Fact]
    public void G163_Stats_MatchGolden()
    {
        var demo = LoadDemo("legacy_g163.json");
        var golden = JsonSerializer.Deserialize<List<GoldenPlayerStats>>(File.ReadAllText(TestDataPath("golden_stats_g163.json")), JsonOpts)!;
        var calculator = new PlayerStatsCalculator();
        Assert.Equal(golden.Count, demo.Players.Count);
        foreach (var g in golden)
        {
            var player = demo.Players.First(p => p.SteamID == g.SteamID);
            var result = calculator.Calculate(demo, player);
            AssertBase(g.Base, result.Base);
            AssertMetricMap(g.Metrics, result.Metrics);
            AssertMetricMap(g.Rating3Metrics, result.Rating3Metrics);
            Assert.Equal(g.Rating3Available, result.Rating3Available);
            if (g.RoundSwing != null)
            {
                Assert.NotNull(result.RoundSwing);
                Assert.InRange(Math.Abs(g.RoundSwing.Value - result.RoundSwing!.Value), 0, 0.01);
            }
        }
    }

    [Fact]
    public void PerfectWorld_Stats_MatchGolden()
    {
        var demo = LoadDemo("legacy_pw.json");
        var golden = JsonSerializer.Deserialize<List<GoldenPlayerStats>>(File.ReadAllText(TestDataPath("golden_stats_pw.json")), JsonOpts)!;
        var calculator = new PlayerStatsCalculator();
        Assert.Equal(golden.Count, demo.Players.Count);
        foreach (var g in golden)
        {
            var player = demo.Players.First(p => p.SteamID == g.SteamID);
            var result = calculator.Calculate(demo, player);
            AssertBase(g.Base, result.Base);
            AssertMetricMap(g.Metrics, result.Metrics);
            AssertMetricMap(g.Rating3Metrics, result.Rating3Metrics);
            Assert.Equal(g.Rating3Available, result.Rating3Available);
            if (g.RoundSwing != null)
            {
                Assert.NotNull(result.RoundSwing);
                Assert.InRange(Math.Abs(g.RoundSwing.Value - result.RoundSwing!.Value), 0, 0.01);
            }
        }
    }

    private static void AssertBase(PlayerBaseStats expected, PlayerBaseStats actual)
    {
        Assert.Equal(expected.Rounds, actual.Rounds);
        Assert.Equal(expected.Kills, actual.Kills);
        Assert.Equal(expected.Deaths, actual.Deaths);
        Assert.Equal(expected.Assists, actual.Assists);
        Assert.Equal(expected.TotalDamage, actual.TotalDamage);
        Assert.Equal(expected.SurvivedRounds, actual.SurvivedRounds);
        Assert.Equal(expected.KASTRounds, actual.KASTRounds);
    }

    private static void AssertMetricMap(Dictionary<string, GoldenMetric>? expected, Dictionary<string, RadarMetric>? actual)
    {
        if (expected == null) { Assert.Null(actual); return; }
        Assert.NotNull(actual);
        Assert.Equal(expected.Count, actual!.Count);
        foreach (var kv in expected)
        {
            Assert.True(actual.ContainsKey(kv.Key), $"missing metric {kv.Key}");
            var m = actual[kv.Key];
            Assert.Equal(kv.Value.Status, m.Status);
            Assert.Equal(kv.Value.DisplayType, m.DisplayType);
            if (kv.Value.Value != null)
            {
                Assert.NotNull(m.Value);
                Assert.InRange(Math.Abs(kv.Value.Value.Value - m.Value!.Value), 0, 0.0011);
            }
        }
    }
}

public class GoldenPlayerStats
{
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("base")] public PlayerBaseStats Base { get; set; } = new();
    [JsonPropertyName("metrics")] public Dictionary<string, GoldenMetric>? Metrics { get; set; }
    [JsonPropertyName("rating_3_metrics")] public Dictionary<string, GoldenMetric>? Rating3Metrics { get; set; }
    [JsonPropertyName("round_swing")] public double? RoundSwing { get; set; }
    [JsonPropertyName("rating_3_available")] public bool Rating3Available { get; set; }
    [JsonPropertyName("rating_3_reason")] public string Rating3Reason { get; set; } = "";
}

public class GoldenMetric
{
    [JsonPropertyName("value")] public double? Value { get; set; }
    [JsonPropertyName("display_type")] public string DisplayType { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
}