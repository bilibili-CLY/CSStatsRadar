using System.Text.Json.Serialization;

namespace Radar.Domain.Models;

public class Player
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
}

public class RoundData
{
    [JsonPropertyName("round_number")] public int RoundNumber { get; set; }
    [JsonPropertyName("start_tick")] public int StartTick { get; set; }
    [JsonPropertyName("freeze_end_tick")] public int FreezeEndTick { get; set; }
    [JsonPropertyName("end_tick")] public int EndTick { get; set; }
    [JsonPropertyName("winner_side")] public string WinnerSide { get; set; } = "";
    [JsonPropertyName("bomb_planted")] public bool BombPlanted { get; set; }
    [JsonPropertyName("bomb_plant_tick")] public int BombPlantTick { get; set; }
    [JsonPropertyName("bomb_planter_id")] public string BombPlanterID { get; set; } = "";
    [JsonPropertyName("bomb_defuser_id")] public string BombDefuserID { get; set; } = "";
    [JsonPropertyName("team_economy")] public Dictionary<string, int>? TeamEconomy { get; set; }
}

public class KillEvent
{
    [JsonPropertyName("round_number")] public int RoundNumber { get; set; }
    [JsonPropertyName("tick")] public int Tick { get; set; }
    [JsonPropertyName("attacker_steam_id")] public string AttackerSteamID { get; set; } = "";
    [JsonPropertyName("victim_steam_id")] public string VictimSteamID { get; set; } = "";
    [JsonPropertyName("assister_steam_id")] public string AssisterSteamID { get; set; } = "";
    [JsonPropertyName("traded_player_steam_id")] public string TradedPlayerSteamID { get; set; } = "";
    [JsonPropertyName("attacker_side")] public string AttackerSide { get; set; } = "";
    [JsonPropertyName("victim_side")] public string VictimSide { get; set; } = "";
    [JsonPropertyName("weapon")] public string Weapon { get; set; } = "";
    [JsonPropertyName("victim_weapon")] public string VictimWeapon { get; set; } = "";
    [JsonPropertyName("attacker_armor")] public bool AttackerArmor { get; set; }
    [JsonPropertyName("victim_armor")] public bool VictimArmor { get; set; }
    [JsonPropertyName("attacker_equipment")] public int AttackerEquipment { get; set; }
    [JsonPropertyName("victim_equipment")] public int VictimEquipment { get; set; }
    [JsonPropertyName("assisted_flash")] public bool AssistedFlash { get; set; }
}

public class DamageEvent
{
    [JsonPropertyName("round_number")] public int RoundNumber { get; set; }
    [JsonPropertyName("tick")] public int Tick { get; set; }
    [JsonPropertyName("attacker_steam_id")] public string AttackerSteamID { get; set; } = "";
    [JsonPropertyName("victim_steam_id")] public string VictimSteamID { get; set; } = "";
    [JsonPropertyName("damage")] public int Damage { get; set; }
    [JsonPropertyName("attacker_side")] public string AttackerSide { get; set; } = "";
    [JsonPropertyName("victim_side")] public string VictimSide { get; set; } = "";
    [JsonPropertyName("weapon")] public string Weapon { get; set; } = "";
    [JsonPropertyName("victim_weapon")] public string VictimWeapon { get; set; } = "";
    [JsonPropertyName("attacker_armor")] public bool AttackerArmor { get; set; }
    [JsonPropertyName("victim_armor")] public bool VictimArmor { get; set; }
    [JsonPropertyName("attacker_equipment")] public int AttackerEquipment { get; set; }
    [JsonPropertyName("victim_equipment")] public int VictimEquipment { get; set; }
}

public class SurvivalState
{
    [JsonPropertyName("round_number")] public int RoundNumber { get; set; }
    [JsonPropertyName("steam_id")] public string SteamID { get; set; } = "";
    [JsonPropertyName("survived")] public bool Survived { get; set; }
    [JsonPropertyName("side")] public string Side { get; set; } = "";
}

public class DemoMeta
{
    [JsonPropertyName("match_time")] public DateTimeOffset? MatchTime { get; set; }
    [JsonPropertyName("map_name")] public string MapName { get; set; } = "";
    [JsonPropertyName("server_name")] public string ServerName { get; set; } = "";
    [JsonIgnore] public string FileSHA256 { get; set; } = "";
}

public class DemoData
{
    [JsonPropertyName("players")] public List<Player> Players { get; set; } = new();
    [JsonPropertyName("rounds")] public List<RoundData> Rounds { get; set; } = new();
    [JsonPropertyName("kills")] public List<KillEvent> Kills { get; set; } = new();
    [JsonPropertyName("damages")] public List<DamageEvent>? Damages { get; set; }
    [JsonPropertyName("survivals")] public List<SurvivalState> Survivals { get; set; } = new();
    [JsonPropertyName("trade_data_available")] public bool TradeDataAvailable { get; set; }
    [JsonPropertyName("source")] public string Source { get; set; } = "";
    [JsonPropertyName("meta")] public DemoMeta Meta { get; set; } = new();
}
