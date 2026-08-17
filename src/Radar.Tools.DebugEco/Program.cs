using DemoFile;
using DemoFile.Game.Cs;

var demoPath = args[0];
var demo = new CsDemoParser();

demo.Source1GameEvents.RoundStart += _ => Log(demo, "ROUND_START");
demo.Source1GameEvents.RoundFreezeEnd += _ => Log(demo, "FREEZE_END");
demo.Source1GameEvents.RoundEnd += _ => Log(demo, "ROUND_END");
demo.Source1GameEvents.RoundStartPreEntity += _ => Log(demo, "ROUND_START_PRE");
demo.Source1GameEvents.TeamplayRoundStart += _ => Log(demo, "TEAMPLAY_ROUND_START");

using var stream = File.OpenRead(demoPath);
var reader = DemoFileReader.Create(demo, stream);
try { reader.ReadAllAsync().GetAwaiter().GetResult(); } catch { }

void Log(CsDemoParser d, string evt)
{
    Console.WriteLine($"{evt} demoTick={d.CurrentDemoTick.Value} warmup={d.GameRules.WarmupPeriod}");
}
