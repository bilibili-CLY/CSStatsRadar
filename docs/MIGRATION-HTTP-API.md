# HTTP API / Bridge 迁移说明

本文件记录从 Go + Wails v2（`desktop_app.go` 的 Wails 绑定）迁移到
`.NET 8 + Photino` 后，前端如何与后端通信。规格见 `doc/prompt.md` §1.5。

## 1. 迁移前：Wails 绑定

旧版前端通过 `frontend/src/bridge.ts` 调用 `window.go.radar.DesktopApp.*`。
Wails 自动生成 `frontend/wailsjs/` 绑定，方法名即 Go 端
`DesktopApp` 结构体的导出方法。

## 2. 迁移后：统一桥接协议

前端仍通过 `bridge.ts` 调用同名方法，但方法来源变为：

1. `window.go?.radar?.DesktopApp?.[name]`（如果未来仍有 Wails 绑定，优先）；
2. 否则回退到 `window.__studioBridge?.[name]`（Photino 桥接注入对象）。

`Radar.Api.BridgeServer` 是一个本地 HTTP 服务器，完成两件事：

### 2.1 静态前端托管

- 服务 `frontend/dist` 目录（构建产物）。
- 对 `index.html` 注入 `<script src="/studio-bridge.js">`。
- `/studio-bridge.js` 定义 `window.__studioBridge`，其每个方法
  发起 `POST /__bridge` 调用。

### 2.2 RPC 桥接端点

```
POST /__bridge
Content-Type: application/json

{ "method": "BuildRadar", "args": ["7656119...", ["demo_record_..."]] }
```

响应：

```json
{ "result": <方法返回值> }
{ "error": { "code": "player_record_not_found", "message": "未找到已保存玩家。" } }
```

- `result` 为 JSON 序列化后的方法返回值。
- `error` 携带 `AppError` 的 `code` / `message`，HTTP 层面始终返回 200，
  由前端 JS 抛出带 `code` 的 `Error`。

## 3. 方法映射

`BridgeServer` 注入的 `window.__studioBridge` 暴露与 Go `DesktopApp`
完全一致的 43 个方法（`Bootstrap` … `CancelVideoExport`）。
`Radar.Api.DesktopApp.Invoke` 通过反射按方法名 + 参数个数分发到 C# 方法，
参数使用 `DeserializeArg` 做类型转换（int / double / bool / string /
`List<string>` / `Dictionary<string,double>` / `Player` / 复杂对象走
`System.Text.Json`）。

导入相关方法（`ChooseImportFiles` / `AddImportSource` / `StartSourceScan` /
`StartFileImport` / `ImportSummary` / `CancelImport` / `FollowAndBackfill` /
`FollowDemoPlayers` / `ChooseReplacementDemo`）已由 `Radar.Application.ImportService`
与 `Radar.Api.DesktopApp` 完整实现：

- `ImportService.ScanSourcePaths` 递归收集素材目录下的 `.dem` / `.zip`，去重排序。
- `Start` 创建后台任务（2 worker 并发消费队列），逐文件解析并调用
  `HistoryService.SaveParsedDemoForPlayersAtSource` 落库，汇总进度
  （processed / imported / duplicates / failed / discovered）。
- ZIP 导入遵循 Go 的安全限制（4GB 文件上限、2GB 解压上限、200 倍压缩比上限、
  单 DEM 限制）。
- 未关注任何玩家时，Demo 记录仍会入库（参与玩家快照 + 分析），保证
  `FollowAndBackfill` 能随后补存玩家数据——与 Go 的
  `saveParsedDemoForPlayersAtSource` 行为一致。
- `FollowAndBackfill` / `FollowDemoPlayers` 校验所选玩家属于该场 Demo 后，
  通过 `FollowParsedDemoPlayersAtSource`（`followPlayers=true`）落库。

`ChooseImportDirectory` / `ChooseImportFiles` / `ChooseReplacementDemo` / `ChooseDatabase` /
`ChooseFFmpeg` / `ExportPNG` / `ChoosePlayerMedia` / `ChooseShowcaseMusic`
通过 `Radar.Api.NativeDialogs` 在 macOS 上用 `osascript` + `NSOpenPanel`
弹出原生目录/文件选择；非 macOS 环境返回空值（前端有轮询与拖拽兜底）。

桌面能力已全部落地：

- **玩家媒体**：`GetPlayerMedia` / `ChoosePlayerMedia` / `SetPlayerImageURL` /
  `ClearPlayerMedia`，图片与 MVP 背景存于 `~/.csplayerstatsradar/`，
  由 `SQLiteHistoryRepository` 的 `player_images` / `player_mvp_backgrounds`
  表持久化，读取时以 data URL 回传（`MediaFiles.FileDataURL`）。
- **背景音乐**：`ChooseShowcaseMusic` / `GetShowcaseMusic` / `GetShowcaseMusicInfo` /
  `ClearShowcaseMusic`，音频时长通过 `AudioMetadata` 解析 MP4/M4A（`mvhd` box）
  与 WAV（`fmt` / `data` chunk），与 Go `audio_metadata.go` 一致。
- **ffmpeg**：`DetectFFmpeg` 检查配置路径与 PATH，`ChooseFFmpeg` 校验后持久化。
- **视频导出**：`BeginVideoExport` / `AppendVideoFrames` / `FinishVideoExport` /
  `CancelVideoExport`，帧写入临时目录后调用 ffmpeg 编码为 MP4
  （libx264 + faststart + 可选音频循环/偏移），限制与 Go `showcase_video.go`
  一致（7200 帧上限、8192 尺寸上限、120 FPS 上限）。
- **PNG 导出**：`ExportPNG` 解码 data URL 后写入用户选择的路径。

## 4. 事件推送（导入进度）

Wails 的 `runtime.EventsOn("import:progress")` 在 Photino 环境没有对应物。
`ImportService.SetProgressHandler` 已支持进度回调，但 `BridgeServer` 当前不推送
服务端事件。前端 `ImportView` 内置 650ms 轮询 `ImportSummary(jobID)` 作为兜底，
因此无事件推送时进度照常刷新。后续可通过 `PhotinoWindow` 的
`SendMessage` / `ReceiveMessage` 通道把 C# 侧进度回调转发到前端，或在
`/__bridge` 增加 SSE/WebSocket 订阅端点。

## 5. 验证

- `src/Radar.Tests/BridgeServerIntegrationTests.cs`：
  - `Bootstrap_Returns_Config_And_Empty_Players`
  - `ImportDemo_Then_BuildRadar_Via_Bridge`
  - `Static_Frontend_Served_With_Bridge_Injector`
- 运行：`cd src/Radar.Tests && dotnet test`

## 6. 相关文件

| 层 | 路径 |
|---|---|
| 桥接服务器 | `src/Radar.Api/BridgeServer.cs` |
| 桌面应用门面 | `src/Radar.Api/DesktopApp.cs` |
| 注入脚本定义 | `BridgeServer.ServeBridgeScript` |
| 前端桥接客户端 | `frontend/src/bridge.ts` |
| Photino 宿主 | `src/Radar.App/Program.cs` |
| 测试 | `src/Radar.Tests/BridgeServerIntegrationTests.cs` |