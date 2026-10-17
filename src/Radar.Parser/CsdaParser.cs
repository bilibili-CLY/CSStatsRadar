using Cs2Demo.Analytics;
using Radar.Domain.Models;

namespace Radar.Parser;

public interface IDemoParser
{
    DemoData Parse(string filePath);
}

/// <summary>
/// 解析结果：DemoData 供项目内部 Analysis/history 复用，MatchData 保留包的原始口径数据。
/// </summary>
public class ParsedDemo
{
    public required DemoData Demo { get; init; }
    public required MatchData Match { get; init; }
}

/// <summary>
/// 基于 Cs2Demo.Analytics（csda）的 demo 解析器，替代原有 DemoFile.Game.Cs 内嵌解析。
/// </summary>
public class CsdaParser : IDemoParser
{
    public DemoData Parse(string filePath) => ParseAll(filePath).Demo;

    public ParsedDemo ParseAll(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
            throw new InvalidOperationException("Demo 文件不存在。");

        MatchData match;
        try
        {
            match = DemoAnalyzer.ParseFile(filePath);
        }
        catch (FileNotFoundException ex)
        {
            throw new InvalidOperationException("Demo 解析失败：未能找到解析组件（" + (ex.FileName ?? ex.Message) + "）。", ex);
        }
        catch (InvalidOperationException ex)
        {
            throw new InvalidOperationException("Demo 解析失败：" + ex.Message, ex);
        }

        if (match.Players.Count == 0)
            throw new InvalidOperationException("Demo 解析失败：未识别到玩家列表。");
        if (match.Rounds.Count == 0)
            throw new InvalidOperationException("Demo 解析失败：未识别到有效回合。");

        return new ParsedDemo
        {
            Demo = MatchDataMapper.Map(match),
            Match = match,
        };
    }
}
