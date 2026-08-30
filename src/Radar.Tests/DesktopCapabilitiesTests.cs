using System.Text;
using Radar.Api;
using Radar.Application;
using Radar.Domain.Models;
using Radar.Infrastructure;
using Xunit;

namespace Radar.Tests;

public class DesktopCapabilitiesTests
{
    private static string CreateTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "radar-cap-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    [Fact]
    public void Showcase_Expected_Frame_Count_Uses_Ceiling_For_Fractional_Durations()
    {
        Assert.Equal(60, ShowcaseVideo.ExpectedFrameCount(new VideoExportRequest
        {
            FPS = 60,
            DurationMS = 1000,
        }));
        Assert.Equal(31, ShowcaseVideo.ExpectedFrameCount(new VideoExportRequest
        {
            FPS = 30,
            DurationMS = 1001,
        }));
    }

    [Fact]
    public void Mac_MultiFile_Output_Uses_Explicit_Separator()
    {
        var parser = typeof(NativeDialogs).GetMethod(
            "ParseMacFileSelectionOutput",
            System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
        Assert.NotNull(parser);
        var paths = (List<string>?)parser!.Invoke(null, new object?[] { "/tmp/one, two.dem\u001f/tmp/three.zip\n" });
        Assert.Equal(new[] { "/tmp/one, two.dem", "/tmp/three.zip" }, paths);
        Assert.Null(parser.Invoke(null, new object?[] { null }));
    }

    [Fact]
    public void Legacy_Config_Enables_New_Showcase_Animations()
    {
        var dir = CreateTempDir();
        try
        {
            var path = Path.Combine(dir, "config.json");
            File.WriteAllText(path, "{\"showcase\":{\"show_best_markers\":true}}");
            var config = new ConfigManager(path).Read(out var error);
            Assert.Null(error);
            Assert.True(config.Showcase.ShowIntroAnimation);
            Assert.True(config.Showcase.ShowBestEntranceAnimation);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void PlayerImage_And_MVPBackground_Persist_And_Clear()
    {
        var dir = CreateTempDir();
        try
        {
            using var app = new DesktopApp(Path.Combine(dir, "config.json"), Path.Combine(dir, "test.db"));
            var repo = new SQLiteHistoryRepository(Path.Combine(dir, "test.db"));
            repo.Init();

            // Seed a player row via a minimal saved demo
            var demo = new SavedDemo
            {
                DemoRecordID = "demo_record_test_0001",
                FileName = "x.dem",
                MatchTime = DateTimeOffset.UtcNow,
                MapName = "de_dust2",
                FileSHA256 = "abc",
                SourcePath = "",
                ImportedAt = DateTimeOffset.UtcNow,
            };
            var player = new DemoPlayerSnapshot { DemoRecordID = demo.DemoRecordID, SteamID = "76561198000000000", NameSnapshot = "TestPlayer" };
            repo.SaveParsedDemo(demo, new List<DemoPlayerSnapshot> { player }, new List<DemoPlayerSnapshot> { player }, new List<PlayerMatchRecord>(), null, followPlayers: false);

            var savedImage = repo.SavePlayerImage(new PlayerImage { SteamID = "76561198000000000", ImageSourceType = "upload", ImagePath = "/tmp/x.png" });
            Assert.Equal("upload", savedImage.ImageSourceType);
            var loadedImage = repo.GetPlayerImage("76561198000000000");
            Assert.NotNull(loadedImage);
            Assert.Equal("/tmp/x.png", loadedImage!.ImagePath);
            repo.DeletePlayerImage("76561198000000000");
            Assert.Null(repo.GetPlayerImage("76561198000000000"));

            var savedBg = repo.SavePlayerMVPBackground(new PlayerMVPBackground { SteamID = "76561198000000000", ImagePath = "/tmp/bg.png" });
            Assert.Equal("/tmp/bg.png", savedBg.ImagePath);
            Assert.NotNull(repo.GetPlayerMVPBackground("76561198000000000"));
            repo.DeletePlayerMVPBackground("76561198000000000");
            Assert.Null(repo.GetPlayerMVPBackground("76561198000000000"));
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Wav_Duration_Is_Parsed()
    {
        // data chunk: 44100 bytes at 176400 bytes/sec => 0.25s = 250ms
        var wav = new byte[12 + 8 + 16 + 8 + 44100];
        Encoding.ASCII.GetBytes("RIFF").CopyTo(wav, 0);
        Encoding.ASCII.GetBytes("WAVE").CopyTo(wav, 8);
        Encoding.ASCII.GetBytes("fmt ").CopyTo(wav, 12);
        BitConverter.GetBytes((int)16).CopyTo(wav, 16);
        // audioFormat(2) channels(2) sampleRate(4) at payload offsets 0/2/4
        BitConverter.GetBytes((short)1).CopyTo(wav, 20);
        BitConverter.GetBytes((short)2).CopyTo(wav, 22);
        BitConverter.GetBytes(44100).CopyTo(wav, 24);
        var bytesPerSecond = 44100 * 4;
        BitConverter.GetBytes(bytesPerSecond).CopyTo(wav, 28);
        Encoding.ASCII.GetBytes("data").CopyTo(wav, 36);
        BitConverter.GetBytes(44100).CopyTo(wav, 40);
        var duration = AudioMetadata.WavDurationMS(wav);
        Assert.Equal(250, duration);
    }

    [Fact]
    public void Mp4_Duration_Is_Parsed()
    {
        // Build a minimal mvhd box inside moov, timescale 1000, duration 3200 => 3200ms
        var mvhdVersion0 = new byte[20 + 8 + 4 + 4];
        mvhdVersion0[0] = 0;
        BitConverter.GetBytes(1000).Reverse().ToArray().CopyTo(mvhdVersion0, 16); // timescale at offset 12 within payload? use payload layout below
        // payload: version(1) + flags(3) + creation(4) + modification(4) + timescale(4) + duration(4)
        mvhdVersion0[0] = 0; mvhdVersion0[1] = 0; mvhdVersion0[2] = 0; mvhdVersion0[3] = 0;
        var timescale = 1000;
        mvhdVersion0[12] = (byte)(timescale >> 24);
        mvhdVersion0[13] = (byte)(timescale >> 16);
        mvhdVersion0[14] = (byte)(timescale >> 8);
        mvhdVersion0[15] = (byte)timescale;
        var duration = 3200;
        mvhdVersion0[16] = (byte)(duration >> 24);
        mvhdVersion0[17] = (byte)(duration >> 16);
        mvhdVersion0[18] = (byte)(duration >> 8);
        mvhdVersion0[19] = (byte)duration;

        var payload = new byte[mvhdVersion0.Length];
        Array.Copy(mvhdVersion0, payload, mvhdVersion0.Length);
        // mvhd box
        var box = new byte[8 + payload.Length];
        BitConverter.GetBytes(box.Length).Reverse().ToArray().CopyTo(box, 0);
        Encoding.ASCII.GetBytes("mvhd").CopyTo(box, 4);
        Array.Copy(payload, 0, box, 8, payload.Length);
        // moov box wrapping mvhd
        var moov = new byte[8 + box.Length];
        BitConverter.GetBytes(moov.Length).Reverse().ToArray().CopyTo(moov, 0);
        Encoding.ASCII.GetBytes("moov").CopyTo(moov, 4);
        Array.Copy(box, 0, moov, 8, box.Length);

        var durationMS = AudioMetadata.Mp4DurationMS(moov);
        Assert.Equal(3200, durationMS);
    }

    [Fact]
    public void MediaFiles_Copy_And_DataURL_RoundTrip()
    {
        var dir = CreateTempDir();
        try
        {
            var source = Path.Combine(dir, "source.png");
            File.WriteAllBytes(source, new byte[] { 1, 2, 3, 4 });
            var target = MediaFiles.CopyMediaFile(Path.Combine(dir, "out"), "STEAM_1", source);
            Assert.NotNull(target);
            Assert.True(File.Exists(target!));
            Assert.StartsWith("data:image/png;base64,", MediaFiles.FileDataURL(target!));
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void ShowcaseVideo_Decode_And_Filter()
    {
        var raw = "data:image/png;base64," + Convert.ToBase64String(new byte[] { 9, 8, 7 });
        Assert.Equal(new byte[] { 9, 8, 7 }, ShowcaseVideo.DecodePNGDataURL(raw));
        Assert.Throws<InvalidOperationException>(() => ShowcaseVideo.DecodePNGDataURL("text/plain"));
        Assert.Equal("[1:a]adelay=500:all=1,atrim=duration=2.000,asetpts=N/SR/TB[a]", ShowcaseVideo.AudioFilter(500, 2.0));
        Assert.Equal("[1:a]atrim=start=0.500,asetpts=PTS-STARTPTS,atrim=duration=2.000[a]", ShowcaseVideo.AudioFilter(-500, 2.0));
        Assert.Equal("[1:a]atrim=duration=2.000,asetpts=PTS-STARTPTS[a]", ShowcaseVideo.AudioFilter(0, 2.0));
    }

    [Fact]
    public void Video_Export_Validate_Rejects_Bad_Requests()
    {
        Assert.NotNull(ShowcaseVideo.Validate(new VideoExportRequest { Width = 0, Height = 1080, FPS = 60, DurationMS = 4000 }));
        Assert.NotNull(ShowcaseVideo.Validate(new VideoExportRequest { Width = 1920, Height = 1080, FPS = 0, DurationMS = 4000 }));
        Assert.NotNull(ShowcaseVideo.Validate(new VideoExportRequest { Width = 1920, Height = 1080, FPS = 60, DurationMS = 0 }));
        Assert.Null(ShowcaseVideo.Validate(new VideoExportRequest { Width = 1920, Height = 1080, FPS = 60, DurationMS = 4000 }));
    }
}
