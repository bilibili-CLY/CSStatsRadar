import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileArchive,
  FolderPlus,
  Play,
  RefreshCw,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { bridge } from "../../bridge";
import { BusyMessage, Spinner } from "../../components/Busy";
import type { ImportSource, ImportSummary, Player } from "../../types";

interface Props {
  sources: ImportSource[];
  followedSteamIDs: string[];
  onSourcesChange: (sources: ImportSource[]) => void;
  onImported: () => void;
}

export function ImportView({
  sources,
  followedSteamIDs,
  onSourcesChange,
  onImported,
}: Props) {
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [following, setFollowing] = useState(false);
  const running = starting || summary?.status === "running";
  useEffect(
    () =>
      bridge.onImportProgress((next) => {
        if (!jobId || next.job_id === jobId) {
          setSummary(next);
          if (next.status === "completed") onImported();
        }
      }),
    [jobId, onImported],
  );
  useEffect(() => {
    if (!jobId || !running) return;
    const timer = window.setInterval(
      () =>
        bridge
          .importSummary(jobId)
          .then(setSummary)
          .catch(() => undefined),
      650,
    );
    return () => clearInterval(timer);
  }, [jobId, running]);
  const followedCandidates = useMemo(() => {
    const followed = new Set(followedSteamIDs);
    return (
      summary?.discovered_players.filter(
        (player) => !followed.has(player.steam_id),
      ) ?? []
    );
  }, [summary, followedSteamIDs]);
  async function addSource() {
    try {
      setError("");
      const path = await bridge.chooseDirectory();
      if (path) onSourcesChange(await bridge.addSource(path));
    } catch (value) {
      setError(message(value));
    }
  }
  async function start(paths?: string[]) {
    try {
      setStarting(true);
      setError("");
      setSummary(null);
      const id = paths
        ? await bridge.importFiles(paths)
        : await bridge.scanSources([]);
      setJobId(id);
      setSummary(await bridge.importSummary(id));
    } catch (value) {
      setError(message(value));
    } finally {
      setStarting(false);
    }
  }
  async function chooseFiles() {
    try {
      const files = await bridge.chooseFiles();
      if (files.length) await start(files);
    } catch (value) {
      setError(message(value));
    }
  }
  async function follow() {
    if (!summary || !selected.size) return;
    const players = summary.discovered_players.filter((player) =>
      selected.has(player.steam_id),
    );
    try {
      setFollowing(true);
      setSummary(await bridge.followAndBackfill(summary.job_id, players));
      setSelected(new Set());
      onImported();
    } catch (value) {
      setError(message(value));
    } finally {
      setFollowing(false);
    }
  }
  return (
    <div className="page import-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">素材入口</span>
          <h1>导入 Demo</h1>
          <p>扫描多个素材目录，或直接拖入 DEM 与 ZIP。只处理目录当前层。</p>
        </div>
        <button
          className="primary"
          onClick={() => start()}
          disabled={!sources.length || running}
        >
          {running ? <Spinner /> : <RefreshCw size={17} />}
          {running ? "正在扫描与解析" : "扫描全部来源"}
        </button>
      </header>
      {error && (
        <div className="notice danger">
          <XCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      <div className="import-layout">
        <section className="card source-card">
          <div className="section-heading">
            <div>
              <h2>素材来源</h2>
              <p>{sources.length} 个目录 · 非递归扫描</p>
            </div>
            <button className="quiet" onClick={addSource}>
              <FolderPlus size={17} />
              添加目录
            </button>
          </div>
          <div className="source-list">
            {sources.length ? (
              sources.map((source) => (
                <article className="source-row" key={source.id}>
                  <div className="source-icon">
                    <FileArchive size={19} />
                  </div>
                  <div>
                    <strong>{source.name}</strong>
                    <p title={source.path}>{source.path}</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`移除 ${source.name}`}
                    onClick={() =>
                      bridge.removeSource(source.id).then(onSourcesChange)
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))
            ) : (
              <Empty text="还没有素材来源。添加赛事 Demo 所在目录。" />
            )}
          </div>
        </section>
        <section
          className="card drop-card"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const paths = Array.from(event.dataTransfer.files)
              .map((file) => (file as File & { path?: string }).path)
              .filter(Boolean) as string[];
            if (paths.length) start(paths);
          }}
        >
          <UploadCloud size={30} />
          <h2>手动导入文件</h2>
          <p>支持多个 .dem 或只包含一个 DEM 的 .zip</p>
          <button onClick={chooseFiles}>选择文件</button>
        </section>
      </div>
      {summary && (
        <section className="card result-card">
          <div className="section-heading">
            <div>
              <h2>导入摘要</h2>
              <p>
                {summary.processed} / {summary.total} 已处理
              </p>
            </div>
            {running && (
              <button onClick={() => bridge.cancelImport(summary.job_id)}>
                取消任务
              </button>
            )}
          </div>
          {summary.status === "running" && (
            <div className="import-running-banner">
              <BusyMessage>
                正在解析 Demo（最多同时处理 2 个），已完成 {summary.processed} /{" "}
                {summary.total}
              </BusyMessage>
            </div>
          )}
          <div className="progress-track">
            <span
              style={{
                width: `${summary.total ? (summary.processed / summary.total) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="stat-strip">
            <Stat label="新增" value={summary.imported} tone="success" />
            <Stat label="重复" value={summary.duplicates} />
            <Stat
              label="失败"
              value={summary.failed}
              tone={summary.failed ? "danger" : ""}
            />
            <Stat label="发现玩家" value={summary.discovered_players.length} />
          </div>
          <div className="result-grid">
            <div className="result-list">
              {summary.items.map((item) => (
                <article className="result-row" key={item.path}>
                  {item.status === "failed" ||
                  item.status === "needs_attention" ? (
                    <XCircle className="danger-text" size={18} />
                  ) : item.status === "duplicate" ? (
                    <RefreshCw size={18} />
                  ) : (
                    <CheckCircle2 className="success-text" size={18} />
                  )}
                  <div>
                    <strong>{item.file_name}</strong>
                    <p>
                      {item.message ||
                        `${item.players?.length ?? 0} 名玩家 · 保存 ${item.saved_count} 名关注玩家`}
                    </p>
                  </div>
                  <span className={`status-pill ${item.status}`}>
                    {statusLabel(item.status)}
                  </span>
                </article>
              ))}
            </div>
            <aside className="discovered-panel">
              <h3>本批发现的玩家</h3>
              <p>选择新人后可关注并补写本批数据。</p>
              <div className="player-check-list">
                {followedCandidates.map((player) => (
                  <label key={player.steam_id}>
                    <input
                      type="checkbox"
                      checked={selected.has(player.steam_id)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          event.target.checked
                            ? next.add(player.steam_id)
                            : next.delete(player.steam_id);
                          return next;
                        })
                      }
                    />
                    <span>
                      <strong>{player.name}</strong>
                      <small>{player.steam_id}</small>
                    </span>
                  </label>
                ))}
              </div>
              <button
                className="primary"
                disabled={!selected.size || following}
                onClick={follow}
              >
                {following ? <Spinner /> : <Play size={16} />}
                {following
                  ? "正在补写本批数据"
                  : `关注并补写 ${selected.size || ""}`}
              </button>
            </aside>
          </div>
        </section>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty-inline">{text}</div>;
}
function Stat({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function statusLabel(status: string) {
  return (
    (
      {
        imported: "已导入",
        duplicate: "重复",
        failed: "失败",
        needs_attention: "需处理",
        cancelled: "已取消",
      } as Record<string, string>
    )[status] ?? status
  );
}
function message(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
