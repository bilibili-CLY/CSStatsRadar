using PhotinoNET;
using Radar.Api;

namespace Radar.App;

public static class Program
{
    public static void Main(string[] args)
    {
        var configPath = args.Length > 0 ? args[0] : null;
        var dbPath = args.Length > 1 ? args[1] : null;
        var frontendDir = args.Length > 2 ? args[2] : null;

        if (string.IsNullOrEmpty(frontendDir))
        {
            var root = FindFrontendDist();
            frontendDir = root ?? throw new InvalidOperationException("找不到 frontend/dist，请先用 npm run build 构建前端。");
        }

        var app = new DesktopApp(configPath, dbPath);
        var bridge = new BridgeServer(app, frontendDir);
        bridge.Start();
        Console.WriteLine($"Bridge listening at {bridge.BaseUrl}");

        var window = new PhotinoWindow()
            .SetTitle("CS Player Stats Radar Studio")
            .SetUseOsDefaultSize(false)
            .SetSize(1440, 900)
            .SetMinSize(1180, 720)
            .Center()
            .SetResizable(true);

        window.RegisterWindowClosingHandler((sender, e) =>
        {
            app.Shutdown();
            bridge.Stop();
            return false;
        });

        window.Load(bridge.BaseUrl);
        window.WaitForClose();
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
}