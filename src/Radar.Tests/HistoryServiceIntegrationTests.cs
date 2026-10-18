using System.Text.Json;
using Radar.Application;
using Radar.Domain.Models;
using Radar.Infrastructure;
using Xunit;
using PackagePlayerInfo = Cs2Demo.Analytics.PlayerInfo;
using PackageMatchMeta = Cs2Demo.Analytics.MatchMeta;
using PackageRoundInfo = Cs2Demo.Analytics.RoundInfo;
using PackageKillEvent = Cs2Demo.Analytics.KillEvent;
using PackageDamageEvent = Cs2Demo.Analytics.DamageEvent;
using PackageSurvivalInfo = Cs2Demo.Analytics.SurvivalInfo;

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

    /// <summary>
    /// legacy fixture 是旧解析器产出的 DemoData；为 HistoryService 构造一份镜像的 MatchData
    /// （csda 事件列表 + 全零 PlayerCsdaStats），使包口径统计可计算。
    /// </summary>
    private static Radar.Parser.ParsedDemo ToParsed(DemoData demo)
    {
        var match = new Cs2Demo.Analytics.MatchData
        {
            Meta = new PackageMatchMeta { MapName = demo.Meta.MapName, FileSha256 = demo.Meta.FileSHA256 },
            Players = demo.Players.Select(p => new PackagePlayerInfo { Name = p.Name, SteamId = p.SteamID, Csda = new Cs2Demo.Analytics.PlayerCsdaStats() }).ToList(),
            Rounds = demo.Rounds.Select(r => new PackageRoundInfo { RoundNumber = r.RoundNumber, StartTick = r.StartTick, EndTick = r.EndTick, WinnerSide = r.WinnerSide }).ToList(),
            Kills = demo.Kills.Select(k => new PackageKillEvent
            {
                RoundNumber = k.RoundNumber,
                Tick = k.Tick,
                AttackerSteamId = k.AttackerSteamID,
                VictimSteamId = k.VictimSteamID,
                AssisterSteamId = k.AssisterSteamID,
                AttackerSide = k.AttackerSide,
                VictimSide = k.VictimSide,
                Weapon = k.Weapon,
            }).ToList(),
            Damages = (demo.Damages ?? new List<DamageEvent>()).Select(d => new PackageDamageEvent
            {
                RoundNumber = d.RoundNumber,
                AttackerSteamId = d.AttackerSteamID,
                VictimSteamId = d.VictimSteamID,
                Damage = d.Damage,
                AttackerSide = d.AttackerSide,
                VictimSide = d.VictimSide,
                Weapon = d.Weapon,
            }).ToList(),
            Survivals = demo.Survivals.Select(s => new PackageSurvivalInfo
            {
                RoundNumber = s.RoundNumber,
                SteamId = s.SteamID,
                Survived = s.Survived,
                Side = s.Side,
            }).ToList(),
        };
        return new Radar.Parser.ParsedDemo { Demo = demo, Match = match };
    }

    [Fact]
    public void SaveParsedDemo_Then_ListPlayers_And_Matches()
    {
        var (repo, history, dir) = CreateRepo();
        try
        {
            var demo = LoadDemo("legacy_g163.json");
            var result = history.SaveParsedDemoForPlayersAtSource("legacy_g163.json", "", ToParsed(demo), null);
            Assert.Equal("saved", result.SaveStatus);
            Assert.NotNull(result.SavedDemo);

            var players = repo.ListPlayers();
            Assert.Equal(10, players.Count);
            Assert.All(players, player => Assert.NotEqual(default, player.LatestImportedAt));

            var savedDemo = repo.ListDemos().Single();
            Assert.Equal(demo.Players.Select(player => player.SteamID).OrderBy(id => id), savedDemo.PlayerStatSteamIDs.OrderBy(id => id));

            var player = players.First();
            var matches = repo.ListPlayerMatches(player.SteamID);
            Assert.Single(matches);
            var match = matches[0];
            Assert.Equal(7, match.Rounds);
            Assert.Equal(result.SavedDemo!.DemoRecordID, match.DemoRecordID);
            Assert.NotNull(match.Rating3);
            Assert.NotNull(match.RoundSwing);
            Assert.Equal("cs2demo-analytics/" + Cs2Demo.Analytics.StatsCalculator.Rating30Version, match.RatingAlgorithm);
            Assert.Equal(6, match.Metrics.Count);

            // 两个剖面同源：切换 Rating 2.0/3.0 时 KPR、ADR 的数值不得变化。
            AssertMetricParity(match.Metrics, match.Rating3Metrics!, "KPR");
            AssertMetricParity(match.Metrics, match.Rating3Metrics!, "ADR");
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
            var first = history.SaveParsedDemoForPlayersAtSource("a.dem", "", ToParsed(demo), null);
            Assert.Equal("saved", first.SaveStatus);
            var second = history.SaveParsedDemoForPlayersAtSource("b.dem", "", ToParsed(demo), null);
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
            var result = history.SaveParsedDemoForPlayersAtSource("a.dem", "", ToParsed(demo), new List<string> { firstSteamID });
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
    public void FollowBackfill_Adds_Only_Missing_Player_Stats_And_Is_Idempotent()
    {
        var (repo, history, dir) = CreateRepo();
        try
        {
            var demo = LoadDemo("legacy_g163.json");
            var first = demo.Players[0];
            var second = demo.Players[1];
            history.SaveParsedDemoForPlayersAtSource("a.dem", "", ToParsed(demo), new List<string> { first.SteamID });

            var before = repo.ListDemos().Single();
            Assert.Contains(first.SteamID, before.PlayerStatSteamIDs);
            Assert.DoesNotContain(second.SteamID, before.PlayerStatSteamIDs);

            history.FollowParsedDemoPlayersAtSource("a.dem", "", ToParsed(demo), new List<string> { second.SteamID });
            history.FollowParsedDemoPlayersAtSource("a.dem", "", ToParsed(demo), new List<string> { second.SteamID });

            var after = repo.ListDemos().Single();
            Assert.Equal(new[] { first.SteamID, second.SteamID }.OrderBy(id => id), after.PlayerStatSteamIDs.OrderBy(id => id));
            Assert.Single(repo.ListPlayerMatches(second.SteamID));
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
            history.SaveParsedDemoForPlayersAtSource("a.dem", "", ToParsed(demo), null);
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
            var result = history.SaveParsedDemoForPlayersAtSource("a.dem", "", ToParsed(demo), null);
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

            // 汇总雷达同样必须同源：两个剖面的 KPR、ADR 值一致。
            AssertPayloadMetricParity(response.Radar, response.Profiles.Rating3!, "KPR");
            AssertPayloadMetricParity(response.Radar, response.Profiles.Rating3!, "ADR");
        }
        finally
        {
            repo.Close();
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void MatchGroups_Create_Assign_Move_And_Remove()
    {
        var (repo, history, dir) = CreateRepo();
        try
        {
            var demo = LoadDemo("legacy_g163.json");
            var result = history.SaveParsedDemoForPlayersAtSource("a.dem", "", ToParsed(demo), null);
            var steamID = demo.Players[0].SteamID;
            var demoID = result.SavedDemo!.DemoRecordID;
            var otherSteamID = demo.Players[1].SteamID;

            var first = repo.CreateMatchGroup(steamID, "小组赛");
            var second = repo.CreateMatchGroup(steamID, "淘汰赛");
            Assert.Empty(repo.ListMatchGroups(otherSteamID));
            Assert.Equal(new[] { "小组赛", "淘汰赛" }, repo.ListMatchGroups(steamID).Select(group => group.Name));

            repo.AssignMatchGroup(steamID, demoID, first.ID);
            Assert.Equal(new[] { demoID }, repo.ListMatchGroups(steamID).Single(group => group.ID == first.ID).DemoIDs);

            repo.AssignMatchGroup(steamID, demoID, second.ID);
            Assert.Equal(new[] { demoID }, repo.ListMatchGroups(steamID).Single(group => group.ID == second.ID).DemoIDs);
            Assert.Empty(repo.ListMatchGroups(steamID).Single(group => group.ID == first.ID).DemoIDs);

            repo.RenameMatchGroup(second.ID, "半决赛");
            Assert.Contains(repo.ListMatchGroups(steamID), group => group.ID == second.ID && group.Name == "半决赛");

            repo.AssignMatchGroup(steamID, demoID, null);
            Assert.Empty(repo.ListMatchGroups(steamID).SelectMany(group => group.DemoIDs));

            repo.DeleteMatchGroup(second.ID);
            Assert.DoesNotContain(repo.ListMatchGroups(steamID), group => group.ID == second.ID);
        }
        finally
        {
            repo.Close();
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void MatchGroup_Assign_Rejects_Other_Players_Match_And_Group()
    {
        var (repo, history, dir) = CreateRepo();
        try
        {
            var demo = LoadDemo("legacy_g163.json");
            var result = history.SaveParsedDemoForPlayersAtSource("a.dem", "", ToParsed(demo), null);
            var steamID = demo.Players[0].SteamID;
            var otherSteamID = demo.Players[1].SteamID;
            var demoID = result.SavedDemo!.DemoRecordID;

            var group = repo.CreateMatchGroup(otherSteamID, "私组");
            Assert.Throws<InvalidOperationException>(() => repo.AssignMatchGroup(steamID, demoID, group.ID));
            Assert.Throws<InvalidOperationException>(() => repo.AssignMatchGroup(otherSteamID, "demo_record_unknown", group.ID));
        }
        finally
        {
            repo.Close();
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void MatchGroups_Are_Cascaded_On_Cleanup()
    {
        var (repo, history, dir) = CreateRepo();
        try
        {
            var demo = LoadDemo("legacy_g163.json");
            var result = history.SaveParsedDemoForPlayersAtSource("a.dem", "", ToParsed(demo), null);
            var steamID = demo.Players[0].SteamID;
            var otherSteamID = demo.Players[1].SteamID;
            var demoID = result.SavedDemo!.DemoRecordID;

            var group = repo.CreateMatchGroup(steamID, "档");
            repo.CreateMatchGroup(steamID, "另一个档");
            repo.AssignMatchGroup(steamID, demoID, group.ID);

            repo.DeletePlayerMatch(steamID, demoID);
            Assert.Empty(repo.ListMatchGroups(steamID).Single(entry => entry.ID == group.ID).DemoIDs);

            repo.DeletePlayer(steamID);
            Assert.Empty(repo.ListMatchGroups(steamID));

            var second = repo.CreateMatchGroup(otherSteamID, "另一档");
            repo.AssignMatchGroup(otherSteamID, demoID, second.ID);
            repo.DeleteDemos(new List<string> { demoID });
            Assert.Empty(repo.ListMatchGroups(otherSteamID).Single().DemoIDs);
        }
        finally
        {
            repo.Close();
            Directory.Delete(dir, recursive: true);
        }
    }

    /// <summary>同一场比赛的 Rating 2.0 / Rating 3.0 指标值必须一致（KPR、ADR 为同源原始口径）。</summary>
    private static void AssertMetricParity(List<RadarMetric> rating2, List<RadarMetric> rating3, string name)
    {
        var m2 = rating2.Single(metric => metric.Name == name);
        var m3 = rating3.Single(metric => metric.Name == name);
        Assert.NotNull(m2.Value);
        Assert.NotNull(m3.Value);
        Assert.Equal(m2.Value!.Value, m3.Value!.Value, 6);
    }

    /// <summary>汇总雷达的 Rating 2.0 / Rating 3.0 剖面必须对同名维度给出相同数值。</summary>
    private static void AssertPayloadMetricParity(RadarPayload rating2, RadarPayload rating3, string name)
    {
        var index2 = rating2.Dimensions.IndexOf(name);
        var index3 = rating3.Dimensions.IndexOf(name);
        Assert.True(index2 >= 0, $"Rating 2.0 剖面缺少 {name}");
        Assert.True(index3 >= 0, $"Rating 3.0 剖面缺少 {name}");
        Assert.NotNull(rating2.Values[index2]);
        Assert.NotNull(rating3.Values[index3]);
        Assert.Equal(rating2.Values[index2]!.Value, rating3.Values[index3]!.Value, 6);
    }
}
