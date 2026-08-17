using DemoFile;
using DemoFile.Game.Cs;
using Radar.Domain.Models;

namespace Radar.Parser;

public class DemoFileDataBuilder
{
    public DemoMeta Meta { get; } = new();

    private int _currentRound;
    private readonly Dictionary<string, Player> _players = new();
    private readonly List<RoundData> _rounds = new();
    private readonly List<KillEvent> _kills = new();
    private readonly List<DamageEvent> _damages = new();
    private readonly List<SurvivalState> _survivals = new();

    public void OnRoundStart(CsDemoParser demo)
    {
        if (demo.GameRules.WarmupPeriod) return;
        _currentRound++;
        _rounds.Add(new RoundData
        {
            RoundNumber = _currentRound,
            StartTick = CurrentTick(demo),
        });
        CollectPlayers(demo, DemoPlayers(demo));
        CaptureRoundEconomy(demo);
    }

    public void OnRoundFreezeEnd(CsDemoParser demo)
    {
        if (demo.GameRules.WarmupPeriod) return;
        EnsureMidRoundStarted(demo);
        CollectPlayers(demo, DemoPlayers(demo));
        if (_rounds.Count > 0)
            _rounds[^1].FreezeEndTick = CurrentTick(demo);
    }

    public void OnKill(CsDemoParser demo, Source1PlayerDeathEvent e)
    {
        if (demo.GameRules.WarmupPeriod || _currentRound == 0) return;
        var roundNumber = _currentRound;
        var killer = PlayerID(e.Attacker);
        var victim = PlayerID(e.Player);
        var assister = PlayerID(e.Assister);
        var killerSide = PlayerSide(e.Attacker);
        var victimSide = PlayerSide(e.Player);
        if (string.IsNullOrEmpty(killer) || string.IsNullOrEmpty(victim) || killer == victim ||
            (!string.IsNullOrEmpty(killerSide) && killerSide == victimSide))
            return;

        CollectPlayer(e.Attacker);
        CollectPlayer(e.Player);
        CollectPlayer(e.Assister);

        var kill = new KillEvent
        {
            RoundNumber = roundNumber,
            Tick = CurrentTick(demo),
            AttackerSteamID = killer,
            VictimSteamID = victim,
            AssisterSteamID = assister,
            AttackerSide = PlayerSide(e.Attacker),
            VictimSide = PlayerSide(e.Player),
            Weapon = MapEquipmentName(e.Weapon),
            VictimWeapon = ActiveWeaponName(demo, e.Player),
            AttackerArmor = PlayerArmor(demo, e.Attacker),
            VictimArmor = PlayerArmor(demo, e.Player),
            AttackerEquipment = PlayerEquipment(demo, e.Attacker),
            VictimEquipment = PlayerEquipment(demo, e.Player),
            AssistedFlash = e.Assistedflash,
        };

        for (var index = _kills.Count - 1; index >= 0; index--)
        {
            var previous = _kills[index];
            if (previous.RoundNumber != roundNumber || kill.Tick - previous.Tick > 5 * 64) break;
            if (previous.AttackerSteamID == kill.VictimSteamID &&
                string.Equals(previous.VictimSide, kill.AttackerSide, StringComparison.OrdinalIgnoreCase))
            {
                kill.TradedPlayerSteamID = previous.VictimSteamID;
                break;
            }
        }
        _kills.Add(kill);
    }

    public void OnDamage(CsDemoParser demo, Source1PlayerHurtEvent e)
    {
        if (demo.GameRules.WarmupPeriod || _currentRound == 0) return;
        var roundNumber = _currentRound;
        var attacker = PlayerID(e.Attacker);
        var victim = PlayerID(e.Player);
        if (string.IsNullOrEmpty(attacker) || string.IsNullOrEmpty(victim) || e.DmgHealth <= 0) return;
        var attackerSide = PlayerSide(e.Attacker);
        var victimSide = PlayerSide(e.Player);
        if (attacker == victim || (!string.IsNullOrEmpty(attackerSide) && attackerSide == victimSide)) return;

        CollectPlayer(e.Attacker);
        CollectPlayer(e.Player);
        _damages.Add(new DamageEvent
        {
            RoundNumber = roundNumber,
            Tick = CurrentTick(demo),
            AttackerSteamID = attacker,
            VictimSteamID = victim,
            Damage = e.DmgHealth,
            AttackerSide = attackerSide,
            VictimSide = victimSide,
            Weapon = MapEquipmentName(e.Weapon),
            VictimWeapon = ActiveWeaponName(demo, e.Player),
            AttackerArmor = PlayerArmor(demo, e.Attacker),
            VictimArmor = PlayerArmor(demo, e.Player),
            AttackerEquipment = PlayerEquipment(demo, e.Attacker),
            VictimEquipment = PlayerEquipment(demo, e.Player),
        });
    }

    public void OnBombPlanted(CsDemoParser demo, Source1BombPlantedEvent e)
    {
        if (_rounds.Count == 0) return;
        _rounds[^1].BombPlanted = true;
        _rounds[^1].BombPlantTick = CurrentTick(demo);
        _rounds[^1].BombPlanterID = PlayerID(e.Player);
    }

    public void OnBombDefused(CsDemoParser demo, Source1BombDefusedEvent e)
    {
        if (_rounds.Count == 0) return;
        _rounds[^1].BombDefuserID = PlayerID(e.Player);
    }

    public void OnRoundEnd(CsDemoParser demo, Source1RoundEndEvent e)
    {
        if (demo.GameRules.WarmupPeriod) return;
        var roundNumber = EnsureRound(demo);
        if (_rounds.Count > 0)
        {
            _rounds[^1].WinnerSide = TeamSide((CSTeamNumber)e.Winner);
            _rounds[^1].EndTick = CurrentTick(demo);
        }
        var playing = DemoPlayers(demo);
        CollectPlayers(demo, playing);
        foreach (var player in playing)
        {
            var id = PlayerID(player);
            if (string.IsNullOrEmpty(id)) continue;
            _survivals.Add(new SurvivalState
            {
                RoundNumber = roundNumber,
                SteamID = id,
                Survived = player.PawnIsAlive,
                Side = PlayerSide(player),
            });
        }
    }

    public void CollectRemaining(CsDemoParser demo)
    {
        CollectPlayers(demo, DemoPlayers(demo));
    }

    public void DiscardOpenRound()
    {
        if (_currentRound == 0 || _rounds.Count == 0) return;
        var roundNumber = _rounds[^1].RoundNumber;
        _rounds.RemoveAt(_rounds.Count - 1);
        _kills.RemoveAll(k => k.RoundNumber == roundNumber);
        _damages.RemoveAll(d => d.RoundNumber == roundNumber);
        _survivals.RemoveAll(s => s.RoundNumber == roundNumber);
    }

    public DemoData Data()
    {
        return new DemoData
        {
            Players = _players.Values.ToList(),
            Rounds = _rounds,
            Kills = _kills,
            Damages = _damages.Count > 0 ? _damages : null,
            Survivals = _survivals,
            TradeDataAvailable = true,
            Source = "demofile",
            Meta = Meta,
        };
    }

    private int EnsureRound(CsDemoParser demo)
    {
        if (_currentRound == 0) OnRoundStart(demo);
        return _currentRound;
    }

    private void EnsureMidRoundStarted(CsDemoParser demo)
    {
        if (_currentRound != 0) return;
        _currentRound++;
        _rounds.Add(new RoundData
        {
            RoundNumber = _currentRound,
            StartTick = 0,
        });
        CollectPlayers(demo, DemoPlayers(demo));
        CaptureRoundEconomy(demo);
    }

    private void CaptureRoundEconomy(CsDemoParser demo)
    {
        if (_rounds.Count == 0) return;
        _rounds[^1].TeamEconomy = new Dictionary<string, int>
        {
            ["T"] = TeamFreezeTimeEndEquipment(demo, CSTeamNumber.Terrorist),
            ["CT"] = TeamFreezeTimeEndEquipment(demo, CSTeamNumber.CounterTerrorist),
        };
    }

    private int TeamFreezeTimeEndEquipment(CsDemoParser demo, CSTeamNumber team)
    {
        var total = 0;
        foreach (var player in demo.Players)
        {
            if ((CSTeamNumber)player.TeamNum != team) continue;
            var pawn = player.PlayerPawnHandle.Get(demo);
            if (pawn == null) continue;
            total += pawn.FreezetimeEndEquipmentValue;
        }
        return total;
    }

    private int CurrentTick(CsDemoParser demo) => (int)demo.CurrentDemoTick.Value;

    private void CollectPlayer(CCSPlayerController? player)
    {
        var id = PlayerID(player);
        if (string.IsNullOrEmpty(id)) return;
        _players[id] = new Player { Name = player!.PlayerName, SteamID = id };
    }

    private void CollectPlayers(CsDemoParser demo, IEnumerable<CCSPlayerController> players)
    {
        foreach (var player in players) CollectPlayer(player);
    }

    private static string PlayerID(CCSPlayerController? player)
    {
        if (player == null || player.SteamID == 0) return "";
        return player.SteamID.ToString();
    }

    private static string PlayerSide(CCSPlayerController? player)
    {
        if (player == null) return "";
        return TeamSide((CSTeamNumber)player.TeamNum);
    }

    private static string TeamSide(CSTeamNumber team) => team switch
    {
        CSTeamNumber.Terrorist => "T",
        CSTeamNumber.CounterTerrorist => "CT",
        _ => "",
    };

    private static bool PlayerArmor(CsDemoParser demo, CCSPlayerController? player)
    {
        var pawn = player?.PlayerPawnHandle.Get(demo);
        return pawn != null && pawn.ArmorValue > 0;
    }

    private static int PlayerEquipment(CsDemoParser demo, CCSPlayerController? player)
    {
        var pawn = player?.PlayerPawnHandle.Get(demo);
        return pawn?.CurrentEquipmentValue ?? 0;
    }

    private static string ActiveWeaponName(CsDemoParser demo, CCSPlayerController? player)
    {
        var pawn = player?.PlayerPawnHandle.Get(demo);
        var weapon = pawn?.ActiveWeapon;
        if (weapon == null) return "";
        var defIndex = weapon.AttributeManager.Item.ItemDefinitionIndex;
        var name = DemoFile.GameStatic.GameItems.ItemDefinitions.GetValueOrDefault(defIndex)?.Name ?? "";
        return MapEquipmentName(name);
    }

    private static IEnumerable<CCSPlayerController> DemoPlayers(CsDemoParser demo)
    {
        foreach (var player in demo.Players)
        {
            if ((CSTeamNumber)player.TeamNum is CSTeamNumber.Terrorist or CSTeamNumber.CounterTerrorist)
                yield return player;
        }
    }

    internal static string MapEquipmentName(string weaponName)
    {
        if (string.IsNullOrEmpty(weaponName)) return "";
        var eqName = weaponName.StartsWith("weapon_", StringComparison.Ordinal)
            ? weaponName["weapon_".Length..]
            : weaponName;

        if (eqName.Contains("knife") || eqName.Contains("bayonet")) return "Knife";
        if (eqName.StartsWith("m4a1_silencer", StringComparison.Ordinal)) return "M4A1";
        if (eqName.StartsWith("vesthelm", StringComparison.Ordinal)) return "Kevlar + Helmet";

        foreach (var pair in EqNameToWeapon)
        {
            if (eqName.StartsWith(pair.Key, StringComparison.Ordinal) || eqName.EndsWith(pair.Key, StringComparison.Ordinal))
                return pair.Value;
        }
        return "UNKNOWN";
    }

    private static readonly Dictionary<string, string> EqNameToWeapon = new()
    {
        ["ak47"] = "AK-47",
        ["aug"] = "AUG",
        ["awp"] = "AWP",
        ["bizon"] = "PP-Bizon",
        ["c4"] = "C4",
        ["planted_c4"] = "C4",
        ["deagle"] = "Desert Eagle",
        ["decoy"] = "Decoy Grenade",
        ["decoygrenade"] = "Decoy Grenade",
        ["decoyprojectile"] = "Decoy Grenade",
        ["decoy_projectile"] = "Decoy Grenade",
        ["elite"] = "Dual Berettas",
        ["famas"] = "FAMAS",
        ["fiveseven"] = "Five-SeveN",
        ["flashbang"] = "Flashbang",
        ["g3sg1"] = "G3SG1",
        ["galil"] = "Galil AR",
        ["galilar"] = "Galil AR",
        ["glock"] = "Glock-18",
        ["hegrenade"] = "HE Grenade",
        ["hkp2000"] = "P2000",
        ["incgrenade"] = "Incendiary Grenade",
        ["incendiarygrenade"] = "Incendiary Grenade",
        ["inferno"] = "Incendiary Grenade",
        ["m249"] = "M249",
        ["m4a1"] = "M4A4",
        ["mac10"] = "MAC-10",
        ["mag7"] = "MAG-7",
        ["molotov"] = "Molotov",
        ["molotovgrenade"] = "Molotov",
        ["molotovprojectile"] = "Molotov",
        ["molotov_projectile"] = "Molotov",
        ["mp7"] = "MP7",
        ["mp5sd"] = "MP5-SD",
        ["mp9"] = "MP9",
        ["negev"] = "Negev",
        ["nova"] = "Nova",
        ["p250"] = "P250",
        ["p90"] = "P90",
        ["sawedoff"] = "Sawed-Off",
        ["scar20"] = "SCAR-20",
        ["sg556"] = "SG 553",
        ["smokegrenade"] = "Smoke Grenade",
        ["smokegrenadeprojectile"] = "Smoke Grenade",
        ["smokegrenade_projectile"] = "Smoke Grenade",
        ["ssg08"] = "SSG 08",
        ["taser"] = "Zeus x27",
        ["tec9"] = "Tec-9",
        ["ump45"] = "UMP-45",
        ["xm1014"] = "XM1014",
        ["m4a1_silencer"] = "M4A1",
        ["m4a1_silencer_off"] = "M4A1",
        ["cz75a"] = "CZ75 Auto",
        ["usp"] = "USP-S",
        ["usp_silencer"] = "USP-S",
        ["usp_silencer_off"] = "USP-S",
        ["revolver"] = "R8 Revolver",
        ["vest"] = "Kevlar Vest",
        ["vesthelm"] = "Kevlar + Helmet",
        ["defuser"] = "Defuse Kit",
        ["knife"] = "Knife",
    };
}
