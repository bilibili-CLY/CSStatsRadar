import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  ChevronRight,
  Layers3,
  Search,
  Star,
  StarOff,
  Tags,
  Video,
} from "lucide-react";
import { bridge } from "../../bridge";
import { BusyMessage, Spinner } from "../../components/Busy";
import type {
  MatchRecord,
  SavedPlayer,
  StudioKind,
  StudioSeed,
} from "../../types";
import { filterMatches, recentMatchIDs } from "./selection";

interface Props {
  players: SavedPlayer[];
  refresh: () => Promise<void>;
  onCreate: (kind: StudioKind, seed: StudioSeed) => void;
}

export function LibraryView({ players, refresh, onCreate }: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SavedPlayer | null>(null);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"recent" | "custom">("recent");
  const [recentN, setRecentN] = useState(5);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [mapFilter, setMapFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [error, setError] = useState("");
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [metadataTime, setMetadataTime] = useState("");
  const [metadataTags, setMetadataTags] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const visiblePlayers = useMemo(
    () =>
      players
        .filter((player) =>
          `${player.name} ${player.steam_id}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .sort((a, b) => Number(b.followed) - Number(a.followed)),
    [players, search],
  );
  const maps = useMemo(
    () =>
      Array.from(
        new Set(matches.map((match) => match.map_name).filter(Boolean)),
      ),
    [matches],
  );
  const filtered = useMemo(
    () => filterMatches(matches, mapFilter, tagFilter),
    [matches, mapFilter, tagFilter],
  );
  const activeIds =
    mode === "recent" ? recentMatchIDs(filtered, recentN) : Array.from(chosen);
  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    setError("");
    bridge
      .getMatches(selected.steam_id)
      .then((values) => {
        setMatches(values);
        setChosen(new Set());
      })
      .catch((value) => setError(String(value)))
      .finally(() => setLoading(false));
  }, [selected]);
  async function create(kind: StudioKind) {
    if (!selected || !activeIds.length) return;
    try {
      setBusyAction(`studio:${kind}`);
      const radar = await bridge.buildRadar(selected.steam_id, activeIds);
      onCreate(kind, { player: selected, matchIds: activeIds, radar });
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusyAction("");
    }
  }
  async function toggleFollow(player: SavedPlayer) {
    try {
      setBusyAction("follow");
      await bridge.setFollowed(
        { name: player.name, steam_id: player.steam_id },
        !player.followed,
      );
      await refresh();
      if (selected?.steam_id === player.steam_id)
        setSelected({ ...player, followed: !player.followed });
    } finally {
      setBusyAction("");
    }
  }
  async function saveMetadata() {
    if (!selected || !chosen.size) return;
    try {
      setBusyAction("metadata");
      setError("");
      const time = metadataTime ? new Date(metadataTime).toISOString() : "";
      const tags = metadataTags
        .split(/[,，]/)
        .map((value) => value.trim())
        .filter(Boolean);
      for (const id of chosen) await bridge.updateMatch(id, time, tags);
      setMatches(await bridge.getMatches(selected.steam_id));
      setMetadataTags("");
      setMetadataOpen(false);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusyAction("");
    }
  }
  async function deleteSelectedMatches() {
    if (
      !selected ||
      !chosen.size ||
      !window.confirm(
        `永久删除已选 ${chosen.size} 场比赛统计？此操作不会取消关注。`,
      )
    )
      return;
    await bridge.deletePlayerMatches(selected.steam_id, Array.from(chosen));
    setMatches(await bridge.getMatches(selected.steam_id).catch(() => []));
    setChosen(new Set());
    await refresh();
  }
  async function deletePlayerData() {
    if (
      !selected ||
      !window.confirm(
        `永久删除 ${selected.name} 的全部比赛统计？关注状态、Demo 目录和媒体会保留。`,
      )
    )
      return;
    await bridge.deletePlayerData(selected.steam_id);
    setSelected(null);
    setMatches([]);
    await refresh();
  }
  function toggleChosen(id: string) {
    setChosen((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  return (
    <div className="page library-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">玩家优先</span>
          <h1>资料库</h1>
          <p>筛选比赛、观察近期表现，然后把选材送入制作器。</p>
        </div>
        <div className="header-stat">
          <strong>{players.length}</strong>
          <span>已保存玩家</span>
        </div>
      </header>
      <div className="library-layout">
        <aside className="card player-browser">
          <div className="search-box">
            <Search size={17} />
            <input
              aria-label="搜索玩家"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="玩家名或 SteamID"
            />
          </div>
          <div className="player-list">
            {visiblePlayers.map((player) => (
              <button
                key={player.steam_id}
                className={`player-item ${selected?.steam_id === player.steam_id ? "active" : ""}`}
                onClick={() => setSelected(player)}
              >
                <span className="avatar">
                  {player.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{player.name}</strong>
                  <small>
                    {player.match_count} 场 ·{" "}
                    {player.followed ? "已关注" : "未关注"}
                  </small>
                </span>
                {player.followed && (
                  <Star size={15} className="followed-icon" />
                )}
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </aside>
        <main className="card match-browser">
          {selected ? (
            <>
              <div className="player-detail-head">
                <div>
                  <span className="avatar large">
                    {selected.name.slice(0, 1)}
                  </span>
                  <div>
                    <h2>{selected.name}</h2>
                    <p>{selected.steam_id}</p>
                  </div>
                </div>
                <button
                  className="quiet"
                  onClick={() => toggleFollow(selected)}
                  disabled={busyAction === "follow"}
                >
                  {busyAction === "follow" ? (
                    <>
                      <Spinner />
                      正在更新
                    </>
                  ) : selected.followed ? (
                    <>
                      <StarOff size={16} />
                      取消关注
                    </>
                  ) : (
                    <>
                      <Star size={16} />
                      关注玩家
                    </>
                  )}
                </button>
              </div>
              <div className="filter-toolbar">
                <div className="segmented">
                  <button
                    className={mode === "recent" ? "active" : ""}
                    onClick={() => setMode("recent")}
                  >
                    最新 N 场
                  </button>
                  <button
                    className={mode === "custom" ? "active" : ""}
                    onClick={() => setMode("custom")}
                  >
                    自定义
                  </button>
                </div>
                {mode === "recent" && (
                  <label className="compact-field">
                    <span>场数</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={recentN}
                      onChange={(event) =>
                        setRecentN(Number(event.target.value))
                      }
                    />
                  </label>
                )}
                <select
                  aria-label="地图筛选"
                  value={mapFilter}
                  onChange={(event) => setMapFilter(event.target.value)}
                >
                  <option value="all">全部地图</option>
                  {maps.map((map) => (
                    <option key={map}>{map}</option>
                  ))}
                </select>
                <div className="search-box compact">
                  <Tags size={16} />
                  <input
                    aria-label="筛选标签"
                    value={tagFilter}
                    onChange={(event) => setTagFilter(event.target.value)}
                    placeholder="筛选标签"
                  />
                </div>
              </div>
              {error && (
                <div className="notice danger" role="alert">
                  {error}
                </div>
              )}
              <div className="match-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{mode === "custom" ? "选择" : ""}</th>
                      <th>比赛时间</th>
                      <th>地图</th>
                      <th>数据</th>
                      <th>标签</th>
                      <th>来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="table-loading-cell">
                          <BusyMessage>正在读取比赛记录…</BusyMessage>
                        </td>
                      </tr>
                    ) : (
                      filtered.map((match, index) => {
                        const active = activeIds.includes(match.demo_record_id);
                        return (
                          <tr
                            key={match.demo_record_id}
                            className={`${active ? "selected" : ""} ${mode === "custom" ? "selectable" : ""}`}
                            tabIndex={mode === "custom" ? 0 : undefined}
                            onClick={() =>
                              mode === "custom" &&
                              toggleChosen(match.demo_record_id)
                            }
                            onKeyDown={(event) => {
                              if (
                                mode === "custom" &&
                                (event.key === "Enter" || event.key === " ")
                              ) {
                                event.preventDefault();
                                toggleChosen(match.demo_record_id);
                              }
                            }}
                          >
                            <td>
                              {mode === "custom" ? (
                                <input
                                  aria-label={`选择 ${match.file_name}`}
                                  type="checkbox"
                                  checked={active}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() =>
                                    toggleChosen(match.demo_record_id)
                                  }
                                />
                              ) : index < recentN ? (
                                <span className="rank-index">{index + 1}</span>
                              ) : null}
                            </td>
                            <td>
                              <strong>
                                {match.match_time_source === "unknown"
                                  ? "比赛时间未知"
                                  : formatDate(match.match_time)}
                              </strong>
                              <small>
                                导入于 {formatDate(match.imported_at)}
                              </small>
                            </td>
                            <td>{match.map_name || "未知地图"}</td>
                            <td>
                              <span className="mono">
                                {match.kills}/{match.deaths}/{match.assists}
                              </span>
                              <small>ADR {number(match.adr)}</small>
                            </td>
                            <td>
                              <div className="tag-list">
                                {match.tags?.map((tag) => (
                                  <span key={tag}>{tag}</span>
                                )) || "—"}
                              </div>
                            </td>
                            <td title={match.source_path}>{match.file_name}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {metadataOpen && (
                <div className="metadata-editor">
                  <label className="field">
                    <span>比赛时间（留空则不修改）</span>
                    <input
                      type="datetime-local"
                      value={metadataTime}
                      onChange={(e) => setMetadataTime(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>标签（逗号分隔，将替换所选比赛标签）</span>
                    <input
                      value={metadataTags}
                      onChange={(e) => setMetadataTags(e.target.value)}
                      placeholder="赛事 A，半决赛"
                    />
                  </label>
                  <button onClick={() => setMetadataOpen(false)}>取消</button>
                  <button
                    className="primary"
                    disabled={busyAction === "metadata"}
                    onClick={saveMetadata}
                  >
                    {busyAction === "metadata" && <Spinner />}
                    {busyAction === "metadata"
                      ? "正在应用"
                      : `应用到 ${chosen.size} 场`}
                  </button>
                </div>
              )}
              <div className="selection-bar">
                <div>
                  <strong>已选 {activeIds.length} 场</strong>
                  <span>
                    {mode === "recent"
                      ? `当前筛选结果的最新 ${Math.min(recentN, filtered.length)} 场`
                      : "手动选择"}
                  </span>
                </div>
                {mode === "custom" && (
                  <>
                    <button
                      onClick={() => setMetadataOpen(true)}
                      disabled={!chosen.size}
                    >
                      <Tags size={17} />
                      时间与标签
                    </button>
                    <button
                      className="danger-action"
                      onClick={deleteSelectedMatches}
                      disabled={!chosen.size}
                    >
                      删除所选
                    </button>
                  </>
                )}
                <button
                  onClick={() => create("radar")}
                  disabled={!activeIds.length || Boolean(busyAction)}
                >
                  {busyAction === "studio:radar" ? (
                    <Spinner />
                  ) : (
                    <CalendarClock size={17} />
                  )}
                  {busyAction === "studio:radar" ? "生成中" : "制作雷达"}
                </button>
                <button
                  onClick={() => create("overlay")}
                  disabled={!activeIds.length || Boolean(busyAction)}
                >
                  {busyAction === "studio:overlay" ? (
                    <Spinner />
                  ) : (
                    <Layers3 size={17} />
                  )}
                  {busyAction === "studio:overlay" ? "加入中" : "加入叠图"}
                </button>
                <button
                  onClick={() => create("showcase")}
                  disabled={!activeIds.length || Boolean(busyAction)}
                >
                  {busyAction === "studio:showcase" ? (
                    <Spinner />
                  ) : (
                    <Video size={17} />
                  )}
                  {busyAction === "studio:showcase" ? "加入中" : "加入轮播"}
                </button>
              </div>
              <button className="text-danger-button" onClick={deletePlayerData}>
                删除该玩家的全部统计
              </button>
            </>
          ) : (
            <div className="empty-state-large">
              <Search size={34} />
              <h2>选择一名玩家</h2>
              <p>查看比赛记录，并以最新 5 场快速生成雷达。</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function number(value: number | null) {
  return value == null ? "—" : value.toFixed(1);
}
