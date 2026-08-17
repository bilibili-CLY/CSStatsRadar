using System.Text.Json.Serialization;

namespace Radar.Domain.Models;

public class DemoTeam
{
    [JsonPropertyName("id")] public string ID { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("score")] public int Score { get; set; }
    [JsonPropertyName("players")] public List<Player> Players { get; set; } = new();
}

public class SwingEventContribution
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("value")] public double Value { get; set; }
}

public class SwingEvent
{
    [JsonPropertyName("id")] public string ID { get; set; } = "";
    [JsonPropertyName("round_number")] public int RoundNumber { get; set; }
    [JsonPropertyName("tick")] public int Tick { get; set; }
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("label")] public string Label { get; set; } = "";
    [JsonPropertyName("actor")] public string Actor { get; set; } = "";
    [JsonPropertyName("target")] public string Target { get; set; } = "";
    [JsonPropertyName("weapon")] public string Weapon { get; set; } = "";
    [JsonPropertyName("contribution")] public double Contribution { get; set; }
    [JsonPropertyName("breakdown")] public List<SwingEventContribution> Breakdown { get; set; } = new();
}

public class PlayerRoundMetric
{
    [JsonPropertyName("round_number")] public int RoundNumber { get; set; }
    [JsonPropertyName("won")] public bool Won { get; set; }
    [JsonPropertyName("score_a")] public int ScoreA { get; set; }
    [JsonPropertyName("score_b")] public int ScoreB { get; set; }
    [JsonPropertyName("kills")] public int Kills { get; set; }
    [JsonPropertyName("deaths")] public int Deaths { get; set; }
    [JsonPropertyName("assists")] public int Assists { get; set; }
    [JsonPropertyName("damage")] public int Damage { get; set; }
    [JsonPropertyName("kast")] public bool KAST { get; set; }
    [JsonPropertyName("cumulative_rating")] public double? CumulativeRating { get; set; }
    [JsonPropertyName("round_swing")] public double RoundSwing { get; set; }
    [JsonPropertyName("events")] public List<SwingEvent> Events { get; set; } = new();
}

public class DemoPlayerAnalysis
{
    [JsonPropertyName("player")] public Player Player { get; set; } = new();
    [JsonPropertyName("team_id")] public string TeamID { get; set; } = "";
    [JsonPropertyName("rounds")] public List<PlayerRoundMetric> Rounds { get; set; } = new();
}

public class DemoAnalysis
{
    [JsonPropertyName("demo_id")] public string DemoID { get; set; } = "";
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("map_name")] public string MapName { get; set; } = "";
    [JsonPropertyName("rounds")] public int Rounds { get; set; }
    [JsonPropertyName("teams")] public List<DemoTeam> Teams { get; set; } = new();
    [JsonPropertyName("players")] public List<DemoPlayerAnalysis> Players { get; set; } = new();
    [JsonPropertyName("generated_at")] public string GeneratedAt { get; set; } = "";
}
