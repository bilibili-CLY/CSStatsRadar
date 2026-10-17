using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Xunit;

namespace Radar.Tests;

/// <summary>
/// Radar.Server sidecar 契约测试：拉起真实 Kestrel 进程，验证 Tauri 壳依赖的
/// /api/* 端点与旧 /__bridge 兼容面的行为。算法本身由 StatsParityTests 锁定，
/// 这里只覆盖传输与生命周期。
/// </summary>
public class ServerSidecarTests : IAsyncLifetime
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };
    private readonly string tempDir = Path.Combine(Path.GetTempPath(), "radar-server-test-" + Guid.NewGuid().ToString("N"));
    private readonly HttpClient http = new();
    private Process? server;
    private string baseUrl = "";
    private const string InstanceId = "test-instance-1";

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(tempDir);
        var (proc, url) = StartServer(InstanceId);
        server = proc;
        baseUrl = url;
        var deadline = DateTime.UtcNow.AddSeconds(25);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var resp = await http.GetAsync(baseUrl + "/api/health");
                if (resp.IsSuccessStatusCode) return;
            }
            catch { /* starting */ }
            await Task.Delay(250);
        }
        throw new TimeoutException("Radar.Server did not become healthy in time.");
    }

    public async Task DisposeAsync()
    {
        http.Dispose();
        if (server is { HasExited: false } p)
        {
            try { p.Kill(entireProcessTree: true); } catch { /* ignore */ }
            await Task.Run(() => { try { p.WaitForExit(5000); } catch { /* ignore */ } });
        }
        try { Directory.Delete(tempDir, true); } catch { /* ignore */ }
    }

    private (Process proc, string url) StartServer(string instanceId)
    {
        var testBin = AppContext.BaseDirectory;
        var tfm = new DirectoryInfo(testBin).Name;
        var cfg = new DirectoryInfo(testBin).Parent?.Name ?? "Debug";
        var dll = Path.GetFullPath(Path.Combine(
            testBin, "..", "..", "..", "..", "Radar.Server", "bin", cfg, tfm, "CSStatsRadar.Server.dll"));
        Assert.True(File.Exists(dll), $"Server binary not found: {dll}");

        var port = FreePort();
        var psi = new ProcessStartInfo("dotnet", $"\"{dll}\"")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.Environment["CS_RADAR_PORT"] = port.ToString();
        psi.Environment["CS_RADAR_INSTANCE_ID"] = instanceId;
        psi.Environment["CS_RADAR_CONFIG_PATH"] = Path.Combine(tempDir, "config.json");
        psi.Environment["CS_RADAR_DB_PATH"] = Path.Combine(tempDir, "test.db");
        // 数据/日志/恢复标记根目录：测试必须与用户真实数据目录隔离。
        psi.Environment["CS_RADAR_DATA_DIR"] = tempDir;
        psi.Environment["CS_RADAR_WEB_DIR"] = Path.Combine(tempDir, "web-empty");
        psi.Environment["DOTNET_NOLOGO"] = "1";
        var proc = Process.Start(psi)!;
        proc.OutputDataReceived += (_, _) => { };
        proc.BeginOutputReadLine();
        return (proc, $"http://127.0.0.1:{port}");
    }

    private static int FreePort()
    {
        using var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        return ((IPEndPoint)l.LocalEndpoint).Port;
    }

    private async Task<JsonDocument> PostBridgeAsync(string method, string rawArgs = "[]", string? hostHeader = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, baseUrl + "/__bridge")
        {
            Content = new StringContent(
                $"{{\"method\":\"{method}\",\"args\":{rawArgs}}}", Encoding.UTF8, "application/json"),
        };
        if (hostHeader != null) req.Headers.Host = hostHeader;
        var resp = await http.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync());
    }

    [Fact]
    public async Task Health_ReturnsOk()
    {
        var resp = await http.GetAsync(baseUrl + "/api/health");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync());
        Assert.Equal("ok", doc.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task RuntimeState_MatchesInstanceId()
    {
        var resp = await http.GetAsync(baseUrl + "/api/app/runtime-state");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync());
        Assert.Equal(InstanceId, doc.RootElement.GetProperty("instance_id").GetString());
        Assert.False(doc.RootElement.GetProperty("recovery_required").GetBoolean());
    }

    /// <summary>
    /// 数据目录必须由 CS_RADAR_DATA_DIR 决定，与数据库路径无关：
    /// 否则历史 config 里的盘根路径（E:\xxx.db）会把日志写到盘根。
    /// </summary>
    [Fact]
    public async Task RuntimeState_DataDir_FollowsDataDirOverride()
    {
        var resp = await http.GetAsync(baseUrl + "/api/app/runtime-state");
        using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync());
        Assert.Equal(
            Path.GetFullPath(tempDir).TrimEnd(Path.DirectorySeparatorChar),
            Path.GetFullPath(doc.RootElement.GetProperty("data_dir").GetString()!).TrimEnd(Path.DirectorySeparatorChar));
    }

    /// <summary>
    /// 契约端点必须回定长 JSON。Tauri 壳（raw_http）在第一个空行处切分首部后直接把
    /// 剩余内容交给 serde_json；若 Kestrel 回 `Transfer-Encoding: chunked`，壳解析
    /// 必然失败并报「后端启动超时（15s 未确认身份）」——即 v2.3.0 的启动失败现场。
    /// </summary>
    [Fact]
    public void ContractEndpoints_UseContentLength_NotChunked()
    {
        var port = new Uri(baseUrl).Port;
        var raw = RawHttpGet("/api/app/runtime-state", $"127.0.0.1:{port}");
        Assert.False(raw.Contains("Transfer-Encoding", StringComparison.OrdinalIgnoreCase), raw);
        Assert.True(raw.Contains("Content-Length", StringComparison.OrdinalIgnoreCase), raw);
        var split = raw.IndexOf("\r\n\r\n", StringComparison.Ordinal);
        Assert.True(split > 0, raw);
        using var doc = JsonDocument.Parse(raw[(split + 4)..]);
        Assert.Equal(InstanceId, doc.RootElement.GetProperty("instance_id").GetString());
    }

    /// <summary>裸 socket 请求：完全复刻 Tauri 壳 raw_http 的报文形状。</summary>
    private string RawHttpGet(string path, string host)
    {
        using var client = new TcpClient();
        client.Connect(IPAddress.Loopback, new Uri(baseUrl).Port);
        client.ReceiveTimeout = 15000;
        using var stream = client.GetStream();
        var request = Encoding.ASCII.GetBytes(
            $"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        stream.Write(request, 0, request.Length);
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    [Fact]
    public async Task Bridge_Bootstrap_Works()
    {
        using var doc = await PostBridgeAsync("Bootstrap");
        var root = doc.RootElement;
        Assert.True(root.TryGetProperty("result", out var result));
        Assert.True(result.TryGetProperty("config", out _));
        Assert.Equal(JsonValueKind.Null, root.GetProperty("error").ValueKind);
    }

    [Fact]
    public async Task Bridge_Bin_UnknownExport_ReturnsVideoExportNotFound()
    {
        // 4B frameCount=0 + 4B startIndex=0：帧解析通过，exportId 未知。
        var body = new byte[8];
        var req = new HttpRequestMessage(HttpMethod.Post, baseUrl + "/__bridge-bin?exportId=nope")
        {
            Content = new ByteArrayContent(body),
        };
        req.Content.Headers.ContentType = new("application/octet-stream");
        var resp = await http.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync());
        Assert.Equal("video_export_not_found", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Bridge_RejectsUntrustedHost()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, baseUrl + "/__bridge")
        {
            Content = new StringContent("{\"method\":\"Bootstrap\",\"args\":[]}", Encoding.UTF8, "application/json"),
        };
        req.Headers.Host = "evil.example.com";
        var resp = await http.SendAsync(req);
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Bridge_OriginMatrix_Allows_Loopback_Tauri_Dev_Rejects_Evil()
    {
        async Task<HttpStatusCode> PingWithOrigin(string? origin)
        {
            var req = new HttpRequestMessage(HttpMethod.Post, baseUrl + "/__bridge")
            {
                Content = new StringContent("{\"method\":\"Ping\",\"args\":[]}", Encoding.UTF8, "application/json"),
            };
            if (origin != null) req.Headers.Add("Origin", origin);
            var resp = await http.SendAsync(req);
            return resp.StatusCode;
        }

        Assert.Equal(HttpStatusCode.OK, await PingWithOrigin(null)); // 非浏览器客户端
        Assert.Equal(HttpStatusCode.OK, await PingWithOrigin("http://tauri.localhost"));
        Assert.Equal(HttpStatusCode.OK, await PingWithOrigin("http://127.0.0.1:5173")); // vite dev
        Assert.Equal(HttpStatusCode.Forbidden, await PingWithOrigin("https://evil.com"));
    }

    [Fact]
    public async Task PrepareExit_WrongInstance_Returns409()
    {
        var resp = await http.PostAsync(baseUrl + "/api/app/prepare-exit?instance_id=other", null);
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        resp = await http.PostAsync(baseUrl + $"/api/app/prepare-exit?instance_id={InstanceId}", null);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Shutdown_StopsOwnServerProcess()
    {
        // 独立实例：关停不影响类级 fixture 进程。
        var (proc, url) = StartServer("shutdown-probe");
        try
        {
            var deadline = DateTime.UtcNow.AddSeconds(25);
            while (DateTime.UtcNow < deadline)
            {
                try
                {
                    if ((await http.GetAsync(url + "/api/health")).IsSuccessStatusCode) break;
                }
                catch { /* starting */ }
                await Task.Delay(250);
            }
            var resp = await http.PostAsync(url + "/api/app/shutdown", null);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            Assert.True(proc.WaitForExit(10000), "Server did not stop after /api/app/shutdown.");
        }
        finally
        {
            if (!proc.HasExited) { try { proc.Kill(entireProcessTree: true); } catch { /* ignore */ } }
            proc.Dispose();
        }
    }
}
