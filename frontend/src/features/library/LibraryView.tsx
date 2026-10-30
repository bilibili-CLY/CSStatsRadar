import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarClock,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Eraser,
  Layers3,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Square,
  Star,
  StarOff,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import { bridge } from "../../bridge";
import { BusyMessage, Spinner } from "../../components/Busy";
import { PlayerAvatarView, applyAvatar } from "../../components/PlayerAvatar";
import { Field } from "../../components/ui";
import { useAppStore } from "../../stores/appStore";
import { useStudioStore } from "../../stores/studioStore";
import { saveSeedToDraft, studioToastLabels } from "../studio/draftMutations";
import type {
  MatchGroup,
  MatchRecord,
  PlayerTeam,
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
  const navigate = useNavigate();
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

  // 战队管理与多选状态
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<PlayerTeam[]>(() => {
    try {
      const saved = localStorage.getItem("cs_radar_player_teams");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const saveTeams = (nextTeams: PlayerTeam[]) => {
    setTeams(nextTeams);
    try {
      localStorage.setItem("cs_radar_player_teams", JSON.stringify(nextTeams));
    } catch {}
  };
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [teamNameInput, setTeamNameInput] = useState("");
  const [teamLogoInput, setTeamLogoInput] = useState("");
  const teamLogoFileInputRef = useRef<HTMLInputElement>(null);

  const teamPlayerMap = useMemo(() => {
    const map = new Map<string, PlayerTeam>();
    for (const team of teams) {
      for (const steamId of team.playerSteamIds) {
        map.set(steamId, team);
      }
    }
    return map;
  }, [teams]);
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

  const playerStatsSummary = useMemo(() => {
    if (!matches.length) return null;
    let totalKills = 0;
    let totalDeaths = 0;
    let totalAdr = 0;
    let totalRating = 0;
    let count = 0;
    for (const m of matches) {
      if (m.kills != null) totalKills += m.kills;
      if (m.deaths != null) totalDeaths += m.deaths;
      if (m.adr != null) totalAdr += m.adr;
      if (m.rating != null) {
        totalRating += m.rating;
        count++;
      }
    }
    const kd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : (totalKills > 0 ? totalKills.toFixed(2) : "—");
    const avgAdr = matches.length > 0 ? (totalAdr / matches.length).toFixed(1) : "—";
    const avgRating = count > 0 ? (totalRating / count).toFixed(2) : "—";
    return {
      totalMatches: matches.length,
      kd,
      avgAdr,
      avgRating,
    };
  }, [matches]);
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
  function handleSaveTeam() {
    const name = teamNameInput.trim();
    if (!name) return;
    const playerIds = Array.from(selectedPlayerIds);
    if (!playerIds.length && selected) playerIds.push(selected.steam_id);
    if (!playerIds.length) return;

    // 清除选定玩家在其他战队的旧关联，避免重复
    const nextTeams = teams
      .map((t) => ({
        ...t,
        playerSteamIds: t.playerSteamIds.filter((id) => !playerIds.includes(id)),
      }))
      .filter((t) => t.playerSteamIds.length > 0);

    const newTeam: PlayerTeam = {
      id: `team_${Date.now()}`,
      name,
      logoUrl: teamLogoInput.trim() || undefined,
      playerSteamIds: playerIds,
    };
    nextTeams.push(newTeam);
    saveTeams(nextTeams);
    setTeamDialogOpen(false);
    setSelectedPlayerIds(new Set());
    setTeamNameInput("");
    setTeamLogoInput("");
    useAppStore.getState().showToast(`已成功将 ${playerIds.length} 名玩家编入战队 [${name}]`);
  }

  async function addTeamToShowcase(team: PlayerTeam) {
    const memberPlayers = players.filter((p) => team.playerSteamIds.includes(p.steam_id));
    const targets = playersWithStats(memberPlayers);
    if (!targets.length) {
      useAppStore.getState().showToast(`战队 [${team.name}] 成员暂无比赛统计`);
      return;
    }
    const failures: string[] = [];
    let completed = 0;
    let lastSeed: StudioSeed | null = null;
    try {
      setBusyAction(`team:showcase:${team.id}`);
      setError("");
      setBulkProgress({ processed: 0, total: targets.length });
      for (const [index, player] of targets.entries()) {
        try {
          const playerMatches = await bridge.getMatches(player.steam_id);
          const matchIds = playerMatches.map((match) => match.demo_record_id);
          if (!matchIds.length) continue;
          const radar = await bridge.buildRadar(player.steam_id, matchIds);
          const seed: StudioSeed = { player, matchIds, radar };
          await saveSeedToDraft("showcase", seed, useAppStore.getState().config, {
            teamLogoUrl: team.logoUrl,
          });
          lastSeed = seed;
          completed += 1;
        } catch {
          failures.push(player.name);
        }
        setBulkProgress({ processed: index + 1, total: targets.length });
      }
      if (lastSeed) useStudioStore.getState().setSeed(lastSeed);
      if (completed)
        useAppStore.getState().showToast(`战队 [${team.name}] 已整体加入轮播（${completed} 人）`);
      if (failures.length)
        setError(`未能加入轮播：${failures.join("、")}`);
    } finally {
      setBusyAction("");
      setBulkProgress(null);
    }
  }

  async function addAllToShowcase() {
    const targets = playersWithStats(sortPlayers(players, playerSort));
    if (!targets.length) return;

    // 播放队列以战队为一组进行排序：同一战队的玩家排在一起，未分组的玩家排在最后
    const sortedTargets = [...targets].sort((a, b) => {
      const teamA = teamPlayerMap.get(a.steam_id);
      const teamB = teamPlayerMap.get(b.steam_id);
      if (teamA && teamB) {
        if (teamA.id === teamB.id) return 0;
        return teamA.name.localeCompare(teamB.name);
      }
      if (teamA) return -1;
      if (teamB) return 1;
      return 0;
    });

    const failures: string[] = [];
    let completed = 0;
    let lastSeed: StudioSeed | null = null;
    try {
      setBusyAction("studio:showcase-all");
      setError("");
      setBulkProgress({ processed: 0, total: sortedTargets.length });
      for (const [index, player] of sortedTargets.entries()) {
        try {
          const playerMatches = await bridge.getMatches(player.steam_id);
          const matchIds = playerMatches.map((match) => match.demo_record_id);
          if (!matchIds.length) continue;
          const radar = await bridge.buildRadar(player.steam_id, matchIds);
          const seed: StudioSeed = { player, matchIds, radar };
          const playerTeam = teamPlayerMap.get(player.steam_id);
          await saveSeedToDraft("showcase", seed, useAppStore.getState().config, {
            teamLogoUrl: playerTeam?.logoUrl,
          });
          lastSeed = seed;
          completed += 1;
        } catch {
          failures.push(player.name);
        }
        setBulkProgress({ processed: index + 1, total: sortedTargets.length });
      }
      if (lastSeed) useStudioStore.getState().setSeed(lastSeed);
      if (completed)
        useAppStore.getState().showToast(
          failures.length
            ? `已加入轮播：${completed} 名玩家；${failures.length} 名未完成`
            : `已加入轮播：${completed} 名玩家（已按战队分组）`,
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
            className="primary-cyan"
            onClick={addAllToShowcase}
            disabled={!playersWithStats(players).length || Boolean(busyAction)}
            aria-label="将所有有比赛统计的玩家一键批量加入轮播"
            title="一键提取全部玩家的战绩生成轮播雷达"
          >
            {busyAction === "studio:showcase-all" ? <Spinner /> : <Video size={17} />}
            {busyAction === "studio:showcase-all"
              ? `正在加入 ${bulkProgress?.processed ?? 0}/${bulkProgress?.total ?? 0}`
              : "全部选手一键加入轮播"}
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
          {selectedPlayerIds.size > 0 && (
            <div style={{ margin: "6px 0 10px 0", padding: "8px 10px", background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--cyan)" }}>
                已选 {selectedPlayerIds.size} 人
              </span>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  className="primary-cyan"
                  style={{ height: "24px", fontSize: "11px", padding: "0 8px" }}
                  onClick={() => {
                    setTeamNameInput("");
                    setTeamLogoInput("");
                    setTeamDialogOpen(true);
                  }}
                >
                  <Shield size={12} /> 编为战队
                </button>
                <button
                  className="quiet"
                  style={{ height: "24px", fontSize: "11px", padding: "0 6px" }}
                  onClick={() => setSelectedPlayerIds(new Set())}
                >
                  取消
                </button>
              </div>
            </div>
          )}
          <div className="player-list">
            {visiblePlayers.map((player) => {
              const playerTeam = teamPlayerMap.get(player.steam_id);
              const isChecked = selectedPlayerIds.has(player.steam_id);
              return (
                <div
                  key={player.steam_id}
                  role="button"
                  tabIndex={0}
                  className={`player-item ${selected?.steam_id === player.steam_id ? "active" : ""}`}
                  onClick={() => setSelected(player)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(player);
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ player, x: event.clientX, y: event.clientY });
                  }}
                >
                  <button
                    type="button"
                    className="icon-button"
                    style={{ width: "20px", height: "20px", padding: 0, marginRight: "4px", opacity: isChecked ? 1 : 0.35 }}
                    title={isChecked ? "取消勾选" : "勾选玩家"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPlayerIds((curr) => {
                        const next = new Set(curr);
                        if (next.has(player.steam_id)) next.delete(player.steam_id);
                        else next.add(player.steam_id);
                        return next;
                      });
                    }}
                  >
                    {isChecked ? <CheckSquare size={16} color="var(--cyan)" /> : <Square size={16} />}
                  </button>
                  <PlayerAvatarView name={player.name} steamId={player.steam_id}/>
                  <span className="player-item-meta">
                    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <strong>{player.name}</strong>
                      {playerTeam && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px",
                            fontSize: "10px",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            background: "rgba(34,211,238,0.12)",
                            color: "var(--cyan)",
                            fontWeight: 600,
                          }}
                          title={`所属战队: ${playerTeam.name}`}
                        >
                          {playerTeam.logoUrl && (
                            <img src={playerTeam.logoUrl} alt="" style={{ width: "12px", height: "12px", objectFit: "contain" }} />
                          )}
                          {playerTeam.name}
                        </span>
                      )}
                    </span>
                    <small>
                      {player.match_count} 场 ·{" "}
                      {player.followed ? "已关注" : "未关注"}
                    </small>
                  </span>
                <div className="player-item-actions">
                  <button
                    type="button"
                    className={`icon-button star-toggle-btn ${player.followed ? "starred" : ""}`}
                    title={player.followed ? "取消关注" : "设为关注"}
                    aria-label={player.followed ? "取消关注" : "设为关注"}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleFollow(player);
                    }}
                  >
                    <Star size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button more-toggle-btn"
                    title="更多操作（重命名/刷新头像/删除）"
                    aria-label="更多操作"
                    onClick={(event) => {
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu({ player, x: rect.right + 2, y: rect.top });
                    }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  </div>
                </div>
              );
            })}
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
                      关注选手
                    </>
                  )}
                </button>
              </div>
              {playerStatsSummary && (
                <div className="player-stats-summary-grid">
                  <div className="summary-stat-chip">
                    <span className="stat-label">已导入比赛</span>
                    <strong className="stat-value">{playerStatsSummary.totalMatches} 场</strong>
                  </div>
                  <div className="summary-stat-chip">
                    <span className="stat-label">场均 Rating</span>
                    <strong className="stat-value accent-cyan">{playerStatsSummary.avgRating}</strong>
                  </div>
                  <div className="summary-stat-chip">
                    <span className="stat-label">场均 ADR</span>
                    <strong className="stat-value">{playerStatsSummary.avgAdr}</strong>
                  </div>
                  <div className="summary-stat-chip">
                    <span className="stat-label">生涯 K/D</span>
                    <strong className="stat-value">{playerStatsSummary.kd}</strong>
                  </div>
                </div>
              )}
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
                <button
                  type="button"
                  className="quiet"
                  style={{
                    borderColor:
                      chosen.size === filtered.length && filtered.length > 0
                        ? "var(--cyan)"
                        : "var(--border)",
                    color:
                      chosen.size === filtered.length && filtered.length > 0
                        ? "var(--cyan)"
                        : "var(--text)",
                    fontSize: "12px",
                    padding: "4px 10px",
                    minHeight: "32px",
                  }}
                  onClick={() => {
                    setMode("custom");
                    if (chosen.size === filtered.length && filtered.length > 0) {
                      setChosen(new Set());
                    } else {
                      setChosen(
                        new Set(filtered.map((m) => m.demo_record_id)),
                      );
                    }
                  }}
                  title="一键选中当前筛选的所有比赛记录"
                >
                  {chosen.size === filtered.length && filtered.length > 0
                    ? "清空全选"
                    : `全选全部 ${filtered.length} 场`}
                </button>
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
                  className="primary-cyan"
                  onClick={() => create("showcase")}
                  disabled={!activeIds.length || Boolean(busyAction)}
                  title="为当前选手将已选比赛生成雷达并加入轮播工坊"
                >
                  {busyAction === "studio:showcase" ? (
                    <Spinner />
                  ) : (
                    <Video size={17} />
                  )}
                  {busyAction === "studio:showcase" ? "正在装载…" : "装载至轮播"}
                </button>
                <button
                  type="button"
                  className="quiet"
                  style={{
                    borderColor: "rgba(34, 211, 238, 0.35)",
                    background: "rgba(34, 211, 238, 0.08)",
                    color: "var(--cyan)",
                    fontWeight: 700,
                  }}
                  onClick={() => navigate("/studio")}
                  title="立即前往轮播工坊预览、排版并导出视频"
                >
                  <span>前往轮播工坊 ➔</span>
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
          {(() => {
            const playerTeam = teamPlayerMap.get(menu.player.steam_id);
            return (
              <>
                {playerTeam ? (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        void addTeamToShowcase(playerTeam);
                      }}
                    >
                      <Video size={15} />
                      {playerTeam.name} 整体加入轮播
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        const nextTeams = teams
                          .map((t) =>
                            t.id === playerTeam.id
                              ? {
                                  ...t,
                                  playerSteamIds: t.playerSteamIds.filter(
                                    (id) => id !== menu.player.steam_id,
                                  ),
                                }
                              : t,
                          )
                          .filter((t) => t.playerSteamIds.length > 0);
                        saveTeams(nextTeams);
                        useAppStore
                          .getState()
                          .showToast(`玩家已退出战队 [${playerTeam.name}]`);
                      }}
                    >
                      <X size={15} />
                      退出战队
                    </button>
                  </>
                ) : (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setSelectedPlayerIds(new Set([menu.player.steam_id]));
                      setTeamNameInput("");
                      setTeamLogoInput("");
                      setTeamDialogOpen(true);
                      setMenu(null);
                    }}
                  >
                    <Shield size={15} />
                    编为战队
                  </button>
                )}
              </>
            );
          })()}
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
      {teamDialogOpen && (
        <div className="modal-backdrop" onClick={() => setTeamDialogOpen(false)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "420px", maxWidth: "90vw" }}
          >
            <h2 style={{ fontSize: "16px", marginBottom: "6px" }}>编为战队</h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>
              为选中的 {selectedPlayerIds.size || 1} 名玩家创建或关联战队。加入轮播时可整体加入或按战队分组。
            </p>
            <div style={{ display: "grid", gap: "14px", marginBottom: "18px" }}>
              <Field label="战队名称">
                <input
                  placeholder="例如 NAVI / FaZe / Team Spirit"
                  value={teamNameInput}
                  onChange={(e) => setTeamNameInput(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="战队 Logo">
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  {teamLogoInput ? (
                    <img
                      src={teamLogoInput}
                      alt="战队Logo"
                      style={{
                        width: "48px",
                        height: "48px",
                        objectFit: "contain",
                        background: "rgba(0,0,0,0.35)",
                        borderRadius: "8px",
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "48px",
                        height: "48px",
                        background: "rgba(255,255,255,0.05)",
                        borderRadius: "8px",
                        border: "1px dashed rgba(255,255,255,0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "11px",
                        color: "var(--text-muted)",
                      }}
                    >
                      无Logo
                    </div>
                  )}
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => teamLogoFileInputRef.current?.click()}
                  >
                    {teamLogoInput ? "更换Logo" : "上传图片"}
                  </button>
                  {teamLogoInput && (
                    <button
                      type="button"
                      className="danger-action"
                      onClick={() => setTeamLogoInput("")}
                    >
                      清除
                    </button>
                  )}
                </div>
                <input
                  ref={teamLogoFileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      setTeamLogoInput(reader.result as string);
                      if (teamLogoFileInputRef.current)
                        teamLogoFileInputRef.current.value = "";
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </Field>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                className="quiet"
                onClick={() => setTeamDialogOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-cyan"
                onClick={handleSaveTeam}
                disabled={!teamNameInput.trim()}
              >
                确认保存战队
              </button>
            </div>
          </div>
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
