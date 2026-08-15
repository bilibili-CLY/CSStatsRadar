import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  CheckCircle2,
  FileArchive,
  FileUp,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  List,
  Play,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { bridge } from "../../bridge";
import { BusyMessage, Spinner } from "../../components/Busy";
import type {
  ImportItem,
  ImportPlayerDetail,
  ImportSource,
  ImportSummary,
} from "../../types";

interface Props {
  sources: ImportSource[];
  followedSteamIDs: string[];
  onSourcesChange: (sources: ImportSource[]) => void;
  onImported: () => void;
}

type ViewMode = "grid" | "list";

export function ImportView({
  sources,
  followedSteamIDs,
  onSourcesChange,
  onImported,
}: Props) {
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [activeItem, setActiveItem] = useState<ImportItem | null>(null);
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [following, setFollowing] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
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

  const followed = useMemo(
    () => new Set(followedSteamIDs),
    [followedSteamIDs],
  );
  const activePlayers = useMemo(
    () => (activeItem ? playerDetails(activeItem) : []),
    [activeItem],
  );

  useEffect(() => {
    if (!activeItem) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !following) setActiveItem(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeItem, following]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const selectedSource = sources.find((source) => source.id === sourceFilter);
    return (summary?.items ?? []).filter((item) => {
      if (
        normalizedQuery &&
        !`${item.file_name} ${item.path} ${item.message ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
        return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (selectedSource && !item.path.startsWith(selectedSource.path))
        return false;
      return true;
    });
  }, [query, sourceFilter, sources, statusFilter, summary]);

  async function addSource() {
    try {
      setError("");
      const path = await bridge.chooseDirectory();
      if (path) onSourcesChange(await bridge.addSource(path));
    } catch (value) {
      setError(message(value));
    }
  }

  async function removeSource(source: ImportSource) {
    try {
      setError("");
      onSourcesChange(await bridge.removeSource(source.id));
      if (sourceFilter === source.id) setSourceFilter("all");
    } catch (value) {
      setError(message(value));
    }
  }

  async function start(paths?: string[]) {
    try {
      setStarting(true);
      setError("");
      setSummary(null);
      setActiveItem(null);
      setSelected(new Set());
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
      setError("");
      const files = await bridge.chooseFiles();
      if (files.length) await start(files);
    } catch (value) {
      setError(message(value));
    }
  }

  async function follow() {
    if (!summary || !activeItem || !selected.size) return;
    const players = activePlayers
      .filter((player) => selected.has(player.steam_id))
      .map(({ name, steam_id }) => ({ name, steam_id }));
    try {
      setFollowing(true);
      setSummary(
        await bridge.followAndBackfill(
          summary.job_id,
          activeItem.path,
          players,
        ),
      );
      setSelected(new Set());
      setActiveItem(null);
      onImported();
    } catch (value) {
      setError(message(value));
    } finally {
      setFollowing(false);
    }
  }

  return (
    <div className="page import-page demo-library-page">
      <header className="page-header import-library-header">
        <div>
          <span className="eyebrow">素材入口</span>
          <h1>本地 Demo 库</h1>
          <p>
            管理本地素材来源并解析 Demo；目录仅扫描当前层，所有数据保存在本机。
          </p>
        </div>
        <div className="import-header-actions">
          <div className="view-switch" aria-label="结果视图">
            <button
              className={viewMode === "grid" ? "active" : ""}
              aria-label="卡片视图"
              aria-pressed={viewMode === "grid"}
              onClick={() => setViewMode("grid")}
            >
              <Grid2X2 size={16} />
            </button>
            <button
              className={viewMode === "list" ? "active" : ""}
              aria-label="列表视图"
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
            >
              <List size={17} />
            </button>
          </div>
          <button className="quiet" onClick={addSource}>
            <FolderPlus size={17} />
            添加 Demo 来源
          </button>
          <button className="quiet" onClick={chooseFiles} disabled={running}>
            <FileUp size={17} />
            选择文件
          </button>
          <button
            className="primary import-scan-button"
            onClick={() => start()}
            disabled={!sources.length || running}
          >
            {running ? <Spinner /> : <RefreshCw size={17} />}
            {running ? "正在扫描" : "扫描并导入"}
          </button>
        </div>
      </header>

      {error && (
        <div className="notice danger">
          <XCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <section className="import-filter-bar" aria-label="筛选 Demo">
        <label className="import-search">
          <Search size={16} />
          <span className="sr-only">搜索 Demo</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="文件名 / 路径 / 解析信息"
          />
        </label>
        <label>
          <span className="sr-only">素材来源</span>
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
          >
            <option value="all">全部来源</option>
            {sources.map((source) => (
              <option value={source.id} key={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">解析状态</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">全部状态</option>
            <option value="imported">已导入</option>
            <option value="duplicate">重复</option>
            <option value="needs_attention">需处理</option>
            <option value="failed">失败</option>
            <option value="cancelled">已取消</option>
          </select>
        </label>
        <span className="import-filter-count">
          显示 {visibleItems.length} / {summary?.items.length ?? 0}
        </span>
      </section>

      <section className="source-manager" aria-labelledby="source-heading">
        <div className="source-manager-heading">
          <div>
            <h2 id="source-heading">素材来源</h2>
            <p>{sources.length} 个目录 · 非递归扫描</p>
          </div>
          <button className="quiet" onClick={addSource}>
            <FolderPlus size={16} />
            添加目录
          </button>
        </div>
        <div className="source-chip-list">
          {sources.length ? (
            sources.map((source) => (
              <article className="source-chip" key={source.id}>
                <span className="source-icon">
                  <FolderOpen size={17} />
                </span>
                <span>
                  <strong>{source.name}</strong>
                  <small title={source.path}>{source.path}</small>
                </span>
                <button
                  className="icon-button"
                  aria-label={`移除 ${source.name}`}
                  onClick={() => removeSource(source)}
                >
                  <Trash2 size={15} />
                </button>
              </article>
            ))
          ) : (
            <p className="source-empty-copy">
              尚未添加目录。你仍可通过“选择文件”直接导入 DEM 或 ZIP。
            </p>
          )}
        </div>
      </section>

      <section
        className="demo-catalog"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const paths = Array.from(event.dataTransfer.files)
            .map((file) => (file as File & { path?: string }).path)
            .filter(Boolean) as string[];
          if (paths.length) start(paths);
        }}
      >
        <div className="demo-catalog-heading">
          <div>
            <h2>最近一次扫描</h2>
            <p>
              {summary
                ? `${summary.processed} / ${summary.total} 个文件已处理`
                : "扫描素材来源后，结果会以卡片形式显示在这里。"}
            </p>
          </div>
          {summary && (
            <div className="catalog-stats" aria-label="导入统计">
              <span>
                新增 <strong>{summary.imported}</strong>
              </span>
              <span>
                重复 <strong>{summary.duplicates}</strong>
              </span>
              <span className={summary.failed ? "danger-text" : ""}>
                失败 <strong>{summary.failed}</strong>
              </span>
            </div>
          )}
        </div>

        {running && summary && (
          <div className="import-progress-panel">
            <BusyMessage>
              正在解析 Demo（最多同时处理 2 个），已完成 {summary.processed} /{" "}
              {summary.total}
            </BusyMessage>
            <div className="progress-track">
              <span
                style={{
                  width: `${summary.total ? (summary.processed / summary.total) * 100 : 0}%`,
                }}
              />
            </div>
            <button onClick={() => bridge.cancelImport(summary.job_id)}>
              取消任务
            </button>
          </div>
        )}

        {visibleItems.length ? (
          <div className={`demo-result-grid ${viewMode}`}>
            {visibleItems.map((item) => (
              <DemoCard
                item={item}
                key={item.path}
                onOpen={() => {
                  setSelected(new Set());
                  setActiveItem(item);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="demo-empty-state">
            <span>
              <UploadCloud size={29} />
            </span>
            <h2>
              {summary?.items.length
                ? "没有符合当前筛选的 Demo"
                : "还没有扫描结果"}
            </h2>
            <p>
              {summary?.items.length
                ? "调整文件名、来源或状态筛选后再试。"
                : "添加素材目录并扫描，或将 DEM / ZIP 文件拖到此处。"}
            </p>
            {!summary?.items.length && (
              <div>
                <button className="primary" onClick={chooseFiles}>
                  <FileUp size={16} />
                  选择文件
                </button>
                <button className="quiet" onClick={addSource}>
                  <FolderPlus size={16} />
                  添加目录
                </button>
              </div>
            )}
          </div>
        )}

        <footer className="catalog-footer">
          <span>共 {summary?.items.length ?? 0} 个 Demo</span>
          <div>
            <button aria-label="上一页" disabled>
              ‹
            </button>
            <span>第 1 / 1 页</span>
            <button aria-label="下一页" disabled>
              ›
            </button>
          </div>
        </footer>
      </section>

      {activeItem && (
        <div
          className="import-player-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !following)
              setActiveItem(null);
          }}
        >
          <section
            className="import-player-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-player-dialog-title"
          >
            <header className="import-dialog-header">
              <div>
                <span className="eyebrow">当前场次</span>
                <h2 id="import-player-dialog-title">{activeItem.file_name}</h2>
                <p>选择需要关注的玩家，仅补写这一场 Demo 的比赛数据。</p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭玩家选择"
                autoFocus
                disabled={following}
                onClick={() => setActiveItem(null)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="import-match-summary">
              <span>
                <small>地图</small>
                <strong>{activeItem.map_name || "未知地图"}</strong>
              </span>
              <span>
                <small>回合</small>
                <strong>{activeItem.rounds || "—"}</strong>
              </span>
              <span>
                <small>参赛玩家</small>
                <strong>{activePlayers.length}</strong>
              </span>
              <span className={`status-pill ${activeItem.status}`}>
                {statusLabel(activeItem.status)}
              </span>
            </div>

            <div className="import-player-heading">
              <div>
                <h3>本场目标玩家</h3>
                <p>点击玩家整行即可选择；已关注玩家仅展示，不会重复补写。</p>
              </div>
              <span>已选 {selected.size} 人</span>
            </div>

            <div className="import-team-grid">
              <TeamPanel
                name="队伍 A"
                tone="blue"
                players={activePlayers.filter((player) => player.team === "A")}
                followed={followed}
                selected={selected}
                setSelected={setSelected}
              />
              <TeamPanel
                name="队伍 B"
                tone="amber"
                players={activePlayers.filter((player) => player.team === "B")}
                followed={followed}
                selected={selected}
                setSelected={setSelected}
              />
            </div>

            <footer className="import-dialog-footer">
              <span>
                {selected.size
                  ? `将关注并补写 ${selected.size} 名玩家`
                  : "选择至少一名未关注玩家"}
              </span>
              <button
                className="primary"
                disabled={!selected.size || following}
                onClick={follow}
              >
                {following ? <Spinner /> : <Play size={16} />}
                {following ? "正在补写" : "关注并补写当前场次"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function DemoCard({ item, onOpen }: { item: ImportItem; onOpen: () => void }) {
  const playerCount = item.players?.length ?? 0;
  const success = item.status === "imported";
  const failed =
    item.status === "failed" || item.status === "needs_attention";
  return (
    <button
      className={`demo-result-card ${item.status}`}
      onClick={onOpen}
      disabled={!playerCount}
      aria-label={`查看 ${item.file_name} 的玩家`}
    >
      <span className="demo-card-header">
        <span className="demo-file-icon">
          <FileArchive size={18} />
        </span>
        <span className="demo-file-title">
          <strong title={item.file_name}>{item.file_name}</strong>
          <small title={item.path}>{parentName(item.path)}</small>
        </span>
        {failed ? (
          <XCircle className="danger-text" size={18} />
        ) : success ? (
          <CheckCircle2 className="success-text" size={18} />
        ) : (
          <RefreshCw size={17} />
        )}
      </span>
      <span className="demo-card-meta">
        <span>
          <Users size={14} /> {playerCount} 名玩家
        </span>
        <span>保存 {item.saved_count} 名</span>
      </span>
      <span className="demo-card-description">
        {item.message ||
          (success ? "解析完成，关注玩家数据已写入资料库。" : "文件已处理。")}
      </span>
      <span className="demo-card-footer">
        <span className={`status-pill ${item.status}`}>
          {statusLabel(item.status)}
        </span>
        <small title={item.path}>{item.path}</small>
      </span>
    </button>
  );
}

function TeamPanel({
  name,
  tone,
  players,
  followed,
  selected,
  setSelected,
}: {
  name: string;
  tone: "blue" | "amber";
  players: ImportPlayerDetail[];
  followed: Set<string>;
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
}) {
  return (
    <section className={`import-team-panel ${tone}`}>
      <header>
        <h3>{name}</h3>
        <span>{players.length} 人</span>
      </header>
      <div>
        {players.map((player) => {
          const isFollowed = followed.has(player.steam_id);
          return (
            <label
              className={`${selected.has(player.steam_id) ? "selected" : ""} ${isFollowed ? "followed" : ""}`}
              key={player.steam_id}
            >
              <input
                type="checkbox"
                disabled={isFollowed}
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
              <span className="import-player-name">
                <strong>{player.name}</strong>
                <small>{player.steam_id}</small>
              </span>
              <span className="import-player-kda">
                K {player.kills} / D {player.deaths} / A {player.assists}
              </span>
              {isFollowed && <small className="followed-label">已关注</small>}
            </label>
          );
        })}
      </div>
    </section>
  );
}

function playerDetails(item: ImportItem): ImportPlayerDetail[] {
  if (item.player_details?.length) return item.player_details;
  const players = item.players ?? [];
  const split = Math.ceil(players.length / 2);
  return players.map((player, index) => ({
    ...player,
    team: index < split ? "A" : "B",
    kills: 0,
    deaths: 0,
    assists: 0,
  }));
}

function parentName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-2) ?? "本地文件";
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
