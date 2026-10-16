using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Radar.Domain.Models;

namespace Radar.Api;

public class BridgeServer
{
    private readonly DesktopApp app;
    private readonly TcpListener listener;
    private readonly string frontendDir;
    private readonly Thread acceptThread;
    private readonly CancellationTokenSource cts = new();
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };
    private long lastHeartbeatTicks;

    /// <summary>浏览器页面存活心跳的最近一次时间（UTC）。</summary>
    public DateTime LastHeartbeatUtc => new(Interlocked.Read(ref lastHeartbeatTicks), DateTimeKind.Utc);

    /// <summary>前端调用 QuitApp 时触发，用于让宿主进程退出。</summary>
    public Action? OnShutdownRequested { get; set; }

    public string BaseUrl { get; }
    public int Port { get; }

    public BridgeServer(DesktopApp app, string frontendDir, int port = 37481)
    {
        this.app = app;
        this.frontendDir = frontendDir;
        (Port, listener) = BindLoopback(port);
        BaseUrl = $"http://127.0.0.1:{Port}";
        acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "bridge-server" };
    }

    private static (int port, TcpListener listener) BindLoopback(int preferredPort)
    {
        // HttpListener is unusable for normal Windows users (http.sys requires admin or a URL ACL).
        // A raw loopback TcpListener needs no elevation, so it works for every Windows account.
        for (var attempt = 0; attempt < 50; attempt++)
        {
            var candidate = preferredPort + attempt;
            try
            {
                var listener = new TcpListener(IPAddress.Loopback, candidate);
                listener.Start();
                var actualPort = ((IPEndPoint)listener.LocalEndpoint).Port;
                return (actualPort, listener);
            }
            catch (SocketException)
            {
                // Port busy or unavailable; try the next one.
            }
        }
        throw new InvalidOperationException($"无法在 127.0.0.1 上找到可用端口（起始端口 {preferredPort}）。");
    }

    public void Start()
    {
        acceptThread.Start();
    }

    public void Stop()
    {
        cts.Cancel();
        try { listener.Stop(); } catch { }
    }

    private void AcceptLoop()
    {
        while (!cts.IsCancellationRequested)
        {
            TcpClient client;
            try { client = listener.AcceptTcpClient(); }
            catch { if (cts.IsCancellationRequested) return; continue; }
            _ = Task.Run(() => HandleClient(client));
        }
    }

    private void HandleClient(TcpClient client)
    {
        try
        {
            using (client)
            using (var stream = client.GetStream())
            {
                var reader = new HttpReader(stream);
                while (true)
                {
                    var request = reader.ReadRequest();
                    if (request == null) return;
                    var keepAlive = request.KeepAlive;
                    Handle(stream, request, keepAlive);
                    if (!keepAlive) return;
                }
            }
        }
        catch
        {
            // Client closed the connection mid-request; nothing to do.
        }
    }

    private void Handle(Stream stream, HttpRequest request, bool keepAlive)
    {
        try
        {
            var path = request.Path;
            if (path == "/studio-bridge.js")
            {
                if (request.Method == "GET") { WriteBytes(stream, 200, "application/javascript", BridgeScriptBytes, keepAlive); return; }
                WriteBytes(stream, 405, "text/plain; charset=utf-8", MethodNotAllowed, keepAlive);
                return;
            }
            if (path == "/__bridge")
            {
                if (request.Method == "POST")
                {
                    if (!IsTrustedRequest(request))
                    {
                        WriteBytes(stream, 403, "text/plain; charset=utf-8", Forbidden, keepAlive);
                        return;
                    }
                    WriteBytes(stream, 200, "application/json; charset=utf-8", HandleBridge(request.Body), keepAlive);
                    return;
                }
                WriteBytes(stream, 405, "text/plain; charset=utf-8", MethodNotAllowed, keepAlive);
                return;
            }
            if (path == "/__bridge-bin")
            {
                if (request.Method == "POST")
                {
                    if (!IsTrustedRequest(request))
                    {
                        WriteBytes(stream, 403, "text/plain; charset=utf-8", Forbidden, keepAlive);
                        return;
                    }
                    WriteBytes(stream, 200, "application/json; charset=utf-8", HandleBinaryFrames(request), keepAlive);
                    return;
                }
                WriteBytes(stream, 405, "text/plain; charset=utf-8", MethodNotAllowed, keepAlive);
                return;
            }
            if (request.Method == "GET" && request.Path.StartsWith("/video-download", StringComparison.Ordinal))
            {
                ServeVideoDownload(stream, request.Query);
                return;
            }
            if (request.Method == "GET")
                ServeStatic(stream, path, keepAlive);
            else
                WriteBytes(stream, 405, "text/plain; charset=utf-8", MethodNotAllowed, keepAlive);
        }
        catch (Exception ex)
        {
            WriteBytes(stream, 500, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(ex.Message), keepAlive);
        }
    }

    private static readonly byte[] MethodNotAllowed = Encoding.UTF8.GetBytes("Method Not Allowed");
    private static readonly byte[] Forbidden = Encoding.UTF8.GetBytes("Forbidden");
    private static readonly byte[] BadRequest = Encoding.UTF8.GetBytes("Bad Request");
    private static readonly byte[] NotFound = Encoding.UTF8.GetBytes("Not Found");
    private static readonly byte[] BridgeScriptBytes = Encoding.UTF8.GetBytes(BridgeScript);

    public const string BridgeScript = @"(function(){
  function post(method, args){
    return fetch('/__bridge', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({method:method, args:args || []})})
      .then(function(r){ return r.json(); })
      .then(function(resp){
        if (resp.error) { var e = new Error(resp.error.message || 'bridge error'); e.code = resp.error.code; throw e; }
        return resp.result;
      });
  }
  var api = {
    Bootstrap: function(){ return post('Bootstrap'); },
    ChooseImportDirectory: function(){ return post('ChooseImportDirectory'); },
    ChooseImportFiles: function(){ return post('ChooseImportFiles'); },
    AddImportSource: function(path){ return post('AddImportSource', [path]); },
    RemoveImportSource: function(id){ return post('RemoveImportSource', [id]); },
    StartSourceScan: function(ids){ return post('StartSourceScan', [ids]); },
    StartFileImport: function(paths){ return post('StartFileImport', [paths]); },
    ImportSummary: function(jobId){ return post('ImportSummary', [jobId]); },
    CancelImport: function(jobId){ return post('CancelImport', [jobId]); },
    FollowAndBackfill: function(jobId, path, players){ return post('FollowAndBackfill', [jobId, path, players]); },
    ListDemos: function(){ return post('ListDemos'); },
    UpdateDemoNote: function(demoId, note){ return post('UpdateDemoNote', [demoId, note]); },
    DeleteDemos: function(demoIds){ return post('DeleteDemos', [demoIds]); },
    GetDemoAnalysis: function(demoId){ return post('GetDemoAnalysis', [demoId]); },
    ReparseDemoAnalysis: function(demoId){ return post('ReparseDemoAnalysis', [demoId]); },
    ChooseReplacementDemo: function(demoId){ return post('ChooseReplacementDemo', [demoId]); },
    GetPlayerAvatars: function(steamIds){ return post('GetPlayerAvatars', [steamIds]); },
    RefreshPlayerAvatars: function(steamIds){ return post('RefreshPlayerAvatars', [steamIds]); },
    FollowDemoPlayers: function(demoId, steamIds){ return post('FollowDemoPlayers', [demoId, steamIds]); },
    ListPlayers: function(){ return post('ListPlayers'); },
    GetPlayerMatches: function(steamId){ return post('GetPlayerMatches', [steamId]); },
    ListMatchGroups: function(steamId){ return post('ListMatchGroups', [steamId]); },
    CreateMatchGroup: function(steamId, name){ return post('CreateMatchGroup', [steamId, name]); },
    RenameMatchGroup: function(groupId, name){ return post('RenameMatchGroup', [groupId, name]); },
    DeleteMatchGroup: function(groupId){ return post('DeleteMatchGroup', [groupId]); },
    AssignMatchGroup: function(steamId, demoId, groupId){ return post('AssignMatchGroup', [steamId, demoId, groupId]); },
    SetPlayerFollowed: function(player, followed){ return post('SetPlayerFollowed', [player, followed]); },
    DeletePlayerData: function(steamId){ return post('DeletePlayerData', [steamId]); },
    DeletePlayerMatches: function(steamId, ids){ return post('DeletePlayerMatches', [steamId, ids]); },
    ClearAllData: function(){ return post('ClearAllData'); },
    ChooseDatabase: function(){ return post('ChooseDatabase'); },
    BuildRadar: function(steamId, ids){ return post('BuildRadar', [steamId, ids]); },
    GetRatingMethodology: function(){ return post('GetRatingMethodology'); },
    LoadDraft: function(kind){ return post('LoadDraft', [kind]); },
    SaveDraft: function(kind, payload){ return post('SaveDraft', [kind, payload]); },
    SavePreferences: function(w,h,fps,ffmpeg,reduced,best,intro,bestEntrance,offset,scaleMode,scale,axis,ratingVersion,showWatermark,floor){ return post('SavePreferences',[w,h,fps,ffmpeg,reduced,best,intro,bestEntrance,offset,scaleMode,scale,axis,ratingVersion,showWatermark,floor]); },
    ChooseFFmpeg: function(){ return post('ChooseFFmpeg'); },
    ExportPNG: function(dataURL, name){ return post('ExportPNG', [dataURL, name]); },
    GetPlayerMedia: function(steamId){ return post('GetPlayerMedia', [steamId]); },
    ChoosePlayerMedia: function(steamId, kind){ return post('ChoosePlayerMedia', [steamId, kind]); },
    SetPlayerImageURL: function(steamId, url){ return post('SetPlayerImageURL', [steamId, url]); },
    ClearPlayerMedia: function(steamId, kind){ return post('ClearPlayerMedia', [steamId, kind]); },
    ChooseShowcaseMusic: function(){ return post('ChooseShowcaseMusic'); },
    GetShowcaseMusic: function(){ return post('GetShowcaseMusic'); },
    GetShowcaseMusicInfo: function(){ return post('GetShowcaseMusicInfo'); },
    ClearShowcaseMusic: function(){ return post('ClearShowcaseMusic'); },
    BeginVideoExport: function(w,h,fps,dur,offset,name){ return post('BeginVideoExport',[w,h,fps,dur,offset,name]); },
    AppendVideoFrames: function(id,start,frames){ return post('AppendVideoFrames',[id,start,frames]); },
    FinishVideoExport: function(id){ return post('FinishVideoExport',[id]); },
    CancelVideoExport: function(id){ return post('CancelVideoExport',[id]); }
  };
  window.__studioBridge = api;
})();";

    /// <summary>
    /// 应用现在由系统浏览器承载（而非嵌入式 WebView），因此必须防跨站伪造与 DNS 重绑定：
    /// 校验 Host 头，且当带 Origin 头时必须与本机地址一致。
    /// </summary>
    private bool IsTrustedRequest(HttpRequest request)
    {
        var hostOk = request.Host.Equals($"127.0.0.1:{Port}", StringComparison.OrdinalIgnoreCase)
                  || request.Host.Equals($"localhost:{Port}", StringComparison.OrdinalIgnoreCase)
                  || request.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase);
        if (!hostOk) return false;
        if (string.IsNullOrEmpty(request.Origin)) return true; // 非浏览器客户端（curl、测试等）
        var origin = request.Origin;
        return origin.Equals($"http://127.0.0.1:{Port}", StringComparison.OrdinalIgnoreCase)
            || origin.Equals($"http://localhost:{Port}", StringComparison.OrdinalIgnoreCase);
    }

    private byte[] HandleBridge(byte[] body)
    {
        object? result = null;
        object? error = null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            var method = doc.RootElement.GetProperty("method").GetString() ?? "";
            var args = new List<JsonElement>();
            if (doc.RootElement.TryGetProperty("args", out var argsEl) && argsEl.ValueKind == JsonValueKind.Array)
                foreach (var el in argsEl.EnumerateArray()) args.Add(el);

            if (method == "Ping")
            {
                Interlocked.Exchange(ref lastHeartbeatTicks, DateTime.UtcNow.Ticks);
                result = new { ok = true };
            }
            else if (method == "QuitApp")
            {
                OnShutdownRequested?.Invoke();
                result = null;
            }
            else
            {
                result = app.Invoke(method, args);
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
        var response = new { result, error };
        return Encoding.UTF8.GetBytes(JsonSerializer.Serialize(response));
    }

    /// <summary>
    /// 二进制视频帧上传：4B 帧数 + 4B 起始序号 + N × (4B 长度 + PNG 数据)。
    /// 相对 JSON/base64 帧上传减少约 1/3 的传输与序列化开销。
    /// </summary>
    private byte[] HandleBinaryFrames(HttpRequest request)
    {
        object? result = null;
        object? error = null;
        try
        {
            var exportId = ParseQuery(request.Query).GetValueOrDefault("exportId");
            var body = request.Body;
            if (string.IsNullOrEmpty(exportId) || body.Length < 8)
                throw AppErrors.New("video_export_not_found", AppErrors.StatusBadRequest, "视频导出任务不存在。");
            var frameCount = ReadInt32(body, 0);
            var startIndex = ReadInt32(body, 4);
            if (frameCount < 0 || frameCount > ShowcaseVideo.MaxBatchFrames)
                throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "单批帧数量超过限制。");
            var frames = new byte[frameCount][];
            var offset = 8;
            for (var i = 0; i < frameCount; i++)
            {
                if (offset + 4 > body.Length)
                    throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "视频帧数据不完整。");
                var length = ReadInt32(body, offset);
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
        var response = new { result, error };
        return Encoding.UTF8.GetBytes(JsonSerializer.Serialize(response));
    }

    private static int ReadInt32(byte[] data, int offset)
        => (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];

    private void ServeStatic(Stream stream, string path, bool keepAlive)
    {
        if (path == "/" || string.IsNullOrEmpty(path)) path = "/index.html";
        var safePath = path.TrimStart('/').Replace("..", "");
        var file = Path.Combine(frontendDir, safePath.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(file))
        {
            file = Path.Combine(frontendDir, "index.html");
            if (!File.Exists(file))
            {
                WriteBytes(stream, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not Found"), keepAlive);
                return;
            }
        }
        var bytes = File.ReadAllBytes(file);
        var contentType = ContentTypeFor(file);
        if (file.EndsWith("index.html", StringComparison.OrdinalIgnoreCase))
        {
            var html = Encoding.UTF8.GetString(bytes);
            html = html.Replace("</head>",
                "<script src=\"/studio-bridge.js\"></script>" +
                "<script>" +
                "(function(){function p(){try{fetch('/__bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'Ping',args:[]}),keepalive:true});}catch(e){}}" +
                "p();setInterval(p,5000);})();" +
                "</script>" +
                "</head>");
            bytes = Encoding.UTF8.GetBytes(html);
        }
        WriteBytes(stream, 200, contentType, bytes, keepAlive);
    }

    /// <summary>通过一次性令牌流式输出已导出的视频，输出完成后清理临时目录。</summary>
    private void ServeVideoDownload(Stream stream, string query)
    {
        var token = ParseQuery(query).GetValueOrDefault("token");
        if (string.IsNullOrEmpty(token))
        {
            WriteBytes(stream, 400, "text/plain; charset=utf-8", BadRequest, false);
            return;
        }
        var download = app.ConsumeVideoDownload(token);
        if (download == null || !File.Exists(download.Path))
        {
            WriteBytes(stream, 404, "text/plain; charset=utf-8", NotFound, false);
            return;
        }
        try
        {
            var safeName = download.Name.Replace("\"", "_");
            var length = new FileInfo(download.Path).Length;
            var head = Encoding.ASCII.GetBytes(
                $"HTTP/1.1 200 OK\r\n" +
                $"Content-Type: video/mp4\r\n" +
                $"Content-Length: {length}\r\n" +
                $"Content-Disposition: attachment; filename=\"{safeName}\"\r\n" +
                $"Connection: close\r\n" +
                "\r\n");
            stream.Write(head, 0, head.Length);
            using (var file = File.OpenRead(download.Path))
                file.CopyTo(stream, 65536);
            stream.Flush();
        }
        finally
        {
            var dir = Path.GetDirectoryName(download.Path);
            if (!string.IsNullOrEmpty(dir)) { try { Directory.Delete(dir, true); } catch { /* ignore */ } }
        }
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(query)) return result;
        foreach (var pair in query.Split('&'))
        {
            var eq = pair.IndexOf('=');
            if (eq < 0) continue;
            try
            {
                result[Uri.UnescapeDataString(pair[..eq])] = Uri.UnescapeDataString(pair[(eq + 1)..]);
            }
            catch
            {
                // ignore malformed pairs
            }
        }
        return result;
    }

    private static string ContentTypeFor(string file) => Path.GetExtension(file).ToLowerInvariant() switch    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "application/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".woff2" => "font/woff2",
        ".woff" => "font/woff",
        ".ttf" => "font/ttf",
        ".json" => "application/json",
        ".map" => "application/json",
        _ => "application/octet-stream",
    };

    private static void WriteBytes(Stream stream, int status, string contentType, byte[] body, bool keepAlive)
    {
        var head = Encoding.ASCII.GetBytes(
            $"HTTP/1.1 {status} {StatusText(status)}\r\n" +
            $"Content-Type: {contentType}\r\n" +
            $"Content-Length: {body.Length}\r\n" +
            $"Connection: {(keepAlive ? "keep-alive" : "close")}\r\n" +
            "\r\n");
        stream.Write(head, 0, head.Length);
        stream.Write(body, 0, body.Length);
        stream.Flush();
    }

    private static string StatusText(int status) => status switch
    {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "Unknown",
    };

    private sealed class HttpRequest
    {
        public string Method = "";
        public string Path = "";
        public string Query = "";
        public bool KeepAlive = true;
        public string Host = "";
        public string Origin = "";
        public byte[] Body = Array.Empty<byte>();
    }

    private sealed class HttpReader
    {
        private readonly Stream stream;
        private readonly byte[] buffer = new byte[8192];
        private int pos;
        private int len;

        public HttpReader(Stream stream) => this.stream = stream;

        private int ReadByte()
        {
            if (pos >= len)
            {
                len = stream.Read(buffer, 0, buffer.Length);
                pos = 0;
                if (len <= 0) return -1;
            }
            return buffer[pos++];
        }

        private int ReadBlock(byte[] target, int offset, int count)
        {
            var copied = 0;
            while (copied < count)
            {
                if (pos >= len)
                {
                    len = stream.Read(buffer, 0, buffer.Length);
                    pos = 0;
                    if (len <= 0) break;
                }
                var n = Math.Min(len - pos, count - copied);
                Array.Copy(buffer, pos, target, offset + copied, n);
                pos += n;
                copied += n;
            }
            return copied;
        }

        public HttpRequest? ReadRequest()
        {
            var header = new List<byte>();
            var state = 0; // 0=start 1=saw \r 2=saw \r\n 3=saw \r\n\r 4=complete \r\n\r\n
            while (true)
            {
                var b = ReadByte();
                if (b < 0) return null;
                header.Add((byte)b);
                if (b == '\r')
                    state = state == 2 ? 3 : 1;
                else if (b == '\n')
                {
                    if (state == 1) state = 2;
                    else if (state == 3) { state = 4; break; }
                    else state = 0;
                }
                else state = 0;
            }

            var lines = Encoding.ASCII.GetString(header.ToArray()).Split("\r\n");
            if (lines.Length == 0) return null;
            var parts = lines[0].Split(' ');
            if (parts.Length < 3) return null;
            var method = parts[0];
            var rawPath = parts[1];
            var version = parts[2];
            var keepAlive = !version.Equals("HTTP/1.0", StringComparison.OrdinalIgnoreCase);
            var host = "";
            var origin = "";

            long contentLength = 0;
            for (var i = 1; i < lines.Length; i++)
            {
                var line = lines[i];
                var colon = line.IndexOf(':');
                if (colon < 0) continue;
                var name = line[..colon].Trim();
                var value = line[(colon + 1)..].Trim();
                if (name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
                    long.TryParse(value, out contentLength);
                else if (name.Equals("Connection", StringComparison.OrdinalIgnoreCase))
                {
                    if (value.Contains("close", StringComparison.OrdinalIgnoreCase)) keepAlive = false;
                    else if (value.Contains("keep-alive", StringComparison.OrdinalIgnoreCase)) keepAlive = true;
                }
                else if (name.Equals("Host", StringComparison.OrdinalIgnoreCase))
                    host = value;
                else if (name.Equals("Origin", StringComparison.OrdinalIgnoreCase))
                    origin = value;
            }

            var body = new byte[contentLength];
            if (contentLength > 0 && ReadBlock(body, 0, body.Length) < contentLength)
                return null;

            var query = rawPath.IndexOf('?');
            var path = query >= 0 ? rawPath[..query] : rawPath;
            var queryString = query >= 0 ? rawPath[(query + 1)..] : "";
            try { path = Uri.UnescapeDataString(path); } catch { }

            return new HttpRequest { Method = method, Path = path, Query = queryString, KeepAlive = keepAlive, Host = host, Origin = origin, Body = body };
        }
    }
}

public static class JsonSnake
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}
