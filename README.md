# CSPlayerStatsRadar

CSPlayerStatsRadar 是面向 CS2 内容制作人员的本地桌面工作台。它把 Demo 导入、玩家资料库、雷达图、多人叠图和展示轮播整理为一条清晰的制作流程，所有比赛数据均保存在本机。

## 工作流

1. 在“导入”中添加一个或多个素材目录，或直接选择 `.dem` / `.zip` 文件。
2. 点击“扫描全部来源”。每个来源只扫描当前目录层级；ZIP 必须包含一个 DEM。
3. 在导入摘要中查看新增、重复、失败和新发现玩家，并按需关注与补写本批数据。
4. 在“资料库”中选择玩家，使用默认最近 5 场或自定义比赛选择。
5. 将选材发送到雷达、叠图或轮播制作器并导出 PNG / MP4。

取消关注只会停止未来自动入库，不会删除已有比赛。缺少真实时间的 Demo 会显示“比赛时间未知”，可在资料库中补录并添加赛事标签。

## 技术栈

- Photino.NET 桌面壳，基于系统 WebView，支持 macOS 和 Windows 原生文件/目录对话框。
- React、TypeScript、Vite 前端，通过本地 HTTP 桥接与后端通信。
- .NET 8 + C#，DemoFile.Net 解析 Demo，SQLite 本地资料库。
- FFmpeg MP4 导出；应用会自动检测，也可在设置中选择可执行文件。

## 项目结构

```text
src/
├── Radar.Domain           领域模型（Demo 数据、雷达、玩家统计）
├── Radar.Parser           DemoFile.Net 解析（产生 DemoData）
├── Radar.Application      核心算法：统计、Rating 3.0、Swing、叠图、导入服务
├── Radar.Infrastructure   SQLite 资料库、配置管理
├── Radar.Api              DesktopApp 门面、HTTP 桥接服务、对话框/媒体/视频导出
├── Radar.App              Photino 桌面宿主（入口）
├── Radar.Tools.Compare    解析结果与黄金数据逐字段对比
├── Radar.Tools.DebugEco   Demo 事件调试工具
└── Radar.Tests            xUnit 测试（算法一致性、桥接、导入、端到端）
```

桥接协议与迁移说明见 `docs/MIGRATION-HTTP-API.md`。

## 开发

要求 .NET SDK 8+、Node.js 18+。由于只安装更高版本运行时（如 .NET 10）时，`Radar.App` 已配置 `<RollForward>LatestMajor</RollForward>` 以便直接运行。

```bash
# 后端测试与构建
dotnet build src/CSPlayerStatsRadar.slnx
dotnet test src/Radar.Tests

# 前端
cd frontend
npm install
npm run build
```

启动桌面应用（需先构建前端）：

```bash
dotnet run --project src/Radar.App
```

生产前端已提交到 `frontend/dist`，因此 `Radar.App` 可以直接嵌入使用。

### 解析一致性校验

`src/Radar.Tests/TestData/` 提交了黄金数据（`golden_stats_*.json`、`legacy_*.json`），
`dotnet test` 会将其与 C# 算法输出逐字段对比。需要用新的 Demo 重新生成黄金数据时，
先解析出 JSON fixture，再用 `Radar.Tools.Compare` 校验：

```bash
dotnet run --project src/Radar.Tools.Compare -- <demo.dem> <golden.json> [--detail]
```

## 数据与迁移

默认数据目录为：

```text
~/.csplayerstatsradar/
```

其中包含 SQLite 资料库、配置、玩家图片、MVP 背景和轮播音乐。旧数据库第一次由新版打开时会先创建 `.bak-YYYYMMDD-HHMMSS` 备份，再执行版本化迁移。已有历史玩家会默认变为已关注。

可以继续使用环境变量覆盖数据路径：

```bash
export CS_RADAR_CONFIG_PATH=/path/to/config.json
export CS_RADAR_DB_PATH=/path/to/history.db
```

## 导入安全

- 仅支持 `.dem` 和 `.zip`；不支持 RAR、7Z、BZ2 或 GZ。
- ZIP 解压在临时目录中完成，不修改原素材。
- 拒绝多个 DEM、异常压缩比、超限文件和路径穿越条目。
- 多文件任务最多同时解析两个 Demo，可取消；已经成功导入的项目会保留。
