using Radar.Domain.Models;

namespace Radar.Application;

public static class SwingCalculator
{
    public static double CalculateRoundSwing(DemoData demo, string steamID)
    {
        if (demo.Rounds.Count == 0) return 0;
        return SwingLedgerCalculator.Calculate(demo).Totals.GetValueOrDefault(steamID) / demo.Rounds.Count * 100;
    }

    public static double RoundWinProbability(int tAlive, int ctAlive, int tEconomy, int ctEconomy, bool planted)
    {
        if (tAlive <= 0) return 0;
        if (ctAlive <= 0) return 1;
        var bomb = planted ? 1.0 : 0.0;
        var baseLog = Math.Log(0.48 / 0.52);
        return Rating3.Clamp(Rating3.Sigmoid(baseLog + Rating3.AliveCoefficient * (tAlive - ctAlive) + Rating3.EconomyCoefficient * (tEconomy - ctEconomy) + Rating3.BombCoefficient * bomb), 0.01, 0.99);
    }

    public static bool IsTradeKill(List<KillEvent> kills, int index)
    {
        var current = kills[index];
        for (var previousIndex = index - 1; previousIndex >= 0; previousIndex--)
        {
            var previous = kills[previousIndex];
            if (current.Tick - previous.Tick > 5 * 64) break;
            if (previous.AttackerSteamID == current.VictimSteamID && Rating3.SameSide(previous.VictimSide, current.AttackerSide)) return true;
        }
        return false;
    }

    public static bool HasSurvival(List<SurvivalState> states, int roundNumber, string steamID)
    {
        foreach (var state in states)
            if (state.RoundNumber == roundNumber && state.SteamID == steamID && state.Survived) return true;
        return false;
    }
}
