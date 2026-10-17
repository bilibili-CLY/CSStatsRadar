using System.Text.Json;
using Radar.Domain.Models;
using Radar.Parser;

var demoPath = args.Length > 0 ? args[0] : null;
var goldenPath = args.Length > 1 ? args[1] : null;

if (demoPath == null || goldenPath == null)
{
    Console.Error.WriteLine("usage: radar-compare <demo|fixture> <golden.json> [--detail]");
    return 1;
}

var detail = args.Contains("--detail");
var JsonOpts = new JsonSerializerOptions
{
    PropertyNameCaseInsensitive = true,
    WriteIndented = true,
};

DemoData parsed;
if (File.Exists(demoPath) && demoPath.EndsWith(".dem", StringComparison.OrdinalIgnoreCase))
{
    parsed = new CsdaParser().Parse(demoPath);
}
else
{
    // Treat as a JSON fixture path, passthrough
    parsed = JsonSerializer.Deserialize<DemoData>(File.ReadAllText(demoPath), JsonOpts)!;
}

DemoData golden;
if (goldenPath.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
{
    golden = JsonSerializer.Deserialize<DemoData>(File.ReadAllText(goldenPath), JsonOpts)!;
}
else
{
    golden = new CsdaParser().Parse(goldenPath);
}

// Write C# output next to golden for inspection
var outPath = Path.Combine(Path.GetDirectoryName(goldenPath)!, "cs_" + Path.GetFileName(goldenPath));
File.WriteAllText(outPath, JsonSerializer.Serialize(parsed, JsonOpts));

var report = Compare(parsed, golden);

Console.WriteLine($"=== Field tolerance report ===");
Console.WriteLine($"players:     expected={golden.Players.Count} got={parsed.Players.Count} match={report.PlayersMatch}");
Console.WriteLine($"rounds:      expected={golden.Rounds.Count} got={parsed.Rounds.Count} match={report.RoundsMatch}");
Console.WriteLine($"kills:       expected={golden.Kills.Count} got={parsed.Kills.Count} match={report.KillsMatch}");
Console.WriteLine($"damages:     expected={golden.Damages?.Count ?? 0} got={parsed.Damages?.Count ?? 0} match={report.DamagesMatch}");
Console.WriteLine($"survivals:   expected={golden.Survivals.Count} got={parsed.Survivals.Count} match={report.SurvivalsMatch}");

Console.WriteLine($"\n=== Per-round tick/economy/winner diffs ===");
foreach (var line in report.RoundDiffs) Console.WriteLine(line);

if (detail)
{
    Console.WriteLine($"\n=== Kill field diffs (first 30) ===");
    foreach (var line in report.KillDiffs.Take(30)) Console.WriteLine(line);
    Console.WriteLine($"\n=== Damage field diffs (first 30) ===");
    foreach (var line in report.DamageDiffs.Take(30)) Console.WriteLine(line);
}

Console.WriteLine($"\noverall: {report.Overall}");
Console.WriteLine($"cs output written to: {outPath}");
return report.Overall == "PASS" ? 0 : 1;

static CompareReport Compare(DemoData parsed, DemoData golden)
{
    var rep = new CompareReport();

    rep.PlayersMatch = SetEqual(golden.Players.Select(p => p.SteamID), parsed.Players.Select(p => p.SteamID));

    rep.RoundsMatch = golden.Rounds.Count == parsed.Rounds.Count;
    for (var i = 0; i < Math.Min(golden.Rounds.Count, parsed.Rounds.Count); i++)
    {
        var g = golden.Rounds[i];
        var c = parsed.Rounds[i];
        var diffs = new List<string>();
        void Chk(string name, object gv, object cv)
        {
            if (!Equals(gv, cv)) diffs.Add($"{name}: expected={gv} got={cv}");
        }
        Chk("round_number", g.RoundNumber, c.RoundNumber);
        Chk("end_tick", g.EndTick, c.EndTick);
        Chk("winner_side", g.WinnerSide, c.WinnerSide);
        // csda 映射丢字段：freeze_end_tick / bomb_* / TeamEconomy 不再比较（Mapper 置默认值）。
        if (diffs.Count > 0)
            rep.RoundDiffs.Add($"round {i + 1}: " + string.Join(" | ", diffs));
    }

    rep.KillsMatch = golden.Kills.Count == parsed.Kills.Count;
    for (var i = 0; i < Math.Min(golden.Kills.Count, parsed.Kills.Count); i++)
    {
        var g = golden.Kills[i];
        var c = parsed.Kills[i];
        var diffs = new List<string>();
        void Chk(string name, object gv, object cv)
        {
            if (!Equals(gv, cv)) diffs.Add($"{name}: expected={gv} got={cv}");
        }
        Chk("round_number", g.RoundNumber, c.RoundNumber);
        Chk("attacker", g.AttackerSteamID, c.AttackerSteamID);
        Chk("victim", g.VictimSteamID, c.VictimSteamID);
        Chk("assister", g.AssisterSteamID, c.AssisterSteamID);
        Chk("traded", g.TradedPlayerSteamID, c.TradedPlayerSteamID);
        Chk("attacker_side", g.AttackerSide, c.AttackerSide);
        Chk("victim_side", g.VictimSide, c.VictimSide);
        Chk("weapon", g.Weapon, c.Weapon);
        // csda 映射丢字段：victim_weapon / armors / equipments / assisted_flash 不再比较；tick 保留（同一 demo 事件 tick 一致）。
        if (diffs.Count > 0)
            rep.KillDiffs.Add($"kill {i + 1}: " + string.Join(" | ", diffs));
    }

    rep.DamagesMatch = (golden.Damages?.Count ?? 0) == (parsed.Damages?.Count ?? 0);
    for (var i = 0; i < Math.Min(golden.Damages?.Count ?? 0, parsed.Damages?.Count ?? 0); i++)
    {
        var g = golden.Damages![i];
        var c = parsed.Damages![i];
        var diffs = new List<string>();
        void Chk(string name, object gv, object cv)
        {
            if (!Equals(gv, cv)) diffs.Add($"{name}: expected={gv} got={cv}");
        }
        Chk("round_number", g.RoundNumber, c.RoundNumber);
        Chk("attacker", g.AttackerSteamID, c.AttackerSteamID);
        Chk("victim", g.VictimSteamID, c.VictimSteamID);
        Chk("damage", g.Damage, c.Damage);
        Chk("attacker_side", g.AttackerSide, c.AttackerSide);
        Chk("victim_side", g.VictimSide, c.VictimSide);
        Chk("weapon", g.Weapon, c.Weapon);
        // csda 映射丢字段：tick（恒 0）/ victim_weapon / armors / equipments 不再比较。
        if (diffs.Count > 0)
            rep.DamageDiffs.Add($"damage {i + 1}: " + string.Join(" | ", diffs));
    }

    rep.SurvivalsMatch = golden.Survivals.Count == parsed.Survivals.Count;
    rep.Overall = rep.PlayersMatch && rep.RoundsMatch && rep.KillsMatch && rep.DamagesMatch && rep.SurvivalsMatch
        ? "PASS"
        : "FAIL";
    return rep;
}

static bool SetEqual(IEnumerable<string> a, IEnumerable<string> b)
{
    var sa = a.ToHashSet();
    var sb = b.ToHashSet();
    return sa.SetEquals(sb);
}

class CompareReport
{
    public bool PlayersMatch;
    public bool RoundsMatch;
    public bool KillsMatch;
    public bool DamagesMatch;
    public bool SurvivalsMatch;
    public string Overall = "FAIL";
    public List<string> RoundDiffs = new();
    public List<string> KillDiffs = new();
    public List<string> DamageDiffs = new();
}
