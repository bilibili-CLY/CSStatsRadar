using System.Net;
using System.Text;
using System.Text.Json;
using Radar.Api;
using Radar.Application;
using Radar.Domain.Models;
using Xunit;

namespace Radar.Tests;

public class LiveEndToEndTests
{
    private const string DemoPath = "/Users/cly/Documents/CSPlayerStatsRadar/doc/perfect-world.dem";
    private const string FrontendDir = "/Users/cly/Documents/CSPlayerStatsRadar/frontend/dist";

    private static string TestDataPath(string name) => Path.Combine(AppContext.BaseDirectory, "TestData", name);

    private static async Task<string> Call(BridgeServer server, string method, params object?[] args)
    {
        using var client = new HttpClient();
        var payload = JsonSerializer.Serialize(new { method, args });
        var content = new StringContent(payload, Encoding.UTF8, "application/json");
        var resp = await client.PostAsync(server.BaseUrl + "/__bridge", content);
        return await resp.Content.ReadAsStringAsync();
    }

    private static async Task<JsonElement> CallOk(BridgeServer server, string method, params object?[] args)
    {
        var json = await Call(server, method, args);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("error").ValueKind);
        return doc.RootElement.GetProperty("result").Clone();
    }

    [Fact]
    public void Real_Demo_Parse_Import_Radar_ClosedLoop()
    {
        if (!File.Exists(DemoPath)) return;
        var dir = Path.Combine(Path.GetTempPath(), "radar-live-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db"));
        try
        {
            // 1. Parse + import the real .dem into history
            var result = app.ImportDemo(DemoPath);
            Assert.Equal("saved", result.SaveStatus);
            Assert.NotNull(result.SavedDemo);
            var demoID = result.SavedDemo!.DemoRecordID;

            // 2. ListPlayers returns 10 players
            var players = app.ListPlayers();
            Assert.Equal(10, players.Count);

            // 3. GetPlayerMatches returns a match with full Rating 3.0 stats
            var steamID = players[0].SteamID;
            var matches = app.GetPlayerMatches(steamID);
            Assert.Single(matches);
            Assert.Equal(18, matches[0].Rounds);
            Assert.NotNull(matches[0].Rating3);
            Assert.NotNull(matches[0].RoundSwing);
            Assert.Equal("cs2demo-analytics/" + Cs2Demo.Analytics.StatsCalculator.Rating30Version, matches[0].RatingAlgorithm);

            // 4. BuildRadar aggregates and includes Rating 3.0 profile
            var radar = app.BuildRadar(steamID, new List<string> { demoID });
            Assert.Equal(1, radar.MatchCount);
            Assert.Equal(6, radar.Radar.Dimensions.Count);
            Assert.True(radar.Rating3Status.Available);
            Assert.Equal(6, radar.Profiles.Rating3!.Dimensions.Count);

            // 5. GetDemoAnalysis builds round-by-round analysis
            var analysis = app.GetDemoAnalysis(demoID);
            Assert.Equal(18, analysis.Rounds);
            Assert.Equal(2, analysis.Teams.Count);
            Assert.Equal(10, analysis.Players.Count);
            Assert.All(analysis.Players, p => Assert.NotEmpty(p.Rounds));
        }
        finally
        {
            app.Shutdown();
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public async Task Bridge_Serves_Real_Frontend_And_Methods()
    {
        if (!Directory.Exists(FrontendDir)) return;
        var dir = Path.Combine(Path.GetTempPath(), "radar-bridge-live-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db"));
        var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        var server = new BridgeServer(app, FrontendDir, port);
        server.Start();
        try
        {
            using var client = new HttpClient();
            var html = await client.GetStringAsync(server.BaseUrl + "/");
            Assert.Contains("studio-bridge.js", html);
            var script = await client.GetStringAsync(server.BaseUrl + "/studio-bridge.js");
            Assert.Contains("window.__studioBridge", script);
            Assert.Contains("Bootstrap", script);

            var bootstrap = await CallOk(server, "Bootstrap");
            Assert.Equal(0, bootstrap.GetProperty("players").GetArrayLength());
            var meth = await CallOk(server, "GetRatingMethodology");
            Assert.Equal("local-r3-2026.08-v2", meth.GetProperty("algorithm_version").GetString());

            // Import via the bridge and poll until completed
            if (File.Exists(DemoPath))
            {
                var jobID = (await CallOk(server, "StartFileImport", new List<string> { DemoPath })).GetString();
                Assert.StartsWith("import_", jobID);
                ImportSummary? terminal = null;
                var deadline = DateTime.UtcNow.AddSeconds(40);
                while (DateTime.UtcNow < deadline)
                {
                    var summary = (await CallOk(server, "ImportSummary", jobID)).Deserialize<ImportSummary>();
                    if (summary?.Status is "completed" or "cancelled" or "failed")
                    {
                        terminal = summary;
                        break;
                    }
                    await Task.Delay(150);
                }
                Assert.NotNull(terminal);
                Assert.Equal("completed", terminal!.Status);
                Assert.Equal(1, terminal.Imported);
            }
        }
        finally
        {
            server.Stop();
            app.Shutdown();
            Directory.Delete(dir, true);
        }
    }
}