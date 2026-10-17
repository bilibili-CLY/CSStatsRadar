// CSStatsRadar sidecar 后端：Kestrel 只绑 loopback，供 Tauri 壳（及浏览器直连）调用。
// 协议兼容旧 BridgeServer：POST /__bridge、POST /__bridge-bin、/studio-bridge.js、
// /video-download，以及静态前端托管 + SPA 回退。
// 新增 sidecar 契约（对齐 CS2-insight-agent 模式）：
//   GET  /api/health、GET /api/app/runtime-state、
//   POST /api/app/prepare-exit?instance_id=、POST /api/app/shutdown
// 算法与业务全部复用 Radar.Api.DesktopApp，本文件只做传输与生命周期。
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Radar.Api;
using Radar.Domain.Models;
using Radar.Infrastructure;

var preferredPort = EnvInt("CS_RADAR_PORT", 19871);
var instanceId = EnvStr("CS_RADAR_INSTANCE_ID") is { Length: > 0 } id ? id : NewInstanceId();
var configPath = ArgOrEnv(args, 0, "CS_RADAR_CONFIG_PATH");
var dbPath = ArgOrEnv(args, 1, "CS_RADAR_DB_PATH");
var webDirArg = ArgOrEnv(args, 2, "CS_RADAR_WEB_DIR");

var port = ProbeLoopbackPort(preferredPort);
var app = new DesktopApp(configPath, dbPath);
// 数据/日志根目录必须与 CWD、数据库路径无关：安装器拉起进程时 CWD 可能停在
// 安装包所在的盘（例如 E:\），而历史 config.json 里可能留着 E:\xxx.db，
// 旧实现据此推导数据目录会把日志写到盘根。
var dataDir = AppPaths.DataDir();
var recoveryMarker = Path.Combine(dataDir, "recovery-required.json");
var cleanShutdown = false;
AppDomain.CurrentDomain.ProcessExit += (_, _) =>
{
    if (!cleanShutdown)
    {
        try { File.WriteAllText(recoveryMarker, "{\"reason\":\"server process exited without clean shutdown\"}\n"); }
        catch { /* ignore */ }
    }
};

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
// 原生裸 TcpListener 服务对请求体没有上限；Kestrel 默认 30MB 会截断
// 30 帧 PNG 批量上传，这里放宽到 512MB（仅 loopback + CSRF 校验端点可用）。
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 512 * 1024 * 1024);
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins(
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        $"http://127.0.0.1:{port}",
        $"http://localhost:{port}")
    .AllowAnyMethod()
    .AllowAnyHeader()));

var web = builder.Build();
web.UseCors();

var jsonOpts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0";
var webDir = ResolveWebDir(webDirArg);
Log($"CSStatsRadar.Server v{version} instance={instanceId} port={port} webDir={webDir ?? "(api-only)"} dataDir={dataDir} config={configPath ?? ConfigManager.DefaultConfigPath()} db={app.CurrentConfig.DatabasePath}");
if (IsDriveRoot(Path.GetDirectoryName(Path.GetFullPath(app.CurrentConfig.DatabasePath))))
    Log($"警告：数据库位于盘根目录（{app.CurrentConfig.DatabasePath}）。日志与恢复标记已固定写入 {dataDir}，不受其影响；若该库不需要，可在设置中改回默认路径。");
Console.WriteLine($"__CSRADAR_PORT__={port}");
Console.WriteLine($"__CSRADAR_INSTANCE__={instanceId}");
Console.Out.Flush();

bool IsTrusted(HttpRequest req)
{
    var host = req.Host.ToString();
    var hostOk = host.Equals($"127.0.0.1:{port}", StringComparison.OrdinalIgnoreCase)
        || host.Equals($"localhost:{port}", StringComparison.OrdinalIgnoreCase)
        || host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase);
    if (!hostOk) return false;
    if (!req.Headers.TryGetValue("Origin", out var originValues)) return true; // 非浏览器客户端
    var origin = originValues.ToString();
    return origin.Equals($"http://127.0.0.1:{port}", StringComparison.OrdinalIgnoreCase)
        || origin.Equals($"http://localhost:{port}", StringComparison.OrdinalIgnoreCase)
        || origin.Equals("http://tauri.localhost", StringComparison.OrdinalIgnoreCase)
        || origin.Equals("https://tauri.localhost", StringComparison.OrdinalIgnoreCase)
        || origin.Equals("tauri://localhost", StringComparison.OrdinalIgnoreCase)
        // 仅 loopback 开发服务器：vite dev（默认 :5173）直连 sidecar 调试。
        || origin.Equals("http://127.0.0.1:5173", StringComparison.OrdinalIgnoreCase)
        || origin.Equals("http://localhost:5173", StringComparison.OrdinalIgnoreCase);
}

byte[] BridgeResult(object? result, object? error) =>
    Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { result, error }));

// ─── sidecar 契约 ───

// 契约端点必须用定长 JSON：Kestrel 对 Results.Json 这类流式写入使用
// `Transfer-Encoding: chunked`，朴素客户端（Tauri 壳的 raw_http、旧版桥）在第一个
// 空行处切分后解析 JSON 必然失败，表现为「后端启动超时（15s 未确认身份）」。
IResult FixedJson(object payload, int statusCode = StatusCodes.Status200OK) =>
    Results.Text(JsonSerializer.Serialize(payload), "application/json; charset=utf-8", Encoding.UTF8, statusCode);

web.MapGet("/api/health", () => FixedJson(new { status = "ok", version }));

web.MapGet("/api/app/runtime-state", () => FixedJson(new
{
    pid = Environment.ProcessId,
    instance_id = instanceId,
    version,
    data_dir = dataDir,
    recovery_required = File.Exists(recoveryMarker),
}));

web.MapPost("/api/app/prepare-exit", (string? instance_id) =>
{
    if (instance_id != instanceId)
        return FixedJson(new { instance_id = instanceId, allowed = false, message = "暂时无法确认后台任务状态，请稍后重试。" }, StatusCodes.Status409Conflict);
    return FixedJson(new { instance_id = instanceId, allowed = true });
});

web.MapPost("/api/app/shutdown", async (IHostApplicationLifetime lifetime) =>
{
    app.Shutdown();
    try { if (File.Exists(recoveryMarker)) File.Delete(recoveryMarker); } catch { /* ignore */ }
    cleanShutdown = true;
    _ = Task.Run(async () =>
    {
        await Task.Delay(250);
        lifetime.StopApplication();
    });
    await Task.CompletedTask;
    return FixedJson(new { safe_to_exit = true });
});

// ─── 旧桥接兼容 ───

web.MapGet("/studio-bridge.js", () =>
    Results.Content(BridgeServer.BridgeScript, "application/javascript"));

web.MapPost("/__bridge", async (HttpRequest req) =>
{
    if (!IsTrusted(req)) return Results.Text("Forbidden", "text/plain; charset=utf-8", statusCode: 403);
    using var doc = await JsonDocument.ParseAsync(req.Body, new JsonDocumentOptions { AllowTrailingCommas = true });
    object? result = null;
    object? error = null;
    try
    {
        var method = doc.RootElement.GetProperty("method").GetString() ?? "";
        var callArgs = new List<JsonElement>();
        if (doc.RootElement.TryGetProperty("args", out var argsEl) && argsEl.ValueKind == JsonValueKind.Array)
            foreach (var el in argsEl.EnumerateArray()) callArgs.Add(el);
        if (method == "Ping")
        {
            result = new { ok = true };
        }
        else if (method == "QuitApp")
        {
            app.Shutdown();
            cleanShutdown = true;
            try { if (File.Exists(recoveryMarker)) File.Delete(recoveryMarker); } catch { /* ignore */ }
            _ = Task.Run(async () =>
            {
                await Task.Delay(250);
                web.Lifetime.StopApplication();
            });
            result = null;
        }
        else
        {
            result = app.Invoke(method, callArgs);
        }
    }
    catch (AppError appErr)
    {
        error = new { code = appErr.Code, message = appErr.Message };
    }
    catch (Exception ex)
    {
        error = new { code = "internal_error", message = ex.Message };
    }
    return Results.Bytes(BridgeResult(result, error), "application/json; charset=utf-8");
});

web.MapPost("/__bridge-bin", async (HttpRequest req) =>
{
    if (!IsTrusted(req)) return Results.Text("Forbidden", "text/plain; charset=utf-8", statusCode: 403);
    object? result = null;
    object? error = null;
    try
    {
        var exportId = req.Query["exportId"].ToString();
        using var ms = new MemoryStream();
        await req.Body.CopyToAsync(ms);
        var body = ms.ToArray();
        if (string.IsNullOrEmpty(exportId) || body.Length < 8)
            throw AppErrors.New("video_export_not_found", AppErrors.StatusBadRequest, "视频导出任务不存在。");
        var frameCount = ReadInt32BE(body, 0);
        var startIndex = ReadInt32BE(body, 4);
        if (frameCount < 0 || frameCount > ShowcaseVideo.MaxBatchFrames)
            throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "单批帧数量超过限制。");
        var frames = new byte[frameCount][];
        var offset = 8;
        for (var i = 0; i < frameCount; i++)
        {
            if (offset + 4 > body.Length)
                throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "视频帧数据不完整。");
            var length = ReadInt32BE(body, offset);
            offset += 4;
            if (length < 0 || offset + length > body.Length)
                throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "视频帧数据不完整。");
            frames[i] = new byte[length];
            Buffer.BlockCopy(body, offset, frames[i], 0, length);
            offset += length;
        }
        app.AppendVideoFramesBinary(exportId, startIndex, frames);
        result = null;
    }
    catch (AppError appErr)
    {
        error = new { code = appErr.Code, message = appErr.Message };
    }
    catch (Exception ex)
    {
        error = new { code = "internal_error", message = ex.Message };
    }
    return Results.Bytes(BridgeResult(result, error), "application/json; charset=utf-8");
});

web.MapGet("/video-download", (HttpRequest req, HttpContext ctx) =>
{
    var token = req.Query["token"].ToString();
    if (string.IsNullOrEmpty(token)) return Results.BadRequest("Bad Request");
    var download = app.ConsumeVideoDownload(token);
    if (download == null || !File.Exists(download.Path)) return Results.NotFound("Not Found");
    var dir = Path.GetDirectoryName(download.Path);
    ctx.Response.OnCompleted(() =>
    {
        try { if (!string.IsNullOrEmpty(dir)) Directory.Delete(dir, true); } catch { /* ignore */ }
        return Task.CompletedTask;
    });
    return Results.File(
        File.OpenRead(download.Path),
        contentType: "video/mp4",
        fileDownloadName: download.Name.Replace("\"", "_"));
});

// ─── 静态前端 + SPA 回退（浏览器直连兼容；Tauri 模式不使用） ───

if (webDir != null)
{
    web.MapGet("/{**path}", async (HttpContext ctx, string? path) =>
    {
        if ((path ?? "").StartsWith("api/", StringComparison.Ordinal))
            return Results.NotFound("Not Found");
        var safe = (path ?? "").Replace("..", "").TrimStart('/');
        if (string.IsNullOrEmpty(safe)) safe = "index.html";
        var file = Path.Combine(webDir, safe.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(file)) file = Path.Combine(webDir, "index.html");
        if (!File.Exists(file)) return Results.NotFound("Not Found");
        var contentType = ContentTypeFor(file);
        if (file.EndsWith("index.html", StringComparison.OrdinalIgnoreCase))
        {
            var html = await File.ReadAllTextAsync(file, Encoding.UTF8);
            html = html.Replace("</head>",
                "<script src=\"/studio-bridge.js\"></script>" +
                "<script>" +
                "(function(){function p(){try{fetch('/__bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'Ping',args:[]}),keepalive:true});}catch(e){}}" +
                "p();setInterval(p,5000);})();" +
                "</script>" +
                "</head>");
            return Results.Content(html, "text/html; charset=utf-8");
        }
        return Results.File(file, contentType);
    });
}

web.Run();

// ─── helpers ───

static string? ArgOrEnv(string[] a, int index, string env)
{
    if (a.Length > index && !string.IsNullOrEmpty(a[index])) return a[index];
    var v = Environment.GetEnvironmentVariable(env);
    return string.IsNullOrEmpty(v) ? null : v;
}

static string? EnvStr(string name)
{
    var v = Environment.GetEnvironmentVariable(name);
    return string.IsNullOrEmpty(v) ? null : v;
}

/// 判断目录是否是盘根（`E:\`、`/`）——仅用于日志告警，不做自动迁移。
static bool IsDriveRoot(string? dir)
{
    if (string.IsNullOrEmpty(dir)) return false;
    var full = Path.GetFullPath(dir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    var root = (Path.GetPathRoot(Path.GetFullPath(dir)) ?? string.Empty)
        .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    return root.Length > 0 && full.Equals(root, StringComparison.OrdinalIgnoreCase);
}

static int EnvInt(string name, int fallback) =>
    int.TryParse(Environment.GetEnvironmentVariable(name), out var v) ? v : fallback;

static string NewInstanceId() =>
    $"{Environment.ProcessId}-{DateTime.UtcNow.Ticks}";

static int ProbeLoopbackPort(int preferred)
{
    // HttpListener/http.sys 需要管理员权限；Kestrel 只绑 loopback 则无需提权。
    // 端口回退保留：忙端口优雅上浮而不是启动失败。
    for (var attempt = 0; attempt < 50; attempt++)
    {
        var candidate = preferred + attempt;
        try
        {
            using var probe = new TcpListener(IPAddress.Loopback, candidate);
            probe.Start();
            return ((IPEndPoint)probe.LocalEndpoint).Port;
        }
        catch (SocketException) { /* busy; try next */ }
    }
    throw new InvalidOperationException($"无法在 127.0.0.1 上找到可用端口（起始端口 {preferred}）。");
}

static string? ResolveWebDir(string? configured)
{
    if (!string.IsNullOrEmpty(configured))
    {
        var p = Path.GetFullPath(configured);
        if (File.Exists(Path.Combine(p, "index.html"))) return p;
    }
    var current = AppContext.BaseDirectory;
    for (var i = 0; i < 6; i++)
    {
        var candidate = Path.Combine(current, "frontend", "dist");
        if (File.Exists(Path.Combine(candidate, "index.html"))) return candidate;
        candidate = Path.Combine(current, "dist");
        if (File.Exists(Path.Combine(candidate, "index.html"))) return candidate;
        var parent = Path.GetDirectoryName(current);
        if (parent == null) break;
        current = parent;
    }
    return null;
}

static string ContentTypeFor(string file) =>
    Path.GetExtension(file).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "application/javascript",
        ".css" => "text/css",
        ".json" => "application/json",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".svg" => "image/svg+xml",
        ".ico" => "image/x-icon",
        ".woff2" => "font/woff2",
        ".woff" => "font/woff",
        ".ttf" => "font/ttf",
        ".mp3" => "audio/mpeg",
        ".wav" => "audio/wav",
        ".m4a" => "audio/mp4",
        _ => "application/octet-stream",
    };

static int ReadInt32BE(byte[] data, int offset) =>
    (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];

void Log(string message)
{
    var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}";
    Console.WriteLine(line);
    try
    {
        var logsDir = Path.Combine(dataDir, "logs");
        Directory.CreateDirectory(logsDir);
        File.AppendAllText(Path.Combine(logsDir, "backend.log"), line + Environment.NewLine);
    }
    catch { /* 日志失败不影响运行 */ }
}
