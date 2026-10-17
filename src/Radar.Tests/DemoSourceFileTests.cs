using System.IO.Compression;
using Radar.Application;
using Xunit;

namespace Radar.Tests;

/// <summary>
/// source_path 可能是导入时的 zip（导入只把 DEM 解到临时目录、解析完即删），
/// 重解析前必须还原成 DEM，否则 csda 报 ErrInvalidFileType。
/// </summary>
public class DemoSourceFileTests
{
    private static string NewDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "radar-demosource-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static string CreateZip(string path, params (string Name, byte[] Content)[] entries)
    {
        using var stream = new FileStream(path, FileMode.Create);
        using var zip = new ZipArchive(stream, ZipArchiveMode.Create);
        foreach (var (name, content) in entries)
        {
            var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
            using var target = entry.Open();
            target.Write(content);
        }
        return path;
    }

    [Fact]
    public void Resolve_NonZipPath_IsReturnedAsIs()
    {
        var dir = NewDir();
        try
        {
            var demo = Path.Combine(dir, "plain.dem");
            var bytes = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 };
            File.WriteAllBytes(demo, bytes);

            using var resolved = DemoSourceFile.Resolve(demo);
            Assert.Equal(demo, resolved.Path);
            Assert.Null(resolved.TempDirectory);
            resolved.Dispose();
            Assert.True(File.Exists(demo));
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Resolve_SingleDemZip_ExtractsToTempAndCleansUpOnDispose()
    {
        var dir = NewDir();
        try
        {
            var bytes = new byte[] { 9, 8, 7, 6, 5, 4, 3, 2, 1 };
            var zipPath = CreateZip(Path.Combine(dir, "pack.zip"), ("nested/inside.dem", bytes));

            string tempPath;
            string? tempDir;
            using (var resolved = DemoSourceFile.Resolve(zipPath))
            {
                tempPath = resolved.Path;
                tempDir = resolved.TempDirectory;
                Assert.NotEqual(zipPath, tempPath);
                Assert.Equal("inside.dem", Path.GetFileName(tempPath));
                Assert.Equal(bytes, File.ReadAllBytes(tempPath));
                Assert.NotNull(tempDir);
                Assert.True(Directory.Exists(tempDir));
            }

            Assert.False(Directory.Exists(tempDir!));
            Assert.True(File.Exists(zipPath));
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Resolve_PrefersRecordFileName_InMultiDemZip()
    {
        var dir = NewDir();
        try
        {
            var zipPath = CreateZip(
                Path.Combine(dir, "multi.zip"),
                ("a.dem", new byte[] { 1, 1, 1 }),
                ("b.dem", new byte[] { 2, 2, 2 }));

            using var resolved = DemoSourceFile.Resolve(zipPath, "b.dem");
            Assert.Equal(new byte[] { 2, 2, 2 }, File.ReadAllBytes(resolved.Path));
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Resolve_Throws_OnMultiDemZip_WithoutRecordName()
    {
        var dir = NewDir();
        try
        {
            var zipPath = CreateZip(
                Path.Combine(dir, "multi.zip"),
                ("a.dem", new byte[] { 1 }),
                ("b.dem", new byte[] { 2 }));

            var ex = Assert.Throws<InvalidOperationException>(() => DemoSourceFile.Resolve(zipPath));
            Assert.Equal(DemoSourceFile.MultipleDemosMessage, ex.Message);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Resolve_Throws_WhenZipHasNoDem()
    {
        var dir = NewDir();
        try
        {
            var zipPath = CreateZip(Path.Combine(dir, "notes.zip"), ("readme.txt", new byte[] { 1 }));

            var ex = Assert.Throws<InvalidOperationException>(() => DemoSourceFile.Resolve(zipPath));
            Assert.Equal(DemoSourceFile.NoDemoMessage, ex.Message);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Resolve_Throws_OnCompressionRatioAbuse()
    {
        var dir = NewDir();
        try
        {
            var zipPath = CreateZip(Path.Combine(dir, "bomb.zip"), ("bomb.dem", new byte[1 << 20]));

            var ex = Assert.Throws<InvalidOperationException>(() => DemoSourceFile.Resolve(zipPath));
            Assert.Equal(DemoSourceFile.BadRatioMessage, ex.Message);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Resolve_Throws_WhenFileMissing()
    {
        var dir = NewDir();
        try
        {
            Assert.Throws<InvalidOperationException>(() => DemoSourceFile.Resolve(Path.Combine(dir, "gone.zip")));
            Assert.Throws<InvalidOperationException>(() => DemoSourceFile.Resolve(Path.Combine(dir, "gone.dem")));
            Assert.Throws<InvalidOperationException>(() => DemoSourceFile.Resolve(""));
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void IsZip_IsCaseInsensitive()
    {
        Assert.True(DemoSourceFile.IsZip("C:\\demos\\pack.ZIP"));
        Assert.True(DemoSourceFile.IsZip("/tmp/pack.zip"));
        Assert.False(DemoSourceFile.IsZip("/tmp/pack.dem"));
        Assert.False(DemoSourceFile.IsZip(""));
        Assert.False(DemoSourceFile.IsZip(null));
    }
}
