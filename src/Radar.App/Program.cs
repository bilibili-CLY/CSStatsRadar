using System.Diagnostics;
using System.Runtime.InteropServices;
using Radar.Api;

namespace Radar.App;

public static class Program
{
    private static readonly object LogLock = new();
    private static string? logPath;
    private static readonly ManualResetEventSlim ShutdownSignal = new();

    public static void Main(string[] args)
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            ShowFatalError("未处理的错误", e.ExceptionObject as Exception);
        try
        {
            Run(args);
        }
        catch (Exception ex)
        {
            ShowFatalError("程序启动失败", ex);
            Environment.ExitCode = 1;
        }
    }

    private static void Run(string[] args)
    {
        var configPath = args.Length > 0 ? args[0] : null;
        var dbPath = args.Length > 1 ? args[1] : null;
        var frontendDir = args.Length > 2 ? args[2] : null;

        if (string.IsNullOrEmpty(frontendDir))
        {
            var root = FindFrontendDist();
            frontendDir = root ?? throw new InvalidOperationException("找不到 frontend/dist，请先用 npm run build 构建前端。");
        }
        Log($"frontend: {frontendDir}");

        var app = new DesktopApp(configPath, dbPath);
        var bridge = new BridgeServer(app, frontendDir);
        bridge.OnShutdownRequested = () => ShutdownSignal.Set();
        bridge.Start();
        Log($"Bridge listening at {bridge.BaseUrl}");

        // 应用以浏览器模式运行：默认浏览器打开本机桥接地址，宿主进程在后台维持服务。
        // 关闭浏览器标签后心跳停止，宿主会在宽限期后自动退出；也可通过 QuitApp 立即退出。
        Log($"Opening {bridge.BaseUrl} in default browser...");
        OpenBrowser(bridge.BaseUrl);

        StartHeartbeatMonitor(bridge);

        ShutdownSignal.Wait();

        app.Shutdown();
        bridge.Stop();
        Log("Exiting.");
    }

    private static void OpenBrowser(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Log($"Failed to open browser: {ex.Message}");
            ShowMessage($"无法打开浏览器，请手动访问：\n\n{url}\n\n（本机桥接服务仍在运行）", "打开浏览器失败");
        }
    }

    /// <summary>
    /// 页面注入的心跳脚本每 5 秒上报一次 Ping。浏览器标签关闭后心跳停止，
    /// 宿主进程自动退出，避免残留后台进程。
    /// </summary>
    private static void StartHeartbeatMonitor(BridgeServer bridge)
    {
        Task.Run(async () =>
        {
            var started = DateTime.UtcNow;
            var sawHeartbeat = false;
            while (!ShutdownSignal.IsSet)
            {
                await Task.Delay(5000);
                var heartbeat = bridge.LastHeartbeatUtc;
                if (heartbeat == default) continue;
                sawHeartbeat = true;
                var idle = DateTime.UtcNow - heartbeat;
                var neverLoaded = !sawHeartbeat && DateTime.UtcNow - started > TimeSpan.FromSeconds(90);
                if ((idle > TimeSpan.FromSeconds(120)) || neverLoaded)
                {
                    Log($"No browser heartbeat for {(int)idle.TotalSeconds}s; shutting down.");
                    ShutdownSignal.Set();
                    return;
                }
            }
        });
    }

    private static string? FindFrontendDist()
    {
        var current = AppContext.BaseDirectory;
        for (var i = 0; i < 6; i++)
        {
            var candidate = Path.Combine(current, "frontend", "dist");
            if (Directory.Exists(candidate)) return candidate;
            candidate = Path.Combine(current, "dist");
            if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "index.html"))) return candidate;
            current = Path.GetDirectoryName(current);
            if (current == null) return null;
        }
        var repoRoot = "/Users/cly/Documents/CSPlayerStatsRadar";
        var repoDist = Path.Combine(repoRoot, "frontend", "dist");
        return Directory.Exists(repoDist) ? repoDist : null;
    }

    private static void ShowFatalError(string title, Exception? ex)
    {
        var message = ex?.Message ?? "未知错误";
        Log($"{title}: {message}\n{ex?.StackTrace}");
        if (OperatingSystem.IsWindows())
            MessageBox(IntPtr.Zero, $"{title}：\n\n{message}", "CS Player Stats Radar Studio", 0x10 /* MB_ICONERROR */);
    }

    private static void ShowMessage(string message, string title)
    {
        Log($"{title}: {message.Replace("\n", " ")}");
        if (OperatingSystem.IsWindows())
            MessageBox(IntPtr.Zero, message, title, 0x40 /* MB_ICONINFORMATION */);
    }

    private static void Log(string message)
    {
        try
        {
            var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}";
            Console.WriteLine(line);
            lock (LogLock)
            {
                logPath ??= EnsureLogFile();
                if (logPath != null) File.AppendAllText(logPath, line + Environment.NewLine);
            }
        }
        catch
        {
            // 日志写入失败不影响应用运行。
        }
    }

    private static string? EnsureLogFile()
    {
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CSPlayerStatsRadar");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "app.log");
        }
        catch
        {
            return null;
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);
}