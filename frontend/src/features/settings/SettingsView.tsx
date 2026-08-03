import { useState } from "react";
import {
  CheckCircle2,
  Database,
  Film,
  FolderCog,
  Gauge,
  Save,
} from "lucide-react";
import { bridge } from "../../bridge";
import { Spinner } from "../../components/Busy";
import type { AppConfig, ImportSource } from "../../types";

interface Props {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
  sources: ImportSource[];
  onSourcesChange: (sources: ImportSource[]) => void;
  onDataChanged: () => Promise<void>;
}

export function SettingsView({
  config,
  onChange,
  sources,
  onSourcesChange,
  onDataChanged,
}: Props) {
  const [draft, setDraft] = useState(config);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
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
        draft.showcase.audio_offset_ms,
      );
      setDraft(next);
      onChange(next);
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
    if (path) onSourcesChange(await bridge.addSource(path));
  }
  async function chooseDatabase() {
    try {
      setError("");
      const next = await bridge.chooseDatabase();
      setDraft(next);
      onChange(next);
      await onDataChanged();
      setState("saved");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      setState("error");
    }
  }
  async function clearData() {
    if (
      !window.confirm(
        "永久清空比赛、玩家、关注列表、媒体、标签和编辑草稿？数据库文件本身会保留。",
      )
    )
      return;
    try {
      await bridge.clearAllData();
      await onDataChanged();
      setState("saved");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
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
                      bridge.removeSource(source.id).then(onSourcesChange)
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
            <button className="danger-action" onClick={clearData}>
              清空全部本地数据
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
