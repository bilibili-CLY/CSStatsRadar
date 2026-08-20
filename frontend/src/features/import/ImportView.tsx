import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
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
import { DemoCard } from "../../components/demo/DemoCard";
import { PlayerAvatarView } from "../../components/PlayerAvatar";
import { useAppStore } from "../../stores/appStore";
import { claimCompletedImport } from "./completion";
import type {
  DemoRecord,
  DemoAnalysis,
  ImportItem,
  ImportPlayerDetail,
  ImportSource,
  ImportSummary,
} from "../../types";

interface Props {
  followedSteamIDs: string[];
}

type ViewMode = "grid" | "list";

export function ImportView({ followedSteamIDs }: Props) {
  const demos = useAppStore((state) => state.demos);
  const sources = useAppStore((state) => state.sources);
  const setDemos = useAppStore((state) => state.setDemos);
  const setImportSources = useAppStore((state) => state.setImportSources);
  const refreshPlayers = useAppStore((state) => state.refreshPlayers);
  const navigate = useNavigate();
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [activeItem, setActiveItem] = useState<ImportItem | null>(null);
  const [activeDemo, setActiveDemo] = useState<DemoRecord | null>(null);
  const [activeAnalysis, setActiveAnalysis] = useState<DemoAnalysis | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedDemos, setSelectedDemos] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [following, setFollowing] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const jobIdRef = useRef("");
  const finalizedJobs = useRef(new Set<string>());
  const running = starting || summary?.status === "running";

  useEffect(
    () =>
      bridge.onImportProgress((next) => {
        if (next.job_id === jobIdRef.current) setSummary(next);
      }),
    [],
  );

  useEffect(() => {
    if (!claimCompletedImport(finalizedJobs.current, summary)) return;
    Promise.all([refreshPlayers(), bridge.listDemos().then(setDemos)]).catch((value) => setError(message(value)));
  }, [summary?.job_id, summary?.status]);

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
  const activePlayers = useMemo(() => activeItem ? playerDetails(activeItem) : activeDemo ? persistentPlayerDetails(activeDemo, activeAnalysis) : [], [activeItem, activeDemo, activeAnalysis]);

  useEffect(() => {
    if (!activeDemo) { setActiveAnalysis(null); return; }
    setDialogError("");
    bridge.getDemoAnalysis(activeDemo.demo_record_id).then(setActiveAnalysis).catch((value) => setDialogError(message(value)));
  }, [activeDemo]);

  useEffect(() => {
    if (!activeItem && !activeDemo) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !following) { setActiveItem(null); setActiveDemo(null); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeItem, activeDemo, following]);

  useEffect(() => {
    const available = new Set(demos.map((demo) => demo.demo_record_id));
    setSelectedDemos((current) => {
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [demos]);

  useEffect(() => {
    if (!pendingDelete.length) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) setPendingDelete([]);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingDelete.length, deleting]);

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

  const visibleDemos = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const selectedSource = sources.find((source) => source.id === sourceFilter);
    if (statusFilter !== "all" && statusFilter !== "imported") return [];
    return demos.filter((demo) => {
      if (normalizedQuery && !`${demo.file_name} ${demo.map_name} ${demo.source_path ?? ""} ${demo.note ?? ""}`.toLocaleLowerCase().includes(normalizedQuery)) return false;
      if (selectedSource && !demo.source_path?.startsWith(selectedSource.path)) return false;
      return true;
    });
  }, [demos, query, sourceFilter, sources, statusFilter]);

  async function addSource() {
    try {
      setError("");
      const path = await bridge.chooseDirectory();
      if (path) setImportSources(await bridge.addSource(path));
    } catch (value) {
      setError(message(value));
    }
  }

  async function removeSource(source: ImportSource) {
    try {
      setError("");
      setImportSources(await bridge.removeSource(source.id));
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
      jobIdRef.current = id;
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
    if ((!summary || !activeItem) && !activeDemo || !selected.size) return;
    const players = activePlayers
      .filter((player) => selected.has(player.steam_id))
      .map(({ name, steam_id }) => ({ name, steam_id }));
    try {
      setFollowing(true);
      if (activeDemo) await bridge.followDemoPlayers(activeDemo.demo_record_id, players.map((player) => player.steam_id));
      else if (summary && activeItem) setSummary(await bridge.followAndBackfill(summary.job_id, activeItem.path, players));
      setSelected(new Set());
      setActiveItem(null);
      setActiveDemo(null);
      await refreshDemos();
      refreshPlayers();
    } catch (value) {
      setError(message(value));
    } finally {
      setFollowing(false);
    }
  }

  async function relocateAndFollow() {
    if (!activeDemo) return;
    const ids = Array.from(selected);
    try {
      setFollowing(true); setDialogError("");
      const analysis = await bridge.chooseReplacementDemo(activeDemo.demo_record_id);
      setActiveAnalysis(analysis);
      await bridge.followDemoPlayers(activeDemo.demo_record_id, ids);
      setSelected(new Set()); setActiveDemo(null); await refreshDemos(); refreshPlayers();
    } catch (value) { setDialogError(message(value)); }
    finally { setFollowing(false); }
  }

  async function refreshDemos() { setDemos(await bridge.listDemos()); }
  async function confirmDeleteDemos() {
    if (!pendingDelete.length || deleting) return;
    try {
      setDeleting(true);
      setError("");
      await bridge.deleteDemos(pendingDelete);
      const nextDemos = await bridge.listDemos();
      setDemos(nextDemos);
      setSelectedDemos(new Set());
      setPendingDelete([]);
      refreshPlayers();
    } catch (value) {
      setError(message(value));
    } finally {
      setDeleting(false);
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
          显示 {visibleDemos.length} / {demos.length}
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

      {summary && <section className="import-task-summary card" aria-label="本次导入结果">
        <div><strong>本次任务</strong><span>{summary.processed}/{summary.total} 已处理</span></div>
        <div className="catalog-stats"><span>新增 <strong>{summary.imported}</strong></span><span>重复 <strong>{summary.duplicates}</strong></span><span className={summary.failed ? "danger-text" : ""}>失败 <strong>{summary.failed}</strong></span></div>

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

        {!!visibleItems.filter((item) => item.status !== "imported").length && <div className="import-task-items">{visibleItems.filter((item) => item.status !== "imported").map((item) => <ImportTaskCard item={item} key={item.path} onOpen={() => { setSelected(new Set()); setActiveItem(item); }}/>)}</div>}
      </section>}

      <section className="demo-catalog" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const paths = Array.from(event.dataTransfer.files).map((file) => (file as File & { path?: string }).path).filter(Boolean) as string[]; if (paths.length) start(paths); }}>
        <div className="demo-catalog-heading"><div><h2>比赛目录</h2><p>成功解析的 Demo 会跨页面和重启保留。</p></div><div className="catalog-bulk-actions"><label><input type="checkbox" checked={visibleDemos.length > 0 && visibleDemos.every((demo) => selectedDemos.has(demo.demo_record_id))} onChange={(event) => setSelectedDemos(event.target.checked ? new Set(visibleDemos.map((demo) => demo.demo_record_id)) : new Set())}/>全选当前</label><button className="danger-action" disabled={!selectedDemos.size || deleting} onClick={() => setPendingDelete(Array.from(selectedDemos))}><Trash2 size={15}/>删除所选 ({selectedDemos.size})</button></div></div>
	        <div className="demo-catalog-content">{visibleDemos.length ? <div className={`demo-record-grid ${viewMode}`}>{visibleDemos.map((demo) => <DemoCard key={demo.demo_record_id} demo={demo} variant="catalog" selected={selectedDemos.has(demo.demo_record_id)} onSelected={(checked) => setSelectedDemos((current) => { const next = new Set(current); checked ? next.add(demo.demo_record_id) : next.delete(demo.demo_record_id); return next; })} editableNote onSavedNote={refreshDemos} footer={<><button onClick={() => { setSelected(new Set()); setActiveDemo(demo); }}>玩家</button><button onClick={() => navigate(`/analysis/${demo.demo_record_id}`)}><Play size={15}/>{demo.analysis_ready ? "分析" : "打开时补解析"}</button><button className="icon-button danger-action" aria-label={`删除 ${demo.file_name}`} onClick={() => setPendingDelete([demo.demo_record_id])}><Trash2 size={15}/></button></>}/>)}</div> : <div className="demo-empty-state"><span><UploadCloud size={29}/></span><h2>{demos.length ? "没有符合当前筛选的 Demo" : "还没有比赛记录"}</h2><p>{demos.length ? "调整文件名、来源或状态筛选后再试。" : "添加素材目录并扫描，或将 DEM / ZIP 文件拖到此处。"}</p>{!demos.length && <div><button className="primary" onClick={chooseFiles}><FileUp size={16}/>选择文件</button><button className="quiet" onClick={addSource}><FolderPlus size={16}/>添加目录</button></div>}</div>}</div>
	        <footer className="catalog-footer"><span>显示 {visibleDemos.length} / {demos.length} 个 Demo</span></footer>
      </section>

      {!!pendingDelete.length && <div className="confirm-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !deleting) setPendingDelete([]); }}>
        <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-demo-title" aria-describedby="delete-demo-description">
          <span className="confirm-danger-icon"><Trash2 size={20}/></span>
          <div><h2 id="delete-demo-title">删除 {pendingDelete.length} 场比赛？</h2><p id="delete-demo-description">将删除比赛记录、分析数据和该场玩家统计。关注关系、玩家资料、头像和制作素材会保留。</p></div>
          <footer><button autoFocus disabled={deleting} onClick={() => setPendingDelete([])}>取消</button><button className="danger-action" disabled={deleting} onClick={confirmDeleteDemos}>{deleting ? <Spinner/> : <Trash2 size={15}/>} {deleting ? "正在删除" : "确认删除"}</button></footer>
        </section>
      </div>}

      {(activeItem || activeDemo) && (
        <div
          className="import-player-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !following) { setActiveItem(null); setActiveDemo(null); }
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
                <h2 id="import-player-dialog-title">{activeItem?.file_name ?? activeDemo?.file_name}</h2>
                <p>选择需要关注的玩家，仅补写这一场 Demo 的比赛数据。</p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭玩家选择"
                autoFocus
                disabled={following}
                onClick={() => { setActiveItem(null); setActiveDemo(null); }}
              >
                <X size={18} />
              </button>
            </header>

            <div className="import-match-summary">
              <span>
                <small>地图</small>
                <strong>{activeItem?.map_name || activeDemo?.map_name || "未知地图"}</strong>
              </span>
              <span>
                <small>回合</small>
                <strong>{activeItem?.rounds || activeDemo?.rounds || "—"}</strong>
              </span>
              <span>
                <small>参赛玩家</small>
                <strong>{activePlayers.length}</strong>
              </span>
              <span className={`status-pill ${activeItem?.status ?? "imported"}`}>
                {activeItem ? statusLabel(activeItem.status) : "已入库"}
              </span>
            </div>

            {dialogError && <div className="notice danger" role="alert"><span>{dialogError}</span>{activeDemo && <button onClick={relocateAndFollow} disabled={following || !selected.size}>重新定位并继续</button>}</div>}

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

function persistentPlayerDetails(demo: DemoRecord, analysis: DemoAnalysis | null): ImportPlayerDetail[] {
  if (!analysis) return playerDetails({ players: demo.participants ?? [] } as ImportItem);
  return analysis.players.map((entry) => ({
    ...entry.player,
    team: entry.team_id,
    kills: entry.rounds.reduce((sum, round) => sum + round.kills, 0),
    deaths: entry.rounds.reduce((sum, round) => sum + round.deaths, 0),
    assists: entry.rounds.reduce((sum, round) => sum + round.assists, 0),
  }));
}

function ImportTaskCard({ item, onOpen }: { item: ImportItem; onOpen: () => void }) {
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
              <PlayerAvatarView name={player.name} steamId={player.steam_id}/>
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
