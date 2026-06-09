# CS2 Player Stats Radar

本项目实现一个本地 Web 工具：上传已解压的 CS2 `.dem` 文件，选择玩家名或 SteamID，计算六维指标并导出 Rock-Radar 风格 PNG。

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
