const state = {
  demoId: null,
  players: [],
  selectedPlayer: null,
  radarData: null,
  aggregateRadarData: null,
  tooltipZones: [],
  view: "current",
  savedPlayers: [],
  savedPlayersLoaded: false,
  whitelistedSteamIds: new Set(loadPlayerWhitelist()),
  radarTitles: loadRadarTitles(),
  radarSubtitle: todayLabel(),
  selectedSavedPlayer: null,
  playerMatches: [],
  selectedMatchIds: new Set(),
  config: {
    export_width: 1920,
    export_height: 1080,
    theme_color: "#00ffff",
    color_preset: "default",
    last_player_identifier_type: "name",
    database_path: "",
  },
};

const el = {
  currentDemoTab: document.querySelector("#currentDemoTab"),
  playerRecordsTab: document.querySelector("#playerRecordsTab"),
  demoPanel: document.querySelector("#demoPanel"),
  playerPanel: document.querySelector("#playerPanel"),
  demoFile: document.querySelector("#demoFile"),
  fileName: document.querySelector("#fileName"),
  uploadBtn: document.querySelector("#uploadBtn"),
  uploadState: document.querySelector("#uploadState"),
  candidates: document.querySelector("#candidates"),
  metricValues: document.querySelector("#metricValues"),
  errorNotice: document.querySelector("#errorNotice"),
  exportBtn: document.querySelector("#exportBtn"),
  exportWidth: document.querySelector("#exportWidth"),
  exportHeight: document.querySelector("#exportHeight"),
  radarTitle: document.querySelector("#radarTitle"),
  radarSubtitle: document.querySelector("#radarSubtitle"),
  themeColor: document.querySelector("#themeColor"),
  databasePath: document.querySelector("#databasePath"),
  colorPreset: document.querySelector("#colorPreset"),
  saveConfigBtn: document.querySelector("#saveConfigBtn"),
  canvas: document.querySelector("#radarCanvas"),
  historyArea: document.querySelector("#historyArea"),
  chartTooltip: document.querySelector("#chartTooltip"),
  metricTitle: document.querySelector("#metricTitle"),
};

const presetColors = {
  default: "#00ffff",
  red: "#ff3b30",
  orange: "#ff9500",
  yellow: "#ffcc00",
  green: "#34c759",
  blue: "#007aff",
  indigo: "#4f46e5",
  violet: "#af52de",
};

const metricCaptions = {
  KPR: "每回合击杀",
  Surviving: "存活率",
  KAST: "没白给",
  Impact: "影响力",
};

const ratingTip = "Rating 是我们自制算法的第一版综合评分，用本地 Demo 解析出的击杀、死亡、伤害、KAST 和影响力近似计算，不等同于 HLTV 官方 Rating。";

function setAccent(color) {
  document.documentElement.style.setProperty("--accent", color);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data.error || { code: "unknown", message: "请求失败" };
    throw error;
  }
  return data;
}

function showError(error) {
  el.errorNotice.hidden = false;
  el.errorNotice.textContent = `${error.message}（${error.code}）`;
  if (error.candidates) renderCandidates(error.candidates);
}

function clearError() {
  el.errorNotice.hidden = true;
  el.errorNotice.textContent = "";
}

function setView(view) {
  state.view = view;
  const isCurrent = view === "current";
  el.currentDemoTab.classList.toggle("active", isCurrent);
  el.playerRecordsTab.classList.toggle("active", !isCurrent);
  el.demoPanel.hidden = !isCurrent;
  el.playerPanel.hidden = !isCurrent;
  el.historyArea.hidden = isCurrent;
  el.canvas.hidden = !isCurrent && !state.aggregateRadarData;
  el.metricTitle.textContent = isCurrent ? "数据指标" : state.aggregateRadarData ? "综合指标" : "玩家记录";
  if (isCurrent) {
    syncRadarTextControls(state.radarData, false);
    renderMetricList(state.radarData);
    renderPreview();
  } else {
    syncRadarTextControls(state.aggregateRadarData, false);
    if (state.selectedSavedPlayer) renderHistoryArea();
    else loadSavedPlayers();
    renderMetricList(state.aggregateRadarData);
    if (state.aggregateRadarData) renderPreview();
  }
}

function activeRadarData() {
  if (state.view === "records") return state.aggregateRadarData;
  return state.radarData;
}

function formatMetric(value, type) {
  if (value === null || value === undefined) return "不可用";
  if (type === "percentage") return `${Math.round(value * 100)}%`;
  return Number(value).toFixed(value >= 10 ? 1 : 2);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function todayLabel() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadRadarTitles() {
  try {
    const raw = localStorage.getItem("cs-radar-title-by-player");
    const titles = JSON.parse(raw || "{}");
    return titles && typeof titles === "object" ? titles : {};
  } catch {
    return {};
  }
}

function saveRadarTitles() {
  localStorage.setItem("cs-radar-title-by-player", JSON.stringify(state.radarTitles));
}

function radarPlayerKey(radarData = activeRadarData()) {
  return radarData?.player?.steam_id || "";
}

function defaultRadarTitle(radarData = activeRadarData()) {
  return radarData?.player?.name || "请上传 Demo";
}

function currentRadarTitle(radarData = activeRadarData()) {
  const key = radarPlayerKey(radarData);
  if (key && state.radarTitles[key]) return state.radarTitles[key];
  return defaultRadarTitle(radarData);
}

function currentRadarSubtitle(radarData = activeRadarData()) {
  const base = (state.radarSubtitle || todayLabel()).trim();
  if (radarData?.match_count) {
    const selectedText = `已选 ${radarData.match_count} 场比赛`;
    return base ? `${base} / ${selectedText}` : selectedText;
  }
  return base;
}

function syncRadarTextControls(radarData = activeRadarData(), resetSubtitle = true) {
  el.radarTitle.value = currentRadarTitle(radarData);
  if (resetSubtitle) {
    state.radarSubtitle = todayLabel();
    el.radarSubtitle.value = state.radarSubtitle;
  } else {
    el.radarSubtitle.value = state.radarSubtitle || todayLabel();
  }
}

function loadPlayerWhitelist() {
  try {
    const raw = localStorage.getItem("cs-radar-player-whitelist");
    const values = JSON.parse(raw || "[]");
    return Array.isArray(values) ? values.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function savePlayerWhitelist() {
  localStorage.setItem("cs-radar-player-whitelist", JSON.stringify(Array.from(state.whitelistedSteamIds)));
}

function renderCandidates(players) {
  el.candidates.innerHTML = "";
  if (!players.length) {
    el.candidates.innerHTML = `<div class="muted">暂无可选玩家。</div>`;
    return;
  }
  players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "candidate-row";
    if (state.selectedPlayer?.steam_id === player.steam_id) row.classList.add("selected");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "candidate";
    button.innerHTML = `<strong>${escapeHtml(player.name)}</strong><br><span>${escapeHtml(player.steam_id)}</span>`;
    button.addEventListener("click", () => selectPlayer(player));
    const whitelistButton = document.createElement("button");
    whitelistButton.type = "button";
    whitelistButton.className = "whitelist-btn";
    const isWhitelisted = state.whitelistedSteamIds.has(player.steam_id);
    whitelistButton.textContent = isWhitelisted ? "移出白名单" : "添加白名单";
    whitelistButton.addEventListener("click", () => toggleWhitelistPlayer(player));
    row.appendChild(button);
    row.appendChild(whitelistButton);
    el.candidates.appendChild(row);
  });
}

async function toggleWhitelistPlayer(player) {
  clearError();
  if (state.whitelistedSteamIds.has(player.steam_id)) {
    state.whitelistedSteamIds.delete(player.steam_id);
    savePlayerWhitelist();
    renderCandidates(state.players);
    return;
  }
  state.whitelistedSteamIds.add(player.steam_id);
  savePlayerWhitelist();
  renderCandidates(state.players);
  if (!state.demoId) return;
  try {
    const result = await api(`/api/demos/${state.demoId}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whitelist_steam_ids: Array.from(state.whitelistedSteamIds) }),
    });
    state.savedPlayersLoaded = false;
    if (state.view === "records") await loadSavedPlayers();
    el.uploadState.textContent =
      result.save_status === "saved" ? "白名单玩家已保存到玩家记录。" : "该 Demo 的白名单玩家记录已存在。";
  } catch (error) {
    showError(error);
  }
}

async function selectPlayer(player) {
  clearError();
  state.selectedPlayer = player;
  renderCandidates(state.players);
  if (!state.demoId) return showError({ code: "demo_not_found", message: "请先上传 Demo。" });
  try {
    const data = await api(`/api/demos/${state.demoId}/radar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier_type: "steam_id", identifier: player.steam_id }),
    });
    state.radarData = data;
    syncRadarTextControls(data);
    renderMetricList(data);
    renderPreview();
    el.exportBtn.disabled = false;
  } catch (error) {
    showError(error);
  }
}

function renderMetricList(radarData) {
  el.metricValues.innerHTML = "";
  if (!radarData) return;
  radarData.radar.metrics.forEach((metric) => {
    const row = document.createElement("div");
    row.className = "metric-row";
    row.dataset.metric = metric.name;
    const value = formatMetric(metric.value, metric.display_type);
    const caption = metricCaptions[metric.name] ? `<small>(${metricCaptions[metric.name]})</small>` : "";
    row.innerHTML = `<span class="metric-name">${metric.name}${caption}</span><span>${value}</span>`;
    if (metric.status !== "ok" && metric.reason) row.title = metric.reason;
    if (metric.name === "Rating") {
      row.title = ratingTip;
      row.addEventListener("mouseenter", (event) => showTooltip(event.clientX, event.clientY, ratingTip));
      row.addEventListener("mousemove", (event) => showTooltip(event.clientX, event.clientY, ratingTip));
      row.addEventListener("mouseleave", hideTooltip);
    }
    el.metricValues.appendChild(row);
  });
}

function renderPreview() {
  const radarData = activeRadarData();
  if (state.view === "records" && !radarData) {
    el.canvas.hidden = true;
    return;
  }
  el.canvas.hidden = false;
  const rect = el.canvas.parentElement.getBoundingClientRect();
  const width = Math.max(640, Math.floor(rect.width));
  const height = Math.max(420, Math.floor(rect.height));
  drawRadar(el.canvas, radarData, { width, height, themeColor: state.config.theme_color });
}

function drawRadar(targetCanvas, radarData, options = {}) {
  const width = Math.floor(options.width || targetCanvas.clientWidth || targetCanvas.width);
  const height = Math.floor(options.height || targetCanvas.clientHeight || targetCanvas.height);
  targetCanvas.width = width;
  targetCanvas.height = height;
  targetCanvas.style.width = `${width}px`;
  targetCanvas.style.height = `${height}px`;
  const ctx = targetCanvas.getContext("2d");
  const accent = options.themeColor || state.config.theme_color;
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#05080d");
  bg.addColorStop(0.55, "#0a1820");
  bg.addColorStop(1, "#020407");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  drawParticles(ctx, width, height, accent);

  const cx = width * 0.5;
  const cy = height * 0.57;
  const radius = Math.min(width, height) * 0.24;
  const dimensions = radarData?.radar?.dimensions || ["KPR", "Surviving", "ADR", "KAST", "Impact", "Rating"];
  const maxValues = radarData?.radar?.max_values || [1, 0.6, 100, 0.7, 2, 1.5];
  const values = radarData?.radar?.values || [0.66, 0.48, 78.2, 0.7, 1.05, 1.13];
  const displayTypes = radarData?.radar?.display_types || ["number", "percentage", "number", "percentage", "number", "number"];
  const tooltipZones = [];

  ctx.strokeStyle = "rgba(145, 205, 217, 0.22)";
  ctx.lineWidth = Math.max(1, width / 1200);
  for (let level = 1; level <= 5; level += 1) {
    drawPolygon(ctx, cx, cy, radius * (level / 5), dimensions.length);
    ctx.stroke();
  }

  dimensions.forEach((_, i) => {
    const point = axisPoint(cx, cy, radius, i, dimensions.length);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  });

  const dataPoints = values.map((value, i) => {
    const normalized = value === null || value === undefined ? 0 : Math.max(0, Math.min(1.25, value / maxValues[i]));
    return axisPoint(cx, cy, radius * normalized, i, dimensions.length);
  });

  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = Math.max(18, width / 45);
  ctx.fillStyle = hexToRgba(accent, 0.24);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, width / 500);
  pathPoints(ctx, dataPoints);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "#e7f8ff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.max(15, width / 72)}px Inter, sans-serif`;
  dimensions.forEach((label, i) => {
    const point = axisPoint(cx, cy, radius * 1.22, i, dimensions.length);
    const labelY = point.y - Math.max(10, height / 90);
    const caption = metricCaptions[label] ? `(${metricCaptions[label]})` : "";
    ctx.fillText(label, point.x, labelY);
    if (caption) {
      ctx.font = `600 ${Math.max(11, width / 118)}px Inter, sans-serif`;
      ctx.fillStyle = "#88a0ad";
      ctx.fillText(caption, point.x, labelY + Math.max(16, height / 58));
      ctx.fillStyle = "#e7f8ff";
      ctx.font = `700 ${Math.max(15, width / 72)}px Inter, sans-serif`;
    }
    if (label === "Rating") {
      tooltipZones.push({ x: point.x - 70, y: labelY - 26, width: 140, height: caption ? 48 : 30, text: ratingTip });
    }
    ctx.fillStyle = accent;
    ctx.font = `650 ${Math.max(13, width / 92)}px Inter, sans-serif`;
    ctx.fillText(formatMetric(values[i], displayTypes[i]), point.x, point.y + Math.max(caption ? 32 : 12, height / 80));
    ctx.fillStyle = "#e7f8ff";
    ctx.font = `700 ${Math.max(15, width / 72)}px Inter, sans-serif`;
  });

  const title = currentRadarTitle(radarData);
  const subtitle = currentRadarSubtitle(radarData);
  ctx.textAlign = "left";
  ctx.font = `800 ${Math.max(24, width / 34)}px Inter, sans-serif`;
  ctx.fillStyle = "#f0fbff";
  ctx.fillText(title, width * 0.06, height * 0.12);
  ctx.font = `520 ${Math.max(13, width / 98)}px Inter, sans-serif`;
  ctx.fillStyle = "#88a0ad";
  if (subtitle) ctx.fillText(subtitle, width * 0.06, height * 0.175);
  if (targetCanvas === el.canvas) state.tooltipZones = tooltipZones;
}

function drawParticles(ctx, width, height, color) {
  ctx.save();
  ctx.fillStyle = hexToRgba(color, 0.38);
  for (let i = 0; i < 96; i += 1) {
    const x = (Math.sin(i * 91.7) * 0.5 + 0.5) * width;
    const y = (Math.cos(i * 47.3) * 0.5 + 0.5) * height;
    const r = ((i % 5) + 1) * Math.max(0.5, width / 3000);
    ctx.globalAlpha = 0.25 + (i % 4) * 0.08;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function axisPoint(cx, cy, radius, index, total) {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total;
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function drawPolygon(ctx, cx, cy, radius, total) {
  const points = Array.from({ length: total }, (_, i) => axisPoint(cx, cy, radius, i, total));
  pathPoints(ctx, points);
}

function pathPoints(ctx, points) {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function showTooltip(clientX, clientY, text) {
  el.chartTooltip.hidden = false;
  el.chartTooltip.textContent = text;
  el.chartTooltip.style.left = `${clientX + 14}px`;
  el.chartTooltip.style.top = `${clientY + 14}px`;
}

function hideTooltip() {
  el.chartTooltip.hidden = true;
}

async function loadConfig() {
  try {
    const config = await api("/api/config");
    state.config = { ...state.config, ...config };
    el.exportWidth.value = state.config.export_width;
    el.exportHeight.value = state.config.export_height;
    syncRadarTextControls(activeRadarData(), false);
    el.themeColor.value = state.config.theme_color;
    el.colorPreset.value = presetColors[state.config.color_preset] ? state.config.color_preset : "default";
    el.databasePath.value = state.config.database_path || "";
    setAccent(state.config.theme_color);
    if (config.warning) showError({ code: "config_read_failed", message: config.warning });
  } catch (error) {
    showError(error);
  }
}

async function saveConfig() {
  clearError();
  const nextConfig = {
    ...state.config,
    export_width: Number(el.exportWidth.value),
    export_height: Number(el.exportHeight.value),
    theme_color: el.themeColor.value,
    color_preset: el.colorPreset.value,
    database_path: el.databasePath.value.trim(),
    last_player_identifier_type: "steam_id",
  };
  try {
    await api("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextConfig),
    });
    state.config = nextConfig;
    setAccent(state.config.theme_color);
    renderPreview();
    if (state.view === "records") {
      state.savedPlayersLoaded = false;
      state.selectedSavedPlayer = null;
      state.aggregateRadarData = null;
      await loadSavedPlayers();
    }
  } catch (error) {
    el.exportWidth.value = state.config.export_width;
    el.exportHeight.value = state.config.export_height;
    el.themeColor.value = state.config.theme_color;
    el.colorPreset.value = state.config.color_preset;
    el.databasePath.value = state.config.database_path || "";
    showError(error);
  }
}

async function loadSavedPlayers() {
  clearError();
  try {
    const data = await api("/api/players");
    state.savedPlayers = data.players || [];
    state.savedPlayersLoaded = true;
    renderHistoryArea();
  } catch (error) {
    state.savedPlayersLoaded = true;
    el.historyArea.innerHTML = `<div class="empty-state">数据库读取失败。</div>`;
    showError(error);
  }
}

async function loadPlayerDetail(steamId, options = {}) {
  clearError();
  state.aggregateRadarData = null;
  state.selectedMatchIds = new Set();
  el.metricTitle.textContent = "玩家记录";
  try {
    const [player, matchesData] = await Promise.all([
      api(`/api/players/${encodeURIComponent(steamId)}`),
      api(`/api/players/${encodeURIComponent(steamId)}/matches`),
    ]);
    state.selectedSavedPlayer = player;
    state.playerMatches = matchesData.matches || [];
    renderMetricList(null);
    renderHistoryArea();
    renderPreview();
  } catch (error) {
    if (options.rethrow) throw error;
    showError(error);
  }
}

function renderHistoryArea() {
  if (state.selectedSavedPlayer) {
    renderPlayerDetail();
    return;
  }
  if (!state.savedPlayersLoaded) {
    el.historyArea.innerHTML = `<div class="empty-state">正在读取玩家记录...</div>`;
    return;
  }
  if (!state.savedPlayers.length) {
    el.historyArea.innerHTML = `<div class="empty-state">暂无保存的玩家记录。</div>`;
    return;
  }
  const rows = state.savedPlayers
    .map(
      (player) => `
        <tr data-steam-id="${escapeHtml(player.steam_id)}">
          <td>${escapeHtml(player.name)}</td>
          <td>${escapeHtml(player.steam_id)}</td>
          <td>${player.match_count}</td>
          <td>${escapeHtml(formatDateTime(player.latest_match_time))}</td>
          <td><button class="delete-player-btn" type="button" data-steam-id="${escapeHtml(player.steam_id)}">删除记录</button></td>
        </tr>`,
    )
    .join("");
  el.historyArea.innerHTML = `
    <section class="history-card">
      <div class="history-header">
        <h2>玩家记录</h2>
        <button id="refreshPlayersBtn" type="button">刷新</button>
      </div>
      <table class="records-table">
        <thead><tr><th>玩家名</th><th>SteamID</th><th>比赛数</th><th>最近记录时间</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  el.historyArea.querySelector("#refreshPlayersBtn").addEventListener("click", loadSavedPlayers);
  el.historyArea.querySelectorAll("tbody tr").forEach((row) => {
    row.addEventListener("dblclick", () => loadPlayerDetail(row.dataset.steamId));
  });
  el.historyArea.querySelectorAll(".delete-player-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deletePlayerRecord(button.dataset.steamId);
    });
  });
}

async function deletePlayerRecord(steamId) {
  clearError();
  const playerName = state.savedPlayers.find((player) => player.steam_id === steamId)?.name || steamId;
  if (!window.confirm(`删除 ${playerName} 的所有玩家记录？`)) return;
  try {
    await api(`/api/players/${encodeURIComponent(steamId)}`, { method: "DELETE" });
    if (state.selectedSavedPlayer?.steam_id === steamId) {
      state.selectedSavedPlayer = null;
      state.playerMatches = [];
      state.selectedMatchIds = new Set();
      state.aggregateRadarData = null;
      renderMetricList(null);
      renderPreview();
    }
    await loadSavedPlayers();
  } catch (error) {
    showError(error);
  }
}

function renderPlayerDetail() {
  const player = state.selectedSavedPlayer;
  const rows = state.playerMatches
    .map((match) => {
      const checked = state.selectedMatchIds.has(match.demo_record_id) ? "checked" : "";
      return `
        <tr>
          <td><input class="match-check" type="checkbox" data-demo-id="${escapeHtml(match.demo_record_id)}" ${checked} /></td>
          <td>${escapeHtml(formatDateTime(match.match_time))}</td>
          <td>${escapeHtml(match.map_name)}</td>
          <td>${escapeHtml(match.file_name)}</td>
          <td>${match.rounds}</td>
          <td>${match.kills}</td>
          <td>${match.deaths}</td>
          <td>${match.assists}</td>
          <td>${formatMetric(match.adr, "number")}</td>
          <td>${formatMetric(match.kast, "percentage")}</td>
          <td>${formatMetric(match.impact, "number")}</td>
          <td>${formatMetric(match.rating, "number")}</td>
          <td><button class="delete-match-btn" type="button" data-demo-id="${escapeHtml(match.demo_record_id)}">删除</button></td>
        </tr>`;
    })
    .join("");
  el.historyArea.innerHTML = `
    <section class="history-card">
      <div class="history-header">
        <div>
          <h2>${escapeHtml(player.name)}</h2>
          <p>${escapeHtml(player.steam_id)}</p>
        </div>
        <button id="backToPlayersBtn" type="button">返回列表</button>
      </div>
      <div class="detail-actions">
        <button id="generateAggregateBtn" type="button" ${state.selectedMatchIds.size ? "" : "disabled"}>生成综合雷达图</button>
        <button id="exportAggregateBtn" type="button" ${state.aggregateRadarData ? "" : "disabled"}>导出综合 PNG</button>
      </div>
      <table class="records-table matches-table">
        <thead>
          <tr><th></th><th>记录时间</th><th>地图</th><th>Demo 文件</th><th>回合</th><th>K</th><th>D</th><th>A</th><th>ADR</th><th>KAST</th><th>Impact</th><th>Rating</th><th></th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="13">暂无比赛记录。</td></tr>`}</tbody>
      </table>
    </section>`;
  el.historyArea.querySelector("#backToPlayersBtn").addEventListener("click", () => {
    state.selectedSavedPlayer = null;
    state.playerMatches = [];
    state.selectedMatchIds = new Set();
    state.aggregateRadarData = null;
    el.metricTitle.textContent = "玩家记录";
    renderMetricList(null);
    renderHistoryArea();
    renderPreview();
  });
  el.historyArea.querySelector("#generateAggregateBtn").addEventListener("click", () => generateAggregateRadar());
  el.historyArea.querySelector("#exportAggregateBtn").addEventListener("click", exportAggregateRadar);
  el.historyArea.querySelectorAll(".delete-match-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteMatchRecord(button.dataset.demoId);
    });
  });
  el.historyArea.querySelectorAll(".match-check").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedMatchIds.add(checkbox.dataset.demoId);
      else state.selectedMatchIds.delete(checkbox.dataset.demoId);
      renderPlayerDetail();
    });
  });
}

async function deleteMatchRecord(demoRecordId) {
  clearError();
  if (!state.selectedSavedPlayer) return;
  if (!window.confirm("删除这场比赛记录？")) return;
  try {
    await api(`/api/players/${encodeURIComponent(state.selectedSavedPlayer.steam_id)}/matches/${encodeURIComponent(demoRecordId)}`, {
      method: "DELETE",
    });
    state.selectedMatchIds.delete(demoRecordId);
    state.aggregateRadarData = null;
    renderMetricList(null);
    state.savedPlayersLoaded = false;
    const steamId = state.selectedSavedPlayer.steam_id;
    try {
      await loadPlayerDetail(steamId, { rethrow: true });
    } catch {
      state.selectedSavedPlayer = null;
      state.playerMatches = [];
      await loadSavedPlayers();
    }
  } catch (error) {
    if (error.code === "player_record_not_found" || error.code === "match_record_not_found") {
      state.selectedSavedPlayer = null;
      state.playerMatches = [];
      state.selectedMatchIds = new Set();
      state.aggregateRadarData = null;
      renderMetricList(null);
      await loadSavedPlayers();
      return;
    }
    showError(error);
  }
}

async function generateAggregateRadar() {
  clearError();
  if (!state.selectedSavedPlayer || !state.selectedMatchIds.size) {
    return showError({ code: "invalid_aggregate_request", message: "请选择比赛记录。" });
  }
  try {
    const data = await api(`/api/players/${encodeURIComponent(state.selectedSavedPlayer.steam_id)}/radar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ demo_record_ids: Array.from(state.selectedMatchIds) }),
    });
    state.aggregateRadarData = data;
    syncRadarTextControls(data);
    el.metricTitle.textContent = "综合指标";
    renderMetricList(data);
    renderHistoryArea();
    renderPreview();
  } catch (error) {
    showError(error);
  }
}

function exportAggregateRadar() {
  clearError();
  if (!state.aggregateRadarData) return showError({ code: "metric_unavailable", message: "没有可导出的综合雷达数据。" });
  exportRadarImage(state.aggregateRadarData, "aggregate-radar");
}

el.demoFile.addEventListener("change", () => {
  const file = el.demoFile.files[0];
  el.fileName.textContent = file ? file.name : "选择已解压的 .dem 文件";
});

el.currentDemoTab.addEventListener("click", () => setView("current"));
el.playerRecordsTab.addEventListener("click", () => setView("records"));

el.uploadBtn.addEventListener("click", async () => {
  clearError();
  const file = el.demoFile.files[0];
  if (!file) return showError({ code: "invalid_file_type", message: "请选择已解压的 .dem 文件。" });
  const form = new FormData();
  form.append("file", file);
  form.append("whitelist_steam_ids", JSON.stringify(Array.from(state.whitelistedSteamIds)));
  el.uploadBtn.disabled = true;
  el.uploadState.textContent = "正在上传并解析...";
  try {
    const data = await api("/api/demos", { method: "POST", body: form });
    state.demoId = data.demo_id;
    state.players = data.players;
    state.selectedPlayer = null;
    state.radarData = null;
    state.aggregateRadarData = null;
    syncRadarTextControls(null);
    if (data.save_status === "saved" || data.save_status === "duplicate") {
      state.savedPlayersLoaded = false;
      if (state.view === "records") loadSavedPlayers();
    }
    el.exportBtn.disabled = true;
    renderMetricList(null);
    renderPreview();
    el.uploadState.textContent = uploadStatusText(data);
    renderCandidates(data.players);
  } catch (error) {
    if (error.code === "demo_fingerprint_missing" && error.demo_id && error.players) {
      state.demoId = error.demo_id;
      state.players = error.players;
      state.selectedPlayer = null;
    state.radarData = null;
    syncRadarTextControls(null);
    el.exportBtn.disabled = true;
      renderMetricList(null);
      renderPreview();
      renderCandidates(error.players);
      el.uploadState.textContent = "已解析，但 Demo 缺少可用于去重的文件指纹，无法保存到历史记录。";
    } else {
      el.uploadState.textContent = "解析失败。";
    }
    showError(error);
  } finally {
    el.uploadBtn.disabled = false;
  }
});

function uploadStatusText(data) {
  const countText = `已解析 ${data.players.length} 名玩家，请点击玩家生成雷达图。`;
  if (data.save_message) return `${countText} ${data.save_message}`;
  if (data.save_status === "saved") return `${countText} 历史记录已保存。`;
  if (data.save_status === "duplicate") return `${countText} 该 Demo 已保存。`;
  if (data.save_status === "not_saved") return `${countText} 未保存到历史记录。`;
  return countText;
}

el.exportBtn.addEventListener("click", () => {
  clearError();
  if (!state.radarData) return showError({ code: "metric_unavailable", message: "没有可导出的雷达数据。" });
  exportRadarImage(state.radarData, "radar");
});

function exportRadarImage(radarData, suffix) {
  const width = Number(el.exportWidth.value);
  const height = Number(el.exportHeight.value);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return showError({ code: "invalid_export_size", message: "导出宽高必须是正整数。" });
  }
  const exportCanvas = document.createElement("canvas");
  drawRadar(exportCanvas, radarData, { width, height, themeColor: state.config.theme_color });
  const link = document.createElement("a");
  const safeName = currentRadarTitle(radarData).replace(/[^a-z0-9_-]+/gi, "-") || (radarData.player.steam_id || "radar");
  link.download = `${safeName}-${suffix}.png`;
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
}

el.themeColor.addEventListener("input", saveConfig);
el.colorPreset.addEventListener("change", () => {
  const color = presetColors[el.colorPreset.value] || presetColors.default;
  el.themeColor.value = color;
  saveConfig();
});
el.exportWidth.addEventListener("change", saveConfig);
el.exportHeight.addEventListener("change", saveConfig);
el.radarTitle.addEventListener("input", () => {
  const radarData = activeRadarData();
  const key = radarPlayerKey(radarData);
  if (key) {
    const value = el.radarTitle.value.trim();
    if (value) state.radarTitles[key] = value;
    else delete state.radarTitles[key];
    saveRadarTitles();
  }
  renderPreview();
});
el.radarSubtitle.addEventListener("input", () => {
  state.radarSubtitle = el.radarSubtitle.value;
  renderPreview();
});
el.databasePath.addEventListener("change", saveConfig);
el.saveConfigBtn.addEventListener("click", saveConfig);

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderPreview, 80);
});

el.canvas.addEventListener("mousemove", (event) => {
  const rect = el.canvas.getBoundingClientRect();
  const scaleX = el.canvas.width / rect.width;
  const scaleY = el.canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  const zone = state.tooltipZones.find((item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height);
  if (zone) showTooltip(event.clientX, event.clientY, zone.text);
  else hideTooltip();
});
el.canvas.addEventListener("mouseleave", hideTooltip);

loadConfig().then(() => setView(state.view));
