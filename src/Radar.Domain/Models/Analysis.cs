using System.Text.Json.Serialization;

namespace Radar.Domain.Models;

public class PlayerBaseStats
{
    [JsonPropertyName("rounds")] public int Rounds { get; set; }
    [JsonPropertyName("kills")] public int Kills { get; set; }
    [JsonPropertyName("deaths")] public int Deaths { get; set; }
    [JsonPropertyName("assists")] public int Assists { get; set; }
    [JsonPropertyName("total_damage")] public int? TotalDamage { get; set; }
    [JsonPropertyName("survived_rounds")] public int SurvivedRounds { get; set; }
    [JsonPropertyName("kast_rounds")] public int KASTRounds { get; set; }
}

public class RadarMetric
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("value")] public double? Value { get; set; }
    [JsonPropertyName("display_type")] public string DisplayType { get; set; } = "number";
    [JsonPropertyName("max_value")] public double MaxValue { get; set; }
    [JsonPropertyName("min_value")] public double MinValue { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("reason")] public string Reason { get; set; } = "";
    [JsonPropertyName("note")] public string Note { get; set; } = "";
}

public class PlayerStatsResult
{
    [JsonPropertyName("base")] public PlayerBaseStats Base { get; set; } = new();
    [JsonPropertyName("metrics")] public Dictionary<string, RadarMetric> Metrics { get; set; } = new();
    [JsonPropertyName("rating_3_metrics")] public Dictionary<string, RadarMetric>? Rating3Metrics { get; set; }
    [JsonPropertyName("round_swing")] public double? RoundSwing { get; set; }
    [JsonPropertyName("rating_3_available")] public bool Rating3Available { get; set; }
    [JsonPropertyName("rating_3_reason")] public string Rating3Reason { get; set; } = "";
}

public class RadarPayload
{
    [JsonPropertyName("dimensions")] public List<string> Dimensions { get; set; } = new();
    [JsonPropertyName("values")] public List<double?> Values { get; set; } = new();
    [JsonPropertyName("display_types")] public List<string> DisplayTypes { get; set; } = new();
    [JsonPropertyName("max_values")] public List<double> MaxValues { get; set; } = new();
    [JsonPropertyName("min_values")] public List<double> MinValues { get; set; } = new();
    [JsonPropertyName("note")] public string Note { get; set; } = "";
    [JsonPropertyName("metrics")] public List<RadarMetric> Metrics { get; set; } = new();
    [JsonPropertyName("round_swing")] public double? RoundSwing { get; set; }
    [JsonPropertyName("algorithm_version")] public string AlgorithmVersion { get; set; } = "";
}

public class RatingProfiles
{
    [JsonPropertyName("rating_2")] public RadarPayload Rating2 { get; set; } = new();
    [JsonPropertyName("rating_3")] public RadarPayload? Rating3 { get; set; }
}

public class Rating3Status
{
    [JsonPropertyName("available")] public bool Available { get; set; }
    [JsonPropertyName("reason")] public string Reason { get; set; } = "";
}

public class RadarResponse
{
    [JsonPropertyName("player")] public Player Player { get; set; } = new();
    [JsonPropertyName("radar")] public RadarPayload Radar { get; set; } = new();
    [JsonPropertyName("profiles")] public RatingProfiles Profiles { get; set; } = new();
    [JsonPropertyName("rating_3_status")] public Rating3Status Rating3Status { get; set; } = new();
}

public class AggregateRadarResponse
{
    [JsonPropertyName("player")] public Player Player { get; set; } = new();
    [JsonPropertyName("match_count")] public int MatchCount { get; set; }
    [JsonPropertyName("radar")] public RadarPayload Radar { get; set; } = new();
    [JsonPropertyName("profiles")] public RatingProfiles Profiles { get; set; } = new();
    [JsonPropertyName("rating_3_status")] public Rating3Status Rating3Status { get; set; } = new();
}

public class WeaponMethodology
{
    [JsonPropertyName("id")] public string ID { get; set; } = "";
    [JsonPropertyName("label")] public string Label { get; set; } = "";
    [JsonPropertyName("strength")] public double Strength { get; set; }
    [JsonPropertyName("weapons")] public List<string> Weapons { get; set; } = new();
}

public class RatingMethodology
{
    [JsonPropertyName("algorithm_version")] public string AlgorithmVersion { get; set; } = "";
    [JsonPropertyName("rating_2_formula")] public string Rating2Formula { get; set; } = "";
    [JsonPropertyName("impact_formula")] public string ImpactFormula { get; set; } = "";
    [JsonPropertyName("rating_3_formula")] public string Rating3Formula { get; set; } = "";
    [JsonPropertyName("rating_3_base_formula")] public string Rating3BaseFormula { get; set; } = "";
    [JsonPropertyName("multi_kpr_formula")] public string MultiKPRFormula { get; set; } = "";
    [JsonPropertyName("multi_impact_formula")] public string MultiImpactFormula { get; set; } = "";
    [JsonPropertyName("swing_rating_formula")] public string SwingRatingFormula { get; set; } = "";
    [JsonPropertyName("swing_formula")] public string SwingFormula { get; set; } = "";
    [JsonPropertyName("win_probability_formula")] public string WinProbabilityFormula { get; set; } = "";
    [JsonPropertyName("weapon_weight_formula")] public string WeaponWeightFormula { get; set; } = "";
    [JsonPropertyName("sniper_damage_formula")] public string SniperDamageFormula { get; set; } = "";
    [JsonPropertyName("weapon_categories")] public List<WeaponMethodology> WeaponCategories { get; set; } = new();
    [JsonPropertyName("contribution_weights")] public Dictionary<string, double> ContributionWeights { get; set; } = new();
    [JsonPropertyName("constants")] public Dictionary<string, double> Constants { get; set; } = new();
    [JsonPropertyName("limitations")] public List<string> Limitations { get; set; } = new();
}

public class PlayerMatchRecord
{
    [JsonPropertyName("demo_record_id")] public string DemoRecordID { get; set; } = "";
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
    [JsonPropertyName("match_time")] public DateTimeOffset MatchTime { get; set; }
    [JsonPropertyName("match_time_source")] public string MatchTimeSource { get; set; } = "";
    [JsonPropertyName("imported_at")] public DateTimeOffset ImportedAt { get; set; }
    [JsonPropertyName("map_name")] public string MapName { get; set; } = "";
    [JsonPropertyName("file_name")] public string FileName { get; set; } = "";
    [JsonPropertyName("source_path")] public string SourcePath { get; set; } = "";
    [JsonPropertyName("tags")] public List<string> Tags { get; set; } = new();
    [JsonPropertyName("rounds")] public int Rounds { get; set; }
    [JsonPropertyName("kills")] public int Kills { get; set; }
    [JsonPropertyName("deaths")] public int Deaths { get; set; }
    [JsonPropertyName("assists")] public int Assists { get; set; }
    [JsonPropertyName("total_damage")] public int? TotalDamage { get; set; }
    [JsonPropertyName("adr")] public double? ADR { get; set; }
    [JsonPropertyName("kast")] public double? KAST { get; set; }
    [JsonPropertyName("impact")] public double? Impact { get; set; }
    [JsonPropertyName("rating")] public double? Rating { get; set; }
    [JsonPropertyName("rating_3")] public double? Rating3 { get; set; }
    [JsonPropertyName("round_swing")] public double? RoundSwing { get; set; }
    [JsonPropertyName("multi_kill")] public double? MultiKill { get; set; }
    [JsonPropertyName("rating_algorithm")] public string RatingAlgorithm { get; set; } = "";
    [JsonPropertyName("rating_3_metrics")] public List<RadarMetric> Rating3Metrics { get; set; } = new();
    [JsonPropertyName("metrics")] public List<RadarMetric> Metrics { get; set; } = new();
}
