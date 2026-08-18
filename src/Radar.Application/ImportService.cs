using System.Collections.Concurrent;
using System.IO.Compression;
using Radar.Domain.Models;

namespace Radar.Application;

public class ImportService
{
    private const long MaxImportFileSize = 4L << 30;
    private const long MaxExtractedDemoSize = 2L << 30;
    private const ulong MaxZipRatio = 200;

    private readonly IHistoryRepository repo;
    private readonly HistoryService history;
    private readonly Func<string, DemoData> parseDemo;
    private readonly object jobsLock = new();
    private readonly Dictionary<string, ImportJob> jobs = new();
    private Action<ImportSummary>? onProgress;

    private class ImportJob
    {
        public CancellationTokenSource Cts { get; } = new();
        public List<string> Paths { get; init; } = new();
        public object Lock { get; } = new();
        public ImportSummary Summary { get; set; } = new();
    }

    public ImportService(IHistoryRepository repo, HistoryService history, Func<string, DemoData> parseDemo)
    {
        this.repo = repo;
        this.history = history;
        this.parseDemo = parseDemo;
    }

    public void SetProgressHandler(Action<ImportSummary> handler) => onProgress = handler;

    public static (List<string>? Paths, string? Error) ScanSourcePaths(List<ImportSource> sources)
    {
        var seen = new HashSet<string>();
        var paths = new List<string>();
        foreach (var source in sources)
        {
            if (!Directory.Exists(source.Path))
                return (null, "invalid_file_type");
            foreach (var entry in Directory.EnumerateFileSystemEntries(source.Path))
            {
                var name = Path.GetFileName(entry);
                if (name.StartsWith(".")) continue;
                var attrs = File.GetAttributes(entry);
                if ((attrs & FileAttributes.Directory) != 0) continue;
                if ((attrs & FileAttributes.ReparsePoint) != 0) continue;
                var lower = name.ToLowerInvariant();
                if (!lower.EndsWith(".dem") && !lower.EndsWith(".zip")) continue;
                if (seen.Add(entry)) paths.Add(entry);
            }
        }
        paths.Sort(StringComparer.Ordinal);
        return (paths, null);
    }

    public (string JobID, string? Error) Start(List<string> paths)
    {
        paths = UniqueStrings(paths);
        if (paths.Count == 0)
            return ("", "invalid_file_type");
        var cts = new CancellationTokenSource();
        var jobID = "import_" + DateTime.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + HistoryService.RandomHex(4);
        var job = new ImportJob
        {
            Paths = paths,
            Summary = new ImportSummary
            {
                JobID = jobID,
                Status = "running",
                Total = paths.Count,
                Items = new List<ImportItemResult>(),
                Discovered = new List<Player>(),
                StartedAt = DateTime.UtcNow.ToString("o"),
            },
        };
        lock (jobsLock) jobs[jobID] = job;
        _ = Task.Run(() => Run(job));
        return (jobID, null);
    }

    private void Run(ImportJob job)
    {
        var workers = 2;
        using var queue = new BlockingCollection<string>(new ConcurrentQueue<string>());
        var tasks = new List<Task>();
        for (var i = 0; i < workers; i++)
        {
            tasks.Add(Task.Run(() =>
            {
                foreach (var path in queue.GetConsumingEnumerable())
                {
                    if (job.Cts.IsCancellationRequested) break;
                    ImportItemResult result;
                    try
                    {
                        result = ProcessPath(job.Cts.Token, path, null);
                    }
                    catch (Exception ex)
                    {
                        result = new ImportItemResult
                        {
                            Path = path,
                            FileName = Path.GetFileName(path),
                            Status = "failed",
                            Message = "导入异常：" + ex.Message,
                        };
                    }
                    lock (job.Lock)
                    {
                        job.Summary.Items.Add(result);
                        job.Summary.Processed++;
                        switch (result.Status)
                        {
                            case "imported": job.Summary.Imported++; break;
                            case "duplicate": job.Summary.Duplicates++; break;
                            case "failed":
                            case "needs_attention": job.Summary.Failed++; break;
                        }
                        job.Summary.Discovered = MergeDiscovered(job.Summary.Discovered, result.Players);
                        var snapshot = job.Summary;
                        Emit(snapshot);
                    }
                }
            }));
        }
        foreach (var path in job.Paths)
        {
            if (job.Cts.IsCancellationRequested) break;
            queue.Add(path);
        }
        queue.CompleteAdding();
        try
        {
            Task.WaitAll(tasks.ToArray());
        }
        catch (AggregateException)
        {
        }
        finally
        {
            lock (job.Lock)
            {
                job.Summary.Status = job.Cts.IsCancellationRequested ? "cancelled" : "completed";
                job.Summary.CompletedAt = DateTime.UtcNow.ToString("o");
                var snapshot = job.Summary;
                Emit(snapshot);
            }
        }
    }

    private ImportItemResult ProcessPath(CancellationToken token, string path, List<string>? allowedOverride)
    {
        var result = new ImportItemResult { Path = path, FileName = Path.GetFileName(path) };
        FileInfo info;
        try
        {
            info = new FileInfo(path);
            if (!info.Exists || (info.Attributes & FileAttributes.ReparsePoint) != 0)
            {
                result.Status = "failed";
                result.Message = "文件不可读取或不是普通文件。";
                return result;
            }
        }
        catch
        {
            result.Status = "failed";
            result.Message = "文件不可读取或不是普通文件。";
            return result;
        }
        if (info.Length > MaxImportFileSize)
        {
            result.Status = "failed";
            result.Message = "文件超过 4GB 安全限制。";
            return result;
        }

        var demoPath = path;
        var cleanup = default(Action);
        var ext = Path.GetExtension(path).ToLowerInvariant();
        if (ext == ".zip")
        {
            (demoPath, cleanup, var zipError) = ExtractSingleDemo(path);
            if (zipError != null)
            {
                result.Status = "needs_attention";
                result.Message = zipError;
                return result;
            }
        }
        else if (ext != ".dem")
        {
            result.Status = "failed";
            result.Message = "仅支持 .dem 和 .zip。";
            return result;
        }

        try
        {
            token.ThrowIfCancellationRequested();
            DemoData data;
            try
            {
                data = parseDemo(demoPath);
            }
            catch
            {
                result.Status = "failed";
                result.Message = "解析失败。";
                return result;
            }
            result.Players = data.Players;
            result.PlayerDetails = BuildImportPlayerDetails(data);
            result.MapName = data.Meta.MapName;
            result.Rounds = data.Rounds.Count;

            var allowed = allowedOverride ?? new List<string>();
            if (allowedOverride == null)
            {
                foreach (var followed in repo.ListFollowedPlayers())
                    allowed.Add(followed.SteamID);
            }

            var saveResult = history.SaveParsedDemoForPlayersAtSource(Path.GetFileName(demoPath), path, data, allowed);
            if (saveResult.SavedDemo != null) result.DemoID = saveResult.SavedDemo.DemoRecordID;
            foreach (var player in data.Players)
                if (allowed.Contains(player.SteamID)) result.SavedCount++;

            result.Status = saveResult.SaveStatus == "duplicate" ? "duplicate" : "imported";
            return result;
        }
        catch (OperationCanceledException)
        {
            result.Status = "cancelled";
            return result;
        }
        finally
        {
            cleanup?.Invoke();
        }
    }

    private static (string Path, Action? Cleanup, string? Error) ExtractSingleDemo(string zipPath)
    {
        try
        {
            using var archive = ZipFile.OpenRead(zipPath);
            ZipArchiveEntry? demo = null;
            foreach (var entry in archive.Entries)
            {
                if (entry.FullName.EndsWith("/")) continue;
                if (!Path.GetExtension(entry.Name).Equals(".dem", StringComparison.OrdinalIgnoreCase)) continue;
                if (demo != null) return ("", null, "ZIP 中包含多个 DEM，请先整理压缩包");
                demo = entry;
            }
            if (demo == null) return ("", null, "ZIP 中没有 DEM 文件");
            if (demo.Length > MaxExtractedDemoSize) return ("", null, "ZIP 中的 DEM 超过 2GB 安全限制");
            if (demo.CompressedLength > 0 && (ulong)demo.Length / (ulong)demo.CompressedLength > MaxZipRatio)
                return ("", null, "ZIP 压缩比异常，已拒绝解压");

            var tempDir = Path.Combine(Path.GetTempPath(), "cs-radar-import-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDir);
            var targetPath = Path.Combine(tempDir, Path.GetFileName(demo.Name));
            demo.ExtractToFile(targetPath, overwrite: false);
            return (targetPath, () => { try { Directory.Delete(tempDir, true); } catch { /* ignore */ } }, null);
        }
        catch (Exception ex)
        {
            return ("", null, "ZIP 解压失败或超过安全限制：" + ex.Message);
        }
    }

    public (ImportSummary? Summary, string? Error) Summary(string jobID)
    {
        lock (jobsLock)
        {
            if (!jobs.TryGetValue(jobID, out var job)) return (null, "demo_not_found");
            lock (job.Lock) return (job.Summary, null);
        }
    }

    public string? Cancel(string jobID)
    {
        lock (jobsLock)
        {
            if (!jobs.TryGetValue(jobID, out var job)) return "demo_not_found";
            job.Cts.Cancel();
            return null;
        }
    }

    public (ImportSummary? Summary, string? Error) Backfill(string jobID, string path, List<Player> players)
    {
        lock (jobsLock)
        {
            if (!jobs.TryGetValue(jobID, out var job)) return (null, "demo_not_found");
            if (!job.Paths.Contains(path)) return (null, "demo_not_found");
            var ids = new List<string>();
            foreach (var player in players)
            {
                repo.SetPlayerFollowed(player, true);
                ids.Add(player.SteamID);
            }
            var itemResult = ProcessPath(CancellationToken.None, path, ids);
            var followed = repo.ListFollowedPlayers();
            var followedIDs = new HashSet<string>(followed.Select(p => p.SteamID));
            lock (job.Lock)
            {
                for (var i = 0; i < job.Summary.Items.Count; i++)
                {
                    if (job.Summary.Items[i].Path != path) continue;
                    job.Summary.Items[i].SavedCount = job.Summary.Items[i].Players.Count(p => followedIDs.Contains(p.SteamID));
                    break;
                }
                var snapshot = job.Summary;
                Emit(snapshot);
                return (snapshot, null);
            }
        }
    }

    private void Emit(ImportSummary summary)
    {
        try { onProgress?.Invoke(summary); }
        catch { /* ignore */ }
    }

    public static List<string> UniqueStrings(List<string> values)
    {
        var seen = new HashSet<string>();
        var result = new List<string>();
        foreach (var value in values)
            if (seen.Add(value)) result.Add(value);
        return result;
    }

    public static List<Player> MergeDiscovered(List<Player> current, List<Player> incoming)
    {
        var byID = new Dictionary<string, Player>();
        foreach (var player in current)
            if (player.SteamID != "") byID[player.SteamID] = player;
        foreach (var player in incoming)
            if (player.SteamID != "") byID[player.SteamID] = player;
        return byID.Values.OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public static List<ImportPlayerDetail> BuildImportPlayerDetails(DemoData data)
    {
        var observed = new Dictionary<string, (int Round, string Side)>();
        void Observe(string steamID, string side, int round)
        {
            if (steamID == "" || (side != "T" && side != "CT")) return;
            if (!observed.TryGetValue(steamID, out var current) || round < current.Round)
                observed[steamID] = (round, side);
        }
        foreach (var state in data.Survivals)
            Observe(state.SteamID, state.Side, state.RoundNumber);
        foreach (var e in data.Kills)
        {
            Observe(e.AttackerSteamID, e.AttackerSide, e.RoundNumber);
            Observe(e.VictimSteamID, e.VictimSide, e.RoundNumber);
        }

        var details = new List<ImportPlayerDetail>();
        var teamCounts = new Dictionary<string, int> { ["A"] = 0, ["B"] = 0 };
        foreach (var player in data.Players)
        {
            var team = "";
            if (observed.TryGetValue(player.SteamID, out var observation))
            {
                team = observation.Side == "T" ? "A" : "B";
                teamCounts[team]++;
            }
            var detail = new ImportPlayerDetail { Name = player.Name, SteamID = player.SteamID, Team = team };
            foreach (var e in data.Kills)
            {
                if (e.AttackerSteamID == player.SteamID && e.VictimSteamID != player.SteamID) detail.Kills++;
                if (e.VictimSteamID == player.SteamID) detail.Deaths++;
                if (e.AssisterSteamID == player.SteamID) detail.Assists++;
            }
            details.Add(detail);
        }

        details = OrderDetails(details);
        for (var i = 0; i < details.Count; i++)
        {
            if (details[i].Team != "") continue;
            var team = teamCounts["A"] > teamCounts["B"] ? "B" : "A";
            details[i].Team = team;
            teamCounts[team]++;
        }
        return OrderDetails(details);
    }

    private static List<ImportPlayerDetail> OrderDetails(List<ImportPlayerDetail> details)
    {
        return details
            .OrderBy(d => d.Team, StringComparer.Ordinal)
            .ThenBy(d => d.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}