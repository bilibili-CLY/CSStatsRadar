using System;
using System.Collections.Generic;
using System.Linq;
using Cs2Demo.Analytics;

namespace Radar.Parser;

/// <summary>
/// 完美平台 demo 会把玩家名记为「战队名 玩家名」；demo 内没有真实战队名字段
/// （包的 PlayerCsdaStats.Team 只是 csda 合成的 Team A/B 阵营标签），因此剥离只能用保守启发式：
/// 1) 聚类：同一场 demo 中 ≥2 名玩家共享同一个 k 词前缀（k = 1..3，忽略大小写）→ 认定该 k 词前缀为战队名；
/// 2) 配置：Settings 的 team_tags 清单（逗号分隔，条目可含空格，整前缀匹配、忽略大小写）。
/// 两种来源都取「最长命中」的前缀剥离，最多 3 个词，且剩余部分必须非空；
/// 真实昵称（含空格，如 "Old Man Jace"）不会成为聚类候选，绝不触碰。
/// </summary>
public static class TeamPrefix
{
    /// <summary>聚类的最大前缀词数（避免把整个长昵称误当战队名）。</summary>
    private const int MaxPrefixWords = 3;

    public static string[] ParseTags(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return [];
        return csv
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(t => t.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    /// <summary>从一场 demo 的玩家列表聚类出 k 词战队前缀候选（1..3 词，同场 ≥2 名玩家共享，忽略大小写）。</summary>
    public static IReadOnlySet<string> ClusterPrefixes(MatchData match)
    {
        var names = match.Players
            .Select(p => p.Name?.Trim() ?? "")
            .Where(n => n != "")
            .ToList();

        var candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var k = 1; k <= MaxPrefixWords; k++)
        {
            var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var name in names)
            {
                var prefix = FirstWords(name, k);
                if (prefix != "") counts[prefix] = counts.GetValueOrDefault(prefix) + 1;
            }
            foreach (var (prefix, count) in counts)
                if (count >= 2) candidates.Add(prefix);
        }
        return candidates;
    }

    /// <summary>
    /// 若 name 命中聚类前缀或配置 tag（整前缀匹配、剩余部分非空），按最长命中剥离并返回 true。
    /// </summary>
    public static bool TryStrip(string name, IReadOnlySet<string> clusterPrefixes, string[] tags, out string stripped)
    {
        stripped = name;
        var words = SplitWords(name);
        if (words.Length < 2) return false;

        var matched = 0;
        foreach (var prefix in clusterPrefixes)
        {
            var size = SplitWords(prefix).Length;
            if (size <= matched || size >= words.Length) continue;
            if (StartsWithWords(words, SplitWords(prefix))) matched = size;
        }
        foreach (var tag in tags)
        {
            var size = SplitWords(tag).Length;
            if (size <= matched || size >= words.Length) continue;
            if (StartsWithWords(words, SplitWords(tag))) matched = size;
        }

        if (matched == 0) return false;
        stripped = string.Join(' ', words.Skip(matched)).Trim();
        return stripped != "";
    }

    /// <summary>按首个空格切成 (首 token, 其余)；无空格或空段返回 ("", "")。</summary>
    public static (string token, string rest) Split(string name)
    {
        var trimmed = name.Trim();
        var idx = trimmed.IndexOf(' ');
        if (idx <= 0) return ("", "");
        var token = trimmed[..idx].Trim();
        var rest = trimmed[(idx + 1)..].Trim();
        return (token, rest);
    }

    private static string[] SplitWords(string value)
        => value.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);

    private static string FirstWords(string name, int count)
    {
        var words = SplitWords(name);
        if (words.Length < count) return "";
        return string.Join(' ', words.Take(count));
    }

    private static bool StartsWithWords(string[] words, string[] prefix)
    {
        if (prefix.Length >= words.Length) return false;
        for (var i = 0; i < prefix.Length; i++)
            if (!string.Equals(words[i], prefix[i], StringComparison.OrdinalIgnoreCase)) return false;
        return true;
    }
}
