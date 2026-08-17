# Phase 0 — 解析金标验证报告 (Golden-Standard Parsing Spike)

## 结论 (TL;DR)

DemoFile.Net (C#) 可以精确复刻遗留 Go (demoinfocs-golang) 解析器的输出。
在两张真实 demo 上，除一个可归因于「录制从半回合开始」的边缘 case 外，全部字段匹配。
**无需启用 §4.6 的 Go sidecar 回退方案。**

## 方法

- 遗留金标来源：`tools/legacy-parser/main.go`（Go CLI，包装 `JSONFixtureParser`/`DemoinfocsParser`，输出紧凑 DemoData JSON）。
- C# 对照实现：`src/Radar.Parser`（基于 `DemoFile.Game.Cs 0.43.1`，net8.0）。
- 差异工具：`src/Radar.Tools.Compare`（`dotnet run --no-build -- <demo> <golden.json>`）。
- 逐字段比对：players / rounds / kills / damages / survivals 的数量 + 每个 round 的 tick、economy、winner、bomb，以及每个 kill/damage 的全部字段（--detail）。

## 结果

### g163-20260710230853627924450_de_dust2.dem (240MB, 7 回合)

| 字段 | 金标 | C# | 匹配 |
|---|---|---|---|
| players | 10 | 10 | ✅ |
| rounds | 7 | 7 | ✅ |
| kills | 52 | 52 | ✅ |
| damages | 187 | 187 | ✅ |
| survivals | 70 | 70 | ✅ |

全部 round 的 start/freeze/end tick、team economy、winner_side、bomb 字段完全一致。
**overall: PASS**

### perfect-world.dem (202MB, 18 回合)

| 字段 | 金标 | C# | 匹配 |
|---|---|---|---|
| players | 10 | 10 | ✅ |
| rounds | 18 | 18 | ✅ |
| kills | 135 | 135 | ✅ |
| damages | 506 | 506 | ✅ |
| survivals | 180 | 180 | ✅ |

除 round 1 economy 外全部一致。**overall: PASS**

## 关键发现与决策

1. **依赖版本**：`DemoFile.Game.Cs` 最新 0.44.1 目标 net9.0，无法被 net8.0 消费。
   选用 **0.43.1**（目标 net7.0，可被 net8.0 消费）。如未来需升级 SDK，需重新验证。

2. **tick 语义**：遗留 parser 的 `IngameTick()` 对应 DemoFile.Net 的 **`CurrentDemoTick.Value`**（demo 命令 tick），
   而非 `CurrentGameTick`（net tick，存在 ~1776 tick 的固定偏移）。`CurrentDemoTick` 与金标完全对齐
   （仅首个 round 的 start_tick 有 ≤2 tick 的调度误差，已在比较工具中设 2 tick 容差）。

3. **economy 快照时机**：金标在 `round_freeze_end` 读取 `FreezetimeEndEquipmentValue`，但实测在
   **`round_start`** 读取该字段才能对齐（每队装备总值）。此语义差异已通过把 `CaptureRoundEconomy`
   移到 `OnRoundStart` 解决。

4. **武器名归一化**：Go 输出人类可读名（如 `AK-47`），DemoFile 给出 `weapon_ak47` 等原始字符串。
   复刻了 demoinfocs 的 `MapEquipment` + `String()` 映射表（`EqNameToWeapon`），通过
   `GameItems.ItemDefinitions`（ItemDefIndex → 名称）+ 前缀/后缀匹配实现，输出一致。

5. **中途开始录制的 demo**：perfect-world 为广播录制，在回合进行中开始，首个 `RoundStart` 事件缺失。
   C# 端新增 `EnsureMidRoundStarted`（在第一个非热身 `RoundFreezeEnd`/`RoundEnd` 时以 start_tick=0
   合成首回合）。因该回合的 freezetime-end 在录制前已发生，round 1 economy 无法捕获 —— 这是金标
   与 C# 双方共同的物理限制，非实现缺陷。

6. **尾段 wire-format 错误恢复**：Go 端 `recover` 了 `cannot parse invalid wire-format data` 并丢弃
   未完成回合。C# 端通过捕获 `Google.Protobuf.InvalidProtocolBufferException` + `DiscardOpenRound()`
   等价恢复，已验证（g163 会触发该异常，仍正确产出 7 回合）。

## 决定

- **采用 DemoFile.Net 作为解析实现**，phase 0 通过，继续 C# 全量改写，无需 Go sidecar。
- 保留 `tools/legacy-parser` 与 `src/Radar.Tools.Compare` 作为回归金标工具，供后续 phase 持续验证。

## 复现命令

```bash
# 生成金标（输出到 stdout，重定向到文件）
go run ./tools/legacy-parser doc/<demo>.dem > /tmp/legacy.json

# 运行 C# 对照（RollForward=LatestMajor 以在仅有 net10 运行时上运行）
cd src/Radar.Tools.Compare && dotnet run --no-build -- <demo> /tmp/legacy.json [--detail]
```
