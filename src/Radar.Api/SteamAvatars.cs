using System.IO.Compression;
using System.Net;
using System.Xml.Linq;

namespace Radar.Api;

/// <summary>
/// 从 Steam 社区资料页拉取玩家头像，无需 Steam Web API Key。
/// 使用 profile XML 接口（?xml=1），解析 <avatarFull> 后下载到本地缓存目录。
/// </summary>
public static class SteamAvatars
{
    private static readonly HttpClient Http = Create();

    private static HttpClient Create()
    {
        var handler = new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            AllowAutoRedirect = true,
        };
        var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(8) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; CSPlayerStatsRadar/1.0)");
        return client;
    }

    public static string DefaultAvatarDir()
        => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) ?? ".", ".csplayerstatsradar", "player-avatars");

    /// <summary>解析 Steam 64 位 ID 的头像完整 URL；失败返回 null（私密资料、限流或网络异常）。</summary>
    public static string? FetchAvatarURL(string steamID)
    {
        try
        {
            var id = steamID.Trim();
            if (id.Length == 0 || !id.All(char.IsDigit)) return null;
            var url = "https://steamcommunity.com/profiles/" + Uri.EscapeDataString(id) + "/?xml=1";
            using var response = Http.Send(new HttpRequestMessage(HttpMethod.Get, url));
            if (!response.IsSuccessStatusCode) return null;
            var xml = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            if (xml.Length == 0) return null;
            var doc = XDocument.Parse(xml);
            var avatar = doc.Root?.Element("avatarFull")?.Value;
            if (string.IsNullOrWhiteSpace(avatar)) return null;
            return avatar.Trim();
        }
        catch
        {
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
            using var response = Http.Send(new HttpRequestMessage(HttpMethod.Get, sourceURL));
            if (!response.IsSuccessStatusCode) return null;
            var bytes = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
            if (bytes.Length == 0) return null;
            File.WriteAllBytes(path, bytes);
            return path;
        }
        catch
        {
            return null;
        }
    }
}