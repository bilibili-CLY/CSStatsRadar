using System.IO.Compression;
using Radar.Api;
using Radar.Application;
using Radar.Domain.Models;
using Radar.Parser;
using Xunit;

namespace Radar.Tests;

public class ImportServiceTests
{
    private const string DemoPath = "/Users/cly/Documents/CSPlayerStatsRadar/doc/perfect-world.dem";

    private static string TestDataPath(string name) => Path.Combine(AppContext.BaseDirectory, "TestData", name);

    private static string G163DemoPath() => DemoPath;

    private static void CopyG163(string dest)
    {
        File.Copy(G163DemoPath(), dest, true);
    }

    [Fact]
    public void ScanSourcePaths_Returns_Sorted_Dem_And_Zip_Only()
    {
        if (!File.Exists(DemoPath)) return;
        var dir = CreateTempDir();
        try
        {
            var g163 = Path.Combine(dir, "b_dust2.dem");
            CopyG163(g163);
            File.WriteAllText(Path.Combine(dir, "a_notes.txt"), "x");
            File.WriteAllText(Path.Combine(dir, ".hidden.dem"), "x");
            Directory.CreateDirectory(Path.Combine(dir, "subdir"));
            var sub = Path.Combine(dir, "subdir", "c_inner.dem");
            CopyG163(sub);

            var (paths, err) = ImportService.ScanSourcePaths(new List<ImportSource> { new() { Path = dir } });
            Assert.Null(err);
            Assert.Single(paths!);
            Assert.Equal("b_dust2.dem", Path.GetFileName(paths![0]));
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void StartFileImport_Imports_Zip_And_Reports_Completed()
    {
        if (!File.Exists(DemoPath)) return;
        var dir = CreateTempDir();
        try
        {
            var zipPath = Path.Combine(dir, "packed.zip");
            using (var stream = new FileStream(zipPath, FileMode.Create))
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Create))
                zip.CreateEntryFromFile(G163DemoPath(), "inside_dust2.dem");

            using var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db"));
            var jobID = app.StartFileImport(new List<string> { zipPath });
            Assert.StartsWith("import_", jobID);

            var summary = WaitForJob(app, jobID);
            Assert.Equal("completed", summary.Status);
            Assert.Equal(1, summary.Total);
            Assert.Equal(1, summary.Processed);
            Assert.Equal(1, summary.Imported);
            Assert.Single(summary.Items);
            Assert.Equal("imported", summary.Items[0].Status);
            Assert.Equal("packed.zip", summary.Items[0].FileName);
            Assert.Equal("de_nuke", summary.Items[0].MapName);
            Assert.Equal(18, summary.Items[0].Rounds);
            Assert.Equal(10, summary.Items[0].Players.Count);
            Assert.Equal(10, summary.Items[0].PlayerDetails.Count);

            var demos = app.ListDemos();
            Assert.Single(demos);
            Assert.Equal("inside_dust2.dem", demos[0].FileName);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Reparse_Zip_Imported_Demo_Backfills_Missing_Players()
    {
        if (!File.Exists(DemoPath)) return;
        var dir = CreateTempDir();
        try
        {
            var zipPath = Path.Combine(dir, "packed.zip");
            using (var stream = new FileStream(zipPath, FileMode.Create))
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Create))
                zip.CreateEntryFromFile(G163DemoPath(), "inside_dust2.dem");

            using var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db"));
            var summary = WaitForJob(app, app.StartFileImport(new List<string> { zipPath }));
            Assert.Equal("imported", summary.Items[0].Status);

            var demos = app.ListDemos();
            Assert.Single(demos);
            var demo = demos[0];
            // 源文件保留为 zip：重解析必须自己把 DEM 从压缩包里还原出来。
            Assert.Equal(zipPath, demo.SourcePath);

            var steamID = demo.Participants[0].SteamID;
            Assert.Empty(app.GetPlayerMatches(steamID));

            // 曾经在这里抛 ErrInvalidFileType（csda 把 zip 当成 demo）。
            app.FollowDemoPlayers(demo.DemoRecordID, new List<string> { steamID });

            var matches = app.GetPlayerMatches(steamID);
            Assert.Single(matches);
            Assert.Equal("inside_dust2.dem", matches[0].FileName);
            Assert.Equal("de_nuke", matches[0].MapName);
            Assert.Equal(18, matches[0].Rounds);

            var analysis = app.ReparseDemoAnalysis(demo.DemoRecordID);
            Assert.Equal("de_nuke", analysis.MapName);
            Assert.Equal(18, analysis.Rounds);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Import_Same_Demo_Twice_Reports_Duplicate()
    {
        if (!File.Exists(DemoPath)) return;
        var dir = CreateTempDir();
        try
        {
            var demo = Path.Combine(dir, "dust2.dem");
            CopyG163(demo);
            using var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db"));

            var first = WaitForJob(app, app.StartFileImport(new List<string> { demo }));
            Assert.Equal(1, first.Imported);

            // Follow one player so the second import has something to save
            var target = first.Items[0].Players[0];
            app.FollowAndBackfill(first.JobID, demo, new List<Player> { target });

            var second = WaitForJob(app, app.StartFileImport(new List<string> { demo }));
            Assert.Equal(1, second.Duplicates);
            Assert.Equal("duplicate", second.Items[0].Status);

            Assert.Single(app.ListDemos());
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void AddSource_RemoveSource_Persist_Across_App()
    {
        var dir = CreateTempDir();
        try
        {
            var sourceDir = Path.Combine(dir, "materials");
            Directory.CreateDirectory(sourceDir);
            using (var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db")))
            {
                var sources = app.AddImportSource(sourceDir);
                Assert.Single(sources);
                Assert.Equal("materials", sources[0].Name);
                Assert.Equal(sourceDir, sources[0].Path);
            }

            using (var app2 = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db")))
            {
                var sources = app2.CurrentConfig.ImportSources;
                Assert.Single(sources);
                var removed = app2.RemoveImportSource(sources[0].ID);
                Assert.Empty(removed);
            }
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void FollowAndBackfill_Saves_Selected_Players_And_Follows_Them()
    {
        if (!File.Exists(DemoPath)) return;
        var dir = CreateTempDir();
        try
        {
            var demo = Path.Combine(dir, "dust2.dem");
            CopyG163(demo);
            using var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db"));
            var jobID = app.StartFileImport(new List<string> { demo });
            var summary = WaitForJob(app, jobID);

            // No followed players -> nothing saved
            Assert.Equal(0, summary.Items[0].SavedCount);
            Assert.Empty(app.ListPlayers());

            var target = summary.Items[0].Players[0];
            var backfilled = app.FollowAndBackfill(jobID, demo, new List<Player> { target });
            Assert.Equal(1, backfilled.Items[0].SavedCount);
            Assert.Single(app.ListPlayers());
            Assert.Single(app.ListFollowedPlayers());
            Assert.Equal(target.SteamID, app.ListFollowedPlayers()[0].SteamID);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void CancelImport_Flips_Status_To_Cancelled()
    {
        if (!File.Exists(DemoPath)) return;
        var dir = CreateTempDir();
        try
        {
            var demo = Path.Combine(dir, "dust2.dem");
            CopyG163(demo);
            using var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db"));
            var jobID = app.StartFileImport(new List<string> { demo });
            app.CancelImport(jobID);
            var summary = WaitForJob(app, jobID);
            Assert.Equal("cancelled", summary.Status);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void ImportSummary_Unknown_Job_Throws_NotFound()
    {
        var dir = CreateTempDir();
        try
        {
            using var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db"));
            var ex = Assert.Throws<AppError>(() => app.ImportSummary("import_unknown"));
            Assert.Equal("demo_not_found", ex.Code);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void ConcurrentImport_Multiple_Demos_Completes_Job()
    {
        if (!File.Exists(DemoPath)) return;
        var dir = CreateTempDir();
        try
        {
            var demos = new List<string>();
            for (var i = 0; i < 3; i++)
            {
                var demo = Path.Combine(dir, $"dust2_{i}.dem");
                CopyG163(demo);
                demos.Add(demo);
            }
            using var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db"));
            var jobID = app.StartFileImport(demos);
            var summary = WaitForJob(app, jobID);

            Assert.Equal("completed", summary.Status);
            Assert.Equal(3, summary.Total);
            Assert.Equal(3, summary.Processed);
            Assert.Equal(3, summary.Items.Count);
            Assert.Equal(3, summary.Imported);
            Assert.Equal(0, summary.Duplicates);
            Assert.All(summary.Items, item => Assert.Equal("imported", item.Status));
            Assert.Single(app.ListDemos());
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    public static ImportSummary WaitForJob(DesktopApp app, string jobID)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            var summary = app.ImportSummary(jobID);
            if (summary.Status is "completed" or "cancelled" or "failed") return summary;
            Thread.Sleep(50);
        }
        throw new TimeoutException("import job did not finish in time");
    }

    private static string CreateTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "radar-import-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }
}