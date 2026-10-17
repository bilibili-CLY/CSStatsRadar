using System.IO.Compression;

namespace Radar.Application;

/// <summary>
/// 一次「解析用文件」的解析结果：<see cref="Path"/> 是 csda 能直接读取的 DEM 路径，
/// zip 源会先解压到临时目录，<see cref="Dispose"/> 负责清理。
/// </summary>
public sealed class ResolvedDemoSource : IDisposable
{
    private readonly string? tempDirectory;

    internal ResolvedDemoSource(string path, string? tempDirectory)
    {
        Path = path;
        this.tempDirectory = tempDirectory;
    }

    /// <summary>可直接交给解析器的 DEM 路径（zip 源为临时解压出的文件）。</summary>
    public string Path { get; }

    /// <summary>临时目录（非 zip 源为 null）。</summary>
    public string? TempDirectory => tempDirectory;

    public void Dispose()
    {
        if (tempDirectory == null) return;
        try { Directory.Delete(tempDirectory, true); }
        catch { /* 临时目录清理失败不影响解析结果 */ }
    }
}

/// <summary>
/// 把 demo 记录里的 <c>source_path</c> 还原成 csda 能读的 DEM 文件。
///
/// 导入 .zip 时只把其中的 DEM 解压到临时目录、解析完立即删除，数据库里保存的
/// <c>source_path</c> 仍是那个 zip；因此所有「重新解析」（补写缺失数据、重新解析分析、
/// 清洗战队前缀、重新定位）都必须先经过这里，否则 csda 会拿到 zip，报
/// <c>ErrInvalidFileType: expecting HL2DEMO in the first 8 bytes</c>。
/// </summary>
public static class DemoSourceFile
{
    public const long MaxExtractedDemoSize = 2L << 30;
    public const ulong MaxZipRatio = 200;

    public const string NoDemoMessage = "ZIP 中没有 DEM 文件";
    public const string MultipleDemosMessage = "ZIP 中包含多个 DEM，请先整理压缩包";
    public const string TooLargeMessage = "ZIP 中的 DEM 超过 2GB 安全限制";
    public const string BadRatioMessage = "ZIP 压缩比异常，已拒绝解压";

    public static bool IsZip(string? path) =>
        !string.IsNullOrEmpty(path) &&
        Path.GetExtension(path).Equals(".zip", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// 解析源文件：非 zip 原样返回；zip 则取其中的 DEM（优先匹配
    /// <paramref name="preferFileName"/>，例如 demo 记录的 file_name）并解压到临时目录。
    /// 失败时抛 <see cref="InvalidOperationException"/>，消息可直接展示给用户。
    /// </summary>
    public static ResolvedDemoSource Resolve(string sourcePath, string? preferFileName = null)
    {
        if (string.IsNullOrWhiteSpace(sourcePath) || !File.Exists(sourcePath))
            throw new InvalidOperationException("Demo 文件不存在。");
        if (!IsZip(sourcePath)) return new ResolvedDemoSource(sourcePath, null);
        try
        {
            using var archive = ZipFile.OpenRead(sourcePath);
            var entries = new List<ZipArchiveEntry>();
            foreach (var entry in archive.Entries)
            {
                if (entry.FullName.EndsWith("/", StringComparison.Ordinal)) continue;
                if (!Path.GetExtension(entry.Name).Equals(".dem", StringComparison.OrdinalIgnoreCase)) continue;
                entries.Add(entry);
            }
            if (entries.Count == 0) throw new InvalidOperationException(NoDemoMessage);

            // 多 DEM 的包（例如用户重新定位时随手选了个合集包）按记录里的文件名精确匹配。
            var preferred = string.IsNullOrWhiteSpace(preferFileName) ? null : Path.GetFileName(preferFileName);
            var chosen = preferred == null
                ? null
                : entries.FirstOrDefault(entry => entry.Name.Equals(preferred, StringComparison.OrdinalIgnoreCase));
            if (chosen == null)
            {
                if (entries.Count > 1) throw new InvalidOperationException(MultipleDemosMessage);
                chosen = entries[0];
            }

            if (chosen.Length > MaxExtractedDemoSize) throw new InvalidOperationException(TooLargeMessage);
            if (chosen.CompressedLength > 0 && (ulong)chosen.Length / (ulong)chosen.CompressedLength > MaxZipRatio)
                throw new InvalidOperationException(BadRatioMessage);

            var tempDirectory = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cs-radar-parse-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDirectory);
            var targetPath = System.IO.Path.Combine(tempDirectory, System.IO.Path.GetFileName(chosen.Name));
            chosen.ExtractToFile(targetPath, overwrite: false);
            return new ResolvedDemoSource(targetPath, tempDirectory);
        }
        catch (InvalidOperationException)
        {
            throw;
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("ZIP 解压失败或超过安全限制：" + ex.Message);
        }
    }
}
