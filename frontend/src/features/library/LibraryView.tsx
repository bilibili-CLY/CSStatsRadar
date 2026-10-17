import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Eraser,
  Layers3,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  StarOff,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { bridge } from "../../bridge";
import { BusyMessage, Spinner } from "../../components/Busy";
import { PlayerAvatarView, applyAvatar } from "../../components/PlayerAvatar";
import { useAppStore } from "../../stores/appStore";
import { useStudioStore } from "../../stores/studioStore";
import { saveSeedToDraft, studioToastLabels } from "../studio/draftMutations";
import type {
  MatchGroup,
  MatchRecord,
  SavedPlayer,
  StudioKind,
  StudioSeed,
} from "../../types";
import {
  filterMatches,
  playersWithStats,
  recentMatchIDs,
  sortGroupMatches,
  sortPlayers,
  type MatchGroupSort,
  type PlayerSort,
} from "./selection";

export function LibraryView() {
  const players = useAppStore((state) => state.players);
  const refreshPlayers = useAppStore((state) => state.refreshPlayers);
  const [search, setSearch] = useState("");
  const [playerSort, setPlayerSort] = useState<PlayerSort>("latest_imported");
  const [selected, setSelected] = useState<SavedPlayer | null>(null);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"recent" | "custom">("recent");
  const [recentN, setRecentN] = useState(5);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [mapFilter, setMapFilter] = useState("all");
  const [groupView, setGroupView] = useState<"all" | "grouped">("all");
  const [groups, setGroups] = useState<MatchGroup[]>([]);
  const [groupSort, setGroupSort] = useState<MatchGroupSort>("time_desc");
  const [newGroupName, setNewGroupName] = useState("");
  const [renaming, setRenaming] = useState<{
    id: number;
    value: string;
  } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragOver, setDragOver] = useState<number | "ungrouped" | null>(null);
  const draggingDemo = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [bulkProgress, setBulkProgress] = useState<{ processed: number; total: number } | null>(null);
  const [menu, setMenu] = useState<{
    player: SavedPlayer;
    x: number;
    y: number;
  } | null>(null);
  const visiblePlayers = useMemo(
    () =>
      sortPlayers(players
        .filter((player) =>
          `${player.name} ${player.steam_id}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        ), playerSort),
    [players, search, playerSort],
  );
  const maps = useMemo(
    () =>
      Array.from(
        new Set(matches.map((match) => match.map_name).filter(Boolean)),
      ),
    [matches],
  );
  const filtered = useMemo(
    () => filterMatches(matches, mapFilter, ""),
    [matches, mapFilter],
  );
  const grouped = useMemo(() => {
    const assigned = new Set(groups.flatMap((group) => group.demo_ids));
    const ungroupedMatches = sortGroupMatches(
      filtered.filter((match) => !assigned.has(match.demo_record_id)),
      groupSort,
    );
    const blocks = groups.map((group) => ({
      group,
      matches: sortGroupMatches(
        filtered.filter((match) => group.demo_ids.includes(match.demo_record_id)),
        groupSort,
      ),
    }));
    return { ungroupedMatches, blocks };
  }, [filtered, groups, groupSort]);
  const activeIds =
    groupView === "grouped"
      ? Array.from(chosen)
      : mode === "recent"
        ? recentMatchIDs(filtered, recentN)
        : Array.from(chosen);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      bridge.getMatches(selected.steam_id),
      bridge.matchGroups(selected.steam_id),
    ])
      .then(([values, groupValues]) => {
        if (cancelled) return;
        setMatches(values);
        setGroups(groupValues);
        setChosen(new Set());
      })
      .catch((value) => {
        if (!cancelled) setError(String(value));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  async function create(kind: StudioKind) {
    if (!selected || !activeIds.length) return;
    try {
      setBusyAction(`studio:${kind}`);
      const radar = await bridge.buildRadar(selected.steam_id, activeIds);
      const seed: StudioSeed = { player: selected, matchIds: activeIds, radar };
      await saveSeedToDraft(kind, seed, useAppStore.getState().config);
      useStudioStore.getState().setSeed(seed);
      useAppStore.getState().showToast(`${studioToastLabels[kind]}：${selected.name}`);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusyAction("");
    }
  }
  async function addAllToShowcase() {
    const targets = playersWithStats(sortPlayers(players, playerSort));
    if (!targets.length) return;
    const failures: string[] = [];
    let completed = 0;
    let lastSeed: StudioSeed | null = null;
    try {
      setBusyAction("studio:showcase-all");
      setError("");
      setBulkProgress({ processed: 0, total: targets.length });
      for (const [index, player] of targets.entries()) {
        try {
          const playerMatches = await bridge.getMatches(player.steam_id);
          const matchIds = playerMatches.map((match) => match.demo_record_id);
          if (!matchIds.length) continue;
          const radar = await bridge.buildRadar(player.steam_id, matchIds);
          const seed: StudioSeed = { player, matchIds, radar };
          await saveSeedToDraft("showcase", seed, useAppStore.getState().config);
          lastSeed = seed;
          completed += 1;
        } catch {
          failures.push(player.name);
        }
        setBulkProgress({ processed: index + 1, total: targets.length });
      }
      if (lastSeed) useStudioStore.getState().setSeed(lastSeed);
      if (completed)
        useAppStore.getState().showToast(
          failures.length
            ? `已加入轮播：${completed} 名玩家；${failures.length} 名未完成`
            : `已加入轮播：${completed} 名玩家`,
        );
      if (failures.length)
        setError(`未能加入轮播：${failures.join("、")}`);
      else if (!completed)
        setError("没有可用于生成轮播的比赛统计。");
    } finally {
      setBusyAction("");
      setBulkProgress(null);
    }
  }
  async function cleanTeamPrefixes() {
    const confirmed = await useAppStore.getState().showConfirm({
      title: "清洗战队前缀",
      message:
        "按「战队名 玩家名」规则清洗资料库中带前缀的玩家名？将逐个重解析最近最多 3 场比赛确定战队前缀，无法确定前缀的玩家会跳过并列出原因。",
      confirmLabel: "开始清洗",
      danger: true,
    });
    if (!confirmed) return;
    try {
      setBusyAction("clean:prefix");
      setError("");
      const results = await bridge.cleanTeamPrefixNames();
      const renamed = results.filter((item) => item.status === "renamed");
      const skipped = results.filter(
        (item) => item.status === "skipped" || item.status === "failed",
      );
      await refreshPlayers();
      useAppStore
        .getState()
        .showToast(
          renamed.length
            ? `已清洗 ${renamed.length} 个玩家名${skipped.length ? `；${skipped.length} 个跳过` : ""}`
            : "没有玩家名被清洗（未匹配到战队前缀）。",
        );
      if (skipped.length) {
        const reasons = skipped
          .slice(0, 5)
          .map((item) => `${item.old_name}：${item.reason}`);
        setError(
          `未清洗 ${skipped.length} 个：${reasons.join("；")}${
            skipped.length > 5 ? " 等" : ""
          }`,
        );
      }
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
      await refreshPlayers();
      if (selected?.steam_id === player.steam_id)
        setSelected({ ...player, followed: !player.followed });
    } finally {
      setBusyAction("");
    }
  }
  async function deleteSelectedMatches() {
    if (!selected || !chosen.size) return;
    const confirmed = await useAppStore.getState().showConfirm({
      title: "删除比赛统计",
      message: `永久删除已选 ${chosen.size} 场比赛统计？此操作不会取消关注。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!confirmed) return;
    await bridge.deletePlayerMatches(selected.steam_id, Array.from(chosen));
    setMatches(await bridge.getMatches(selected.steam_id).catch(() => []));
    setChosen(new Set());
    refreshGroups(selected.steam_id);
    await refreshPlayers();
  }
  async function deletePlayerData() {
    if (!selected) return;
    const confirmed = await useAppStore.getState().showConfirm({
      title: "删除玩家资历",
      message: `永久删除 ${selected.name} 的全部比赛统计？关注状态、Demo 目录和媒体会保留。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!confirmed) return;
    await bridge.deletePlayerData(selected.steam_id);
    setSelected(null);
    setMatches([]);
    setGroups([]);
    await refreshPlayers();
  }
  function toggleChosen(id: string) {
    setChosen((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function refreshGroups(steamId: string) {
    setGroups(await bridge.matchGroups(steamId).catch(() => []));
  }
  async function handleCreateGroup() {
    if (!selected) return;
    const name = newGroupName.trim();
    if (!name) return;
    try {
      setBusyAction("group");
      const group = await bridge.createMatchGroup(selected.steam_id, name);
      setGroups((current) => [...current, group]);
      setNewGroupName("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusyAction("");
    }
  }
  function beginRename(group: MatchGroup) {
    setRenaming({ id: group.id, value: group.name });
  }
  async function saveRename(group: MatchGroup) {
    const value = renaming?.value.trim() ?? "";
    setRenaming(null);
    if (!value || value === group.name) return;
    try {
      setBusyAction("group");
      await bridge.renameMatchGroup(group.id, value);
      setGroups((current) =>
        current.map((entry) =>
          entry.id === group.id ? { ...entry, name: value } : entry,
        ),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction("");
    }
  }
  async function handleDeleteGroup(group: MatchGroup) {
    const confirmed = await useAppStore.getState().showConfirm({
      title: "删除分组",
      message: `删除分组「${group.name}」？组内已归类的比赛会回到未分组。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!confirmed) return;
    try {
      setBusyAction("group");
      await bridge.deleteMatchGroup(group.id);
      setGroups((current) => current.filter((entry) => entry.id !== group.id));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusyAction("");
    }
  }
  function toggleCollapsed(key: string) {
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  }
  function startDrag(match: MatchRecord) {
    draggingDemo.current = match.demo_record_id;
  }
  function endDrag() {
    draggingDemo.current = null;
    setDragOver(null);
  }
  async function handleDrop(groupId: number | null) {
    const demoId = draggingDemo.current;
    setDragOver(null);
    draggingDemo.current = null;
    if (!demoId || !selected) return;
    try {
      setBusyAction("group");
      await bridge.assignMatchGroup(selected.steam_id, demoId, groupId);
      setGroups((current) =>
        current.map((group) => {
          if (group.id === groupId && !group.demo_ids.includes(demoId))
            return { ...group, demo_ids: [...group.demo_ids, demoId] };
          if (group.demo_ids.includes(demoId))
            return {
              ...group,
              demo_ids: group.demo_ids.filter((id) => id !== demoId),
            };
          return group;
        }),
      );
      setError("");
    } catch (value) {
      draggingDemo.current = demoId;
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusyAction("");
    }
  }
  async function refreshAvatarFromMenu(player: SavedPlayer) {
    setMenu(null);
    try {
      setBusyAction("avatar");
      const values = await bridge.refreshPlayerAvatars([player.steam_id]);
      const avatar = values[0];
      if (avatar) applyAvatar(avatar);
      useAppStore.getState().showToast(
        avatar?.status === "ready"
          ? `已刷新头像：${player.name}`
          : `头像刷新失败：${player.name}（详见 ~/.csplayerstatsradar/logs/avatars.log）`,
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusyAction("");
    }
  }
  async function renamePlayerFromMenu(player: SavedPlayer) {
    setMenu(null);
    const input = await useAppStore.getState().showPrompt({
      title: "修改名称",
      message: "为该玩家设置新的显示名称。",
      inputLabel: "名称",
      initialValue: player.name,
      confirmLabel: "保存",
    });
    if (input === null) return;
    const name = input.trim();
    if (!name) {
      useAppStore.getState().showToast("名称不能为空。");
      return;
    }
    try {
      setBusyAction("rename");
      await bridge.renamePlayer(player.steam_id, name);
      await refreshPlayers();
      if (selected?.steam_id === player.steam_id)
        setSelected({ ...player, name });
      useAppStore
        .getState()
        .showToast(`已改名：${player.name} → ${name}`);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusyAction("");
    }
  }
  async function deletePlayerFromMenu(player: SavedPlayer) {
    setMenu(null);
    const confirmed = await useAppStore.getState().showConfirm({
      title: "删除玩家资历",
      message: `永久删除 ${player.name} 的全部比赛统计？关注状态、Demo 目录和媒体会保留。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await bridge.deletePlayerData(player.steam_id);
      if (selected?.steam_id === player.steam_id) {
        setSelected(null);
        setMatches([]);
        setGroups([]);
      }
      await refreshPlayers();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }
  function matchRow(
    match: MatchRecord,
    options: { selectable: boolean; rankIndex?: number },
  ) {
    const active = activeIds.includes(match.demo_record_id);
    const selectable = options.selectable;
    return (
      <tr
        key={match.demo_record_id}
        className={`${active ? "selected" : ""} ${selectable ? "selectable" : ""} ${groupView === "grouped" ? "draggable-row" : ""}`}
        tabIndex={selectable ? 0 : undefined}
        draggable={groupView === "grouped"}
        onDragStart={(event) => {
          if (groupView !== "grouped") return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", match.demo_record_id);
          startDrag(match);
        }}
        onDragEnd={endDrag}
        onClick={() => selectable && toggleChosen(match.demo_record_id)}
        onKeyDown={(event) => {
          if (selectable && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            toggleChosen(match.demo_record_id);
          }
        }}
      >
        <td>
          {selectable ? (
            <input
              aria-label={`选择 ${match.file_name}`}
              type="checkbox"
              checked={active}
              onClick={(event) => event.stopPropagation()}
              onChange={() => toggleChosen(match.demo_record_id)}
            />
          ) : options.rankIndex != null && options.rankIndex < recentN ? (
            <span className="rank-index">{options.rankIndex + 1}</span>
          ) : null}
        </td>
        <td>
          <strong>
            {match.match_time_source === "unknown"
              ? "比赛时间未知"
              : formatDate(match.match_time)}
          </strong>
          <small>导入于 {formatDate(match.imported_at)}</small>
        </td>
        <td>{match.map_name || "未知地图"}</td>
        <td>
          <span className="mono">
            {match.kills}/{match.deaths}/{match.assists}
          </span>
          <small>ADR {number(match.adr)}</small>
        </td>
        <td title={match.source_path}>{match.file_name}</td>
      </tr>
    );
  }
  return (
    <div className="page library-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">玩家优先</span>
          <h1>资料库</h1>
          <p>筛选比赛、观察近期表现，然后把选材送入制作器。</p>
        </div>
        <div className="library-header-actions">
          <div className="header-stat">
            <strong>{players.length}</strong>
            <span>已保存玩家</span>
          </div>
          <button
            className="quiet"
            onClick={addAllToShowcase}
            disabled={!playersWithStats(players).length || Boolean(busyAction)}
            aria-label="将所有有比赛统计的玩家加入轮播"
          >
            {busyAction === "studio:showcase-all" ? <Spinner /> : <Video size={17} />}
            {busyAction === "studio:showcase-all"
              ? `正在加入 ${bulkProgress?.processed ?? 0}/${bulkProgress?.total ?? 0}`
              : "全部加入轮播"}
          </button>
          <button
            className="quiet"
            onClick={cleanTeamPrefixes}
            disabled={!players.length || Boolean(busyAction)}
            aria-label="按战队名前缀清洗玩家名"
          >
            {busyAction === "clean:prefix" ? <Spinner /> : <Eraser size={17} />}
            {busyAction === "clean:prefix" ? "正在清洗" : "清洗战队前缀"}
          </button>
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
          <label className="player-sort">
            <span>排序</span>
            <select
              aria-label="玩家排序"
              value={playerSort}
              onChange={(event) => setPlayerSort(event.target.value as PlayerSort)}
            >
              <option value="latest_imported">最新导入</option>
              <option value="match_count_asc">场次升序</option>
              <option value="match_count_desc">场次降序</option>
            </select>
          </label>
          <div className="player-list">
            {visiblePlayers.map((player) => (
              <button
                key={player.steam_id}
                className={`player-item ${selected?.steam_id === player.steam_id ? "active" : ""}`}
                onClick={() => setSelected(player)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ player, x: event.clientX, y: event.clientY });
                }}
              >
                <PlayerAvatarView name={player.name} steamId={player.steam_id}/>
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
                  <PlayerAvatarView name={selected.name} steamId={selected.steam_id} large/>
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
                    className={groupView === "all" ? "active" : ""}
                    onClick={() => setGroupView("all")}
                  >
                    全部场次
                  </button>
                  <button
                    className={groupView === "grouped" ? "active" : ""}
                    onClick={() => setGroupView("grouped")}
                  >
                    分组
                  </button>
                </div>
                {groupView === "all" && (
                  <>
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
                  </>
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
              </div>
              {groupView === "grouped" && (
                <div className="group-toolbar">
                  <label className="compact-field">
                    <span>组内排序</span>
                    <select
                      aria-label="组内排序"
                      value={groupSort}
                      onChange={(event) =>
                        setGroupSort(event.target.value as MatchGroupSort)
                      }
                    >
                      <option value="time_desc">时间最新</option>
                      <option value="time_asc">时间最早</option>
                      <option value="kills">击杀 Kills</option>
                      <option value="adr">ADR</option>
                      <option value="rating">Rating</option>
                    </select>
                  </label>
                  <form
                    className="new-group-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleCreateGroup();
                    }}
                  >
                    <input
                      value={newGroupName}
                      onChange={(event) => setNewGroupName(event.target.value)}
                      placeholder="新建分组名称"
                      aria-label="新建分组名称"
                    />
                    <button
                      type="submit"
                      disabled={!newGroupName.trim() || Boolean(busyAction)}
                    >
                      {busyAction === "group" ? <Spinner /> : <Plus size={16} />}
                      新建分组
                    </button>
                  </form>
                </div>
              )}
              {error && (
                <div className="notice danger" role="alert">
                  {error}
                </div>
              )}
              {groupView === "grouped" ? (
                <div className="match-groups">
                  {loading ? (
                    <BusyMessage>正在读取比赛记录…</BusyMessage>
                  ) : (
                    <>
                      <section
                        className={`match-group-block ${dragOver === "ungrouped" ? "drag-over" : ""}`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDragOver("ungrouped");
                        }}
                        onDragLeave={(event) => {
                          const related = event.relatedTarget as Node | null;
                          if (related && event.currentTarget.contains(related)) return;
                          setDragOver((current) =>
                            current === "ungrouped" ? null : current,
                          );
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleDrop(null);
                        }}
                      >
                        <header
                          className={`match-group-header ${collapsed["ungrouped"] ? "collapsed" : ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleCollapsed("ungrouped")}
                          onKeyDown={(event) => {
                            if (
                              event.target === event.currentTarget &&
                              (event.key === "Enter" || event.key === " ")
                            ) {
                              event.preventDefault();
                              toggleCollapsed("ungrouped");
                            }
                          }}
                        >
                          <ChevronDown size={15} className="chevron" />
                          <strong>未分组</strong>
                          <span className="match-group-count">
                            {grouped.ungroupedMatches.length} 场
                          </span>
                          <span className="match-group-hint">
                            拖入场次移出分组
                          </span>
                        </header>
                        {!collapsed["ungrouped"] && (
                          <div className="match-group-body">
                            {grouped.ungroupedMatches.length === 0 ? (
                              <p className="match-group-empty">暂无未分组比赛</p>
                            ) : (
                              <table className="data-table">
                                <thead>
                                  <tr>
                                    <th>选择</th>
                                    <th>比赛时间</th>
                                    <th>地图</th>
                                    <th>数据</th>
                                    <th>来源</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {grouped.ungroupedMatches.map((match) =>
                                    matchRow(match, { selectable: true }),
                                  )}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </section>
                      {grouped.blocks.map(({ group, matches: blockMatches }) => {
                        const key = String(group.id);
                        const isCollapsed = Boolean(collapsed[key]);
                        return (
                          <section
                            key={key}
                            className={`match-group-block ${dragOver === group.id ? "drag-over" : ""}`}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              setDragOver(group.id);
                            }}
                            onDragLeave={(event) => {
                              const related = event.relatedTarget as Node | null;
                              if (related && event.currentTarget.contains(related)) return;
                              setDragOver((current) =>
                                current === group.id ? null : current,
                              );
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              handleDrop(group.id);
                            }}
                          >
                            <header
                              className={`match-group-header ${isCollapsed ? "collapsed" : ""}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleCollapsed(key)}
                              onKeyDown={(event) => {
                                if (
                                  event.target === event.currentTarget &&
                                  (event.key === "Enter" || event.key === " ")
                                ) {
                                  event.preventDefault();
                                  toggleCollapsed(key);
                                }
                              }}
                            >
                              <ChevronDown size={15} className="chevron" />
                              {renaming?.id === group.id ? (
                                <span
                                  className="match-group-rename"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <input
                                    autoFocus
                                    value={renaming.value}
                                    onChange={(event) =>
                                      setRenaming({
                                        id: group.id,
                                        value: event.target.value,
                                      })
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") saveRename(group);
                                      if (event.key === "Escape")
                                        setRenaming(null);
                                    }}
                                    onBlur={() => saveRename(group)}
                                    aria-label={`重命名分组 ${group.name}`}
                                  />
                                  <button
                                    className="group-header-button"
                                    onClick={() => setRenaming(null)}
                                    aria-label="取消重命名"
                                  >
                                    <X size={14} />
                                  </button>
                                </span>
                              ) : (
                                <>
                                  <strong>{group.name}</strong>
                                  <span className="match-group-count">
                                    {blockMatches.length} 场
                                  </span>
                                  <button
                                    className="group-header-button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      beginRename(group);
                                    }}
                                    aria-label={`重命名 ${group.name}`}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    className="group-header-button danger"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleDeleteGroup(group);
                                    }}
                                    aria-label={`删除分组 ${group.name}`}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </header>
                            {!isCollapsed && (
                              <div className="match-group-body">
                                {blockMatches.length === 0 ? (
                                  <p className="match-group-empty">
                                    暂无比赛，拖入场次到这里
                                  </p>
                                ) : (
                                  <table className="data-table">
                                    <thead>
                                      <tr>
                                        <th>选择</th>
                                        <th>比赛时间</th>
                                        <th>地图</th>
                                        <th>数据</th>
                                        <th>来源</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {blockMatches.map((match) =>
                                        matchRow(match, { selectable: true }),
                                      )}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </>
                  )}
                </div>
              ) : (
                <div className="match-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{mode === "custom" ? "选择" : ""}</th>
                        <th>比赛时间</th>
                        <th>地图</th>
                        <th>数据</th>
                        <th>来源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={5} className="table-loading-cell">
                            <BusyMessage>正在读取比赛记录…</BusyMessage>
                          </td>
                        </tr>
                      ) : (
                        filtered.map((match, index) =>
                          matchRow(match, {
                            selectable: mode === "custom",
                            rankIndex: index,
                          }),
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="selection-bar">
                <div>
                  <strong>已选 {activeIds.length} 场</strong>
                  <span>
                    {groupView === "grouped"
                      ? "手动选择，可拖拽归组"
                      : mode === "recent"
                        ? `当前筛选结果的最新 ${Math.min(recentN, filtered.length)} 场`
                        : "手动选择"}
                  </span>
                </div>
                {(mode === "custom" || groupView === "grouped") && (
                  <button
                    className="danger-action"
                    onClick={deleteSelectedMatches}
                    disabled={!chosen.size}
                  >
                    删除所选
                  </button>
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
      {menu && (
        <div
          className="context-menu"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 180),
            top: Math.min(menu.y, window.innerHeight - 164),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            role="menuitem"
            onClick={() => toggleFollow(menu.player)}
            disabled={busyAction === "follow"}
          >
            {menu.player.followed ? (
              <StarOff size={15} />
            ) : (
              <Star size={15} />
            )}
            {menu.player.followed ? "取消关注" : "关注"}
          </button>
          <button
            role="menuitem"
            onClick={() => refreshAvatarFromMenu(menu.player)}
            disabled={busyAction === "avatar"}
          >
            <RefreshCw size={15} />
            刷新头像
          </button>
          <button
            role="menuitem"
            onClick={() => renamePlayerFromMenu(menu.player)}
            disabled={busyAction === "rename"}
          >
            <Pencil size={15} />
            修改名称
          </button>
          <button
            role="menuitem"
            className="danger"
            onClick={() => deletePlayerFromMenu(menu.player)}
          >
            <Trash2 size={15} />
            删除资历
          </button>
        </div>
      )}
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
