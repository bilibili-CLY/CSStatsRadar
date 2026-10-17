using Radar.Infrastructure;
using Xunit;

namespace Radar.Tests;

public class LogFilesTests
{
    /// <summary>
    /// 清理只删日志目录里的日志文件，不能碰数据库、素材或子目录里的同名文件。
    /// </summary>
    [Fact]
    public void Clear_DeletesOnlyLogFiles()
    {
        var dir = NewTempLogsDir();
        try
        {
            File.WriteAllText(Path.Combine(dir, "backend.log"), "启动行");
            File.WriteAllText(Path.Combine(dir, "desktop.log"), "壳日志");
            File.WriteAllText(Path.Combine(dir, "avatars.log.1"), "轮转日志");
            File.WriteAllText(Path.Combine(dir, "notes.txt"), "保留");
            File.WriteAllText(Path.Combine(dir, "player_stats.db"), "保留");
            var nested = Path.Combine(dir, "archive");
            Directory.CreateDirectory(nested);
            File.WriteAllText(Path.Combine(nested, "backend.log"), "保留");

            var result = LogFiles.Clear(dir);

            Assert.Equal(dir, result.LogsDir);
            Assert.Equal(3, result.DeletedFiles);
            Assert.True(result.FreedBytes > 0);
            Assert.Empty(result.Failed);
            Assert.Empty(LogFiles.Enumerate(dir));
            Assert.True(File.Exists(Path.Combine(dir, "notes.txt")));
            Assert.True(File.Exists(Path.Combine(dir, "player_stats.db")));
            Assert.True(File.Exists(Path.Combine(nested, "backend.log")));
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    /// <summary>日志目录还不存在（或为空）时清理必须是无害的空操作。</summary>
    [Fact]
    public void Clear_OnMissingDirectory_IsNoOp()
    {
        var dir = Path.Combine(Path.GetTempPath(), "csr-missing-" + Guid.NewGuid().ToString("N"));
        var result = LogFiles.Clear(dir);
        Assert.Equal(0, result.DeletedFiles);
        Assert.Equal(0, result.FreedBytes);
        Assert.Empty(result.Failed);
        Assert.Empty(LogFiles.Enumerate(dir));
    }

    [Fact]
    public void Enumerate_ListsLogFilesInNameOrder()
    {
        var dir = NewTempLogsDir();
        try
        {
            File.WriteAllText(Path.Combine(dir, "desktop.log"), "x");
            File.WriteAllText(Path.Combine(dir, "backend.log"), "x");
            File.WriteAllText(Path.Combine(dir, "avatars.log.bak"), "x");
            var names = LogFiles.Enumerate(dir).Select(Path.GetFileName).ToList();
            Assert.Equal(new[] { "backend.log", "desktop.log" }, names);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Theory]
    [InlineData("backend.log", true)]
    [InlineData("desktop.log.1", true)]
    [InlineData("avatars.log.12", true)]
    [InlineData("avatars.log.bak", false)]
    [InlineData("notes.txt", false)]
    [InlineData("player_stats.db", false)]
    [InlineData("", false)]
    public void IsLogFile_MatchesLogNamesOnly(string name, bool expected)
    {
        Assert.Equal(expected, LogFiles.IsLogFile(name));
    }

    private static string NewTempLogsDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "csr-logs-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }
}
