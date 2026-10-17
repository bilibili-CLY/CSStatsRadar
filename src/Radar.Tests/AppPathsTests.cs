using Radar.Infrastructure;
using Xunit;

namespace Radar.Tests;

public class AppPathsTests
{
    /// <summary>
    /// 数据根目录必须锚在主目录（或显式覆盖），绝不能跟随进程工作目录——
    /// 安装器拉起 sidecar 时 CWD 可能是盘根（E:\），日志就会落到那里。
    /// </summary>
    [Fact]
    public void DataDir_AnchorsOnUserProfile_NotWorkingDirectory()
    {
        var dir = AppPaths.DataDir();
        Assert.True(Path.IsPathRooted(dir), dir);
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable(AppPaths.DataDirEnvVar))) return;
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrEmpty(home)) return;
        Assert.StartsWith(Path.GetFullPath(home), Path.GetFullPath(dir));
    }

    [Fact]
    public void ResolveDatabasePath_KeepsAbsolute_RebasesRelative()
    {
        var absolute = Path.Combine(Path.GetTempPath(), "kept", "player_stats.db");
        Assert.Equal(absolute, AppPaths.ResolveDatabasePath(absolute));
        Assert.Equal(
            Path.Combine(AppPaths.DataDir(), "player_stats.db"),
            AppPaths.ResolveDatabasePath("player_stats.db"));
        Assert.Equal(AppPaths.DefaultDatabasePath(), AppPaths.ResolveDatabasePath(null));
    }

    [Fact]
    public void DefaultsAndLogsDir_LiveUnderDataDir()
    {
        Assert.Equal(Path.Combine(AppPaths.DataDir(), "logs"), AppPaths.LogsDir());
        Assert.Equal(Path.Combine(AppPaths.DataDir(), "config.json"), AppPaths.DefaultConfigPath());
        Assert.Equal(Path.Combine(AppPaths.DataDir(), "player_stats.db"), AppPaths.DefaultDatabasePath());
        Assert.Equal(Path.Combine(AppPaths.DataDir(), "player-avatars"), AppPaths.PlayerAvatarDir());
    }
}
