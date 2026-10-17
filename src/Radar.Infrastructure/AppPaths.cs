namespace Radar.Infrastructure;

/// <summary>
/// 应用数据根目录的唯一解析入口（PRD §7.1：<c>~/.csplayerstatsradar/</c>）。
///
/// 解析结果绝不能依赖进程工作目录（CWD）或数据库路径：Tauri 壳/安装器拉起 sidecar 时
/// CWD 可能落在安装包所在的盘（例如 <c>E:\</c>），而旧实现用
/// <c>Path.GetDirectoryName(Path.GetFullPath(cfg.DatabasePath))</c> 推导数据目录，
/// 一旦历史 config.json 里留着 <c>E:\xxx.db</c>，日志与恢复标记就会被写到 <c>E:\logs</c>
/// 这类盘根目录。所有数据/日志/缓存目录都必须经过这里。
/// </summary>
public static class AppPaths
{
    public const string FolderName = ".csplayerstatsradar";

    /// <summary>显式覆盖（测试、便携运行）优先。</summary>
    public const string DataDirEnvVar = "CS_RADAR_DATA_DIR";

    /// <summary>
    /// 数据根目录：<c>CS_RADAR_DATA_DIR</c> → <c>{UserProfile}/.csplayerstatsradar</c>
    /// → <c>{LocalApplicationData}/CSStatsRadar</c> → <c>{程序目录}/data</c>。
    /// </summary>
    public static string DataDir()
    {
        var env = Environment.GetEnvironmentVariable(DataDirEnvVar);
        if (!string.IsNullOrWhiteSpace(env)) return System.IO.Path.GetFullPath(env);
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!string.IsNullOrEmpty(home)) return System.IO.Path.Combine(home, FolderName);
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (!string.IsNullOrEmpty(local)) return System.IO.Path.Combine(local, "CSStatsRadar");
        // 最后兜底：与 CWD 无关的程序目录，绝不会是盘根。
        return System.IO.Path.Combine(AppContext.BaseDirectory, "data");
    }

    public static string LogsDir() => System.IO.Path.Combine(DataDir(), "logs");

    public static string DefaultConfigPath() => System.IO.Path.Combine(DataDir(), "config.json");

    public static string DefaultDatabasePath() => System.IO.Path.Combine(DataDir(), "player_stats.db");

    /// <summary>相对路径按数据根目录解析；绝对路径原样保留（不迁移用户已有数据）。</summary>
    public static string ResolveDatabasePath(string? configured)
    {
        if (string.IsNullOrWhiteSpace(configured)) return DefaultDatabasePath();
        return System.IO.Path.IsPathRooted(configured)
            ? configured
            : System.IO.Path.Combine(DataDir(), configured);
    }

    public static string PlayerImageDir() => System.IO.Path.Combine(DataDir(), "player-images");

    public static string PlayerMvpBackgroundDir() => System.IO.Path.Combine(DataDir(), "player-mvp-backgrounds");

    public static string ShowcaseMusicDir() => System.IO.Path.Combine(DataDir(), "showcase-music");

    public static string PlayerAvatarDir() => System.IO.Path.Combine(DataDir(), "player-avatars");
}
