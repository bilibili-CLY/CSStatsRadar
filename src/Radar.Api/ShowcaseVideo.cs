using System.Diagnostics;

namespace Radar.Api;

public class VideoExportRequest
{
    public int Width { get; set; }
    public int Height { get; set; }
    public int FPS { get; set; }
    public int DurationMS { get; set; }
    public int AudioOffsetMS { get; set; }
}

public class VideoExportSession
{
    public string TempDir { get; init; } = "";
    public string OutputPath { get; init; } = "";
    public VideoExportRequest Request { get; init; } = new();
    public CancellationTokenSource Cts { get; } = new();
    public object Lock { get; } = new();
    public bool Finishing { get; set; }
}

public class VideoDownload
{
    public string Path { get; init; } = "";
    public string Name { get; init; } = "";
    public DateTime ExpiresUtc { get; init; }
}

public static class ShowcaseVideo
{
    public const int MaxShowcaseVideoFrames = 7200;
    private const int MaxShowcaseAudioOffsetMS = 24 * 60 * 60 * 1000;

    public static string? Validate(VideoExportRequest request)
    {
        if (request.Width <= 0 || request.Width > 8192 || request.Height <= 0 || request.Height > 8192)
            return "invalid_export_size";
        if (request.FPS <= 0 || request.FPS > 120)
            return "invalid_showcase_video";
        if (request.DurationMS <= 0)
            return "invalid_showcase_video";
        if (request.AudioOffsetMS < -MaxShowcaseAudioOffsetMS || request.AudioOffsetMS > MaxShowcaseAudioOffsetMS)
            return "invalid_showcase_video";
        return null;
    }

    public static byte[] DecodePNGDataURL(string raw)
    {
        const string prefix = "data:image/png;base64,";
        if (!raw.StartsWith(prefix, StringComparison.Ordinal))
            throw new InvalidOperationException("只支持 PNG data URL。");
        return Convert.FromBase64String(raw.Substring(prefix.Length));
    }

    public static string AudioFilter(int offsetMS, double durationSeconds)
    {
        var duration = durationSeconds.ToString("0.000");
        if (offsetMS > 0) return $"[1:a]adelay={offsetMS}:all=1,atrim=duration={duration},asetpts=N/SR/TB[a]";
        if (offsetMS < 0) return $"[1:a]atrim=start={((double)-offsetMS / 1000):0.000},asetpts=PTS-STARTPTS,atrim=duration={duration}[a]";
        return $"[1:a]atrim=duration={duration},asetpts=PTS-STARTPTS[a]";
    }

    public static string EncodeShowcaseMP4(CancellationToken token, string ffmpegPath, string tempDir, string outputPath, string musicPath, VideoExportRequest request)
    {
        var durationSeconds = (double)request.DurationMS / 1000;
        var args = new List<string>
        {
            "-y",
            "-framerate", request.FPS.ToString(),
            "-i", Path.Combine(tempDir, "frame_%06d.png"),
        };
        var hasAudio = !string.IsNullOrWhiteSpace(musicPath) && File.Exists(musicPath);
        if (hasAudio)
        {
            args.Add("-stream_loop");
            args.Add("-1");
            args.Add("-i");
            args.Add(musicPath);
            var filter = AudioFilter(request.AudioOffsetMS, durationSeconds);
            args.Add("-filter_complex");
            args.Add(filter);
            args.Add("-map");
            args.Add("0:v:0");
            args.Add("-map");
            args.Add("[a]");
            args.Add("-c:a");
            args.Add("aac");
            args.Add("-b:a");
            args.Add("192k");
        }
        args.Add("-c:v");
        args.Add("libx264");
        args.Add("-pix_fmt");
        args.Add("yuv420p");
        args.Add("-r");
        args.Add(request.FPS.ToString());
        args.Add("-t");
        args.Add(durationSeconds.ToString("0.000"));
        args.Add("-movflags");
        args.Add("+faststart");
        args.Add(outputPath);

        var psi = new ProcessStartInfo
        {
            FileName = ffmpegPath,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var arg in args) psi.ArgumentList.Add(arg);
        using var process = Process.Start(psi);
        if (process == null) throw new InvalidOperationException("ffmpeg 启动失败。");
        var stderr = process.StandardError.ReadToEndAsync();
        process.WaitForExit();
        token.ThrowIfCancellationRequested();
        if (process.ExitCode != 0)
        {
            var message = stderr.Result.Trim();
            if (message.Length > 800) message = message.Substring(message.Length - 800);
            throw new InvalidOperationException("ffmpeg 编码失败：" + message);
        }
        return outputPath;
    }
}