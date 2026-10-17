using Radar.Domain.Models;

namespace Radar.Infrastructure;

/// <summary>
/// 应用日志文件的清点与清理（<c>&lt;dataDir&gt;/logs</c> 下的 backend.log、desktop.log、avatars.log…）。
///
/// 只清理日志目录里符合日志命名的文件（<c>*.log</c> 与轮转文件 <c>*.log.1</c>），
/// 不递归子目录、不碰同目录的其它文件。写入方（sidecar、Tauri 壳、头像抓取）都是
/// 每次追加即关闭，因此文件通常可删；Windows 上偶发占用会重试几次，
/// 仍失败的文件作为明细返回，绝不抛异常打断调用方。
/// </summary>
public static class LogFiles
{
    private const int RetryCount = 5;
    private const int RetryDelayMs = 40;

    /// <summary>日志目录中符合日志命名的文件（完整路径，按名称排序）。</summary>
    public static IReadOnlyList<string> Enumerate(string? logsDir = null)
    {
        var dir = logsDir ?? AppPaths.LogsDir();
        if (!Directory.Exists(dir)) return Array.Empty<string>();
        return Directory.EnumerateFiles(dir)
            .Where(file => IsLogFile(Path.GetFileName(file)))
            .OrderBy(file => file, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>是否日志文件：<c>*.log</c> 或轮转文件 <c>*.log.1</c>。</summary>
    public static bool IsLogFile(string fileName)
    {
        if (string.IsNullOrEmpty(fileName)) return false;
        var marker = fileName.IndexOf(".log", StringComparison.OrdinalIgnoreCase);
        if (marker < 0) return false;
        var suffix = fileName[(marker + ".log".Length)..];
        if (suffix.Length == 0) return true;
        if (suffix[0] != '.') return false;
        return suffix[1..].All(char.IsAsciiDigit);
    }

    /// <summary>删除全部日志文件，返回删除数量、释放字节数与失败明细。</summary>
    public static LogClearResult Clear(string? logsDir = null)
    {
        var dir = logsDir ?? AppPaths.LogsDir();
        var result = new LogClearResult { LogsDir = dir };
        foreach (var file in Enumerate(dir))
        {
            long size = 0;
            try { size = new FileInfo(file).Length; }
            catch { /* 大小只用于展示，取不到也不影响删除 */ }
            var error = Delete(file);
            if (error == null)
            {
                result.DeletedFiles++;
                result.FreedBytes += size;
            }
            else
            {
                result.Failed.Add($"{Path.GetFileName(file)}：{error}");
            }
        }
        return result;
    }

    /// <summary>返回 null 表示已删除（或本来就不存在），否则是失败原因。</summary>
    private static string? Delete(string file)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                File.Delete(file);
                return null;
            }
            catch (FileNotFoundException)
            {
                return null;
            }
            catch (DirectoryNotFoundException)
            {
                return null;
            }
            catch (Exception ex)
            {
                if (attempt >= RetryCount - 1) return ex.Message;
                Thread.Sleep(RetryDelayMs);
            }
        }
    }
}
