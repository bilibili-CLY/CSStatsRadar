using Radar.Domain.Models;

namespace Radar.Application;

public class SwingLedger
{
    public Dictionary<string, double> Totals { get; } = new();
    public Dictionary<int, Dictionary<string, List<SwingEvent>>> Events { get; } = new();
}

public static class SwingLedgerCalculator
{
    public static SwingLedger Calculate(DemoData demo)
    {
        var ledger = new SwingLedger();
        var killsByRound = new Dictionary<int, List<KillEvent>>();
        var damagesByRound = new Dictionary<int, List<DamageEvent>>();
        foreach (var kill in demo.Kills)
            (killsByRound.GetValueOrDefaultList(kill.RoundNumber)).Add(kill);
        if (demo.Damages != null)
            foreach (var damage in demo.Damages)
                (damagesByRound.GetValueOrDefaultList(damage.RoundNumber)).Add(damage);

        foreach (var round in demo.Rounds)
        {
            var roundContribution = new Dictionary<string, double>();
            var sideByID = new Dictionary<string, string>();
            var kills = killsByRound.GetValueOrDefault(round.RoundNumber) ?? new List<KillEvent>();
            kills = kills.OrderBy(k => k.Tick).ToList();
            var tAlive = 5;
            var ctAlive = 5;
            var tEco = round.TeamEconomy != null && round.TeamEconomy.TryGetValue("T", out var te) ? te : 0;
            var ctEco = round.TeamEconomy != null && round.TeamEconomy.TryGetValue("CT", out var ce) ? ce : 0;

            for (var killIndex = 0; killIndex < kills.Count; killIndex++)
            {
                var kill = kills[killIndex];
                if (kill.AttackerSteamID == "" || kill.VictimSteamID == "" || kill.AttackerSteamID == kill.VictimSteamID || Rating3.SameSide(kill.AttackerSide, kill.VictimSide)) continue;
                var planted = round.BombPlanted && round.BombPlantTick > 0 && kill.Tick >= round.BombPlantTick;
                sideByID[kill.AttackerSteamID] = kill.AttackerSide;
                sideByID[kill.VictimSteamID] = kill.VictimSide;
                var beforeProb = SwingCalculator.RoundWinProbability(tAlive, ctAlive, tEco, ctEco, planted);
                if (Rating3.SameSide(kill.VictimSide, "T")) tAlive--;
                else ctAlive--;
                var after = SwingCalculator.RoundWinProbability(tAlive, ctAlive, tEco, ctEco, planted);
                var delta = Math.Abs(after - beforeProb);
                var credits = new Dictionary<string, double>();
                var parts = new Dictionary<string, List<SwingEventContribution>>();
                var blow = 0.30 * Rating3.WeaponEventWeight(kill.Weapon, kill.VictimWeapon, kill.AttackerSide, kill.AttackerArmor, kill.VictimArmor);
                credits[kill.AttackerSteamID] = credits.GetValueOrDefault(kill.AttackerSteamID) + blow;
                parts.GetOrCreate(kill.AttackerSteamID).Add(new SwingEventContribution { Kind = "final_blow", Value = blow });
                var damageTotal = 0.0;
                var damageCredits = new Dictionary<string, double>();
                if (damagesByRound.TryGetValue(round.RoundNumber, out var dmgList))
                    foreach (var damage in dmgList)
                    {
                        if (damage.VictimSteamID != kill.VictimSteamID || damage.Tick > kill.Tick || damage.AttackerSteamID == "" || Rating3.SameSide(damage.AttackerSide, damage.VictimSide)) continue;
                        var weighted = damage.Damage * Rating3.WeaponEventWeight(damage.Weapon, damage.VictimWeapon, damage.AttackerSide, damage.AttackerArmor, damage.VictimArmor);
                        damageCredits[damage.AttackerSteamID] = damageCredits.GetValueOrDefault(damage.AttackerSteamID) + weighted;
                        damageTotal += weighted;
                    }
                if (damageTotal > 0)
                    foreach (var kv in damageCredits)
                    {
                        var credit = 0.50 * kv.Value / damageTotal;
                        credits[kv.Key] = credits.GetValueOrDefault(kv.Key) + credit;
                        parts.GetOrCreate(kv.Key).Add(new SwingEventContribution { Kind = "damage", Value = credit });
                    }
                if (kill.AssistedFlash && kill.AssisterSteamID != "")
                {
                    credits[kill.AssisterSteamID] = credits.GetValueOrDefault(kill.AssisterSteamID) + 0.10;
                    parts.GetOrCreate(kill.AssisterSteamID).Add(new SwingEventContribution { Kind = "flash_assist", Value = 0.10 });
                }
                if (SwingCalculator.IsTradeKill(kills, killIndex))
                {
                    credits[kill.AttackerSteamID] = credits.GetValueOrDefault(kill.AttackerSteamID) + 0.10;
                    parts.GetOrCreate(kill.AttackerSteamID).Add(new SwingEventContribution { Kind = "trade", Value = 0.10 });
                }
                var creditTotal = credits.Values.Sum();
                if (creditTotal == 0) { credits[kill.AttackerSteamID] = 1; creditTotal = 1; }
                foreach (var kv in credits)
                {
                    var share = delta * kv.Value / creditTotal;
                    ledger.Totals[kv.Key] = ledger.Totals.GetValueOrDefault(kv.Key) + share;
                    roundContribution[kv.Key] = roundContribution.GetValueOrDefault(kv.Key) + share;
                    AppendSwingEvent(ledger, kv.Key, new SwingEvent
                    {
                        ID = $"r{round.RoundNumber}-t{kill.Tick}-{kv.Key}",
                        RoundNumber = round.RoundNumber,
                        Tick = kill.Tick,
                        Type = "engagement",
                        Actor = kv.Key,
                        Target = kill.VictimSteamID,
                        Weapon = kill.Weapon,
                        Contribution = Rating3.Round2(share * 100),
                        Breakdown = NormalizeBreakdown(parts.GetValueOrDefault(kv.Key) ?? new List<SwingEventContribution>(), delta / creditTotal * 100),
                    });
                }
                ledger.Totals[kill.VictimSteamID] = ledger.Totals.GetValueOrDefault(kill.VictimSteamID) - delta;
                roundContribution[kill.VictimSteamID] = roundContribution.GetValueOrDefault(kill.VictimSteamID) - delta;
                AppendSwingEvent(ledger, kill.VictimSteamID, new SwingEvent
                {
                    ID = $"r{round.RoundNumber}-t{kill.Tick}-death-{kill.VictimSteamID}",
                    RoundNumber = round.RoundNumber,
                    Tick = kill.Tick,
                    Type = "death",
                    Actor = kill.VictimSteamID,
                    Target = kill.AttackerSteamID,
                    Weapon = kill.Weapon,
                    Contribution = Rating3.Round2(-delta * 100),
                    Breakdown = new List<SwingEventContribution> { new() { Kind = "death", Value = Rating3.Round2(-delta * 100) } },
                });
            }

            var finalProbability = SwingCalculator.RoundWinProbability(tAlive, ctAlive, tEco, ctEco, round.BombPlanted);
            var target = Rating3.SameSide(round.WinnerSide, "T") ? 1.0 : 0.0;
            var before = new Dictionary<string, double>(ledger.Totals);
            AllocateRoundResidual(ledger.Totals, roundContribution, sideByID, demo.Survivals, round, Math.Abs(target - finalProbability));
            foreach (var kv in new Dictionary<string, double>(ledger.Totals))
            {
                var diff = kv.Value - before.GetValueOrDefault(kv.Key);
                if (Math.Abs(diff) < 1e-9) continue;
                AppendSwingEvent(ledger, kv.Key, new SwingEvent
                {
                    ID = $"r{round.RoundNumber}-settlement-{kv.Key}",
                    RoundNumber = round.RoundNumber,
                    Tick = round.EndTick,
                    Type = "settlement",
                    Actor = kv.Key,
                    Contribution = Rating3.Round2(diff * 100),
                    Breakdown = SettlementBreakdown(demo, round, kv.Key, diff * 100),
                });
            }
        }
        return ledger;
    }

    private static void AppendSwingEvent(SwingLedger ledger, string steamID, SwingEvent evt)
    {
        if (!ledger.Events.TryGetValue(evt.RoundNumber, out var perRound))
        {
            perRound = new Dictionary<string, List<SwingEvent>>();
            ledger.Events[evt.RoundNumber] = perRound;
        }
        if (!perRound.TryGetValue(steamID, out var list)) { list = new List<SwingEvent>(); perRound[steamID] = list; }
        list.Add(evt);
    }

    private static List<SwingEventContribution> NormalizeBreakdown(List<SwingEventContribution> parts, double factor)
    {
        foreach (var part in parts) part.Value = Rating3.Round2(part.Value * factor);
        return parts;
    }

    private static List<SwingEventContribution> SettlementBreakdown(DemoData demo, RoundData round, string id, double value)
    {
        var kind = "round_result";
        if (id == round.BombPlanterID) kind = "plant_and_result";
        if (id == round.BombDefuserID) kind = "defuse_and_result";
        if (SwingCalculator.HasSurvival(demo.Survivals, round.RoundNumber, id)) kind = "survival_and_result";
        return new List<SwingEventContribution> { new() { Kind = kind, Value = Rating3.Round2(value) } };
    }

    private static void AllocateRoundResidual(Dictionary<string, double> total, Dictionary<string, double> contribution, Dictionary<string, string> sideByID, List<SurvivalState> survivals, RoundData round, double residual)
    {
        if (residual <= 0 || round.WinnerSide == "") return;
        var winnerWeights = new Dictionary<string, double>();
        var loserWeights = new Dictionary<string, double>();
        foreach (var kv in contribution)
            if (kv.Value > 0 && Rating3.SameSide(sideByID.GetValueOrDefault(kv.Key), round.WinnerSide))
                winnerWeights[kv.Key] = winnerWeights.GetValueOrDefault(kv.Key) + 2;
        var winnerSurvivors = 0;
        foreach (var state in survivals)
        {
            if (state.RoundNumber != round.RoundNumber || !state.Survived) continue;
            if (sideByID.GetValueOrDefault(state.SteamID) == "") sideByID[state.SteamID] = state.Side;
            if (Rating3.SameSide(sideByID.GetValueOrDefault(state.SteamID), round.WinnerSide))
            {
                winnerWeights[state.SteamID] = winnerWeights.GetValueOrDefault(state.SteamID) + 1;
                winnerSurvivors++;
            }
            else if (sideByID.GetValueOrDefault(state.SteamID) != "")
                loserWeights[state.SteamID] = loserWeights.GetValueOrDefault(state.SteamID) + 1;
        }
        if (winnerSurvivors == 1)
            foreach (var id in new List<string>(winnerWeights.Keys))
                if (SwingCalculator.HasSurvival(survivals, round.RoundNumber, id))
                    winnerWeights[id]++;
        foreach (var id in new[] { round.BombPlanterID, round.BombDefuserID })
            if (id != "" && Rating3.SameSide(sideByID.GetValueOrDefault(id), round.WinnerSide))
                winnerWeights[id] = winnerWeights.GetValueOrDefault(id) + 1;
        if (winnerWeights.Count == 0 || loserWeights.Count == 0) return;
        DistributeResidual(total, winnerWeights, residual);
        DistributeResidual(total, loserWeights, -residual);
    }

    private static void DistributeResidual(Dictionary<string, double> total, Dictionary<string, double> weights, double amount)
    {
        var sum = weights.Values.Sum();
        if (sum == 0) return;
        foreach (var kv in weights) total[kv.Key] = total.GetValueOrDefault(kv.Key) + amount * kv.Value / sum;
    }
}

internal static class MapExtensions
{
    public static TValue GetValueOrDefault<TKey, TValue>(this Dictionary<TKey, TValue> map, TKey key) where TKey : notnull
    {
        if (map.TryGetValue(key, out var value)) return value;
        if (typeof(TValue) == typeof(string)) return (TValue)(object)"";
        return default!;
    }

    public static List<T> GetValueOrDefaultList<T>(this Dictionary<int, List<T>> map, int key)
    {
        if (!map.TryGetValue(key, out var list)) { list = new List<T>(); map[key] = list; }
        return list;
    }

    public static List<T> GetOrCreate<T>(this Dictionary<string, List<T>> map, string key)
    {
        if (!map.TryGetValue(key, out var list)) { list = new List<T>(); map[key] = list; }
        return list;
    }
}
