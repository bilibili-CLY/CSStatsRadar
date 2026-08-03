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

- Wails v2 桌面壳，支持 macOS 和 Windows 原生文件/目录对话框。
- React、TypeScript、Vite 前端。
- Go Demo 解析、SQLite 本地资料库。
- FFmpeg MP4 导出；应用会自动检测，也可在设置中选择可执行文件。

## 开发

要求 Go 1.23+、Node.js 18+，并建议安装 Wails v2.12 CLI。

```bash
cd frontend
npm install
npm test
npm run build

cd ../
go test ./...
```

启动 Wails 开发模式：

```bash
cd cmd/cs-radar-studio
wails dev
```

生成当前平台安装包：

```bash
cd cmd/cs-radar-studio
wails build -clean
```

生产前端已提交到 `frontend/dist`，因此普通 `go test ./...` 在没有 Node.js 的环境中也能编译嵌入资源。

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
