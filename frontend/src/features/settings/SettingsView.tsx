import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  Film,
  FolderCog,
  Gauge,
  BookOpen,
  Save,
} from "lucide-react";
import { bridge } from "../../bridge";
import { Spinner } from "../../components/Busy";
import { errorMessage, formatBytes } from "../../lib/format";
import { useAppStore } from "../../stores/appStore";
import type { AppConfig, ImportSource } from "../../types";

const radarAxisLimits: Array<{
  name: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}> = [
  { name: "KPR", min: 0.5, max: 2, step: 0.05, defaultValue: 1 },
  { name: "Surviving", min: 0.3, max: 1, step: 0.01, defaultValue: 0.6 },
  { name: "ADR", min: 50, max: 200, step: 5, defaultValue: 100 },
  { name: "KAST", min: 0.35, max: 1, step: 0.01, defaultValue: 0.7 },
  { name: "Impact", min: 1, max: 4, step: 0.05, defaultValue: 2 },
  { name: "Multi-Kill", min: 0.05, max: 0.5, step: 0.01, defaultValue: 0.2 },
  { name: "Rating", min: 0.75, max: 3, step: 0.05, defaultValue: 1.5 },
];

const radarFloorLimits: Array<{
  name: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}> = [
  { name: "KPR", min: 0, max: 1, step: 0.01, defaultValue: 0.42 },
  { name: "Surviving", min: 0, max: 0.6, step: 0.005, defaultValue: 0.157 },
  { name: "ADR", min: 0, max: 100, step: 0.5, defaultValue: 47.5 },
  { name: "KAST", min: 0, max: 0.7, step: 0.005, defaultValue: 0.545 },
  { name: "Multi-Kill", min: 0, max: 0.2, step: 0.005, defaultValue: 0.07 },
  { name: "Rating", min: 0, max: 1.5, step: 0.01, defaultValue: 0.55 },
];

export function SettingsView() {
  const config = useAppStore((state) => state.config);
  const sources = useAppStore((state) => state.sources);
  const setConfig = useAppStore((state) => state.setConfig);
  const setImportSources = useAppStore((state) => state.setImportSources);
  const refreshPlayers = useAppStore((state) => state.refreshPlayers);
  const setMethodologyOpen = useAppStore((state) => state.setMethodologyOpen);
  const [draft, setDraft] = useState(config);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const [logsDir, setLogsDir] = useState("");
  useEffect(() => {
    let cancelled = false;
    bridge
      .logsDir()
      .then((dir) => {
        if (!cancelled) setLogsDir(dir);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  async function save() {
    try {
      setState("saving");
      setError("");
      const next = await bridge.savePreferences(
        draft.export_width,
        draft.export_height,
        draft.video_fps,
        draft.showcase.ffmpeg_path ?? "",
        draft.reduce_motion,
        draft.showcase.show_best_markers,
        draft.showcase.show_intro_animation,
        draft.showcase.show_best_entrance_animation,
        draft.showcase.audio_offset_ms,
        draft.showcase.radar_scale_mode,
        draft.showcase.radar_scale,
        draft.showcase.radar_axis_scale ?? {},
        draft.rating_version,
        draft.show_rating_watermark,
        draft.showcase.radar_floor ?? {},
        draft.team_tags ?? "",
      );
      setDraft(next);
      setConfig(next);
      setState("saved");
    } catch (value) {
      setState("error");
      setError(value instanceof Error ? value.message : String(value));
    }
  }
  async function selectFFmpeg() {
    try {
      const path = await bridge.chooseFFmpeg();
      setDraft({
        ...draft,
        showcase: { ...draft.showcase, ffmpeg_path: path },
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }
  async function addSource() {
    const path = await bridge.chooseDirectory();
    if (path) setImportSources(await bridge.addSource(path));
  }
  async function chooseDatabase() {
    try {
      setError("");
      const next = await bridge.chooseDatabase();
      setDraft(next);
      setConfig(next);
      await refreshPlayers();
      setState("saved");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      setState("error");
    }
  }
  async function clearData() {
    const confirmed = await useAppStore.getState().showConfirm({
      title: "清空数据",
      message:
        "永久清空比赛、玩家、关注列表、媒体、标签和编辑草稿？数据库文件本身会保留。",
      confirmLabel: "清空",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await bridge.clearAllData();
      await refreshPlayers();
      setState("saved");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }
  async function clearLogs() {
    const confirmed = await useAppStore.getState().showConfirm({
      title: "清除日志",
      message:
        "删除日志目录中的全部日志文件？日志由后端与桌面壳持续写入，删除后会自动重建。",
      confirmLabel: "清除",
      danger: true,
    });
    if (!confirmed) return;
    try {
      setError("");
      const result = await bridge.clearLogs();
      if (result.failed.length > 0) {
        setError(`部分日志未能删除：${result.failed.join("；")}`);
        return;
      }
      useAppStore
        .getState()
        .showToast(
          result.deleted_files === 0
            ? "日志目录已经是空的。"
            : `已清除 ${result.deleted_files} 个日志文件（${formatBytes(result.freed_bytes)}）`,
        );
    } catch (value) {
      setError(errorMessage(value));
    }
  }
  async function openLogsDir() {
    try {
      setError("");
      await bridge.openLogsDir();
    } catch (value) {
      setError(errorMessage(value));
    }
  }
  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">本地工作台</span>
          <h1>设置</h1>
          <p>管理素材来源、导出默认值、存储位置与视频依赖。</p>
        </div>
        <button
          className="primary"
          disabled={state === "saving"}
          onClick={save}
        >
          {state === "saving" ? <Spinner /> : <Save size={17} />}
          {state === "saving" ? "保存中" : "保存设置"}
        </button>
      </header>
      {state === "saved" && (
        <div className="notice success">
          <CheckCircle2 size={17} />
          设置已保存
        </div>
      )}
      {error && <div className="notice danger">{error}</div>}
      <div className="settings-grid">
        <section className="card settings-section">
          <div className="settings-icon"><BookOpen /></div>
          <div>
            <h2>评分算法与透明度</h2>
            <p>Rating 3.0 使用透明的本地近似算法，当前版本 <code>local-r3-2025.10-v1</code>。三处制作器共用此全局设置。</p>
            <div className="segmented">
              <button
                className={draft.rating_version === "rating_2" ? "active" : ""}
                onClick={() =>
                  setDraft({ ...draft, rating_version: "rating_2" })
                }
              >
                Rating 2.0
              </button>
              <button
                className={draft.rating_version === "rating_3" ? "active" : ""}
                onClick={() =>
                  setDraft({ ...draft, rating_version: "rating_3" })
                }
              >
                Rating 3.0
              </button>
            </div>
            {draft.rating_version === "rating_3" && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.show_rating_watermark}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      show_rating_watermark: event.target.checked,
                    })
                  }
                />
                <span>显示 3.0 近似水印</span>
              </label>
            )}
            <button className="quiet" onClick={() => setMethodologyOpen(true)}>查看 Rating 与 Swing 公式</button>
          </div>
        </section>
        <section className="card settings-section">
          <div className="settings-icon">
            <FolderCog />
          </div>
          <div>
            <h2>素材来源</h2>
            <p>扫描仅包含目录当前层，不跟随子目录或符号链接。</p>
            <div className="settings-source-list">
              {sources.map((source) => (
                <div key={source.id}>
                  <span>
                    <strong>{source.name}</strong>
                    <small>{source.path}</small>
                  </span>
                  <button
                    onClick={() =>
                      bridge.removeSource(source.id).then(setImportSources)
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
            <button className="quiet" onClick={addSource}>
              添加素材目录
            </button>
          </div>
        </section>
        <section className="card settings-section">
          <div className="settings-icon">
            <Gauge />
          </div>
          <div>
            <h2>默认导出</h2>
            <p>制作器可为每次作品单独覆盖。</p>
            <div className="two-fields">
              <label className="field">
                <span>宽度</span>
                <input
                  type="number"
                  value={draft.export_width}
                  onChange={(e) =>
                    setDraft({ ...draft, export_width: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>高度</span>
                <input
                  type="number"
                  value={draft.export_height}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      export_height: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <label className="field">
              <span>视频帧率</span>
              <select
                value={draft.video_fps}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    video_fps: Number(e.target.value) as 30 | 60,
                  })
                }
              >
                <option value="60">60 FPS</option>
                <option value="30">30 FPS</option>
              </select>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.showcase.show_best_markers}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    showcase: {
                      ...draft.showcase,
                      show_best_markers: event.target.checked,
                    },
                  })
                }
              />
              <span>轮播中显示单项最佳 BEST 标记</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.showcase.show_intro_animation}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    showcase: {
                      ...draft.showcase,
                      show_intro_animation: event.target.checked,
                    },
                  })
                }
              />
              <span>播放轮播开场动画（6 秒）</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.showcase.show_best_entrance_animation}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    showcase: {
                      ...draft.showcase,
                      show_best_entrance_animation: event.target.checked,
                    },
                  })
                }
              />
              <span>播放 BEST 玩家入场动画</span>
            </label>
            <h3>雷达外圈缩放</h3>
            <p className="field-note">
              调小上限可凸显单项爆发数据，标签仍显示真实数值。
            </p>
            <div className="segmented">
              <button
                className={draft.showcase.radar_scale_mode === "global" ? "active" : ""}
                onClick={() =>
                  setDraft({
                    ...draft,
                    showcase: {
                      ...draft.showcase,
                      radar_scale_mode: "global",
                    },
                  })
                }
              >
                全局缩放
              </button>
              <button
                className={draft.showcase.radar_scale_mode === "axis" ? "active" : ""}
                onClick={() =>
                  setDraft({
                    ...draft,
                    showcase: {
                      ...draft.showcase,
                      radar_scale_mode: "axis",
                    },
                  })
                }
              >
                分轴微调
              </button>
            </div>
            {draft.showcase.radar_scale_mode === "global" ? (
              <label className="field">
                <span>全局缩放系数</span>
                <input
                  type="number"
                  min={0.5}
                  max={1.0}
                  step={0.05}
                  value={draft.showcase.radar_scale}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      showcase: {
                        ...draft.showcase,
                        radar_scale: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ) : (
              <div className="two-fields">
                {radarAxisLimits.map((axis) => (
                  <label className="field" key={axis.name}>
                    <span>{axis.name}</span>
                    <input
                      type="number"
                      min={axis.min}
                      max={axis.max}
                      step={axis.step}
                      value={
                        draft.showcase.radar_axis_scale?.[axis.name] ??
                        axis.defaultValue
                      }
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          showcase: {
                            ...draft.showcase,
                            radar_axis_scale: {
                              ...draft.showcase.radar_axis_scale,
                              [axis.name]: Number(e.target.value),
                            },
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            )}
            <h3>雷达圆心最小值</h3>
            <p className="field-note">
              圆心代表的最低基准值：低于或等于它的数据停在圆心，高于它的数据向外延伸。仅影响 Rating 3.0 轮播雷达。
            </p>
            <div className="two-fields">
              {radarFloorLimits.map((axis) => (
                <label className="field" key={axis.name}>
                  <span>{axis.name}</span>
                  <input
                    type="number"
                    min={axis.min}
                    max={axis.max}
                    step={axis.step}
                    value={
                      draft.showcase.radar_floor?.[axis.name] ??
                      axis.defaultValue
                    }
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        showcase: {
                          ...draft.showcase,
                          radar_floor: {
                            ...draft.showcase.radar_floor,
                            [axis.name]: Number(e.target.value),
                          },
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </section>
        <section className="card settings-section">
          <div className="settings-icon">
            <Film />
          </div>
          <div>
            <h2>视频导出</h2>
            <p>优先自动检测系统中的 ffmpeg，也可手动定位。</p>
            <label className="field">
              <span>ffmpeg 路径</span>
              <div className="input-action">
                <input
                  value={draft.showcase.ffmpeg_path ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      showcase: {
                        ...draft.showcase,
                        ffmpeg_path: e.target.value,
                      },
                    })
                  }
                />
                <button onClick={selectFFmpeg}>选择</button>
              </div>
            </label>
          </div>
        </section>
        <section className="card settings-section">
          <div className="settings-icon">
            <Database />
          </div>
          <div>
            <h2>数据与辅助功能</h2>
            <p>数据库升级前会自动创建时间戳备份。</p>
            <label className="field">
              <span>数据库路径</span>
              <div className="input-action">
                <input value={draft.database_path} disabled />
                <button onClick={chooseDatabase}>切换</button>
              </div>
            </label>
            <label className="field">
              <span>日志目录</span>
              <div className="input-action">
                <input value={logsDir || "读取中…"} disabled />
                <button onClick={openLogsDir}>打开</button>
              </div>
            </label>
            <p className="field-note">
              后端与桌面壳的日志（backend.log、desktop.log、avatars.log）都在这里；导入失败、头像抓取失败等问题先看它。
            </p>
            <label className="field">
              <span>战队前缀清单</span>
              <input
                value={draft.team_tags ?? ""}
                placeholder="例如：Alt, TY, SP"
                onChange={(e) =>
                  setDraft({ ...draft, team_tags: e.target.value })
                }
              />
            </label>
            <p className="field-note">
              完美平台 demo 会把玩家名记为「战队名 玩家名」。逗号分隔的战队名会在导入时自动去掉；
              同一场比赛中重复出现的前缀也会被自动识别。
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.reduce_motion}
                onChange={(e) =>
                  setDraft({ ...draft, reduce_motion: e.target.checked })
                }
              />
              <span>减少界面动态效果</span>
            </label>
            <div className="settings-action-row">
              <button onClick={clearLogs}>清除日志</button>
              <button className="danger-action" onClick={clearData}>
                清空全部本地数据
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
