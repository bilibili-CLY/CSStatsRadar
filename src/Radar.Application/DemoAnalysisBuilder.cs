using Radar.Domain.Models;

namespace Radar.Application;

public static class DemoAnalysisBuilder
{
    public const string Version = "demo-analysis-v1";

    public static DemoAnalysis Build(string demoID, DemoData demo)
    {
        var analysis = new DemoAnalysis
        {
            DemoID = demoID,
            Version = Version,
            MapName = demo.Meta.MapName,
            Rounds = demo.Rounds.Count,
            GeneratedAt = DateTime.UtcNow.ToString("o"),
        };
        var teamByPlayer = InitialTeams(demo);
        var roster = new List<Player>();
        foreach (var player in demo.Players)
            if (teamByPlayer.GetValueOrDefault(player.SteamID) != "")
                roster.Add(player);
        if (roster.Count == 0)
        {
            roster = demo.Players.Take(10).ToList();
            for (var i = 0; i < roster.Count; i++)
                teamByPlayer[roster[i].SteamID] = i < roster.Count / 2 ? "A" : "B";
        }
        var teams = new Dictionary<string, DemoTeam> { ["A"] = new() { ID = "A", Name = "队伍 A" }, ["B"] = new() { ID = "B", Name = "队伍 B" } };
        foreach (var player in roster)
        {
            var id = teamByPlayer.GetValueOrDefault(player.SteamID);
            if (id == "") id = "A";
            teams[id].Players.Add(player);
        }
        var ledger = SwingLedgerCalculator.Calculate(demo);
        var scoreA = 0;
        var scoreB = 0;
        var scores = new Dictionary<int, (int, int)>();
        foreach (var round in demo.Rounds)
        {
            var winner = TeamForSideInRound(demo, teamByPlayer, round.RoundNumber, round.WinnerSide);
            if (winner == "A") scoreA++;
            else if (winner == "B") scoreB++;
            scores[round.RoundNumber] = (scoreA, scoreB);
        }
        teams["A"].Score = scoreA;
        teams["B"].Score = scoreB;
        analysis.Teams = new List<DemoTeam> { teams["A"], teams["B"] };
        foreach (var player in roster)
        {
            var entry = new DemoPlayerAnalysis { Player = player, TeamID = teamByPlayer.GetValueOrDefault(player.SteamID) };
            foreach (var round in demo.Rounds)
            {
                var prefix = DemoPrefix(demo, round.RoundNumber);
                var stats = new PlayerStatsCalculator().Calculate(prefix, player);
                double? rating = null;
                if (stats.Rating3Metrics != null && stats.Rating3Metrics.TryGetValue("Rating", out var metric) && metric.Value != null)
                    rating = metric.Value;
                var playerRound = BuildPlayerRoundMetric(demo, player, round, teamByPlayer, scores.GetValueOrDefault(round.RoundNumber), ledger.Events.GetValueOrDefault(round.RoundNumber)?.GetValueOrDefault(player.SteamID));
                playerRound.CumulativeRating = rating;
                foreach (var evt in playerRound.Events)
                    playerRound.RoundSwing += evt.Contribution;
                playerRound.RoundSwing = Rating3.Round2(playerRound.RoundSwing);
                entry.Rounds.Add(playerRound);
            }
            analysis.Players.Add(entry);
        }
        return analysis;
    }

    public static Dictionary<string, string> InitialTeams(DemoData demo)
    {
        var result = new Dictionary<string, string>();
        var first = 1;
        if (demo.Rounds.Count > 0) first = demo.Rounds[0].RoundNumber;
        foreach (var state in demo.Survivals)
        {
            if (state.RoundNumber != first) continue;
            if (Rating3.SameSide(state.Side, "T")) result[state.SteamID] = "A";
            else if (Rating3.SameSide(state.Side, "CT")) result[state.SteamID] = "B";
        }
        return result;
    }

    public static string TeamForSideInRound(DemoData demo, Dictionary<string, string> teams, int round, string side)
    {
        foreach (var state in demo.Survivals)
            if (state.RoundNumber == round && Rating3.SameSide(state.Side, side))
                return teams.GetValueOrDefault(state.SteamID);
        return "";
    }

    public static DemoData DemoPrefix(DemoData demo, int round)
    {
        var result = new DemoData
        {
            Players = demo.Players,
            Kills = demo.Kills.Where(k => k.RoundNumber <= round).ToList(),
            Rounds = demo.Rounds.Where(r => r.RoundNumber <= round).ToList(),
            Damages = demo.Damages?.Where(d => d.RoundNumber <= round).ToList(),
            Survivals = demo.Survivals.Where(s => s.RoundNumber <= round).ToList(),
            TradeDataAvailable = demo.TradeDataAvailable,
            Source = demo.Source,
            Meta = demo.Meta,
        };
        return result;
    }

    public static PlayerRoundMetric BuildPlayerRoundMetric(DemoData demo, Player player, RoundData round, Dictionary<string, string> teams, (int, int) score, List<SwingEvent>? events)
    {
        var metric = new PlayerRoundMetric { RoundNumber = round.RoundNumber, ScoreA = score.Item1, ScoreB = score.Item2, Events = events ?? new List<SwingEvent>() };
        metric.Won = TeamForSideInRound(demo, teams, round.RoundNumber, round.WinnerSide) == teams.GetValueOrDefault(player.SteamID);
        foreach (var kill in demo.Kills)
        {
            if (kill.RoundNumber != round.RoundNumber) continue;
            if (kill.AttackerSteamID == player.SteamID) { metric.Kills++; metric.KAST = true; }
            if (kill.VictimSteamID == player.SteamID) metric.Deaths++;
            if (kill.AssisterSteamID == player.SteamID) { metric.Assists++; metric.KAST = true; }
            if (kill.TradedPlayerSteamID == player.SteamID) metric.KAST = true;
        }
        if (demo.Damages != null)
            foreach (var damage in demo.Damages)
                if (damage.RoundNumber == round.RoundNumber && damage.AttackerSteamID == player.SteamID)
                    metric.Damage += damage.Damage;
        if (SwingCalculator.HasSurvival(demo.Survivals, round.RoundNumber, player.SteamID))
            metric.KAST = true;
        for (var i = 0; i < metric.Events.Count; i++)
            metric.Events[i].Label = SwingEventLabel(metric.Events[i], demo.Players);
        return metric;
    }

    public static string SwingEventLabel(SwingEvent evt, List<Player> players)
    {
        string name(string id)
        {
            foreach (var player in players)
                if (player.SteamID == id) return player.Name;
            return id;
        }
        if (evt.Type == "death") return $"被 {name(evt.Target)} 使用 {evt.Weapon} 击杀";
        if (evt.Type == "settlement") return "回合结算贡献";
        return $"参与击杀 {name(evt.Target)}";
    }
}