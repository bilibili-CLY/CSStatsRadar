using Cs2Demo.Analytics;
using Radar.Parser;
using Xunit;

namespace Radar.Tests;

public class TeamPrefixTests
{
    private static MatchData Match(params string[] names)
    {
        var match = new MatchData { Meta = new MatchMeta() };
        var index = 0;
        foreach (var name in names)
        {
            match.Players.Add(new PlayerInfo
            {
                SteamId = (++index).ToString(),
                Name = name,
                Csda = new PlayerCsdaStats(),
            });
        }
        return match;
    }

    [Fact]
    public void ClusterPrefix_SharedByTwoPlayers_IsStripped()
    {
        var demo = MatchDataMapper.Map(Match("Alt Alice", "Alt Bob", "Carol"));

        Assert.Equal(
            new[] { "Alice", "Bob", "Carol" },
            demo.Players.OrderBy(p => p.SteamID).Select(p => p.Name));
    }

    [Fact]
    public void SingleOccurrencePrefix_WithoutTags_IsKept()
    {
        var demo = MatchDataMapper.Map(Match("Lonely Prefix", "Bob"));

        Assert.Contains(demo.Players, p => p.Name == "Lonely Prefix");
    }

    [Fact]
    public void ConfiguredTag_IsStripped_CaseInsensitive()
    {
        var demo = MatchDataMapper.Map(Match("alt Alice", "Bob"), "ALT, TY");

        Assert.Contains(demo.Players, p => p.Name == "Alice");
        Assert.Contains(demo.Players, p => p.Name == "Bob");
    }

    [Fact]
    public void ConfiguredTag_IsStripped_ThroughCluster()
    {
        // 前缀只出现一次（单发），但配置里给了该战队名 → 仍然剥离。
        var demo = MatchDataMapper.Map(Match("Ty Bob", "Carol"), "ALT, TY");

        Assert.Contains(demo.Players, p => p.Name == "Bob");
        Assert.Contains(demo.Players, p => p.Name == "Carol");
    }

    [Fact]
    public void NameWithoutSpace_IsKept()
    {
        var demo = MatchDataMapper.Map(Match("Alt", "Alt Bob"), "Alt");

        Assert.Contains(demo.Players, p => p.Name == "Alt");
    }

    [Fact]
    public void EmptyRest_IsKept()
    {
        var demo = MatchDataMapper.Map(Match("Alt ", "Bob"), "Alt");

        Assert.Contains(demo.Players, p => p.Name == "Alt");
    }

    [Fact]
    public void RealSpacedNickname_IsKept()
    {
        var demo = MatchDataMapper.Map(Match("Old Man Jace", "Bob"));

        Assert.Contains(demo.Players, p => p.Name == "Old Man Jace");
    }

    [Fact]
    public void MultiWordClusterPrefix_IsStripped()
    {
        var demo = MatchDataMapper.Map(Match("Best Bet Alpha", "Best Bet Bravo", "Carol"));

        Assert.Equal(
            new[] { "Alpha", "Bravo", "Carol" },
            demo.Players.OrderBy(p => p.SteamID).Select(p => p.Name));
    }

    [Fact]
    public void MultiWordConfiguredTag_IsStripped()
    {
        var demo = MatchDataMapper.Map(Match("Best Bet Solo", "Bob"), "Best Bet");

        Assert.Contains(demo.Players, p => p.Name == "Solo");
        Assert.Contains(demo.Players, p => p.Name == "Bob");
    }

    [Fact]
    public void MultiWordConfiguredTag_IsStripped_CaseInsensitive()
    {
        var demo = MatchDataMapper.Map(Match("best bet Solo", "Bob"), "Best Bet");

        Assert.Contains(demo.Players, p => p.Name == "Solo");
    }

    [Fact]
    public void LongestClusterPrefix_Wins_ShorterTeamName_NotOverStripped()
    {
        // 「Best」与「Best Bet」两支战队同场：长前缀优先，短前缀玩家只剥一段。
        var demo = MatchDataMapper.Map(Match("Best Carol", "Best Bet Alpha", "Best Bet Bravo"));

        Assert.Equal(
            new[] { "Carol", "Alpha", "Bravo" },
            demo.Players.OrderBy(p => p.SteamID).Select(p => p.Name));
    }

    [Fact]
    public void ConfiguredTag_DoesNotMatchWithoutWordBoundary()
    {
        var demo = MatchDataMapper.Map(Match("BestBet Solo", "Bob"), "Best Bet");

        Assert.Contains(demo.Players, p => p.Name == "BestBet Solo");
    }
}
