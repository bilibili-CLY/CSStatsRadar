using Cs2Demo.Analytics;
using Radar.Domain.Models;

namespace Radar.Parser;

/// <summary>
/// 将包的 MatchData（csda 口径）映射为项目通用的 DemoData。
/// 包不含的字段（受害者武器/护甲、伤害事件 tick、投弹人、冻结结束 tick、ServerName）以默认值填充；
/// KillEvent 的装备值为回合开始总额（非事件时点快照），保留原字段但语义不同。
/// 注意：包的 KillEvent 含空 attacker 的 C4/世界死亡事件，映射 DemoData 时剔除以保持
/// 本地逐轮统计与旧解析器口径一致（match 级统计仍完全使用包的 Csda 数据）。
/// </summary>
public static class MatchDataMapper
{
    private const int TradeWindowTicks = 5 * 64;

    public static DemoData Map(MatchData match, string? teamTags = null)
    {
        var tags = TeamPrefix.ParseTags(teamTags);
        var cluster = TeamPrefix.ClusterPrefixes(match);
        var playerByID = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var p in match.Players)
        {
            var steamID = p.SteamId.Trim();
            if (steamID == "") continue;
            var name = p.Name.Trim();
            if (TeamPrefix.TryStrip(name, cluster, tags, out var stripped)) name = stripped;
            playerByID.TryAdd(steamID, name);
        }

        var players = playerByID
            .OrderBy(kv => kv.Key, StringComparer.Ordinal)
            .Select(kv => new Player { Name = kv.Value, SteamID = kv.Key })
            .ToList();

        var rounds = match.Rounds.Select(r => new RoundData
        {
            RoundNumber = r.RoundNumber,
            StartTick = r.StartTick,
            FreezeEndTick = 0,
            EndTick = r.EndTick,
            WinnerSide = r.WinnerSide ?? "",
            BombPlanted = r.BombPlantedTick > 0,
            BombPlantTick = r.BombPlantedTick,
            BombPlanterID = "",
            BombDefuserID = r.DefuserSteamId ?? "",
            TeamEconomy = new Dictionary<string, int>(StringComparer.Ordinal)
            {
                ["T"] = r.TEquipmentValue,
                ["CT"] = r.CTEquipmentValue,
            },
        }).ToList();

        var kills = match.Kills
            .Where(k => k.AttackerSteamId != "")
            .Select(k => new Radar.Domain.Models.KillEvent
            {
                RoundNumber = k.RoundNumber,
                Tick = k.Tick,
                AttackerSteamID = k.AttackerSteamId,
                VictimSteamID = k.VictimSteamId,
                AssisterSteamID = k.AssisterSteamId,
                AttackerSide = k.AttackerSide ?? "",
                VictimSide = k.VictimSide ?? "",
                Weapon = k.Weapon ?? "",
                VictimWeapon = "",
                AttackerArmor = false,
                VictimArmor = false,
                AttackerEquipment = k.KillerEquipmentValue,
                VictimEquipment = k.VictimEquipmentValue,
                AssistedFlash = k.IsAssistedFlash,
            })
            .OrderBy(k => k.Tick)
            .ToList();

        ApplyTradeCredits(kills);

        var damages = match.Damages
            .Where(d => d.AttackerSteamId != "" && d.VictimSteamId != "" && d.Damage > 0)
            .Select(d => new Radar.Domain.Models.DamageEvent
            {
                RoundNumber = d.RoundNumber,
                Tick = 0,
                AttackerSteamID = d.AttackerSteamId,
                VictimSteamID = d.VictimSteamId,
                AttackerSide = d.AttackerSide ?? "",
                VictimSide = d.VictimSide ?? "",
                Weapon = d.Weapon ?? "",
                VictimWeapon = "",
                Damage = d.Damage,
                AttackerArmor = false,
                VictimArmor = false,
                AttackerEquipment = 0,
                VictimEquipment = 0,
            })
            .OrderBy(d => d.RoundNumber)
            .ToList();

        var survivals = match.Survivals.Select(s => new SurvivalState
        {
            RoundNumber = s.RoundNumber,
            SteamID = s.SteamId,
            Survived = s.Survived,
            Side = s.Side ?? "",
        }).ToList();

        return new DemoData
        {
            Players = players,
            Rounds = rounds,
            Kills = kills,
            Damages = damages.Count > 0 ? damages : null,
            Survivals = survivals,
            TradeDataAvailable = true,
            Source = "csda",
            Meta = new DemoMeta
            {
                MatchTime = null,
                MapName = match.Meta.MapName ?? "",
                ServerName = "",
                FileSHA256 = match.Meta.FileSha256 ?? "",
            },
        };
    }

    /// <summary>
    /// 复刻旧解析器的 trade 规则：≤5 秒（5·64 tick）内、前一个击杀的攻击者即本次受害者（复仇对象），
    /// 且前一个受害者阵营 == 本次攻击者阵营，则本次击杀为 traded 击杀。
    /// </summary>
    private static void ApplyTradeCredits(List<Radar.Domain.Models.KillEvent> kills)
    {
        for (var i = 1; i < kills.Count; i++)
        {
            var kill = kills[i];
            if (kill.AttackerSteamID == "" || kill.VictimSteamID == "") continue;
            if (string.Equals(kill.AttackerSide, kill.VictimSide, StringComparison.OrdinalIgnoreCase)) continue;

            for (var j = i - 1; j >= 0; j--)
            {
                var prev = kills[j];
                if (kill.Tick - prev.Tick > TradeWindowTicks) break;
                if (prev.AttackerSteamID != kill.VictimSteamID) continue;
                if (!string.Equals(prev.VictimSide, kill.AttackerSide, StringComparison.OrdinalIgnoreCase)) continue;
                kill.TradedPlayerSteamID = prev.VictimSteamID;
                break;
            }
        }
    }
}
