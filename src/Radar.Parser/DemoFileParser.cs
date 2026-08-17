using System.Security.Cryptography;
using System.Text;
using DemoFile;
using DemoFile.Game.Cs;
using Radar.Domain.Models;

namespace Radar.Parser;

public interface IDemoParser
{
    DemoData Parse(string filePath);
}

public class DemoFileParser : IDemoParser
{
    public DemoData Parse(string filePath)
    {
        if (!File.Exists(filePath))
            throw new InvalidOperationException("Demo 文件不存在。");

        var builder = new DemoFileDataBuilder();
        builder.Meta.FileSHA256 = Sha256OfFile(filePath);

        using var stream = File.OpenRead(filePath);
        var demo = new CsDemoParser();
        demo.Source1GameEvents.RoundStart += e => builder.OnRoundStart(demo);
        demo.Source1GameEvents.RoundFreezeEnd += e => builder.OnRoundFreezeEnd(demo);
        demo.Source1GameEvents.PlayerDeath += e => builder.OnKill(demo, e);
        demo.Source1GameEvents.PlayerHurt += e => builder.OnDamage(demo, e);
        demo.Source1GameEvents.BombPlanted += e => builder.OnBombPlanted(demo, e);
        demo.Source1GameEvents.BombDefused += e => builder.OnBombDefused(demo, e);
        demo.Source1GameEvents.RoundEnd += e => builder.OnRoundEnd(demo, e);

        var reader = DemoFileReader.Create(demo, stream);
        try
        {
            reader.ReadAllAsync().GetAwaiter().GetResult();
        }
        catch (Exception ex) when (IsRecoverableWireError(ex))
        {
            builder.DiscardOpenRound();
        }

        if (demo.ServerInfo?.MapName is { Length: > 0 } map) builder.Meta.MapName = map;
        builder.CollectRemaining(demo);
        var result = builder.Data();
        if (result.Players.Count == 0)
            throw new InvalidOperationException("Demo 解析失败：未识别到玩家列表。");
        if (result.Rounds.Count == 0)
            throw new InvalidOperationException("Demo 解析失败：未识别到有效回合。");
        return result;
    }

    private static bool IsRecoverableWireError(Exception ex)
    {
        for (var current = ex; current != null; current = current.InnerException)
        {
            if (current is Google.Protobuf.InvalidProtocolBufferException) return true;
        }
        return false;
    }

    private static string Sha256OfFile(string path)
    {
        using var sha = SHA256.Create();
        using var stream = File.OpenRead(path);
        var hash = sha.ComputeHash(stream);
        var sb = new StringBuilder(hash.Length * 2);
        foreach (var b in hash) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }
}
