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
    private readonly DemoFileParser parser;
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
        parser = new DemoFileParser();
        imports = new ImportService(repo, history, ParseDemoFile);
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
        var data = ParseDemoFile(demo.SourcePath);
        analysis = DemoAnalysisBuilder.Build(demoID, data);
        repo.SaveDemoAnalysis(demoID, analysis);
        return analysis;
    }

    public DemoAnalysis ReparseDemoAnalysis(string demoID)
    {
        var demo = repo.GetDemo(demoID);
        if (demo == null) throw AppErrors.New("demo_not_found", AppErrors.StatusNotFound);
        var data = ParseDemoFile(demo.SourcePath);
        var analysis = DemoAnalysisBuilder.Build(demoID, data);
        repo.SaveDemoAnalysis(demoID, analysis);
        return analysis;
    }

    public List<SavedPlayer> ListPlayers() => repo.ListPlayers();

    public List<Player> ListFollowedPlayers() => repo.ListFollowedPlayers();

    public List<PlayerMatchRecord> GetPlayerMatches(string steamID) => repo.ListPlayerMatches(steamID);

    public void SetPlayerFollowed(Player player, bool followed) => repo.SetPlayerFollowed(player, followed);

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

    public void ClearAllData() => repo.DeleteAllPlayers();

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

    public AppConfig SavePreferences(int exportWidth, int exportHeight, int videoFPS, string ffmpegPath, bool reduceMotion, bool showBestMarkers, int audioOffsetMS, string radarScaleMode, double radarScale, Dictionary<string, double> radarAxisScale, string ratingVersion, bool showRatingWatermark)
    {
        cfg.ExportWidth = exportWidth;
        cfg.ExportHeight = exportHeight;
        cfg.VideoFPS = videoFPS;
        cfg.Showcase.FFmpegPath = ffmpegPath;
        cfg.ReduceMotion = reduceMotion;
        cfg.Showcase.ShowBestMarkers = showBestMarkers;
        cfg.Showcase.AudioOffsetMS = audioOffsetMS;
        cfg.Showcase.RadarScaleMode = radarScaleMode;
        cfg.Showcase.RadarScale = radarScale;
        cfg.Showcase.RadarAxisScale = radarAxisScale;
        cfg.RatingVersion = ratingVersion;
        cfg.ShowRatingWatermark = showRatingWatermark;
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
        var data = ParseDemoFile(path);
        return history.SaveParsedDemoForPlayersAtSource(System.IO.Path.GetFileName(path), path, data, allowedSteamIDs);
    }

public DemoAnalysis GetDemoAnalysisFromFile(string path)
    {
        var data = ParseDemoFile(path);
        return DemoAnalysisBuilder.Build(PathUtils.GetDemoId(), data);
    }

    public string? ChooseImportDirectory() => NativeDialogs.ChooseDirectory("选择素材目录");

    public List<string>? ChooseImportFiles() => NativeDialogs.ChooseFiles("选择 DEM 或 ZIP", ".dem", ".zip");

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
        var result = new List<PlayerAvatar>();
        foreach (var id in steamIDs)
        {
            var cached = repo.GetPlayerAvatar(id);
            if (cached != null)
                result.Add(new PlayerAvatar { SteamID = id, DataURL = "", Status = cached.Status, UpdatedAt = cached.UpdatedAt.ToString("o") });
        }
        return result;
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
        var data = ParseDemoFile(demo.SourcePath);
        history.FollowParsedDemoPlayersAtSource(demo.FileName, demo.SourcePath, data, requested);
    }

    public DemoAnalysis ChooseReplacementDemo(string demoID)
    {
        var path = NativeDialogs.ChooseFile("重新定位原 Demo", ".dem", ".zip");
        if (path == null) throw AppErrors.New("demo_parse_failed", AppErrors.StatusBadRequest, "未选择文件。");
        var demo = repo.GetDemo(demoID);
        if (demo == null) throw AppErrors.New("demo_not_found", AppErrors.StatusNotFound);
        var data = ParseDemoFile(path);
        var analysis = DemoAnalysisBuilder.Build(demo.DemoRecordID, data);
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
        DetectFFmpeg();
        var request = new VideoExportRequest { Width = width, Height = height, FPS = fps, DurationMS = durationMS, AudioOffsetMS = audioOffsetMS };
        var validateErr = ShowcaseVideo.Validate(request);
        if (validateErr != null) throw AppErrors.New(validateErr, AppErrors.StatusBadRequest);
        if (!suggestedName.ToLowerInvariant().EndsWith(".mp4")) suggestedName += ".mp4";
        var tempDir = Path.Combine(Path.GetTempPath(), "cs-radar-video-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var id = "video_" + HistoryService.RandomHex(8);
        var session = new VideoExportSession
        {
            TempDir = tempDir,
            OutputPath = Path.Combine(tempDir, suggestedName),
            Request = request,
        };
        lock (videoLock) videoExports[id] = session;
        return id;
    }

    public void AppendVideoFrames(string exportID, int startIndex, List<string> frames)
    {
        VideoExportSession session;
        lock (videoLock) videoExports.TryGetValue(exportID, out session!);
        if (session == null) throw AppErrors.New("video_export_not_found", AppErrors.StatusBadRequest, "视频导出任务不存在。");
        lock (session.Lock)
        {
            if (session.Cts.IsCancellationRequested) throw AppErrors.New("video_export_cancelled", AppErrors.StatusBadRequest, "视频导出已取消。");
            if (startIndex < 0 || startIndex + frames.Count > ShowcaseVideo.MaxShowcaseVideoFrames)
                throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "视频帧数量超过限制。");
            for (var i = 0; i < frames.Count; i++)
            {
                byte[] data;
                try { data = ShowcaseVideo.DecodePNGDataURL(frames[i]); }
                catch { throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "只支持 PNG data URL。"); }
                File.WriteAllBytes(Path.Combine(session.TempDir, $"frame_{startIndex + i + 1:000000}.png"), data);
            }
        }
    }

    public void AppendVideoFramesBinary(string exportID, int startIndex, byte[][] frames)
    {
        VideoExportSession session;
        lock (videoLock) videoExports.TryGetValue(exportID, out session!);
        if (session == null) throw AppErrors.New("video_export_not_found", AppErrors.StatusBadRequest, "视频导出任务不存在。");
        lock (session.Lock)
        {
            if (session.Cts.IsCancellationRequested) throw AppErrors.New("video_export_cancelled", AppErrors.StatusBadRequest, "视频导出已取消。");
            if (startIndex < 0 || startIndex + frames.Length > ShowcaseVideo.MaxShowcaseVideoFrames)
                throw AppErrors.New("invalid_showcase_video", AppErrors.StatusBadRequest, "视频帧数量超过限制。");
            for (var i = 0; i < frames.Length; i++)
                File.WriteAllBytes(Path.Combine(session.TempDir, $"frame_{startIndex + i + 1:000000}.png"), frames[i]);
        }
    }

    public object FinishVideoExport(string exportID)
    {
        VideoExportSession session;
        lock (videoLock) videoExports.TryGetValue(exportID, out session!);
        if (session == null) throw AppErrors.New("video_export_not_found", AppErrors.StatusBadRequest, "视频导出任务不存在。");
        lock (session.Lock) session.Finishing = true;
        try
        {
            var ffmpegPath = DetectFFmpeg();
            string musicPath;
            lock (cfgLock) musicPath = cfg.Showcase.MusicPath;
            try
            {
                ShowcaseVideo.EncodeShowcaseMP4(session.Cts.Token, ffmpegPath, session.TempDir, session.OutputPath, musicPath, session.Request);
            }
            catch (OperationCanceledException)
            {
                throw AppErrors.New("video_export_cancelled", AppErrors.StatusBadRequest, "视频导出已取消。");
            }
            var token = "dl_" + HistoryService.RandomHex(16);
            var name = Path.GetFileName(session.OutputPath);
            lock (downloadLock) videoDownloads[token] = new VideoDownload
            {
                Path = session.OutputPath,
                Name = name,
                ExpiresUtc = DateTime.UtcNow.AddHours(1),
            };
            return new { url = $"/video-download?token={token}", name };
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
        lock (session.Lock)
        {
            session.Cts.Cancel();
            if (!session.Finishing)
            {
                videoExports.Remove(exportID);
                try { Directory.Delete(session.TempDir, true); } catch { /* ignore */ }
            }
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

    private DemoData ParseDemoFile(string path)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path))
            throw AppErrors.New("demo_not_found", AppErrors.StatusNotFound);
        var result = parser.Parse(path);
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