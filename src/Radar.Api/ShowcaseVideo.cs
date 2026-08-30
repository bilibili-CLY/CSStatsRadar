using System.Diagnostics;
using System.Text;

namespace Radar.Api;

public class VideoExportRequest
{
    public int Width { get; set; }
    public int Height { get; set; }
    public int FPS { get; set; }
    public int DurationMS { get; set; }
    public int AudioOffsetMS { get; set; }
}

/// <summary>
/// 流式视频导出会话：ffmpeg 在 Begin 时即以 image2pipe 从 stdin 读取 PNG 帧启动，
/// Append 直接向 stdin 写入，因此没有帧数上限、也不产生临时帧文件。
/// </summary>
public class VideoExportSession
{
    public string TempDir { get; init; } = "";
    public string OutputPath { get; init; } = "";
    public VideoExportRequest Request { get; init; } = new();
    public string MusicPath { get; init; } = "";
    public CancellationTokenSource Cts { get; } = new();
    public object Lock { get; } = new();
    public bool Finishing { get; set; }
    public Process? Encoder { get; set; }
    public long FramesWritten { get; set; }
    private readonly StringBuilder stderr = new();

    public void AppendStderr(string? line)
    {
        if (line == null) return;
        lock (stderr) stderr.AppendLine(line);
    }

    public string LastStderr(int maxChars = 800)
    {
        lock (stderr)
        {
            var text = stderr.ToString().Trim();
            return text.Length > maxChars ? text[^maxChars..] : text;
        }
    }
}

public class VideoDownload
{
    public string Path { get; init; } = "";
    public string Name { get; init; } = "";
    public DateTime ExpiresUtc { get; init; }
}

public static class ShowcaseVideo
{
    /// <summary>单次批量追加的帧数上限（仅防滥用；导出总时长不受限制）。</summary>
    public const int MaxBatchFrames = 1024;
    private const int MaxShowcaseAudioOffsetMS = 24 * 60 * 60 * 1000;
    private static readonly TimeSpan EncoderTimeout = TimeSpan.FromMinutes(10);

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

    public static long ExpectedFrameCount(VideoExportRequest request)
        => (long)Math.Ceiling((double)request.DurationMS * request.FPS / 1000);

    public static byte[] DecodePNGDataURL(string raw)
    {
        const string prefix = "data:image/png;base64,";
        if (!raw.StartsWith(prefix, StringComparison.Ordinal))
            throw new InvalidOperationException("只支持 PNG data URL。");
        return Convert.FromBase64String(raw.Substring(prefix.Length));
    }

    public static string AudioFilter(int offsetMS, double durationSeconds)
    {
        var duration = durationSeconds.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture);
        if (offsetMS > 0) return $"[1:a]adelay={offsetMS}:all=1,atrim=duration={duration},asetpts=N/SR/TB[a]";
        if (offsetMS < 0) return $"[1:a]atrim=start={((double)-offsetMS / 1000).ToString("0.000", System.Globalization.CultureInfo.InvariantCulture)},asetpts=PTS-STARTPTS,atrim=duration={duration}[a]";
        return $"[1:a]atrim=duration={duration},asetpts=PTS-STARTPTS[a]";
    }

    /// <summary>
    /// 构造从 stdin（image2pipe）读帧的 ffmpeg 参数。视频时长由 -t 精确截断，
    /// 输入帧率与输出帧率一致保证每一帧恰好占用 1/fps。
    /// </summary>
    public static List<string> BuildEncoderArgs(string outputPath, string musicPath, VideoExportRequest request)
    {
        var durationSeconds = ((double)request.DurationMS / 1000).ToString("0.000", System.Globalization.CultureInfo.InvariantCulture);
        var args = new List<string>
        {
            "-y",
            "-f", "image2pipe",
            "-framerate", request.FPS.ToString(),
            "-i", "-",
        };
        var hasAudio = !string.IsNullOrWhiteSpace(musicPath) && File.Exists(musicPath);
        if (hasAudio)
        {
            args.Add("-stream_loop");
            args.Add("-1");
            args.Add("-i");
            args.Add(musicPath);
            args.Add("-filter_complex");
            args.Add(AudioFilter(request.AudioOffsetMS, request.DurationMS / 1000.0));
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
        args.Add(durationSeconds);
        args.Add("-movflags");
        args.Add("+faststart");
        args.Add(outputPath);
        return args;
    }

    /// <summary>立即启动 ffmpeg 编码进程并异步排空 stdout/stderr（防止管道缓冲塞满导致死锁）。</summary>
    public static Process StartEncoder(string ffmpegPath, string outputPath, string musicPath, VideoExportRequest request, VideoExportSession session)
    {
        var psi = new ProcessStartInfo(ffmpegPath)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var arg in BuildEncoderArgs(outputPath, musicPath, request)) psi.ArgumentList.Add(arg);
        var process = Process.Start(psi) ?? throw new InvalidOperationException("ffmpeg 启动失败。");
        process.ErrorDataReceived += (_, e) => session.AppendStderr(e.Data);
        process.OutputDataReceived += (_, e) => { /* 丢弃 stdout，仅排空管道 */ };
        process.BeginErrorReadLine();
        process.BeginOutputReadLine();
        return process;
    }

    /// <summary>关闭 stdin 后等待编码完成；失败时抛出携带 ffmpeg 尾部日志的异常。</summary>
    public static void CompleteEncoder(Process process, CancellationToken token, Func<string> lastStderr)
    {
        try
        {
            if (!process.WaitForExit((int)EncoderTimeout.TotalMilliseconds))
            {
                TryKill(process);
                throw new InvalidOperationException("ffmpeg 编码超时。");
            }
            token.ThrowIfCancellationRequested();
            if (process.ExitCode != 0)
                throw new InvalidOperationException("ffmpeg 编码失败：" + lastStderr());
        }
        finally
        {
            process.Dispose();
        }
    }

    public static void TryKill(Process? process)
    {
        try
        {
            if (process is { HasExited: false }) process.Kill(entireProcessTree: true);
        }
        catch
        {
            // 进程可能已退出。
        }
    }
}
