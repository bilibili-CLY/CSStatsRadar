using System.Text;

namespace Radar.Api;

public static class MediaFiles
{
    private static string HomeDir()
        => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) ?? ".";

    public static string DefaultPlayerImageDir()
        => Path.Combine(HomeDir(), ".csplayerstatsradar", "player-images");

    public static string DefaultPlayerMVPBackgroundDir()
        => Path.Combine(HomeDir(), ".csplayerstatsradar", "player-mvp-backgrounds");

    public static string DefaultShowcaseMusicDir()
        => Path.Combine(HomeDir(), ".csplayerstatsradar", "showcase-music");

    public static string? PlayerImageFileName(string steamID, DateTimeOffset now, string originalName)
    {
        var ext = Path.GetExtension(originalName).ToLowerInvariant();
        if (ext == "") ext = ".img";
        return steamID.Trim() + "-" + now.ToUnixTimeMilliseconds() + ext;
    }

    public static string? PlayerImageAssetPath(string baseDir, string fileName)
    {
        if (string.IsNullOrEmpty(fileName) || fileName.Contains('/') || fileName.Contains('\\'))
            return null;
        string fullPath;
        try
        {
            var cleanBase = Path.GetFullPath(baseDir);
            fullPath = Path.GetFullPath(Path.Combine(cleanBase, fileName));
            if (Path.GetDirectoryName(fullPath) != cleanBase) return null;
        }
        catch
        {
            return null;
        }
        return fullPath;
    }

    public static string? CopyMediaFile(string baseDir, string steamID, string sourcePath)
    {
        try
        {
            Directory.CreateDirectory(baseDir);
            var name = PlayerImageFileName(steamID, DateTimeOffset.UtcNow, Path.GetFileName(sourcePath));
            var target = PlayerImageAssetPath(baseDir, name ?? "");
            if (target == null) return null;
            File.Copy(sourcePath, target, overwrite: false);
            return target;
        }
        catch
        {
            return null;
        }
    }

    public static string FileDataURL(string path)
    {
        var data = File.ReadAllBytes(path);
        var ext = Path.GetExtension(path).ToLowerInvariant();
        var content = ext switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            ".mp3" => "audio/mpeg",
            ".wav" => "audio/wav",
            ".m4a" => "audio/mp4",
            ".aac" => "audio/aac",
            ".mp4" => "video/mp4",
            ".mov" => "video/quicktime",
            _ => "application/octet-stream",
        };
        return "data:" + content + ";base64," + Convert.ToBase64String(data);
    }
}

public static class AudioMetadata
{
    public static int AudioDurationMS(string path)
    {
        try
        {
            var data = File.ReadAllBytes(path);
            return Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".m4a" or ".mp4" or ".mov" => Mp4DurationMS(data),
                ".wav" => WavDurationMS(data),
                _ => 0,
            };
        }
        catch
        {
            return 0;
        }
    }

    public static int Mp4DurationMS(byte[] data)
    {
        var mvhd = FindMP4Box(data, "mvhd");
        if (mvhd == null || mvhd.Length < 20) return 0;
        uint timescale;
        ulong duration;
        if (mvhd[0] == 1)
        {
            if (mvhd.Length < 32) return 0;
            timescale = BigEndianU32(mvhd, 20);
            duration = BigEndianU64(mvhd, 24);
        }
        else
        {
            timescale = BigEndianU32(mvhd, 12);
            duration = BigEndianU32(mvhd, 16);
        }
        if (timescale == 0) return 0;
        return (int)((duration * 1000 + (ulong)timescale / 2) / timescale);
    }

    private static byte[]? FindMP4Box(byte[] data, string target)
    {
        for (var offset = 0; offset + 8 <= data.Length;)
        {
            var size = (ulong)BigEndianU32(data, offset);
            var header = 8;
            if (size == 1)
            {
                if (offset + 16 > data.Length) return null;
                size = BigEndianU64(data, offset + 8);
                header = 16;
            }
            else if (size == 0)
            {
                size = (ulong)(data.Length - offset);
            }
            if (size < (ulong)header || size > (ulong)(data.Length - offset)) return null;
            var kind = Encoding.ASCII.GetString(data, offset + 4, 4);
            var payload = new byte[(int)size - header];
            Array.Copy(data, offset + header, payload, 0, payload.Length);
            if (kind == target) return payload;
            if (kind == "moov")
            {
                var found = FindMP4Box(payload, target);
                if (found != null) return found;
            }
            offset += (int)size;
        }
        return null;
    }

    public static int WavDurationMS(byte[] data)
    {
        if (data.Length < 12 || Encoding.ASCII.GetString(data, 0, 4) != "RIFF" || Encoding.ASCII.GetString(data, 8, 4) != "WAVE")
            return 0;
        uint bytesPerSecond = 0;
        uint audioBytes = 0;
        for (var offset = 12; offset + 8 <= data.Length;)
        {
            var kind = Encoding.ASCII.GetString(data, offset, 4);
            var size = (int)LittleEndianU32(data, offset + 4);
            var start = offset + 8;
            var end = start + size;
            if (end > data.Length) break;
            if (kind == "fmt " && size >= 12)
                bytesPerSecond = LittleEndianU32(data, start + 8);
            if (kind == "data")
                audioBytes = (uint)size;
            offset = end + size % 2;
        }
        if (bytesPerSecond == 0) return 0;
        return (int)(((ulong)audioBytes * 1000 + (ulong)bytesPerSecond / 2) / bytesPerSecond);
    }

    private static uint BigEndianU32(byte[] data, int offset)
        => ((uint)data[offset] << 24) | ((uint)data[offset + 1] << 16) | ((uint)data[offset + 2] << 8) | data[offset + 3];

    private static ulong BigEndianU64(byte[] data, int offset)
        => ((ulong)BigEndianU32(data, offset) << 32) | BigEndianU32(data, offset + 4);

    private static uint LittleEndianU32(byte[] data, int offset)
        => data[offset] | ((uint)data[offset + 1] << 8) | ((uint)data[offset + 2] << 16) | ((uint)data[offset + 3] << 24);
}