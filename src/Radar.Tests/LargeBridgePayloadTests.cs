using System.Text;
using System.Text.Json;
using Radar.Api;
using Xunit;

namespace Radar.Tests;

public class LargeBridgePayloadTests
{
    [Fact]
    public async Task Bridge_Handles_Large_AppendVideoFrames_Payload()
    {
        var (server, dir) = Start();
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            // A realistic batch: 10 PNG data URLs ~2MB each
            var big = "data:image/png;base64," + new string('A', 2_000_000);
            var frames = Enumerable.Range(0, 10).Select(_ => big).ToList();
            var payload = JsonSerializer.Serialize(new { method = "AppendVideoFrames", args = new object?[] { "video_whatever", 0, frames } });
            Assert.True(payload.Length > 20_000_000, $"payload too small: {payload.Length}");
            var content = new StringContent(payload, Encoding.UTF8, "application/json");
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var resp = await client.PostAsync(server.BaseUrl + "/__bridge", content);
            sw.Stop();
            var body = await resp.Content.ReadAsStringAsync();
            Assert.True(resp.IsSuccessStatusCode, $"status {resp.StatusCode}: {body}");
            Assert.Contains("video_export_not_found", body);
            Assert.True(sw.Elapsed.TotalSeconds < 20, $"took {sw.Elapsed.TotalSeconds}s");
        }
        finally
        {
            server.Stop();
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public async Task Begin_And_Append_VideoExport_Via_Bridge()
    {
        var fakeDir = AddFakeFFmpegToPath();
        var (server, dir) = Start();
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            var beginJson = await Call(client, server, "BeginVideoExport", 1920, 1080, 30, 2000, 0, "cs2-showcase.mp4");
            using var beginDoc = JsonDocument.Parse(beginJson);
            Assert.Equal(JsonValueKind.Null, beginDoc.RootElement.GetProperty("error").ValueKind);
            var id = beginDoc.RootElement.GetProperty("result").GetString();
            Assert.NotNull(id);
            Assert.StartsWith("video_", id);

            // A real 1x1 PNG so DecodePNGDataURL accepts the frames
            var tinyPng = "data:image/png;base64," +
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
            var frames = new List<string> { tinyPng, tinyPng };
            var append = await Call(client, server, "AppendVideoFrames", id, 0, frames);
            Assert.True(append.Contains("\"error\":null"), append);
        }
        finally
        {
            server.Stop();
            Directory.Delete(dir, true);
            RestorePath(fakeDir);
        }
    }

    private static string AddFakeFFmpegToPath()
    {
        var fakeDir = Path.Combine(Path.GetTempPath(), "radar-fakebin-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(fakeDir);
        var script = Path.Combine(fakeDir, "ffmpeg");
        File.WriteAllText(script, "#!/bin/sh\nif [ \"$1\" = \"-version\" ]; then echo \"ffmpeg version fake\"; exit 0; fi\nexit 1\n");
        File.SetUnixFileMode(script, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var oldPath = Environment.GetEnvironmentVariable("PATH") ?? "";
        Environment.SetEnvironmentVariable("PATH", fakeDir + Path.PathSeparator + oldPath);
        return fakeDir;
    }

    private static void RestorePath(string fakeDir)
    {
        var current = Environment.GetEnvironmentVariable("PATH") ?? "";
        Environment.SetEnvironmentVariable("PATH", current.Replace(fakeDir + Path.PathSeparator, ""));
        try { Directory.Delete(fakeDir, true); } catch { }
    }

    [Fact]
    public async Task Full_VideoExport_Encode_And_Download()
    {
        var (server, dir) = Start();
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
            var beginJson = await Call(client, server, "BeginVideoExport", 320, 180, 10, 1000, 0, "cs2-showcase.mp4");
            using var beginDoc = JsonDocument.Parse(beginJson);
            if (beginDoc.RootElement.GetProperty("error").ValueKind != JsonValueKind.Null)
            {
                var msg = beginDoc.RootElement.GetProperty("error").GetProperty("message").GetString();
                Assert.Fail("begin failed: " + msg);
            }
            var id = beginDoc.RootElement.GetProperty("result").GetString();
            Assert.NotNull(id);

            var frame = "data:image/png;base64," +
                "iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAYAAADl5PURAAABlElEQVR42u3TAQkAAAzDsIm4iIu4f13XMQhEQaGZPaBUJAADAwYGDAwGBgwMGBgwMBgYMDBgYDAwYGDAwICBwcCAgQEDAwYGAwMGBgwMBgYMDBgYMDAYGDAwYGDAwGBgwMCAgcHAgIEBAwMGBgMDBgYMDAZWAQwMGBgwMBgYMDBgYMDAYGDAwICBwcCAgQEDAwYGAwMGBgwMGBgMDBgYMDAYGDAwYGDAwGBgwMCAgQEDg4EBAwMGBgMDBgYMDBgYDAwYGDAwGBgwMGBgwMBgYMDAgIEBA4OBAQMDBgYDAwYGDAwYGAwMGBgwMGBgMDBgYMDAYGDAwICBAQODgQEDAwYGDAwGBgwMGBgMDBgYMDBgYDAwYGDAwGBgwMCAgQEDg4EBAwMGBgwMBgYMDBgYDAwYGDAwYGAwMGBgwMCAgcHAgIEBA4OBAQMDBgYMDAYGDAwYGAysAhgYMDBgYDAwYGDAwICBwcCAgQEDg4EBAwMGBgwMBgYMDBgYMDAYGDAwYGAwMGBgwMCAgcHAgIEBAwMGhm4P/9V+KBhtu+4AAAAASUVORK5CYII=";
            var frames = Enumerable.Range(0, 10).Select(_ => frame).ToList();
            var append = await Call(client, server, "AppendVideoFrames", id, 0, frames);
            Assert.True(append.Contains("\"error\":null"), append);

            var finishJson = await Call(client, server, "FinishVideoExport", id);
            using var finishDoc = JsonDocument.Parse(finishJson);
            if (finishDoc.RootElement.GetProperty("error").ValueKind != JsonValueKind.Null)
            {
                var msg = finishDoc.RootElement.GetProperty("error").GetProperty("message").GetString();
                Assert.Fail("finish failed: " + msg);
            }
            var url = finishDoc.RootElement.GetProperty("result").GetProperty("url").GetString();
            var name = finishDoc.RootElement.GetProperty("result").GetProperty("name").GetString();
            Assert.NotNull(url);
            Assert.Equal("cs2-showcase.mp4", name);

            var mp4 = await client.GetByteArrayAsync(server.BaseUrl + url);
            Assert.True(mp4.Length > 1000, $"mp4 too small: {mp4.Length}");
            Assert.Equal("ftyp", Encoding.ASCII.GetString(mp4, 4, 4));
        }
        finally
        {
            server.Stop();
            Directory.Delete(dir, true);
        }
    }

    private static (BridgeServer server, string dir) Start()
    {
        var dir = Path.Combine(Path.GetTempPath(), "radar-bridge-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        Directory.CreateDirectory(Path.Combine(dir, "frontend"));
        File.WriteAllText(Path.Combine(dir, "frontend", "index.html"), "<html><head></head><body>test</body></html>");
        var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db"));
        var server = new BridgeServer(app, Path.Combine(dir, "frontend"), 0);
        server.Start();
        return (server, dir);
    }

    private static async Task<string> Call(HttpClient client, BridgeServer server, string method, params object?[] args)
    {
        var payload = JsonSerializer.Serialize(new { method, args });
        var content = new StringContent(payload, Encoding.UTF8, "application/json");
        var resp = await client.PostAsync(server.BaseUrl + "/__bridge", content);
        return await resp.Content.ReadAsStringAsync();
    }
}
