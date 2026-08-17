using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Radar.Domain.Models;

namespace Radar.Api;

public class BridgeServer
{
    private readonly DesktopApp app;
    private readonly HttpListener listener;
    private readonly string frontendDir;
    private readonly Thread thread;
    private volatile bool running;
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    public string BaseUrl { get; }
    public int Port { get; }

    public BridgeServer(DesktopApp app, string frontendDir, int port = 37481)
    {
        this.app = app;
        this.frontendDir = frontendDir;
        Port = port;
        BaseUrl = $"http://127.0.0.1:{port}";
        listener = new HttpListener();
        listener.Prefixes.Add(BaseUrl + "/");
        thread = new Thread(Loop) { IsBackground = true, Name = "bridge-server" };
    }

    public void Start()
    {
        listener.Start();
        running = true;
        thread.Start();
    }

    public void Stop()
    {
        running = false;
        try { listener.Stop(); } catch { }
        try { listener.Close(); } catch { }
    }

    private void Loop()
    {
        while (running)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); }
            catch { if (!running) return; continue; }
            try { Handle(ctx); }
            catch { }
        }
    }

    private void Handle(HttpListenerContext ctx)
    {
        var path = ctx.Request.Url?.AbsolutePath ?? "/";
        try
        {
            if (path == "/studio-bridge.js")
            {
                ServeBridgeScript(ctx);
                return;
            }
            if (path == "/__bridge")
            {
                if (ctx.Request.HttpMethod == "POST")
                {
                    HandleBridge(ctx);
                    return;
                }
                ctx.Response.StatusCode = 405;
                ctx.Response.Close();
                return;
            }
            if (ctx.Request.HttpMethod == "GET")
                ServeStatic(ctx, path);
            else
            {
                ctx.Response.StatusCode = 405;
                ctx.Response.Close();
            }
        }
        catch (Exception ex)
        {
            var body = Encoding.UTF8.GetBytes(ex.Message);
            ctx.Response.StatusCode = 500;
            ctx.Response.ContentType = "text/plain; charset=utf-8";
            ctx.Response.OutputStream.Write(body);
            ctx.Response.Close();
        }
    }

    private void ServeBridgeScript(HttpListenerContext ctx)
    {
        var script = @"(function(){
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
    FollowDemoPlayers: function(demoId, steamIds){ return post('FollowDemoPlayers', [demoId, steamIds]); },
    ListPlayers: function(){ return post('ListPlayers'); },
    GetPlayerMatches: function(steamId){ return post('GetPlayerMatches', [steamId]); },
    SetPlayerFollowed: function(player, followed){ return post('SetPlayerFollowed', [player, followed]); },
    DeletePlayerData: function(steamId){ return post('DeletePlayerData', [steamId]); },
    DeletePlayerMatches: function(steamId, ids){ return post('DeletePlayerMatches', [steamId, ids]); },
    ClearAllData: function(){ return post('ClearAllData'); },
    ChooseDatabase: function(){ return post('ChooseDatabase'); },
    BuildRadar: function(steamId, ids){ return post('BuildRadar', [steamId, ids]); },
    GetRatingMethodology: function(){ return post('GetRatingMethodology'); },
    LoadDraft: function(kind){ return post('LoadDraft', [kind]); },
    SaveDraft: function(kind, payload){ return post('SaveDraft', [kind, payload]); },
    SavePreferences: function(w,h,fps,ffmpeg,reduced,best,offset,scaleMode,scale,axis,ratingVersion,showWatermark){ return post('SavePreferences',[w,h,fps,ffmpeg,reduced,best,offset,scaleMode,scale,axis,ratingVersion,showWatermark]); },
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
        var bytes = Encoding.UTF8.GetBytes(script);
        ctx.Response.ContentType = "application/javascript";
        ctx.Response.ContentLength64 = bytes.Length;
        ctx.Response.OutputStream.Write(bytes);
        ctx.Response.Close();
    }

    private void HandleBridge(HttpListenerContext ctx)
    {
        using var reader = new StreamReader(ctx.Request.InputStream, Encoding.UTF8);
        var body = reader.ReadToEnd();
        object? result = null;
        object? error = null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            var method = doc.RootElement.GetProperty("method").GetString() ?? "";
            var args = new List<JsonElement>();
            if (doc.RootElement.TryGetProperty("args", out var argsEl) && argsEl.ValueKind == JsonValueKind.Array)
                foreach (var el in argsEl.EnumerateArray()) args.Add(el);
            result = app.Invoke(method, args);
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
        var json = JsonSerializer.Serialize(response);
        var bytes = Encoding.UTF8.GetBytes(json);
        ctx.Response.ContentType = "application/json; charset=utf-8";
        ctx.Response.ContentLength64 = bytes.Length;
        ctx.Response.OutputStream.Write(bytes);
        ctx.Response.Close();
    }

    private void ServeStatic(HttpListenerContext ctx, string path)
    {
        if (path == "/") path = "/index.html";
        var safePath = path.TrimStart('/').Replace("..", "");
        var file = Path.Combine(frontendDir, safePath.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(file))
        {
            file = Path.Combine(frontendDir, "index.html");
            if (!File.Exists(file)) { ctx.Response.StatusCode = 404; ctx.Response.Close(); return; }
        }
        var bytes = File.ReadAllBytes(file);
        ctx.Response.ContentType = ContentTypeFor(file);
        ctx.Response.ContentLength64 = bytes.Length;
        if (file.EndsWith("index.html", StringComparison.OrdinalIgnoreCase))
        {
            var html = Encoding.UTF8.GetString(bytes);
            html = html.Replace("</head>", "<script src=\"/studio-bridge.js\"></script></head>");
            bytes = Encoding.UTF8.GetBytes(html);
            ctx.Response.ContentLength64 = bytes.Length;
        }
        ctx.Response.OutputStream.Write(bytes);
        ctx.Response.Close();
    }

    private static string ContentTypeFor(string file) => Path.GetExtension(file).ToLowerInvariant() switch
    {
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
}

public static class JsonSnake
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}