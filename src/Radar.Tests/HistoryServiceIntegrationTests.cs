using System.Text.Json;
using Radar.Application;
using Radar.Domain.Models;
using Radar.Infrastructure;
using Xunit;

namespace Radar.Tests;

public class HistoryServiceIntegrationTests
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
    };

    private static (SQLiteHistoryRepository repo, HistoryService history, string dir) CreateRepo()
    {
        var dir = Path.Combine(Path.GetTempPath(), "radar-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var dbPath = Path.Combine(dir, "test.db");
        var repo = new SQLiteHistoryRepository(dbPath);
        Assert.Null(repo.Init());
        return (repo, new HistoryService(repo), dir);
    }

    private static DemoData LoadDemo(string name)
    {
        var json = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "TestData", name));
        var demo = JsonSerializer.Deserialize<DemoData>(json, JsonOpts)!;
        demo.Meta.FileSHA256 = "testsha-" + Guid.NewGuid().ToString("N");
        return demo;
    }

    [Fact]
    public void SaveParsedDemo_Then_ListPlayers_And_Matches()
    {
        var (repo, history, dir) = CreateRepo();
        try
        {
            var demo = LoadDemo("legacy_g163.json");
            var result = history.SaveParsedDemoForPlayersAtSource("legacy_g163.json", "", demo, null);
            Assert.Equal("saved", result.SaveStatus);
            Assert.NotNull(result.SavedDemo);

            var players = repo.ListPlayers();
            Assert.Equal(10, players.Count);

            var player = players.First();
            var matches = repo.ListPlayerMatches(player.SteamID);
            Assert.Single(matches);
            var match = matches[0];
            Assert.Equal(7, match.Rounds);
            Assert.Equal(result.SavedDemo!.DemoRecordID, match.DemoRecordID);
            Assert.NotNull(match.Rating3);
            Assert.NotNull(match.RoundSwing);
            Assert.Equal(Rating3.AlgorithmVersion, match.RatingAlgorithm);
            Assert.Equal(6, match.Metrics.Count);
        }
        finally
        {
            repo.Close();
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void DuplicateDemo_Returns_Duplicate()
    {
        var (repo, history, dir) = CreateRepo();
        try
        {
            var demo = LoadDemo("legacy_g163.json");
            var first = history.SaveParsedDemoForPlayersAtSource("a.dem", "", demo, null);
            Assert.Equal("saved", first.SaveStatus);
            var second = history.SaveParsedDemoForPlayersAtSource("b.dem", "", demo, null);
            Assert.Equal("duplicate", second.SaveStatus);
            Assert.Equal(first.SavedDemo!.DemoRecordID, second.SavedDemo!.DemoRecordID);
            Assert.Single(repo.ListDemos());
        }
        finally
        {
            repo.Close();
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void AllowedSteamIDs_Filters_Players()
    {
        var (repo, history, dir) = CreateRepo();
        try
        {
            var demo = LoadDemo("legacy_g163.json");
            var firstSteamID = demo.Players[0].SteamID;
            var result = history.SaveParsedDemoForPlayersAtSource("a.dem", "", demo, new List<string> { firstSteamID });
            Assert.Equal("saved", result.SaveStatus);
            var players = repo.ListPlayers();
            Assert.Single(players);
            Assert.Equal(firstSteamID, players[0].SteamID);
        }
        finally
        {
            repo.Close();
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void DeletePlayer_Removes_Everything()
    {
        var (repo, history, dir) = CreateRepo();
        try
        {
            var demo = LoadDemo("legacy_g163.json");
            history.SaveParsedDemoForPlayersAtSource("a.dem", "", demo, null);
            Assert.Equal(10, repo.ListPlayers().Count);
            var steamID = demo.Players[0].SteamID;
            repo.DeletePlayer(steamID);
            Assert.Equal(9, repo.ListPlayers().Count);
            Assert.Empty(repo.ListPlayerMatches(steamID));
        }
        finally
        {
            repo.Close();
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void AggregateRadar_Builds_Over_Multiple_Matches()
    {
        var (repo, history, dir) = CreateRepo();
        try
        {
            var demo = LoadDemo("legacy_g163.json");
            var result = history.SaveParsedDemoForPlayersAtSource("a.dem", "", demo, null);
            var steamID = demo.Players[0].SteamID;
            var player = repo.GetPlayer(steamID)!;
            var records = repo.GetMetricSnapshots(steamID, new List<string> { result.SavedDemo!.DemoRecordID });
            var err = AggregateRadarBuilder.Build(new Player { Name = player.Name, SteamID = steamID }, records, out var response);
            Assert.Null(err);
            Assert.Equal(1, response.MatchCount);
            Assert.Equal(6, response.Radar.Dimensions.Count);
            Assert.NotNull(response.Profiles.Rating3);
            Assert.True(response.Rating3Status.Available);
            Assert.Equal(6, response.Profiles.Rating3!.Dimensions.Count);
        }
        finally
        {
            repo.Close();
            Directory.Delete(dir, recursive: true);
        }
    }
}