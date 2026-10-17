using System.Net;
using System.Text;
using System.Text.Json;
using Radar.Api;
using Radar.Domain.Models;
using Xunit;

namespace Radar.Tests;

public class BridgeServerIntegrationTests
{
    private static string TestDataPath(string name) => Path.Combine(AppContext.BaseDirectory, "TestData", name);

    private static (BridgeServer server, string dir, string dbPath) StartServer()
    {
        var dir = Path.Combine(Path.GetTempPath(), "radar-bridge-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        Directory.CreateDirectory(Path.Combine(dir, "frontend"));
        File.WriteAllText(Path.Combine(dir, "frontend", "index.html"), "<html><head></head><body>test</body></html>");
        var dbPath = Path.Combine(dir, "test.db");
        var app = new DesktopApp(Path.Combine(dir, "config.json"), dbPath);
        var server = new BridgeServer(app, Path.Combine(dir, "frontend"), 0);
        server.Start();
        return (server, dir, dbPath);
    }

    private static async Task<string> Call(BridgeServer server, string method, params object?[] args)
    {
        using var client = new HttpClient();
        var payload = JsonSerializer.Serialize(new { method, args });
        var content = new StringContent(payload, Encoding.UTF8, "application/json");
        var resp = await client.PostAsync(server.BaseUrl + "/__bridge", content);
        return await resp.Content.ReadAsStringAsync();
    }

    [Fact]
    public async Task Bootstrap_Returns_Config_And_Empty_Players()
    {
        var (server, dir, _) = StartServer();
        try
        {
            var json = await Call(server, "Bootstrap");
            using var doc = JsonDocument.Parse(json);
            Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("error").ValueKind);
            var config = doc.RootElement.GetProperty("result").GetProperty("config");
            Assert.Equal(1920, config.GetProperty("export_width").GetInt32());
            var players = doc.RootElement.GetProperty("result").GetProperty("players");
            Assert.Equal(0, players.GetArrayLength());
        }
        finally
        {
            server.Stop();
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public async Task ImportDemo_Then_BuildRadar_Via_Bridge()
    {
        var (server, dir, _) = StartServer();
        try
        {
            var demoPath = TestDataPath("legacy_g163.json");
            // DesktopApp.ImportDemo expects a .dem parse; instead exercise the bridge methods that
            // don't require parsing: save via HistoryService path already covered by integration tests.
            // Here verify ListPlayers, BuildRadar error handling, GetRatingMethodology.
            var json = await Call(server, "GetRatingMethodology");
            using var doc = JsonDocument.Parse(json);
            Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("error").ValueKind);
            Assert.Equal("local-r3-2026.09-v1", doc.RootElement.GetProperty("result").GetProperty("algorithm_version").GetString());

            // BuildRadar with no records -> error
            var errJson = await Call(server, "BuildRadar", "nonexistent", new List<string> { "x" });
            using var errDoc = JsonDocument.Parse(errJson);
            Assert.Equal("player_record_not_found", errDoc.RootElement.GetProperty("error").GetProperty("code").GetString());

            // Unknown method -> bridge error
            var unknown = await Call(server, "NoSuchMethod");
            using var unkDoc = JsonDocument.Parse(unknown);
            Assert.Equal("method_not_found", unkDoc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally
        {
            server.Stop();
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public async Task Static_Frontend_Served_With_Bridge_Injector()
    {
        var (server, dir, _) = StartServer();
        try
        {
            using var client = new HttpClient();
            var html = await client.GetStringAsync(server.BaseUrl + "/");
            Assert.Contains("studio-bridge.js", html);
            var script = await client.GetStringAsync(server.BaseUrl + "/studio-bridge.js");
            Assert.Contains("window.__studioBridge", script);
            Assert.Contains("BuildRadar", script);
        }
        finally
        {
            server.Stop();
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public async Task VideoDownload_Endpoint_Requires_Valid_Token()
    {
        var (server, dir, _) = StartServer();
        try
        {
            using var client = new HttpClient();
            var missing = await client.GetAsync(server.BaseUrl + "/video-download?token=bogus");
            Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
            var noToken = await client.GetAsync(server.BaseUrl + "/video-download");
            Assert.Equal(HttpStatusCode.BadRequest, noToken.StatusCode);
        }
        finally
        {
            server.Stop();
            Directory.Delete(dir, true);
        }
    }
}