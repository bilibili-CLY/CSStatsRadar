# CS2 Player Stats Radar

本项目实现一个本地 Web 工具：上传已解压的 CS2 `.dem` 文件，选择玩家名或 SteamID，计算六维指标并导出 Rock-Radar 风格 PNG。

## 功能

- 上传并解析本地 CS2 `.dem` 文件。
- 从当前 Demo 中选择玩家，生成单场六维雷达图。
- 在左侧玩家列表中维护白名单，只有白名单玩家会写入玩家记录。
- 将白名单玩家的比赛级统计保存到本地 SQLite。
- 使用 Demo 文件指纹、地图和玩家集合去重，避免依赖 CS2 Demo 中可能缺失的真实比赛时间。
- 在“玩家记录”中查看已保存玩家，删除玩家记录或删除单场比赛记录。
- 双击玩家记录进入详情，多选比赛后生成综合雷达图。
- 雷达标题支持按玩家记忆，日期副标题可编辑，综合雷达会显示“已选 n 场比赛”。
- 支持配置导出宽高、主题色、数据库路径，并导出 PNG。

## 运行

开发运行：

```bash
go run ./cmd/cs-radar-server
```

打开浏览器访问：

```text
http://127.0.0.1:8000/
```

端口可通过环境变量修改：

```bash
CS_RADAR_ADDR=127.0.0.1:9000 go run ./cmd/cs-radar-server
```

## 配置文件

默认保存到：

```text
~/.csplayerstatsradar/config.json
```

可通过环境变量覆盖：

```bash
export CS_RADAR_CONFIG_PATH=/path/to/config.json
```

## 历史数据库

玩家记录默认保存到：

```text
~/.csplayerstatsradar/history.db
```

可在页面左侧“数据库路径”中修改，保存配置后即时切换。也可以通过环境变量覆盖：

```bash
export CS_RADAR_DB_PATH=/path/to/history.db
```

## 使用流程

1. 启动服务并打开 `http://127.0.0.1:8000/`。
2. 上传已解压的 `.dem` 文件。
3. 在左侧玩家列表中点击“添加白名单”。
4. 选择玩家查看当前 Demo 雷达图，或切换到“玩家记录”查看历史数据。
5. 在玩家记录中双击玩家进入详情，勾选比赛并生成综合雷达图。
6. 按需修改标题、日期、主题色和导出尺寸后导出 PNG。
