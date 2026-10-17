using System.Text.Json;
using Radar.Application;
using Radar.Domain.Models;
using Radar.Infrastructure;
using Radar.Parser;

namespace Radar.Api;

public class DesktopApp : IDisposable
{
    private readonly ConfigManager config;
    private AppConfig cfg;
    private readonly SQLiteHistoryRepository repo;
    private readonly HistoryService history;
    private readonly CsdaParser parser;
    private readonly ImportService imports;
    private readonly object cfgLock = new();
    private readonly object videoLock = new();
    private readonly Dictionary<string, VideoExportSession> videoExports = new();
    private readonly object downloadLock = new();
    private readonly Dictionary<string, VideoDownload> videoDownloads = new();

    public DesktopApp(string? configPath = null, string? databasePath = null)
    {
        config = new ConfigManager(configPath ?? "");
        cfg = config.Read(out _);
        if (!string.IsNullOrEmpty(databasePath)) cfg.DatabasePath = databasePath;
        repo = new SQLiteHistoryRepository(cfg.DatabasePath);
        repo.Init();
        history = new HistoryService(repo);
        parser = new CsdaParser();
        imports = new ImportService(repo, history, path => ParseDemoFile(path));
    }

    public void Shutdown() => repo.Close();

    public void Dispose()
    {
        Shutdown();
        GC.SuppressFinalize(this);
    }

    public AppConfig CurrentConfig => cfg;

    public BootstrapState Bootstrap()
    {
        var players = repo.ListPlayers();
        var followed = repo.ListFollowedPlayers();
        return new BootstrapState { Config = cfg, Players = players, Followed = followed };
    }

    public List<SavedDemo> ListDemos() => repo.ListDemos();

    public void UpdateDemoNote(string demoID, string note) => repo.UpdateDemoNote(demoID, note);

    public void DeleteDemos(List<string> demoIDs) => repo.DeleteDemos(demoIDs);

    public DemoAnalysis GetDemoAnalysis(string demoID)
    {
        var analysis = repo.GetDemoAnalysis(demoID);
        if (analysis != null) return analysis;
        var demo = repo.GetDemo(demoID);
        if (demo == null) throw AppErrors.New("demo_not_found", AppErrors.StatusNotFound);
        var parsed = ParseDemoFile(demo.SourcePath, demo.FileName);
        analysis = DemoAnalysisBuilder.Build(demoID, parsed.Demo);
        repo.SaveDemoAnalysis(demoID, analysis);
        return analysis;
    }

    public DemoAnalysis ReparseDemoAnalysis(string demoID)
    {
        var demo = repo.GetDemo(demoID);
        if (demo == null) throw AppErrors.New("demo_not_found", AppErrors.StatusNotFound);
        var parsed = ParseDemoFile(demo.SourcePath, demo.FileName);
        var analysis = DemoAnalysisBuilder.Build(demoID, parsed.Demo);
        repo.SaveDemoAnalysis(demoID, analysis);
        return analysis;
    }

    public List<SavedPlayer> ListPlayers() => repo.ListPlayers();

    public List<Player> ListFollowedPlayers() => repo.ListFollowedPlayers();

    public List<PlayerMatchRecord> GetPlayerMatches(string steamID) => repo.ListPlayerMatches(steamID);

    public void SetPlayerFollowed(Player player, bool followed) => repo.SetPlayerFollowed(player, followed);

    /// <summary>手动改名：仅更新显示名（players/followed/discovered 的名称字段），历史快照不动。</summary>
    public void RenamePlayer(string steamID, string name)
    {
        var trimmed = (name ?? "").Trim();
        if (trimmed == "") throw AppErrors.New("player_name_empty", AppErrors.StatusBadRequest, "名称不能为空。");
        if (trimmed.Length > 64) throw AppErrors.New("player_name_too_long", AppErrors.StatusBadRequest, "名称最长 64 个字符。");
        if (repo.GetPlayer(steamID) == null)
            throw AppErrors.New("player_record_not_found", AppErrors.StatusNotFound);
        repo.RenamePlayer(steamID, trimmed);
    }

    /// <summary>
    /// 批量清洗「战队名 玩家名」前缀：对名称含空格的玩家，取其最近 ≤3 场可用 demo 重解析，
    /// 依据该 demo 的聚类前缀（≥2 玩家共享的 1..3 词前缀）或 Settings 配置的 team_tags 判定；
    /// 命中才改名，未命中跳过并给出原因。绝不使用裸空格启发式。
    /// </summary>
    public List<TeamPrefixCleanResult> CleanTeamPrefixNames()
    {
        var tags = TeamPrefix.ParseTags(cfg.TeamTags);
        var results = new List<TeamPrefixCleanResult>();
        var parsedByDemo = new Dictionary<string, ParsedDemo>(StringComparer.Ordinal);
        foreach (var p in repo.ListPlayers())
        {
            var oldName = p.Name ?? "";
            var (token, rest) = TeamPrefix.Split(oldName);
            if (token == "" || rest == "") continue; // 无空格或空 token 的玩家不参与
            var item = new TeamPrefixCleanResult { SteamID = p.SteamID, OldName = oldName };
            var demos = repo.ListPlayerMatches(p.SteamID)
                .Where(m => !string.IsNullOrWhiteSpace(m.SourcePath) && File.Exists(m.SourcePath))
                .GroupBy(m => m.DemoRecordID, StringComparer.Ordinal)
                .Select(g => g.First())
                .OrderByDescending(m => m.MatchTime)
                .Take(3);
            var done = false;
            var reason = "没有可用的 demo 文件。";
            foreach (var demoRec in demos)
            {
                if (!parsedByDemo.TryGetValue(demoRec.DemoRecordID, out var parsed))
                {
                    try
                    {
                        parsed = ParseDemoFile(demoRec.SourcePath!, demoRec.FileName);
                        parsedByDemo[demoRec.DemoRecordID] = parsed;
                    }
                    catch (Exception ex)
                    {
                        reason = "demo 解析失败：" + ex.Message;
                        continue;
                    }
                }
                var cluster = TeamPrefix.ClusterPrefixes(parsed.Match);
                if (!TeamPrefix.TryStrip(oldName, cluster, tags, out var stripped))
                {
                    reason = "未匹配已知战队前缀。";
                    continue;
                }
                repo.RenamePlayer(p.SteamID, stripped);
                item.NewName = stripped;
                item.Status = "renamed";
                results.Add(item);
                done = true;
                break;
            }
            if (!done)
            {
                item.Status = "skipped";
                item.Reason = reason;
                results.Add(item);
            }
        }
        return results;
    }

    public void DeletePlayerData(string steamID)
    {
        if (repo.GetPlayer(steamID) == null)
            throw AppErrors.New("player_record_not_found", AppErrors.StatusNotFound);
        repo.DeletePlayer(steamID);
    }

    public void DeletePlayerMatches(string steamID, List<string> demoIDs)
    {
        foreach (var id in demoIDs)
            repo.DeletePlayerMatch(steamID, id);
    }

    public List<MatchGroup> ListMatchGroups(string steamID) => repo.ListMatchGroups(steamID);

    public MatchGroup CreateMatchGroup(string steamID, string name)
    {
        var trimmed = name.Trim();
        if (trimmed == "")
            throw AppErrors.New("invalid_match_group", AppErrors.StatusBadRequest, "分组名称不能为空。");
        return repo.CreateMatchGroup(steamID, trimmed);
    }

    public void RenameMatchGroup(long groupID, string name)
    {
        var trimmed = name.Trim();
        if (trimmed == "")
            throw AppErrors.New("invalid_match_group", AppErrors.StatusBadRequest, "分组名称不能为空。");
        repo.RenameMatchGroup(groupID, trimmed);
    }

    public void DeleteMatchGroup(long groupID) => repo.DeleteMatchGroup(groupID);

    public void AssignMatchGroup(string steamID, string demoRecordID, long? groupID)
        => repo.AssignMatchGroup(steamID, demoRecordID, groupID);

    public void ClearAllData() => repo.DeleteAllPlayers();

    /// <summary>日志目录（与 sidecar、Tauri 壳共用的 &lt;dataDir&gt;/logs）。</summary>
    public string LogsDir() => AppPaths.LogsDir();

    /// <summary>清空应用日志；日志目录不存在或为空时返回 0，不报错。</summary>
    public LogClearResult ClearLogs() => LogFiles.Clear();

    /// <summary>在系统文件管理器里打开日志目录（便于用户交日志排查）。</summary>
    public void OpenLogsDir()
    {
        var dir = AppPaths.LogsDir();
        Directory.CreateDirectory(dir);
        var (fileName, arguments) = OperatingSystem.IsWindows()
            ? ("explorer.exe", $"\"{dir}\"")
            : OperatingSystem.IsMacOS()
                ? ("open", $"\"{dir}\"")
                : ("xdg-open", $"\"{dir}\"");
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(fileName, arguments)
        {
            UseShellExecute = true,
        });
    }

    public AggregateRadarResponse BuildRadar(string steamID, List<string> demoRecordIDs)
    {
        var player = repo.GetPlayer(steamID);
        if (player == null) throw AppErrors.New("player_record_not_found", AppErrors.StatusNotFound);
        var records = repo.GetMetricSnapshots(steamID, demoRecordIDs);
        if (records.Count != AggregateRadar.UniqueStrings(demoRecordIDs).Count)
            throw AppErrors.New("match_record_not_found", AppErrors.StatusNotFound);
        var playerModel = new Player { Name = player.Name, SteamID = player.SteamID };
        var err = AggregateRadarBuilder.Build(playerModel, records, out var response);
        if (err != null) throw AppErrors.New(err, AppErrors.StatusUnprocessable);
        return response;
    }

    public RatingMethodology GetRatingMethodology() => Rating3.GetMethodology();

    public EditorDraft? LoadDraft(string kind) => repo.GetEditorDraft(kind);

    public void SaveDraft(string kind, string payload)
    {
        if (kind is not ("radar" or "overlay" or "showcase"))
            throw AppErrors.New("invalid_export_size", AppErrors.StatusBadRequest, "草稿类型无效。");
        try { JsonDocument.Parse(payload); }
        catch { throw AppErrors.New("invalid_export_size", AppErrors.StatusBadRequest, "草稿内容必须是合法 JSON。"); }
        repo.SaveEditorDraft(new EditorDraft { Kind = kind, Payload = payload });
    }

    public AppConfig SavePreferences(int exportWidth, int exportHeight, int videoFPS, string ffmpegPath, bool reduceMotion, bool showBestMarkers, bool showIntroAnimation, bool showBestEntranceAnimation, int audioOffsetMS, string radarScaleMode, double radarScale, Dictionary<string, double> radarAxisScale, string ratingVersion, bool showRatingWatermark, Dictionary<string, double> radarFloor, string teamTags)
    {
        cfg.ExportWidth = exportWidth;
        cfg.ExportHeight = exportHeight;
        cfg.VideoFPS = videoFPS;
        cfg.Showcase.FFmpegPath = ffmpegPath;
        cfg.ReduceMotion = reduceMotion;
        cfg.Showcase.ShowBestMarkers = showBestMarkers;
        cfg.Showcase.ShowIntroAnimation = showIntroAnimation;
        cfg.Showcase.ShowBestEntranceAnimation = showBestEntranceAnimation;
        cfg.Showcase.AudioOffsetMS = audioOffsetMS;
        cfg.Showcase.RadarScaleMode = radarScaleMode;
        cfg.Showcase.RadarScale = radarScale;
        cfg.Showcase.RadarAxisScale = radarAxisScale;
        cfg.Showcase.RadarFloor = radarFloor;
        cfg.RatingVersion = ratingVersion;
        cfg.ShowRatingWatermark = showRatingWatermark;
        cfg.TeamTags = teamTags ?? "";
        var err = config.Validate(cfg);
        if (err != null) throw AppErrors.New(err, AppErrors.StatusBadRequest, err);
        var saveErr = config.Save(cfg);
        if (saveErr != null) throw AppErrors.New(saveErr, AppErrors.StatusInternal);
        return cfg;
    }

    public AppConfig SwitchDatabase(string path)
    {
        cfg.DatabasePath = path;
        var err = config.Validate(cfg);
        if (err != null) throw AppErrors.New(err, AppErrors.StatusBadRequest, err);
        config.Save(cfg);
        repo.Close();
        var newRepo = new SQLiteHistoryRepository(path);
        var initErr = newRepo.Init();
        if (initErr != null) throw AppErrors.New(initErr, AppErrors.StatusInternal);
        return cfg;
    }

    public HistorySaveResult ImportDemo(string path, List<string>? allowedSteamIDs = null)
    {
        var parsed = ParseDemoFile(path);
        return history.SaveParsedDemoForPlayersAtSource(System.IO.Path.GetFileName(path), path, parsed, allowedSteamIDs);
    }

public DemoAnalysis GetDemoAnalysisFromFile(string path)
    {
        var parsed = ParseDemoFile(path);
        return DemoAnalysisBuilder.Build(PathUtils.GetDemoId(), parsed.Demo);
    }

    public string? ChooseImportDirectory() => NativeDialogs.ChooseDirectory("选择素材目录");

    public List<string> ChooseImportFiles() => NativeDialogs.ChooseFiles("选择 DEM 或 ZIP", ".dem", ".zip") ?? new List<string>();

    public List<ImportSource> AddImportSource(string path)
    {
        path = PathUtils.CleanPath(path);
        if (!Directory.Exists(path))
            throw AppErrors.New("invalid_file_type", AppErrors.StatusBadRequest, "素材目录不存在或不可读取。");
        lock (cfgLock)
        {
            foreach (var source in cfg.ImportSources)
                if (PathUtils.CleanPath(source.Path) == path) return cfg.ImportSources;
            cfg.ImportSources.Add(new ImportSource
            {
                ID = "source_" + HistoryService.RandomHex(6),
                Name = Path.GetFileName(Path.TrimEndingDirectorySeparator(path)),
                Path = path,
                CreatedAt = DateTime.UtcNow.ToString("o"),
            });
            SaveConfig();
        }
        return cfg.ImportSources;
    }

    public List<ImportSource> RemoveImportSource(string id)
    {
        lock (cfgLock)
        {
            cfg.ImportSources.RemoveAll(s => s.ID == id);
            SaveConfig();
        }
        return cfg.ImportSources;
    }

    public string StartSourceScan(List<string> sourceIDs)
    {
        List<ImportSource> sources;
        lock (cfgLock) sources = new List<ImportSource>(cfg.ImportSources);
        if (sourceIDs.Count > 0)
            sources = sources.Where(s => sourceIDs.Contains(s.ID)).ToList();
        var (paths, err) = ImportService.ScanSourcePaths(sources);
        if (err != null) throw AppErrors.New(err, AppErrors.StatusBadRequest);
        var (jobID, startErr) = imports.Start(paths ?? new List<string>());
        if (startErr != null) throw AppErrors.New(startErr, AppErrors.StatusBadRequest);
        return jobID;
    }

    public string StartFileImport(List<string> paths)
    {
        var (jobID, err) = imports.Start(paths);
        if (err != null) throw AppErrors.New(err, AppErrors.StatusBadRequest);
        return jobID;
    }

    public ImportSummary ImportSummary(string jobID)
    {
        var (summary, err) = imports.Summary(jobID);
        if (err != null) throw AppErrors.New(err, AppErrors.StatusNotFound);
        return summary ?? new ImportSummary { JobID = jobID };
    }

    public void CancelImport(string jobID)
    {
        var err = imports.Cancel(jobID);
        if (err != null) throw AppErrors.New(err, AppErrors.StatusNotFound);
    }

    public ImportSummary FollowAndBackfill(string jobID, string path, List<Player> players)
    {
        var (summary, err) = imports.Backfill(jobID, path, players);
        if (err != null) throw AppErrors.New(err, AppErrors.StatusNotFound);
        return summary ?? new ImportSummary { JobID = jobID };
    }

    public List<PlayerAvatar> GetPlayerAvatars(List<string> steamIDs)
    {
        var results = new PlayerAvatar[steamIDs.Count];
        var fetches = new List<(int Index, string SteamID)>();
        for (var i = 0; i < steamIDs.Count; i++)
        {
            var id = steamIDs[i];
            var cached = repo.GetPlayerAvatar(id);
            if (cached != null && cached.Status == "ready" && !string.IsNullOrEmpty(cached.CachePath) && File.Exists(cached.CachePath))
            {
                results[i] = new PlayerAvatar { SteamID = id, DataURL = MediaFiles.FileDataURL(cached.CachePath), Status = "ready", UpdatedAt = cached.UpdatedAt.ToString("o") };
            }
            else if (cached != null && cached.Status == "fallback" && (DateTimeOffset.UtcNow - cached.UpdatedAt).TotalHours < 1)
            {
                results[i] = new PlayerAvatar { SteamID = id, Status = "fallback", UpdatedAt = cached.UpdatedAt.ToString("o") };
            }
            else
            {
                fetches.Add((i, id));
            }
        }
        if (fetches.Count > 0)
        {
            Parallel.ForEach(fetches, new ParallelOptions { MaxDegreeOfParallelism = 4 }, item =>
            {
                results[item.Index] = FetchAndStoreAvatar(item.SteamID);
            });
        }
        return results.ToList();
    }

    /// <summary>忽略缓存 TTL，立即重新拉取指定玩家的头像（资料库右键“刷新头像”）。</summary>
    public List<PlayerAvatar> RefreshPlayerAvatars(List<string> steamIDs)
    {
        var results = new PlayerAvatar[steamIDs.Count];
        Parallel.ForEach(steamIDs.Select((id, index) => (id, index)), new ParallelOptions { MaxDegreeOfParallelism = 4 }, item =>
        {
            results[item.index] = FetchAndStoreAvatar(item.id);
        });
        return results.ToList();
    }

    private PlayerAvatar FetchAndStoreAvatar(string id)
    {
        var source = SteamAvatars.FetchAvatarURL(id);
        var path = source == null ? null : SteamAvatars.DownloadAvatar(source, id);
        if (path != null)
        {
            repo.SavePlayerAvatar(new PlayerAvatarCache { SteamID = id, SourceURL = source!, CachePath = path, Status = "ready", UpdatedAt = DateTimeOffset.UtcNow });
            return new PlayerAvatar { SteamID = id, DataURL = MediaFiles.FileDataURL(path), Status = "ready", UpdatedAt = DateTimeOffset.UtcNow.ToString("o") };
        }
        repo.SavePlayerAvatar(new PlayerAvatarCache { SteamID = id, SourceURL = "", CachePath = "", Status = "fallback", UpdatedAt = DateTimeOffset.UtcNow });
        return new PlayerAvatar { SteamID = id, Status = "fallback" };
    }

    public void FollowDemoPlayers(string demoID, List<string> steamIDs)
    {
        var demo = repo.GetDemo(demoID);
        if (demo == null) throw AppErrors.New("demo_not_found", AppErrors.StatusNotFound);
        var requested = ImportService.UniqueStrings(steamIDs);
        if (requested.Count == 0)
            throw AppErrors.New("player_not_found", AppErrors.StatusBadRequest, "请选择属于该场比赛的玩家。");
        var participants = new HashSet<string>(demo.Participants.Select(p => p.SteamID.Trim()));
        foreach (var id in requested)
            if (!participants.Contains(id))
                throw AppErrors.New("player_not_found", AppErrors.StatusBadRequest, "所选玩家不属于该场比赛。");
        var parsed = ParseDemoFile(demo.SourcePath, demo.FileName);
        history.FollowParsedDemoPlayersAtSource(demo.FileName, demo.SourcePath, parsed, requested);
    }

    public DemoAnalysis ChooseReplacementDemo(string demoID)
    {
        var path = NativeDialogs.ChooseFile("重新定位原 Demo", ".dem", ".zip");
        if (path == null) throw AppErrors.New("demo_parse_failed", AppErrors.StatusBadRequest, "未选择文件。");
        var demo = repo.GetDemo(demoID);
        if (demo == null) throw AppErrors.New("demo_not_found", AppErrors.StatusNotFound);
        var parsed = ParseDemoFile(path, demo.FileName);
        var analysis = DemoAnalysisBuilder.Build(demo.DemoRecordID, parsed.Demo);
        repo.SaveDemoAnalysis(demo.DemoRecordID, analysis);
        repo.UpdateDemoSourcePath(demo.DemoRecordID, path);
        return analysis;
    }

    public AppConfig ChooseDatabase()
    {
        var path = NativeDialogs.SaveFile("选择或创建 SQLite 数据库", Path.GetFileName(cfg.DatabasePath), Path.GetDirectoryName(cfg.DatabasePath) ?? ".", ".db", ".sqlite", ".sqlite3");
        if (string.IsNullOrEmpty(path)) return cfg;
        return SwitchDatabase(path);
    }

    public string DetectFFmpeg()
    {
        var configured = cfg.Showcase.FFmpegPath;
        var candidates = new List<string> { configured, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg" };
        // 安装包内嵌的 ffmpeg：边车在 <安装目录>/server/，内嵌 ffmpeg 在 <安装目录>/ffmpeg/。
        var ffmpegName = OperatingSystem.IsWindows() ? "ffmpeg.exe" : "ffmpeg";
        var baseDir = AppContext.BaseDirectory;
        candidates.Insert(0, Path.GetFullPath(Path.Combine(baseDir, "..", "ffmpeg", ffmpegName)));
        candidates.Insert(0, Path.Combine(baseDir, "ffmpeg", ffmpegName));
        var which = Which("ffmpeg");
        if (which != null) candidates.Insert(0, which);
        foreach (var candidate in candidates)
            if (!string.IsNullOrEmpty(candidate) && ValidateFFmpeg(candidate)) return candidate;
        throw AppErrors.New("ffmpeg_not_found", AppErrors.StatusBadRequest, "未检测到 ffmpeg");
    }

    public string ChooseFFmpeg()
    {
        var path = NativeDialogs.ChooseFile("选择 ffmpeg 可执行文件", ".exe", "");
        if (string.IsNullOrEmpty(path)) return "";
        if (!ValidateFFmpeg(path))
            throw AppErrors.New("ffmpeg_not_found", AppErrors.StatusBadRequest, "所选文件不是可用的 ffmpeg。");
        lock (cfgLock)
        {
            cfg.Showcase.FFmpegPath = path;
            SaveConfig();
        }
        return path;
    }

    public string ExportPNG(string dataURL, string suggestedName)
    {
        var comma = dataURL.IndexOf(',');
        if (comma < 0) throw AppErrors.New("invalid_export_size", AppErrors.StatusBadRequest, "PNG 数据无效。");
        byte[] data;
        try { data = Convert.FromBase64String(dataURL.Substring(comma + 1)); }
        catch { throw AppErrors.New("invalid_export_size", AppErrors.StatusBadRequest, "PNG 数据无效。"); }
        if (!suggestedName.ToLowerInvariant().EndsWith(".png")) suggestedName += ".png";
        var path = NativeDialogs.SaveFile("导出 PNG", suggestedName, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".png");
        if (string.IsNullOrEmpty(path)) return "";
        File.WriteAllBytes(path, data);
        return path;
    }

    public DesktopPlayerMedia GetPlayerMedia(string steamID)
    {
        var result = new DesktopPlayerMedia();
        var image = repo.GetPlayerImage(steamID);
        if (image != null)
        {
            if (image.ImageSourceType == "external_url") result.ImageURL = image.ImageURL;
            else if (!string.IsNullOrEmpty(image.ImagePath) && File.Exists(image.ImagePath)) result.ImageURL = MediaFiles.FileDataURL(image.ImagePath);
        }
        var background = repo.GetPlayerMVPBackground(steamID);
        if (background != null && !string.IsNullOrEmpty(background.ImagePath) && File.Exists(background.ImagePath))
            result.BackgroundURL = MediaFiles.FileDataURL(background.ImagePath);
        return result;
    }

    public DesktopPlayerMedia ChoosePlayerMedia(string steamID, string kind)
    {
        var path = NativeDialogs.ChooseFile("选择图片", ".png", ".jpg", ".jpeg", ".webp");
        if (string.IsNullOrEmpty(path)) return GetPlayerMedia(steamID);
        var baseDir = kind == "background" ? MediaFiles.DefaultPlayerMVPBackgroundDir() : MediaFiles.DefaultPlayerImageDir();
        var target = MediaFiles.CopyMediaFile(baseDir, steamID, path);
        if (target == null) throw AppErrors.New("invalid_player_image", AppErrors.StatusBadRequest, "媒体目标路径无效。");
        if (kind == "background")
            repo.SavePlayerMVPBackground(new PlayerMVPBackground { SteamID = steamID, ImagePath = target, UpdatedAt = DateTimeOffset.UtcNow });
        else
            repo.SavePlayerImage(new PlayerImage { SteamID = steamID, ImageSourceType = "upload", ImagePath = target, UpdatedAt = DateTimeOffset.UtcNow });
        return GetPlayerMedia(steamID);
    }

    public DesktopPlayerMedia SetPlayerImageURL(string steamID, string imageURL)
    {
        imageURL = imageURL.Trim();
        if (imageURL == "") throw AppErrors.New("invalid_player_image", AppErrors.StatusBadRequest, "图片 URL 不能为空。");
        repo.SavePlayerImage(new PlayerImage { SteamID = steamID, ImageSourceType = "external_url", ImageURL = imageURL, UpdatedAt = DateTimeOffset.UtcNow });
        return GetPlayerMedia(steamID);
    }

    public DesktopPlayerMedia ClearPlayerMedia(string steamID, string kind)
    {
        if (kind == "background") repo.DeletePlayerMVPBackground(steamID);
        else repo.DeletePlayerImage(steamID);
        return GetPlayerMedia(steamID);
    }

    public ShowcaseMusicInfo ChooseShowcaseMusic()
    {
        var path = NativeDialogs.ChooseFile("选择背景音乐", ".mp3", ".wav", ".m4a", ".aac");
        if (string.IsNullOrEmpty(path)) return new ShowcaseMusicInfo();
        var target = MediaFiles.CopyMediaFile(MediaFiles.DefaultShowcaseMusicDir(), "showcase", path);
        if (target == null) throw AppErrors.New("invalid_player_image", AppErrors.StatusBadRequest, "音乐目标路径无效。");
        lock (cfgLock)
        {
            cfg.Showcase.MusicPath = target;
            SaveConfig();
        }
        return ShowcaseMusicInfoFromPath(target);
    }

    public string GetShowcaseMusic()
    {
        string path;
        lock (cfgLock) path = cfg.Showcase.MusicPath;
        if (path == "" || !File.Exists(path)) return "";
        return MediaFiles.FileDataURL(path);
    }

    public ShowcaseMusicInfo GetShowcaseMusicInfo()
    {
        string path;
        lock (cfgLock) path = cfg.Showcase.MusicPath;
        if (path == "" || !File.Exists(path)) return new ShowcaseMusicInfo();
        return ShowcaseMusicInfoFromPath(path);
    }

    public void ClearShowcaseMusic()
    {
        lock (cfgLock)
        {
            cfg.Showcase.MusicPath = "";
            SaveConfig();
        }
    }

    private static ShowcaseMusicInfo ShowcaseMusicInfoFromPath(string path)
        => new() { URL = MediaFiles.FileDataURL(path), DurationMS = AudioMetadata.AudioDurationMS(path) };

    private static bool ValidateFFmpeg(string path)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo(path, "-version")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            using var process = System.Diagnostics.Process.Start(psi);
            return process != null && process.WaitForExit(5000);
        }
        catch
        {
            return false;
        }
    }

    private static string? Which(string name)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo("/usr/bin/which", name)
            {
                RedirectStandardOutput = true,
                UseShellExecute = false,
            };
            using var process = System.Diagnostics.Process.Start(psi);
            if (process == null) return null;
            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit();
            return string.IsNullOrWhiteSpace(output) ? null : output.Trim();
        }
        catch
        {
            return null;
        }
    }

    private void SaveConfig()
    {
        var err = config.Save(cfg);
        if (err != null) throw AppErrors.New(err, AppErrors.StatusInternal);
    }

    public string BeginVideoExport(int width, int height, int fps, int durationMS, int audioOffsetMS, string suggestedName)
    {
        var ffmpegPath = DetectFFmpeg();
        var request = new VideoExportRequest { Width = width, Height = height, FPS = fps, DurationMS = durationMS, AudioOffsetMS = audioOffsetMS };
        var validateErr = ShowcaseVideo.Validate(request);
        if (validateErr != null) throw AppErrors.New(validateErr, AppErrors.StatusBadRequest);
        if (!suggestedName.ToLowerInvariant().EndsWith(".mp4")) suggestedName += ".mp4";
        string musicPath;
        lock (cfgLock) musicPath = cfg.Showcase.MusicPath;
        var tempDir = Path.Combine(Path.GetTempPath(), "cs-radar-video-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var id = "video_" + HistoryService.RandomHex(8);
        var session = new VideoExportSession
        {
            TempDir = tempDir,
            OutputPath = Path.Combine(tempDir, suggestedName),
            Request = request,
            MusicPath = musicPath,
        };
        try
        {
            // ffmpeg 以 image2pipe 从 stdin 读帧，立即启动；帧经 Append 写入管道。
            session.Encoder = ShowcaseVideo.StartEncoder(ffmpegPath, session.OutputPath, musicPath, request, session);
        }
        catch
        {
            try { Directory.Delete(tempDir, true); } catch { /* ignore */ }
            throw;
        }
        lock (videoLock) videoExports[id] = session;
        return id;
    }

    /// <summary>校验会话仍可接收帧（未取消且编码进程存活）。</summary>
    private static void EnsureAcceptingFrames(VideoExportSession session)
    {
        if (session.Cts.IsCancellationRequested)
            throw AppErrors.New("video_export_cancelled", AppErrors.StatusBadRequest, "视频导出已取消。");
        if (session.Encoder == null || session.Encoder.HasExited)
            throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "ffmpeg 编码进程已退出：" + session.LastStderr());
    }

    private static void WriteFrame(VideoExportSession session, byte[] data)
    {
        var stream = session.Encoder?.StandardInput.BaseStream;
        if (stream == null)
            throw AppErrors.New("video_export_cancelled", AppErrors.StatusBadRequest, "视频导出已取消。");
        try
        {
            stream.Write(data, 0, data.Length);
            stream.Flush();
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException)
        {
            if (session.Cts.IsCancellationRequested)
                throw AppErrors.New("video_export_cancelled", AppErrors.StatusBadRequest, "视频导出已取消。");
            throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "ffmpeg 编码进程已退出：" + session.LastStderr());
        }
    }

    public void AppendVideoFrames(string exportID, int startIndex, List<string> frames)
    {
        VideoExportSession session;
        lock (videoLock) videoExports.TryGetValue(exportID, out session!);
        if (session == null) throw AppErrors.New("video_export_not_found", AppErrors.StatusBadRequest, "视频导出任务不存在。");
        if (frames.Count > ShowcaseVideo.MaxBatchFrames)
            throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "单批帧数量超过限制。");
        lock (session.Lock)
        {
            EnsureAcceptingFrames(session);
            if (startIndex != session.FramesWritten)
                throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, $"视频帧必须按顺序上传：期望第 {session.FramesWritten} 帧，收到第 {startIndex} 帧。");
            foreach (var frame in frames)
            {
                byte[] data;
                try { data = ShowcaseVideo.DecodePNGDataURL(frame); }
                catch { throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "只支持 PNG data URL。"); }
                WriteFrame(session, data);
            }
            session.FramesWritten += frames.Count;
        }
    }

    public void AppendVideoFramesBinary(string exportID, int startIndex, byte[][] frames)
    {
        VideoExportSession session;
        lock (videoLock) videoExports.TryGetValue(exportID, out session!);
        if (session == null) throw AppErrors.New("video_export_not_found", AppErrors.StatusBadRequest, "视频导出任务不存在。");
        if (frames.Length > ShowcaseVideo.MaxBatchFrames)
            throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "单批帧数量超过限制。");
        lock (session.Lock)
        {
            EnsureAcceptingFrames(session);
            if (startIndex != session.FramesWritten)
                throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, $"视频帧必须按顺序上传：期望第 {session.FramesWritten} 帧，收到第 {startIndex} 帧。");
            foreach (var frame in frames)
                WriteFrame(session, frame);
            session.FramesWritten += frames.Length;
        }
    }

    public object FinishVideoExport(string exportID)
    {
        VideoExportSession session;
        lock (videoLock) videoExports.TryGetValue(exportID, out session!);
        if (session == null) throw AppErrors.New("video_export_not_found", AppErrors.StatusBadRequest, "视频导出任务不存在。");
        lock (session.Lock)
        {
            session.Finishing = true;
            var expectedFrames = ShowcaseVideo.ExpectedFrameCount(session.Request);
            if (session.FramesWritten != expectedFrames)
                throw AppErrors.New(
                    "invalid_showcase_video",
                    AppErrors.StatusBadRequest,
                    $"视频帧数量不完整：期望 {expectedFrames} 帧，收到 {session.FramesWritten} 帧。");
        }
        try
        {
            var encoder = session.Encoder;
            if (encoder == null)
                throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "视频编码进程未启动。");
            try
            {
                // 关闭 stdin：ffmpeg 收到 EOF 后完成编码并写出 MP4。
                encoder.StandardInput.Close();
            }
            catch { /* 进程可能已退出 */ }
            ShowcaseVideo.CompleteEncoder(encoder, session.Cts.Token, () => session.LastStderr());
            var downloadToken = "dl_" + HistoryService.RandomHex(16);
            var name = Path.GetFileName(session.OutputPath);
            lock (downloadLock) videoDownloads[downloadToken] = new VideoDownload
            {
                Path = session.OutputPath,
                Name = name,
                ExpiresUtc = DateTime.UtcNow.AddHours(1),
            };
            return new { url = $"/video-download?token={downloadToken}", name };
        }
        catch (OperationCanceledException)
        {
            throw AppErrors.New("video_export_cancelled", AppErrors.StatusBadRequest, "视频导出已取消。");
        }
        catch
        {
            try { Directory.Delete(session.TempDir, true); } catch { /* ignore */ }
            throw;
        }
        finally
        {
            session.Cts.Cancel();
            lock (videoLock) videoExports.Remove(exportID);
        }
    }

    public void CancelVideoExport(string exportID)
    {
        VideoExportSession session;
        lock (videoLock) videoExports.TryGetValue(exportID, out session!);
        if (session == null) return;
        // 不获取 session.Lock：写入线程可能正阻塞在管道写上，Kill 会解除其阻塞。
        session.Cts.Cancel();
        ShowcaseVideo.TryKill(session.Encoder);
        bool finishing;
        lock (session.Lock) finishing = session.Finishing;
        if (!finishing)
        {
            lock (videoLock) videoExports.Remove(exportID);
            try { Directory.Delete(session.TempDir, true); } catch { /* ignore */ }
        }
    }

    /// <summary>消耗一次性的视频下载令牌；返回后由调用方负责流式输出与清理临时目录。</summary>
    public VideoDownload? ConsumeVideoDownload(string token)
    {
        lock (downloadLock)
        {
            if (!videoDownloads.TryGetValue(token, out var download)) return null;
            videoDownloads.Remove(token);
            if (download.ExpiresUtc < DateTime.UtcNow) return null;
            return download;
        }
    }

    /// <summary>
    /// 解析 demo 文件。<paramref name="path"/> 可能是导入时用的 .zip（记录里保存的
    /// source_path 就是它，导入流程解析完会把临时解压出的 DEM 删掉），所以必须先
    /// 还原成 csda 能读的 DEM，否则补写/重解析一律报 ErrInvalidFileType。
    /// <paramref name="preferFileName"/> 用于多 DEM 的 zip（按记录的 file_name 精确匹配）。
    /// </summary>
    private ParsedDemo ParseDemoFile(string path, string? preferFileName = null)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path))
            throw AppErrors.New("demo_not_found", AppErrors.StatusNotFound);
        using var source = DemoSourceFile.Resolve(path, preferFileName);
        var result = parser.ParseAll(source.Path);
        if (result == null)
            throw AppErrors.New("demo_parse_failed", AppErrors.StatusUnprocessable);
        return result;
    }

    public object? Invoke(string method, List<JsonElement> args)
    {
        var type = GetType();
        var methods = type.GetMethods().Where(m => m.Name == method && !m.IsSpecialName).ToList();
        if (methods.Count == 0) throw AppErrors.New("method_not_found", AppErrors.StatusBadRequest, $"未知桥接方法: {method}");
        var target = methods.FirstOrDefault(m => m.GetParameters().Length == args.Count)
            ?? throw AppErrors.New("method_arity", AppErrors.StatusBadRequest, $"桥接方法参数数量不匹配: {method}");
        var parameters = target.GetParameters();
        var values = new object?[parameters.Length];
        for (var i = 0; i < parameters.Length; i++)
            values[i] = DeserializeArg(args[i], parameters[i].ParameterType);
        object? result;
        try
        {
            result = target.Invoke(this, values);
        }
        catch (System.Reflection.TargetInvocationException ex)
        {
            throw ex.InnerException ?? ex;
        }
        return result;
    }

    private static object? DeserializeArg(JsonElement el, Type targetType)
    {
        if (el.ValueKind == JsonValueKind.Null)
        {
            return targetType.IsValueType ? Activator.CreateInstance(targetType) : null;
        }
        if (targetType == typeof(string)) return el.GetString();
        if (targetType == typeof(int)) return el.GetInt32();
        if (targetType == typeof(double)) return el.GetDouble();
        if (targetType == typeof(bool)) return el.GetBoolean();
        if (targetType == typeof(List<string>)) return el.EnumerateArray().Select(e => e.GetString() ?? "").ToList();
        if (targetType == typeof(Dictionary<string, double>))
        {
            var dict = new Dictionary<string, double>();
            foreach (var prop in el.EnumerateObject()) dict[prop.Name] = prop.Value.GetDouble();
            return dict;
        }
        if (targetType == typeof(Player))
            return new Player { Name = el.GetProperty("name").GetString() ?? "", SteamID = el.GetProperty("steam_id").GetString() ?? "" };
        var json = el.GetRawText();
        return JsonSerializer.Deserialize(json, targetType);
    }
}

public static class PathUtils
{
    public static string GetDemoId() => "demo_record_" + DateTime.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + HistoryService.RandomHex(4);

    public static string CleanPath(string path)
    {
        var cleaned = System.IO.Path.GetFullPath(System.IO.Path.TrimEndingDirectorySeparator(path.Trim()));
        return cleaned;
    }
}
