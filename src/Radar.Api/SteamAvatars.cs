using System.IO.Compression;
using System.Net;
using System.Xml.Linq;
using Radar.Infrastructure;

namespace Radar.Api;

/// <summary>
/// 从 Steam 社区资料页拉取玩家头像，无需 Steam Web API Key。
/// 使用 profile XML 接口（?xml=1），解析 <avatarFull> 后下载到本地缓存目录。
/// 所有失败都会写入 ~/.csplayerstatsradar/logs/avatars.log，便于在 Windows 上排查
/// （常见原因：steamcommunity.com 需要代理而应用未走系统代理、防火墙拦截、限流）。
/// </summary>
public static class SteamAvatars
{
    private static readonly object LogLock = new();
    private static readonly HttpClient Http = Create();

    private static HttpClient Create()
    {
        var handler = new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            AllowAutoRedirect = true,
            // 默认 UseProxy=true 即跟随系统代理（Windows 为 WinINET 设置），显式保留以便排查。
            UseProxy = true,
        };
        var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(15) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; CSPlayerStatsRadar/1.0)");
        return client;
    }

    public static string DefaultAvatarDir() => AppPaths.PlayerAvatarDir();

    public static string LogDir() => AppPaths.LogsDir();

    internal static void Log(string message)
    {
        try
        {
            var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}";
            lock (LogLock)
            {
                Directory.CreateDirectory(LogDir());
                File.AppendAllText(Path.Combine(LogDir(), "avatars.log"), line + Environment.NewLine);
            }
        }
        catch
        {
            // 日志写入失败不影响头像流程。
        }
    }

    /// <summary>带一次网络异常重试的 GET；失败返回 null 并把原因写入日志。HTTP 非 2xx 不重试。</summary>
    private static HttpResponseMessage? SendWithLog(string url, string stage, string steamID)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                var response = Http.Send(request);
                if (response.IsSuccessStatusCode) return response;
                Log($"{stage} {steamID}: HTTP {(int)response.StatusCode} ({response.ReasonPhrase}) url={url}");
                response.Dispose();
                return null;
            }
            catch (Exception ex)
            {
                var detail = ex.InnerException != null
                    ? $"{ex.GetType().Name}: {ex.Message} <- {ex.InnerException.Message}"
                    : $"{ex.GetType().Name}: {ex.Message}";
                Log($"{stage} {steamID}: attempt {attempt} failed: {detail} url={url}");
                if (attempt >= 2) return null;
                Thread.Sleep(600);
            }
        }
    }

    /// <summary>解析 Steam 64 位 ID 的头像完整 URL；失败返回 null（私密资料、限流或网络异常）。</summary>
    public static string? FetchAvatarURL(string steamID)
    {
        var id = steamID.Trim();
        try
        {
            if (id.Length == 0 || !id.All(char.IsDigit)) return null;
            var url = "https://steamcommunity.com/profiles/" + Uri.EscapeDataString(id) + "/?xml=1";
            using var response = SendWithLog(url, "profile", id);
            if (response == null) return null;
            var xml = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            if (xml.Length == 0)
            {
                Log($"profile {id}: empty body");
                return null;
            }
            var doc = XDocument.Parse(xml);
            var error = doc.Root?.Element("error")?.Value;
            if (!string.IsNullOrWhiteSpace(error))
            {
                Log($"profile {id}: steam reports \"{error.Trim()}\"");
                return null;
            }
            var avatar = doc.Root?.Element("avatarFull")?.Value;
            if (string.IsNullOrWhiteSpace(avatar))
            {
                Log($"profile {id}: no <avatarFull> in profile xml");
                return null;
            }
            return avatar.Trim();
        }
        catch (Exception ex)
        {
            Log($"profile {id}: parse failed: {ex.GetType().Name}: {ex.Message}");
            return null;
        }
    }

    /// <summary>下载头像到本地缓存目录；成功返回缓存路径，失败返回 null。</summary>
    public static string? DownloadAvatar(string sourceURL, string steamID)
    {
        try
        {
            var dir = DefaultAvatarDir();
            Directory.CreateDirectory(dir);
            string ext;
            try { ext = Path.GetExtension(new Uri(sourceURL).AbsolutePath); }
            catch { ext = ""; }
            if (string.IsNullOrEmpty(ext) || ext.Length > 6 || !ext.StartsWith('.')) ext = ".jpg";
            var path = Path.Combine(dir, steamID.Trim() + ext);
            using var response = SendWithLog(sourceURL, "download", steamID);
            if (response == null) return null;
            var bytes = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
            if (bytes.Length == 0)
            {
                Log($"download {steamID}: empty image body");
                return null;
            }
            File.WriteAllBytes(path, bytes);
            return path;
        }
        catch (Exception ex)
        {
            Log($"download {steamID}: failed: {ex.GetType().Name}: {ex.Message}");
            return null;
        }
    }
}
