const defaultShowcaseDurationMs = 4000;

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
  matchSelectionDragging: false,
  matchSelectionMode: "select",
  config: {
    export_width: 1920,
    export_height: 1080,
    theme_color: "#00ffff",
    color_preset: "default",
    last_player_identifier_type: "name",
    database_path: "",
    showcase: {
      default_duration_ms: defaultShowcaseDurationMs,
      show_best_markers: true,
      audio_offset_ms: 0,
      ffmpeg_path: "",
      layout: {
        radar_position: { x: 0.36, y: 0.56 },
        name_position: { x: 0.72, y: 0.22 },
        image_position: { x: 0.72, y: 0.54 },
      },
    },
  },
  showcase: {
    playersLoaded: false,
    players: [],
    expandedSteamIds: new Set(),
    selectedSteamIds: new Set(),
    matchesBySteamId: new Map(),
    matchErrorsBySteamId: new Map(),
    selectedMatchIdsBySteamId: new Map(),
    imagesBySteamId: new Map(),
    mvpBackgroundsBySteamId: new Map(),
    activeImageSteamId: "",
    slides: [],
    buildErrors: new Map(),
    currentIndex: 0,
    status: "empty",
    currentTimeMs: 0,
    lastFrameTime: 0,
    timelineDragging: false,
    activeDragTarget: null,
    draggedQueueSteamId: "",
    particles: [],
    particleFadeLevel: 1,
    particlesEnabled: true,
    previewFrameId: 0,
    lastPreviewFrameTime: 0,
    currentThemeColor: "#00ffff",
    targetThemeColor: "#00ffff",
    animationStartTime: 0,
    music: null,
    waveformUrl: "",
    waveformPeaks: [],
    waveformExpanded: true,
    waveformDragging: false,
    audioContext: null,
    exportingVideo: false,
    renderingExport: false,
  },
};

const el = {
  currentDemoTab: document.querySelector("#currentDemoTab"),
  playerRecordsTab: document.querySelector("#playerRecordsTab"),
  showcaseTab: document.querySelector("#showcaseTab"),
  workspace: document.querySelector("#workspace"),
  demoPanel: document.querySelector("#demoPanel"),
  playerPanel: document.querySelector("#playerPanel"),
  showcasePanel: document.querySelector("#showcasePanel"),
  showcaseImagePanel: document.querySelector("#showcaseImagePanel"),
  showcaseQueueList: document.querySelector("#showcaseQueueList"),
  showcaseImagePlayer: document.querySelector("#showcaseImagePlayer"),
  showcaseDurationSeconds: document.querySelector("#showcaseDurationSeconds"),
  showcaseThemePreset: document.querySelector("#showcaseThemePreset"),
  showBestMarkers: document.querySelector("#showBestMarkers"),
  showcaseImageFile: document.querySelector("#showcaseImageFile"),
  showcaseImageFileName: document.querySelector("#showcaseImageFileName"),
  showcaseImageUrl: document.querySelector("#showcaseImageUrl"),
  saveShowcaseImageUrlBtn: document.querySelector("#saveShowcaseImageUrlBtn"),
  clearShowcaseImageBtn: document.querySelector("#clearShowcaseImageBtn"),
  showcaseMvpBackgroundFile: document.querySelector("#showcaseMvpBackgroundFile"),
  showcaseMvpBackgroundFileName: document.querySelector("#showcaseMvpBackgroundFileName"),
  clearShowcaseMvpBackgroundBtn: document.querySelector("#clearShowcaseMvpBackgroundBtn"),
  showcaseMusicFile: document.querySelector("#showcaseMusicFile"),
  showcaseMusicFileName: document.querySelector("#showcaseMusicFileName"),
  clearShowcaseMusicBtn: document.querySelector("#clearShowcaseMusicBtn"),
  showcaseFFmpegPath: document.querySelector("#showcaseFFmpegPath"),
  saveShowcaseSettingsBtn: document.querySelector("#saveShowcaseSettingsBtn"),
  exportShowcaseVideoBtn: document.querySelector("#exportShowcaseVideoBtn"),
  showcaseVideoStatus: document.querySelector("#showcaseVideoStatus"),
  resetShowcaseLayoutBtn: document.querySelector("#resetShowcaseLayoutBtn"),
  demoFile: document.querySelector("#demoFile"),
  fileName: document.querySelector("#fileName"),
  uploadBtn: document.querySelector("#uploadBtn"),
  uploadState: document.querySelector("#uploadState"),
  candidates: document.querySelector("#candidates"),
  metricValues: document.querySelector("#metricValues"),
  errorNotice: document.querySelector("#errorNotice"),
  exportSettingsPanel: document.querySelector("#exportSettingsPanel"),
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
  showcaseArea: document.querySelector("#showcaseArea"),
  showcaseCanvas: document.querySelector("#showcaseCanvas"),
  showcaseTimeline: document.querySelector("#showcaseTimeline"),
  showcaseTimelineBar: document.querySelector("#showcaseTimelineBar"),
  showcaseAudioTimeline: document.querySelector("#showcaseAudioTimeline"),
  toggleAudioWaveformBtn: document.querySelector("#toggleAudioWaveformBtn"),
  showcaseWaveformCanvas: document.querySelector("#showcaseWaveformCanvas"),
  showcaseAudioPlayhead: document.querySelector("#showcaseAudioPlayhead"),
  showcaseAudioOffset: document.querySelector("#showcaseAudioOffset"),
  showcaseAudioOffsetSeconds: document.querySelector("#showcaseAudioOffsetSeconds"),
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

const showcaseThemeOptions = {
  random: "",
  ...presetColors,
};

const metricCaptions = {
  KPR: "每回合击杀",
  Surviving: "存活率",
  KAST: "没白给",
  Impact: "影响力",
};

const ratingTip = "Rating 是我们自制算法的第一版综合评分，用本地 Demo 解析出的击杀、死亡、伤害、KAST 和影响力近似计算，不等同于 HLTV 官方 Rating。";

const defaultShowcaseLayout = {
  radar_position: { x: 0.36, y: 0.56 },
  name_position: { x: 0.72, y: 0.22 },
  image_position: { x: 0.72, y: 0.54 },
};

const showcaseColorPresets = ["#00ffff", "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#007aff", "#4f46e5", "#af52de"];

const showcaseImageCache = new Map();
const showcaseAnimDuration = 1500;
const bestColor = "#ffd76a";
const showcaseAudio = new Audio();
showcaseAudio.loop = true;
showcaseAudio.addEventListener("loadedmetadata", () => syncShowcaseAudioToTimeline(state.showcase.status === "playing"));

function configureShowcaseAudio() {
  const url = effectiveMusicUrl();
  if (!url) {
    showcaseAudio.pause();
    showcaseAudio.removeAttribute("src");
    state.showcase.waveformUrl = "";
    state.showcase.waveformPeaks = [];
    renderAudioWaveform();
    return;
  }
  if (showcaseAudio.getAttribute("src") !== url) {
    showcaseAudio.src = url;
    showcaseAudio.load();
  }
  if (state.showcase.waveformUrl !== url) {
    state.showcase.waveformUrl = url;
    loadAudioWaveform();
  }
}

function audioOffsetMs() {
  return Number(state.config.showcase?.audio_offset_ms || 0);
}

function timelineAudioTimeSeconds(globalTimeMs = state.showcase.currentTimeMs) {
  const rawMs = globalTimeMs - audioOffsetMs();
  if (rawMs < 0) return null;
  const seconds = rawMs / 1000;
  if (Number.isFinite(showcaseAudio.duration) && showcaseAudio.duration > 0) {
    return seconds % showcaseAudio.duration;
  }
  return seconds;
}

function syncShowcaseAudioToTimeline(shouldPlay = state.showcase.status === "playing") {
  const url = effectiveMusicUrl();
  if (!url) return;
  configureShowcaseAudio();
  const nextTime = timelineAudioTimeSeconds();
  if (nextTime === null) {
    showcaseAudio.pause();
    return;
  }
  if (Number.isFinite(nextTime) && Math.abs((showcaseAudio.currentTime || 0) - nextTime) > 0.18) {
    try {
      showcaseAudio.currentTime = nextTime;
    } catch {
      return;
    }
  }
  if (shouldPlay) showcaseAudio.play().catch(() => {});
}

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
  const isRecords = view === "records";
  const isShowcase = view === "showcase";
  el.currentDemoTab.classList.toggle("active", isCurrent);
  el.playerRecordsTab.classList.toggle("active", isRecords);
  el.showcaseTab.classList.toggle("active", isShowcase);
  el.workspace.classList.toggle("showcase-view", isShowcase);
  el.workspace.classList.toggle("records-view", isRecords);
  el.demoPanel.hidden = !isCurrent;
  el.playerPanel.hidden = !isCurrent;
  el.showcasePanel.hidden = !isShowcase;
  el.showcaseImagePanel.hidden = !isShowcase;
  el.exportSettingsPanel.hidden = isShowcase;
  el.historyArea.hidden = !isRecords;
  el.showcaseArea.hidden = !isShowcase;
  el.canvas.hidden = isShowcase || (!isCurrent && !state.aggregateRadarData);
  el.metricTitle.textContent = isCurrent ? "数据指标" : isShowcase ? "展示轮播" : "玩家记录";
  if (isCurrent) {
    syncRadarTextControls(state.radarData, false);
    renderMetricList(state.radarData);
    renderPreview();
  } else if (isRecords) {
    syncRadarTextControls(state.aggregateRadarData, false);
    if (state.selectedSavedPlayer) renderHistoryArea();
    else loadSavedPlayers();
    renderMetricList(null);
    if (state.aggregateRadarData) renderPreview();
  } else if (isShowcase) {
    renderMetricList(null);
    syncRadarTextControls(null, false);
    renderShowcaseQueueList();
    renderShowcaseImagePanel(currentShowcaseImagePlayer());
    updateShowcaseControls();
    renderAudioWaveform();
    renderShowcasePreview();
  }
}

function activeRadarData() {
  if (state.view === "records") return state.aggregateRadarData;
  if (state.view === "showcase") return null;
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
  if (state.view === "showcase") {
    renderShowcasePreview();
    return;
  }
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
  updateExportButton();
}

function updateExportButton() {
  const radarData = activeRadarData();
  el.exportBtn.disabled = !radarData;
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

function lerpHexColor(c1, c2, t) {
  const a = c1.replace("#", "");
  const b = c2.replace("#", "");
  const r1 = parseInt(a.slice(0, 2), 16);
  const g1 = parseInt(a.slice(2, 4), 16);
  const b1 = parseInt(a.slice(4, 6), 16);
  const r2 = parseInt(b.slice(0, 2), 16);
  const g2 = parseInt(b.slice(2, 4), 16);
  const b2 = parseInt(b.slice(4, 6), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const blue = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
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
    state.config = {
      ...state.config,
      ...config,
      showcase: {
        ...state.config.showcase,
        ...(config.showcase || {}),
        layout: {
          ...state.config.showcase.layout,
          ...(config.showcase?.layout || {}),
        },
      },
    };
    el.exportWidth.value = state.config.export_width;
    el.exportHeight.value = state.config.export_height;
    syncRadarTextControls(activeRadarData(), false);
    el.themeColor.value = state.config.theme_color;
    el.colorPreset.value = presetColors[state.config.color_preset] ? state.config.color_preset : "default";
    el.databasePath.value = state.config.database_path || "";
    el.showBestMarkers.checked = state.config.showcase.show_best_markers !== false;
    el.showcaseFFmpegPath.value = state.config.showcase.ffmpeg_path || "";
    syncAudioOffsetControls();
    setAccent(state.config.theme_color);
    renderShowcasePreview();
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
    renderShowcasePreview();
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
    el.showBestMarkers.checked = state.config.showcase.show_best_markers !== false;
    el.showcaseFFmpegPath.value = state.config.showcase.ffmpeg_path || "";
    syncAudioOffsetControls();
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
        <div class="history-header-actions">
          <button id="refreshPlayersBtn" type="button">刷新</button>
          <button id="clearAllPlayersBtn" class="danger-btn" type="button">清除所有数据</button>
        </div>
      </div>
      <table class="records-table">
        <thead><tr><th>玩家名</th><th>SteamID</th><th>比赛数</th><th>最近记录时间</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  el.historyArea.querySelector("#refreshPlayersBtn").addEventListener("click", loadSavedPlayers);
  el.historyArea.querySelector("#clearAllPlayersBtn").addEventListener("click", clearAllPlayerRecords);
  el.historyArea.querySelectorAll("tbody tr").forEach((row) => {
    row.addEventListener("click", () => loadPlayerDetail(row.dataset.steamId));
  });
  el.historyArea.querySelectorAll(".delete-player-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deletePlayerRecord(button.dataset.steamId);
    });
  });
}

async function clearAllPlayerRecords() {
  clearError();
  if (!state.savedPlayers.length) return;
  if (!window.confirm("清除所有玩家记录、比赛记录、玩家图片和展示轮播数据？")) return;
  try {
    await api("/api/players", { method: "DELETE" });
    state.savedPlayers = [];
    state.savedPlayersLoaded = true;
    state.selectedSavedPlayer = null;
    state.playerMatches = [];
    state.selectedMatchIds = new Set();
    state.aggregateRadarData = null;
    state.showcase = {
      ...state.showcase,
      playersLoaded: false,
      players: [],
      expandedSteamIds: new Set(),
      selectedSteamIds: new Set(),
      matchesBySteamId: new Map(),
      matchErrorsBySteamId: new Map(),
      selectedMatchIdsBySteamId: new Map(),
      imagesBySteamId: new Map(),
      mvpBackgroundsBySteamId: new Map(),
      activeImageSteamId: "",
      slides: [],
      buildErrors: new Map(),
      currentIndex: 0,
      currentTimeMs: 0,
      status: "empty",
    };
    renderMetricList(null);
    renderHistoryArea();
    renderShowcaseQueueList();
    updateShowcaseControls();
    renderPreview();
  } catch (error) {
    showError(error);
  }
}

async function deletePlayerRecord(steamId) {
  clearError();
  const playerName = state.savedPlayers.find((player) => player.steam_id === steamId)?.name || steamId;
  if (!window.confirm(`删除 ${playerName} 的所有玩家记录？`)) return;
  try {
    await api(`/api/players/${encodeURIComponent(steamId)}`, { method: "DELETE" });
    clearShowcasePlayerState(steamId);
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
  const selectedCount = state.selectedMatchIds.size;
  const allSelected = state.playerMatches.length > 0 && selectedCount === state.playerMatches.length;
  const rows = state.playerMatches
    .map((match) => {
      const selected = state.selectedMatchIds.has(match.demo_record_id);
      const selectedClass = selected ? "selected-match" : "";
      return `
        <tr class="match-row ${selectedClass}" data-demo-id="${escapeHtml(match.demo_record_id)}" aria-selected="${selected ? "true" : "false"}">
          <td><span class="match-select-indicator" aria-hidden="true"></span></td>
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
        <button id="addToShowcaseBtn" type="button" ${state.selectedMatchIds.size ? "" : "disabled"}>加入展示轮播</button>
        <button id="clearPlayerBtn" class="danger-btn" type="button">清除该玩家数据</button>
      </div>
      <div class="floating-selection-actions ${selectedCount ? "has-selection" : ""}">
        <span>${selectedCount ? `已选 ${selectedCount} 场` : "点击或拖动选择比赛"}</span>
        <button id="selectAllMatchesBtn" type="button" ${allSelected ? "disabled" : ""}>全选</button>
        <button id="clearMatchSelectionBtn" type="button" ${selectedCount ? "" : "disabled"}>全不选</button>
        <button id="deleteSelectedMatchesBtn" class="danger-btn" type="button" ${selectedCount ? "" : "disabled"}>删除</button>
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
  el.historyArea.querySelector("#addToShowcaseBtn").addEventListener("click", () => addSelectedMatchesToShowcase());
  el.historyArea.querySelector("#clearPlayerBtn").addEventListener("click", () => deletePlayerRecord(player.steam_id));
  el.historyArea.querySelector("#selectAllMatchesBtn").addEventListener("click", () => setAllMatchesSelected(true));
  el.historyArea.querySelector("#clearMatchSelectionBtn").addEventListener("click", () => setAllMatchesSelected(false));
  el.historyArea.querySelector("#deleteSelectedMatchesBtn").addEventListener("click", deleteSelectedMatchRecords);
  el.historyArea.querySelectorAll(".delete-match-btn").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteMatchRecord(button.dataset.demoId);
    });
  });
  el.historyArea.querySelectorAll(".match-row").forEach((row) => {
    row.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      state.matchSelectionDragging = true;
      state.matchSelectionMode = state.selectedMatchIds.has(row.dataset.demoId) ? "deselect" : "select";
      applyMatchSelection(row.dataset.demoId, state.matchSelectionMode, row);
      event.preventDefault();
    });
    row.addEventListener("mouseenter", () => {
      if (state.matchSelectionDragging) applyMatchSelection(row.dataset.demoId, state.matchSelectionMode, row);
    });
  });
}

function applyMatchSelection(demoRecordId, mode, row) {
  const shouldSelect = mode === "select";
  if (shouldSelect) state.selectedMatchIds.add(demoRecordId);
  else state.selectedMatchIds.delete(demoRecordId);
  row?.classList.toggle("selected-match", shouldSelect);
  row?.setAttribute("aria-selected", shouldSelect ? "true" : "false");
  const selectedCount = state.selectedMatchIds.size;
  const actions = el.historyArea.querySelector(".floating-selection-actions");
  actions?.classList.toggle("has-selection", selectedCount > 0);
  const label = actions?.querySelector("span");
  if (label) label.textContent = selectedCount ? `已选 ${selectedCount} 场` : "点击或拖动选择比赛";
  const generate = el.historyArea.querySelector("#generateAggregateBtn");
  const showcase = el.historyArea.querySelector("#addToShowcaseBtn");
  const clear = el.historyArea.querySelector("#clearMatchSelectionBtn");
  const remove = el.historyArea.querySelector("#deleteSelectedMatchesBtn");
  const selectAll = el.historyArea.querySelector("#selectAllMatchesBtn");
  if (generate) generate.disabled = selectedCount === 0;
  if (showcase) showcase.disabled = selectedCount === 0;
  if (clear) clear.disabled = selectedCount === 0;
  if (remove) remove.disabled = selectedCount === 0;
  if (selectAll) selectAll.disabled = state.playerMatches.length > 0 && selectedCount === state.playerMatches.length;
}

function setAllMatchesSelected(selected) {
  state.selectedMatchIds = selected ? new Set(state.playerMatches.map((match) => match.demo_record_id)) : new Set();
  renderPlayerDetail();
}

async function deleteSelectedMatchRecords() {
  clearError();
  if (!state.selectedSavedPlayer || !state.selectedMatchIds.size) return;
  const ids = Array.from(state.selectedMatchIds);
  if (!window.confirm(`删除已选 ${ids.length} 场比赛记录？`)) return;
  try {
    const steamId = state.selectedSavedPlayer.steam_id;
    for (const demoRecordId of ids) {
      await api(`/api/players/${encodeURIComponent(steamId)}/matches/${encodeURIComponent(demoRecordId)}`, { method: "DELETE" });
      state.showcase.selectedMatchIdsBySteamId.get(steamId)?.delete(demoRecordId);
    }
    state.selectedMatchIds = new Set();
    state.showcase.matchesBySteamId.delete(steamId);
    state.showcase.slides = state.showcase.slides.filter((slide) => !(slide.player?.steam_id === steamId && slide.selectedDemoRecordIds.some((id) => ids.includes(id))));
    if (!state.showcase.slides.length) state.showcase.status = "empty";
    recomputeShowcaseBestMarkers();
    updateShowcaseControls();
    state.aggregateRadarData = null;
    renderMetricList(null);
    await loadPlayerDetail(steamId, { rethrow: true });
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

async function deleteMatchRecord(demoRecordId) {
  clearError();
  if (!state.selectedSavedPlayer) return;
  if (!window.confirm("删除这场比赛记录？")) return;
  try {
    await api(`/api/players/${encodeURIComponent(state.selectedSavedPlayer.steam_id)}/matches/${encodeURIComponent(demoRecordId)}`, {
      method: "DELETE",
    });
    const deletedSteamId = state.selectedSavedPlayer.steam_id;
    state.selectedMatchIds.delete(demoRecordId);
    state.showcase.matchesBySteamId.delete(deletedSteamId);
    state.showcase.selectedMatchIdsBySteamId.get(deletedSteamId)?.delete(demoRecordId);
    state.showcase.slides = state.showcase.slides.filter((slide) => !(slide.player?.steam_id === deletedSteamId && slide.selectedDemoRecordIds.includes(demoRecordId)));
    if (!state.showcase.slides.length) state.showcase.status = "empty";
    recomputeShowcaseBestMarkers();
    updateShowcaseControls();
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

function clearShowcasePlayerState(steamId) {
  state.showcase.playersLoaded = false;
  state.showcase.players = state.showcase.players.filter((player) => player.steam_id !== steamId);
  state.showcase.expandedSteamIds.delete(steamId);
  state.showcase.selectedSteamIds.delete(steamId);
  state.showcase.matchesBySteamId.delete(steamId);
  state.showcase.matchErrorsBySteamId.delete(steamId);
  state.showcase.selectedMatchIdsBySteamId.delete(steamId);
  state.showcase.imagesBySteamId.delete(steamId);
  state.showcase.mvpBackgroundsBySteamId.delete(steamId);
  state.showcase.slides = state.showcase.slides.filter((slide) => slide.player?.steam_id !== steamId);
  if (state.showcase.activeImageSteamId === steamId) state.showcase.activeImageSteamId = "";
  if (!state.showcase.slides.length) state.showcase.status = "empty";
  updateShowcaseControls();
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
    el.metricTitle.textContent = "玩家记录";
    renderMetricList(null);
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

async function fetchAggregateRadarForShowcase(steamId, demoRecordIds) {
  return api(`/api/players/${encodeURIComponent(steamId)}/radar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demo_record_ids: demoRecordIds }),
  });
}

function assignShowcaseThemeColor(index) {
  return showcaseColorPresets[index % showcaseColorPresets.length];
}

function createShowcaseSlide(radarData, selectedDemoRecordIds, image, mvpBackground, index = 0) {
  return {
    player: radarData.player,
    radar: radarData.radar,
    matchCount: radarData.match_count || selectedDemoRecordIds.length,
    selectedDemoRecordIds,
    displayTitle: radarData.player?.name || radarData.player?.steam_id || "",
    displaySubtitle: "",
    themePreset: "random",
    themeColor: assignShowcaseThemeColor(index),
    image: image || null,
    mvpBackground: mvpBackground || null,
    bestMetricIndexes: [],
    isMvp: false,
    durationMs: state.config.showcase?.default_duration_ms || defaultShowcaseDurationMs,
  };
}

async function addSelectedMatchesToShowcase() {
  clearError();
  if (!state.selectedSavedPlayer || !state.selectedMatchIds.size) {
    return showError({ code: "invalid_aggregate_request", message: "请选择比赛记录。" });
  }
  const steamId = state.selectedSavedPlayer.steam_id;
  const demoRecordIds = Array.from(state.selectedMatchIds);
  const button = el.historyArea.querySelector("#addToShowcaseBtn");
  if (button) {
    button.disabled = true;
    button.textContent = "加入中...";
  }
  try {
    const [radarData, image, mvpBackground] = await Promise.all([
      fetchAggregateRadarForShowcase(steamId, demoRecordIds),
      loadPlayerImage(steamId),
      loadPlayerMVPBackground(steamId),
    ]);
    const existingIndex = state.showcase.slides.findIndex((slide) => slide.player?.steam_id === steamId);
    const targetIndex = existingIndex >= 0 ? existingIndex : state.showcase.slides.length;
    const slide = createShowcaseSlide(radarData, demoRecordIds, image, mvpBackground, targetIndex);
    if (existingIndex >= 0) state.showcase.slides[existingIndex] = slide;
    else state.showcase.slides.push(slide);
    recomputeShowcaseBestMarkers();
    state.showcase.currentIndex = existingIndex >= 0 ? existingIndex : state.showcase.slides.length - 1;
    state.showcase.currentTimeMs = slideStartTime(state.showcase.currentIndex);
    state.showcase.status = state.showcase.slides.length ? "ready" : "empty";
    state.showcase.animationStartTime = performance.now();
    state.showcase.activeImageSteamId = steamId;
    updateShowcaseControls();
    renderShowcaseQueueList();
    renderShowcasePreview();
    state.selectedSavedPlayer = null;
    state.playerMatches = [];
    state.selectedMatchIds = new Set();
    state.aggregateRadarData = null;
    renderMetricList(null);
    await loadSavedPlayers();
  } catch (error) {
    showError(error);
  } finally {
    if (button) {
      button.disabled = !state.selectedMatchIds.size;
      button.textContent = "加入展示轮播";
    }
  }
}

function renderShowcaseQueueList() {
  if (!state.showcase.slides.length) {
    el.showcaseQueueList.innerHTML = `<div class="empty-state">从“玩家记录”详情页勾选比赛后，点击“加入展示轮播”。</div>`;
    return;
  }
  el.showcaseQueueList.innerHTML = state.showcase.slides
    .map((slide, index) => {
      const steamId = slide.player?.steam_id || "";
      const isActive = index === state.showcase.currentIndex ? "active-image-player" : "";
      return `
        <div class="showcase-player-row ${isActive}" draggable="true" data-steam-id="${escapeHtml(steamId)}">
          <div class="showcase-player-main">
            <div class="showcase-check">
              <span class="queue-index">${index + 1}</span>
              <span>
                <button class="showcase-title-edit" type="button" data-index="${index}">${escapeHtml(showcaseDisplayTitle(slide))}</button>
                <button class="showcase-subtitle-edit ${slide.displaySubtitle ? "" : "placeholder"}" type="button" data-index="${index}">
                  ${escapeHtml(slide.displaySubtitle || "点击添加图中副标题")}
                </button>
              </span>
            </div>
            <div class="showcase-row-actions">
              <button class="showcase-remove" type="button" data-steam-id="${escapeHtml(steamId)}">删除</button>
            </div>
          </div>
        </div>`;
    })
    .join("");
  el.showcaseQueueList.querySelectorAll(".showcase-player-row").forEach((row) => {
    row.addEventListener("click", () => selectShowcaseSlideBySteamId(row.dataset.steamId));
    row.addEventListener("dragstart", () => {
      state.showcase.draggedQueueSteamId = row.dataset.steamId;
      row.classList.add("drag-source");
    });
    row.addEventListener("dragend", () => {
      state.showcase.draggedQueueSteamId = "";
      row.classList.remove("drag-source");
    });
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      reorderShowcaseQueue(state.showcase.draggedQueueSteamId, row.dataset.steamId);
    });
  });
  el.showcaseQueueList.querySelectorAll(".showcase-title-edit").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      beginShowcaseSlideTextEdit(button, Number(button.dataset.index), "title");
    });
  });
  el.showcaseQueueList.querySelectorAll(".showcase-subtitle-edit").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      beginShowcaseSlideTextEdit(button, Number(button.dataset.index), "subtitle");
    });
  });
  el.showcaseQueueList.querySelectorAll(".showcase-remove").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      removeShowcaseSlide(button.dataset.steamId);
    });
  });
}

async function selectShowcaseSlideBySteamId(steamId) {
  const index = state.showcase.slides.findIndex((slide) => slide.player?.steam_id === steamId);
  if (index < 0) return;
  await selectShowcaseSlide(index);
}

async function selectShowcaseSlide(index) {
  const slide = state.showcase.slides[index];
  if (!slide) return;
  const steamId = slide.player?.steam_id || "";
  state.showcase.activeImageSteamId = steamId;
  await Promise.all([loadPlayerImage(steamId), loadPlayerMVPBackground(steamId)]).catch(showError);
  seekShowcase(slideStartTime(index));
  renderShowcaseQueueList();
  renderShowcaseImagePanel(currentShowcaseImagePlayer());
  renderShowcasePreview();
}

function showcaseDisplayTitle(slide) {
  return slide.displayTitle || slide.player?.name || slide.player?.steam_id || "Unknown";
}

function beginShowcaseSlideTextEdit(button, index, field) {
  const slide = state.showcase.slides[index];
  if (!slide) return;
  const isTitle = field === "title";
  const currentValue = isTitle ? showcaseDisplayTitle(slide) : slide.displaySubtitle || "";
  const input = document.createElement("input");
  const row = button.closest(".showcase-player-row");
  input.className = `showcase-text-input ${isTitle ? "title" : "subtitle"}`;
  input.type = "text";
  input.value = currentValue;
  input.placeholder = isTitle ? "输入图中名称" : "输入图中副标题";
  row?.setAttribute("draggable", "false");
  button.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    if (save) {
      const trimmed = input.value.trim();
      if (isTitle) slide.displayTitle = trimmed || slide.player?.name || slide.player?.steam_id || "";
      else slide.displaySubtitle = trimmed;
      state.showcase.particlesEnabled = true;
      state.showcase.particles = [];
      renderShowcasePreview();
    }
    row?.setAttribute("draggable", "true");
    renderShowcaseQueueList();
  };

  input.addEventListener("mousedown", (event) => event.stopPropagation());
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
}

function reorderShowcaseQueue(sourceSteamId, targetSteamId) {
  if (!sourceSteamId || !targetSteamId || sourceSteamId === targetSteamId) return;
  const from = state.showcase.slides.findIndex((slide) => slide.player?.steam_id === sourceSteamId);
  const to = state.showcase.slides.findIndex((slide) => slide.player?.steam_id === targetSteamId);
  if (from < 0 || to < 0) return;
  const [slide] = state.showcase.slides.splice(from, 1);
  state.showcase.slides.splice(to, 0, slide);
  recomputeShowcaseBestMarkers();
  state.showcase.currentIndex = Math.min(state.showcase.currentIndex, state.showcase.slides.length - 1);
  state.showcase.currentTimeMs = slideStartTime(state.showcase.currentIndex);
  renderShowcaseQueueList();
  renderShowcasePreview();
}

function removeShowcaseSlide(steamId) {
  state.showcase.slides = state.showcase.slides.filter((slide) => slide.player?.steam_id !== steamId);
  if (state.showcase.activeImageSteamId === steamId) state.showcase.activeImageSteamId = "";
  if (!state.showcase.slides.length) {
    state.showcase.status = "empty";
    state.showcase.currentIndex = 0;
    state.showcase.currentTimeMs = 0;
  } else {
    state.showcase.currentIndex = Math.min(state.showcase.currentIndex, state.showcase.slides.length - 1);
    state.showcase.currentTimeMs = slideStartTime(state.showcase.currentIndex);
  }
  recomputeShowcaseBestMarkers();
  updateShowcaseControls();
  renderShowcaseQueueList();
  renderShowcaseImagePanel(currentShowcaseImagePlayer());
  renderShowcasePreview();
}

function recomputeShowcaseBestMarkers() {
  const slides = state.showcase.slides;
  slides.forEach((slide) => {
    slide.bestMetricIndexes = [];
    slide.isMvp = false;
  });
  if (!slides.length) return;
  const dimensions = slides[0]?.radar?.dimensions || [];
  dimensions.forEach((_, metricIndex) => {
    const values = slides
      .map((slide) => slide.radar?.values?.[metricIndex])
      .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
      .map(Number);
    if (!values.length) return;
    const max = Math.max(...values);
    slides.forEach((slide) => {
      const value = Number(slide.radar?.values?.[metricIndex]);
      if (Number.isFinite(value) && value === max) {
        slide.bestMetricIndexes.push(metricIndex);
        slide.isMvp = true;
      }
    });
  });
}

async function loadPlayerImage(steamId) {
  const data = await api(`/api/players/${encodeURIComponent(steamId)}/image`);
  state.showcase.imagesBySteamId.set(steamId, data.image || null);
  syncShowcaseSlideImage(steamId, data.image || null);
  return data.image || null;
}

async function loadPlayerMVPBackground(steamId) {
  const data = await api(`/api/players/${encodeURIComponent(steamId)}/mvp-background`);
  state.showcase.mvpBackgroundsBySteamId.set(steamId, data.background || null);
  syncShowcaseSlideMVPBackground(steamId, data.background || null);
  return data.background || null;
}

async function uploadPlayerMVPBackground(steamId, file) {
  clearError();
  const form = new FormData();
  form.append("file", file);
  const data = await api(`/api/players/${encodeURIComponent(steamId)}/mvp-background`, { method: "POST", body: form });
  state.showcase.mvpBackgroundsBySteamId.set(steamId, data.background || null);
  syncShowcaseSlideMVPBackground(steamId, data.background || null);
  renderShowcaseImagePanel(currentShowcaseImagePlayer());
  renderShowcaseQueueList();
  renderShowcasePreview();
}

async function clearPlayerMVPBackground(steamId) {
  clearError();
  await api(`/api/players/${encodeURIComponent(steamId)}/mvp-background`, { method: "DELETE" });
  state.showcase.mvpBackgroundsBySteamId.set(steamId, null);
  syncShowcaseSlideMVPBackground(steamId, null);
  renderShowcaseImagePanel(currentShowcaseImagePlayer());
  renderShowcaseQueueList();
  renderShowcasePreview();
}

async function loadShowcaseMusic() {
  const data = await api("/api/showcase/music");
  state.showcase.music = data.music || null;
  state.config.showcase.music_path = state.showcase.music?.music_path || state.config.showcase.music_path || "";
  return state.showcase.music;
}

async function uploadShowcaseMusic(file) {
  clearError();
  const form = new FormData();
  form.append("file", file);
  const data = await api("/api/showcase/music", { method: "POST", body: form });
  state.showcase.music = data.music || null;
  state.config.showcase.music_path = state.showcase.music?.music_path || "";
  configureShowcaseAudio();
  renderAudioWaveform();
}

async function clearShowcaseMusic() {
  clearError();
  await api("/api/showcase/music", { method: "DELETE" });
  state.showcase.music = null;
  state.config.showcase.music_path = "";
  configureShowcaseAudio();
  renderAudioWaveform();
}

function effectiveImageUrl(image) {
  if (!image) return "";
  if (image.image_source_type === "upload") return image.public_url || "";
  if (image.image_source_type === "external_url") return image.image_url || "";
  return "";
}

function effectiveMVPBackgroundUrl(background) {
  return background?.public_url || "";
}

function effectiveMusicUrl() {
  return state.showcase.music?.public_url || (state.config.showcase?.music_path ? `/api/showcase-music/${encodeURIComponent(state.config.showcase.music_path.split(/[\\/]/).pop())}` : "");
}

async function uploadPlayerImage(steamId, file) {
  clearError();
  const form = new FormData();
  form.append("file", file);
  const data = await api(`/api/players/${encodeURIComponent(steamId)}/image-upload`, { method: "POST", body: form });
  state.showcase.imagesBySteamId.set(steamId, data.image || null);
  syncShowcaseSlideImage(steamId, data.image || null);
  renderShowcaseImagePanel(currentShowcaseImagePlayer());
  renderShowcasePreview();
}

async function savePlayerImageUrl(steamId, imageUrl) {
  clearError();
  const data = await api(`/api/players/${encodeURIComponent(steamId)}/image-url`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl }),
  });
  state.showcase.imagesBySteamId.set(steamId, data.image || null);
  syncShowcaseSlideImage(steamId, data.image || null);
  renderShowcaseImagePanel(currentShowcaseImagePlayer());
  renderShowcasePreview();
}

async function clearPlayerImage(steamId) {
  clearError();
  await api(`/api/players/${encodeURIComponent(steamId)}/image`, { method: "DELETE" });
  state.showcase.imagesBySteamId.set(steamId, null);
  syncShowcaseSlideImage(steamId, null);
  renderShowcaseImagePanel(currentShowcaseImagePlayer());
  renderShowcasePreview();
}

function syncShowcaseSlideImage(steamId, image) {
  state.showcase.slides.forEach((slide) => {
    if (slide.player?.steam_id === steamId) slide.image = image || null;
  });
}

function syncShowcaseSlideMVPBackground(steamId, background) {
  state.showcase.slides.forEach((slide) => {
    if (slide.player?.steam_id === steamId) slide.mvpBackground = background || null;
  });
}

function currentShowcaseImagePlayer() {
  const steamId = state.showcase.activeImageSteamId || state.showcase.slides[state.showcase.currentIndex]?.player?.steam_id || "";
  return state.showcase.slides.find((slide) => slide.player?.steam_id === steamId)?.player || null;
}

function currentShowcaseResourceSlide() {
  const steamId = state.showcase.activeImageSteamId || state.showcase.slides[state.showcase.currentIndex]?.player?.steam_id || "";
  return state.showcase.slides.find((slide) => slide.player?.steam_id === steamId) || null;
}

function isEditableEventTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || Boolean(target?.isContentEditable);
}

function renderShowcaseImagePanel(player) {
  const slide = currentShowcaseResourceSlide();
  if (!player) {
    el.showcaseImagePlayer.textContent = "选择一个玩家后配置图片。";
    el.showcaseDurationSeconds.value = defaultShowcaseDurationMs / 1000;
    el.showcaseDurationSeconds.disabled = true;
    el.showcaseThemePreset.value = "random";
    el.showcaseThemePreset.disabled = true;
    el.showcaseImageUrl.value = "";
    el.showcaseImageFile.value = "";
    el.showcaseImageFileName.textContent = "未选择文件";
    el.showcaseImageFile.disabled = true;
    el.showcaseImageUrl.disabled = true;
    el.saveShowcaseImageUrlBtn.disabled = true;
    el.clearShowcaseImageBtn.disabled = true;
    el.showcaseMvpBackgroundFile.disabled = true;
    el.showcaseMvpBackgroundFileName.textContent = "未选择文件";
    el.clearShowcaseMvpBackgroundBtn.disabled = true;
    el.showcaseMusicFile.disabled = false;
    el.showcaseMusicFileName.textContent = "未选择文件";
    el.clearShowcaseMusicBtn.disabled = false;
    el.showBestMarkers.checked = state.config.showcase.show_best_markers !== false;
    el.showcaseFFmpegPath.value = state.config.showcase.ffmpeg_path || "";
    updateShowcaseControls();
    return;
  }
  const image = state.showcase.imagesBySteamId.get(player.steam_id) || null;
  const background = state.showcase.mvpBackgroundsBySteamId.get(player.steam_id) || null;
  el.showcaseImagePlayer.textContent = `${player.name} / ${player.steam_id}`;
  el.showcaseDurationSeconds.value = ((slide?.durationMs || defaultShowcaseDurationMs) / 1000).toFixed(1).replace(/\.0$/, "");
  el.showcaseDurationSeconds.disabled = false;
  el.showcaseThemePreset.value = slide?.themePreset || "random";
  el.showcaseThemePreset.disabled = false;
  el.showcaseImageUrl.value = image?.image_source_type === "external_url" ? image.image_url : "";
  el.showcaseImageFile.value = "";
  el.showcaseImageFileName.textContent = "未选择文件";
  el.showcaseImageFile.disabled = false;
  el.showcaseImageUrl.disabled = false;
  el.saveShowcaseImageUrlBtn.disabled = false;
  el.clearShowcaseImageBtn.disabled = false;
  el.showcaseMvpBackgroundFile.value = "";
  el.showcaseMvpBackgroundFileName.textContent = "未选择文件";
  el.showcaseMvpBackgroundFile.disabled = false;
  el.clearShowcaseMvpBackgroundBtn.disabled = !background;
  el.showcaseMusicFile.disabled = false;
  el.showcaseMusicFileName.textContent = "未选择文件";
  el.clearShowcaseMusicBtn.disabled = false;
  el.showBestMarkers.checked = state.config.showcase.show_best_markers !== false;
  el.showcaseFFmpegPath.value = state.config.showcase.ffmpeg_path || "";
  updateShowcaseControls();
}

function renderShowcasePreview(timestamp = performance.now()) {
  if (!el.showcaseCanvas || el.showcaseArea.hidden) return;
  const rect = el.showcaseArea.getBoundingClientRect();
  const width = Math.max(720, Math.floor(rect.width || 1280));
  const height = Math.max(405, Math.floor(width * 0.5625));
  const slide = state.showcase.slides[state.showcase.currentIndex] || null;
  const frameDeltaMs = state.showcase.lastPreviewFrameTime ? Math.min(50, timestamp - state.showcase.lastPreviewFrameTime) : 16.67;
  state.showcase.lastPreviewFrameTime = timestamp;
  drawShowcase(el.showcaseCanvas, slide, state.config.showcase.layout, { width, height, frameDeltaMs, exportMode: false });
  renderShowcaseTimeline();
  if (shouldContinueShowcasePreview(slide)) {
    scheduleShowcasePreview();
  } else {
    state.showcase.lastPreviewFrameTime = 0;
  }
}

function shouldContinueShowcasePreview(slide) {
  return Boolean(slide && state.view === "showcase" && (state.showcase.particlesEnabled || state.showcase.status === "playing" || showcaseAnimationProgress(1800) < 1));
}

function scheduleShowcasePreview() {
  if (state.showcase.previewFrameId) return;
  state.showcase.previewFrameId = requestAnimationFrame((timestamp) => {
    state.showcase.previewFrameId = 0;
    renderShowcasePreview(timestamp);
  });
}

function drawShowcase(canvas, slide, layout, options = {}) {
  const width = Math.floor(options.width || canvas.clientWidth || canvas.width);
  const height = Math.floor(options.height || canvas.clientHeight || canvas.height);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const cssWidth = `${width}px`;
  const cssHeight = `${height}px`;
  if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
  if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
  const ctx = canvas.getContext("2d");
  state.showcase.renderingExport = Boolean(options.exportMode);
  const accent = slide?.themeColor || state.config.theme_color || "#00ffff";
  state.showcase.targetThemeColor = accent;
  state.showcase.currentThemeColor = lerpHexColor(state.showcase.currentThemeColor || accent, state.showcase.targetThemeColor, options.exportMode ? 1 : 0.08);
  const theme = state.showcase.currentThemeColor;
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, hexToRgba(theme, 0.2));
  bg.addColorStop(0.5, "#071018");
  bg.addColorStop(1, "#020304");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  if (slide?.isMvp) drawShowcaseMVPBackground(ctx, slide, width, height);
  if (state.showcase.particlesEnabled && !options.exportMode) drawShowcaseParticles(ctx, width, height, theme, options.frameDeltaMs || 16.67);
  ctx.save();
  ctx.strokeStyle = hexToRgba(theme, 0.12);
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += width / 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + width * 0.08, height);
    ctx.stroke();
  }
  ctx.restore();
  if (!slide) {
    ctx.fillStyle = "#88a0ad";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(18, width / 48)}px Inter, sans-serif`;
    ctx.fillText("选择玩家和比赛后生成展示轮播", width / 2, height / 2);
    state.showcase.renderingExport = false;
    return;
  }
  const rects = showcaseElementRectsForSize(width, height, layout, slide);
  drawShowcaseRadar(ctx, slide, rects.radar);
  drawShowcaseName(ctx, slide, rects.namePoint);
  drawShowcaseImage(ctx, slide, rects.image);
  state.showcase.renderingExport = false;
}

function drawShowcaseMVPBackground(ctx, slide, width, height) {
  const url = effectiveMVPBackgroundUrl(slide.mvpBackground);
  if (!url) return;
  const cached = showcaseImageCache.get(url);
  if (cached?.status === "loaded") {
    const image = cached.image;
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const x = (width - drawWidth) / 2;
    const y = (height - drawHeight) / 2;
    const fade = showcaseAnimationProgress(1800);
    ctx.save();
    ctx.globalAlpha = 0.55 * fade;
    ctx.drawImage(image, x, y, drawWidth, drawHeight);
    const mask = ctx.createLinearGradient(0, 0, width, 0);
    mask.addColorStop(0, "rgba(0,0,0,0.15)");
    mask.addColorStop(0.55, "rgba(0,0,0,0.62)");
    mask.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    return;
  }
  if (!cached) {
    const image = new Image();
    showcaseImageCache.set(url, { status: "loading", image });
    image.onload = () => {
      showcaseImageCache.set(url, { status: "loaded", image });
      renderShowcasePreview();
    };
    image.onerror = () => {
      showcaseImageCache.set(url, { status: "error", image });
      renderShowcasePreview();
    };
    image.src = url;
  }
}

function drawShowcaseParticles(ctx, width, height, color, frameDeltaMs = 16.67) {
  if (!state.showcase.particles.length || state.showcase.particles[0].width !== width || state.showcase.particles[0].height !== height) {
    state.showcase.particles = Array.from({ length: 75 }, (_, index) => {
      const isNebula = index >= 50;
      const seedA = Math.sin(index * 43.7) * 0.5 + 0.5;
      const seedB = Math.cos(index * 29.1) * 0.5 + 0.5;
      const direction = index % 2 === 0 ? 1 : -1;
      return {
        width,
        height,
        type: isNebula ? "nebula" : "normal",
        x: seedA * width,
        y: seedB * height,
        vx: (seedB - 0.5) * (isNebula ? 0.16 : 0.28),
        vy: direction * (isNebula ? 0.08 + (index % 5) * 0.025 : 0.16 + (index % 7) * 0.035),
        size: isNebula ? 5 + (index % 5) : 1 + (index % 3),
      };
    });
  }
  const frameScale = frameDeltaMs / 16.67;
  ctx.save();
  state.showcase.particles.forEach((particle) => {
    particle.x += particle.vx * frameScale;
    particle.y += particle.vy * frameScale;
    if (particle.y < -150) particle.y = height + 150;
    if (particle.y > height + 150) particle.y = -150;
    if (particle.x < -80) particle.x = width + 80;
    if (particle.x > width + 80) particle.x = -80;
    const distanceFromCenter = Math.abs(particle.y - height / 2) / (height / 2);
    const alpha = Math.max(0.05, Math.min(1, distanceFromCenter)) * (particle.type === "nebula" ? 0.22 : 0.65);
    const bloom = particle.size * (particle.type === "nebula" ? 15 : 10);
    const gradient = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, bloom);
    gradient.addColorStop(0, hexToRgba(color, alpha));
    gradient.addColorStop(0.3, hexToRgba(color, alpha * 0.35));
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, bloom, 0, Math.PI * 2);
    ctx.fill();
    if (particle.type === "normal") {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.75, alpha)})`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

function showcaseAnimationProgress(duration = showcaseAnimDuration) {
  if (state.showcase.renderingExport) return 1;
  const started = state.showcase.animationStartTime || performance.now();
  const raw = Math.min(1, (performance.now() - started) / duration);
  return raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
}

function drawShowcaseRadar(ctx, slide, rect) {
  const { x, y, width, height } = rect;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const radius = Math.min(width, height) * 0.36;
  const dimensions = slide.radar?.dimensions || ["KPR", "Surviving", "ADR", "KAST", "Impact", "Rating"];
  const values = slide.radar?.values || [];
  const maxValues = slide.radar?.max_values || [];
  const displayTypes = slide.radar?.display_types || [];
  const accent = slide.themeColor;
  const grow = showcaseAnimationProgress();
  ctx.save();
  ctx.strokeStyle = "rgba(190, 230, 240, 0.18)";
  ctx.lineWidth = Math.max(1, width / 520);
  for (let level = 1; level <= 5; level += 1) {
    drawPolygon(ctx, cx, cy, radius * (level / 5), dimensions.length);
    ctx.stroke();
  }
  dimensions.forEach((_, index) => {
    const point = axisPoint(cx, cy, radius, index, dimensions.length);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  });
  const points = dimensions.map((_, index) => {
    const maxValue = maxValues[index] || 1;
    const value = values[index] ?? 0;
    const normalized = Math.max(0, Math.min(1.25, (value / maxValue) * grow));
    return axisPoint(cx, cy, radius * normalized, index, dimensions.length);
  });
  ctx.shadowColor = accent;
  ctx.shadowBlur = Math.max(18, width / 18);
  ctx.fillStyle = hexToRgba(accent, 0.22);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, width / 220);
  pathPoints(ctx, points);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#e7f8ff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  dimensions.forEach((label, index) => {
    const point = axisPoint(cx, cy, radius * 1.25, index, dimensions.length);
    const isBest = slide.bestMetricIndexes?.includes(index);
    ctx.font = `850 ${Math.max(16, width / 27)}px Inter, sans-serif`;
    ctx.fillStyle = "#e7f8ff";
    ctx.fillText(label, point.x, point.y - Math.max(8, height / 52));
    ctx.font = `750 ${Math.max(13, width / 34)}px Inter, sans-serif`;
    ctx.fillStyle = accent;
    ctx.fillText(formatMetric(values[index], displayTypes[index]), point.x, point.y + Math.max(11, height / 42));
    if (isBest && state.config.showcase.show_best_markers !== false) {
      ctx.save();
      const bestY = point.y + Math.max(42, height / 14);
      const bestSize = Math.max(22, width / 22);
      const bestSpacing = Math.max(2, width / 95);
      ctx.font = `900 ${bestSize}px "Marker Felt", Papyrus, Copperplate, Impact, fantasy`;
      ctx.fillStyle = bestColor;
      ctx.shadowColor = bestColor;
      ctx.shadowBlur = Math.max(14, width / 28);
      ctx.lineWidth = Math.max(3, width / 180);
      ctx.strokeStyle = "rgba(255, 247, 172, 0.62)";
      drawCenteredSpacedText(ctx, "BEST", point.x, bestY, bestSpacing, true);
      drawCenteredSpacedText(ctx, "BEST", point.x, bestY, bestSpacing, false);
      ctx.restore();
    }
  });
  ctx.restore();
}

function drawCenteredSpacedText(ctx, text, x, y, spacing, stroke = false) {
  const chars = Array.from(text);
  const width = chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0) + spacing * Math.max(0, chars.length - 1);
  let cursor = x - width / 2;
  chars.forEach((char) => {
    const charWidth = ctx.measureText(char).width;
    const drawX = cursor + charWidth / 2;
    if (stroke) ctx.strokeText(char, drawX, y);
    else ctx.fillText(char, drawX, y);
    cursor += charWidth + spacing;
  });
}

function drawShowcaseName(ctx, slide, point) {
  const name = showcaseDisplayTitle(slide);
  const subtitle = slide.displaySubtitle || "";
  const enter = showcaseAnimationProgress(1200);
  ctx.save();
  ctx.globalAlpha = enter;
  ctx.translate(point.x, point.y);
  ctx.scale(0.82 + enter * 0.18, 0.82 + enter * 0.18);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = slide.themeColor;
  ctx.shadowBlur = 22;
  ctx.fillStyle = "#f2fbff";
  ctx.font = `900 ${Math.max(32, ctx.canvas.width / 24)}px Inter, sans-serif`;
  ctx.fillText(name, 0, 0);
  if (subtitle) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(210, 232, 240, 0.72)";
    ctx.font = `650 ${Math.max(13, ctx.canvas.width / 86)}px Inter, sans-serif`;
    ctx.fillText(subtitle, 0, Math.max(32, ctx.canvas.height / 18));
  }
  ctx.restore();
}

function drawShowcaseImage(ctx, slide, rect) {
  const url = effectiveImageUrl(slide.image);
  if (!url) return;
  const cached = showcaseImageCache.get(url);
  if (cached?.status === "loaded") {
    const image = cached.image;
    const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = rect.x + (rect.width - width) / 2;
    const y = rect.y + (rect.height - height) / 2;
    const enter = showcaseAnimationProgress(1500);
    ctx.save();
    ctx.globalAlpha = enter;
    ctx.translate(x + width / 2, y + height / 2);
    ctx.scale(0.72 + enter * 0.28, 0.72 + enter * 0.28);
    ctx.shadowColor = slide.themeColor;
    ctx.shadowBlur = 28;
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
    return;
  }
  if (!cached) {
    const image = new Image();
    showcaseImageCache.set(url, { status: "loading", image });
    image.onload = () => {
      showcaseImageCache.set(url, { status: "loaded", image });
      renderShowcasePreview();
    };
    image.onerror = () => {
      showcaseImageCache.set(url, { status: "error", image });
      renderShowcasePreview();
    };
    image.src = url;
  }
}

function showcaseElementRects(canvas, layout) {
  return showcaseElementRectsForSize(canvas.width, canvas.height, layout, state.showcase.slides[state.showcase.currentIndex] || null);
}

function showcaseElementRectsForSize(width, height, layout, slide) {
  const radarSize = Math.min(width * 0.42, height * 0.68);
  const imageWidth = width * 0.24;
  const imageHeight = height * 0.42;
  const radarCenter = denormalizePoint(layout.radar_position, { width, height, left: 0, top: 0 });
  const namePoint = denormalizePoint(layout.name_position, { width, height, left: 0, top: 0 });
  const imageCenter = denormalizePoint(layout.image_position, { width, height, left: 0, top: 0 });
  const nameWidth = Math.max(width * 0.24, (slide?.player?.name || slide?.player?.steam_id || "").length * (width / 36));
  const nameHeight = Math.max(64, height * 0.12);
  return {
    radar: { x: radarCenter.x - radarSize / 2, y: radarCenter.y - radarSize / 2, width: radarSize, height: radarSize },
    name: { x: namePoint.x - nameWidth / 2, y: namePoint.y - nameHeight / 2, width: nameWidth, height: nameHeight },
    namePoint,
    image: { x: imageCenter.x - imageWidth / 2, y: imageCenter.y - imageHeight / 2, width: imageWidth, height: imageHeight },
  };
}

function totalShowcaseDuration() {
  return state.showcase.slides.reduce((sum, slide) => sum + (slide.durationMs || defaultShowcaseDurationMs), 0);
}

function currentShowcaseSegment(globalTimeMs) {
  let elapsed = 0;
  for (let index = 0; index < state.showcase.slides.length; index += 1) {
    const duration = state.showcase.slides[index].durationMs || defaultShowcaseDurationMs;
    if (globalTimeMs < elapsed + duration || index === state.showcase.slides.length - 1) {
      return { index, offsetMs: Math.max(0, globalTimeMs - elapsed), startMs: elapsed, durationMs: duration };
    }
    elapsed += duration;
  }
  return { index: 0, offsetMs: 0, startMs: 0, durationMs: 0 };
}

function startShowcase() {
  if (!state.showcase.slides.length) return;
  if (state.showcase.status === "ended") seekShowcase(0);
  state.showcase.status = "playing";
  state.showcase.lastFrameTime = 0;
  configureShowcaseAudio();
  syncShowcaseAudioToTimeline(true);
  updateShowcaseControls();
  requestAnimationFrame(updateShowcasePlayback);
}

function pauseShowcase() {
  if (state.showcase.status === "playing") state.showcase.status = "paused";
  showcaseAudio.pause();
  updateShowcaseControls();
}

function toggleShowcasePlayback() {
  if (state.showcase.status === "playing") pauseShowcase();
  else startShowcase();
}

function nextShowcaseSlide() {
  if (!state.showcase.slides.length) return;
  const next = Math.min(state.showcase.slides.length - 1, state.showcase.currentIndex + 1);
  seekShowcase(slideStartTime(next));
}

function previousShowcaseSlide() {
  if (!state.showcase.slides.length) return;
  const prev = Math.max(0, state.showcase.currentIndex - 1);
  seekShowcase(slideStartTime(prev));
}

function slideStartTime(index) {
  return state.showcase.slides.slice(0, index).reduce((sum, slide) => sum + (slide.durationMs || defaultShowcaseDurationMs), 0);
}

function seekShowcase(globalTimeMs) {
  const total = totalShowcaseDuration();
  state.showcase.currentTimeMs = Math.max(0, Math.min(globalTimeMs, Math.max(0, total - 1)));
  const segment = currentShowcaseSegment(state.showcase.currentTimeMs);
  const changed = state.showcase.currentIndex !== segment.index;
  state.showcase.currentIndex = segment.index;
  if (changed) state.showcase.animationStartTime = performance.now();
  if (state.showcase.status === "ended" && state.showcase.currentTimeMs < total) state.showcase.status = "paused";
  syncShowcaseAudioToTimeline(state.showcase.status === "playing");
  renderShowcasePreview();
  updateShowcaseControls();
}

function updateShowcasePlayback(timestamp) {
  if (state.showcase.status !== "playing") return;
  if (!state.showcase.lastFrameTime) state.showcase.lastFrameTime = timestamp;
  const delta = timestamp - state.showcase.lastFrameTime;
  state.showcase.lastFrameTime = timestamp;
  const total = totalShowcaseDuration();
  state.showcase.currentTimeMs += delta;
  syncShowcaseAudioToTimeline(true);
  if (state.showcase.currentTimeMs >= total) {
    state.showcase.currentTimeMs = total;
    state.showcase.currentIndex = Math.max(0, state.showcase.slides.length - 1);
    state.showcase.status = "ended";
    showcaseAudio.pause();
    renderShowcasePreview();
    updateShowcaseControls();
    return;
  }
  const nextIndex = currentShowcaseSegment(state.showcase.currentTimeMs).index;
  if (nextIndex !== state.showcase.currentIndex) state.showcase.animationStartTime = performance.now();
  state.showcase.currentIndex = nextIndex;
  renderShowcasePreview();
  requestAnimationFrame(updateShowcasePlayback);
}

function renderShowcaseTimeline() {
  const total = totalShowcaseDuration();
  const progress = total ? Math.min(1, state.showcase.currentTimeMs / total) : 0;
  el.showcaseTimelineBar.style.width = `${progress * 100}%`;
  renderAudioPlayhead();
}

async function loadAudioWaveform() {
  const url = effectiveMusicUrl();
  state.showcase.waveformPeaks = [];
  if (!url || !el.showcaseWaveformCanvas) {
    renderAudioWaveform();
    return;
  }
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!state.showcase.audioContext) state.showcase.audioContext = new AudioContextClass();
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const audioBuffer = await state.showcase.audioContext.decodeAudioData(buffer.slice(0));
    state.showcase.waveformPeaks = buildWaveformPeaks(audioBuffer, 420);
    renderAudioWaveform();
  } catch {
    state.showcase.waveformPeaks = [];
    renderAudioWaveform();
  }
}

function buildWaveformPeaks(audioBuffer, count) {
  const channel = audioBuffer.getChannelData(0);
  const block = Math.max(1, Math.floor(channel.length / count));
  return Array.from({ length: count }, (_, index) => {
    const start = index * block;
    const end = Math.min(channel.length, start + block);
    let peak = 0;
    for (let i = start; i < end; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
    return peak;
  });
}

function renderAudioWaveform() {
  const canvas = el.showcaseWaveformCanvas;
  if (!canvas) return;
  el.showcaseArea.classList.toggle("audio-collapsed", !state.showcase.waveformExpanded);
  el.toggleAudioWaveformBtn.textContent = state.showcase.waveformExpanded ? "折叠波形" : "展开波形";
  el.toggleAudioWaveformBtn.setAttribute("aria-expanded", state.showcase.waveformExpanded ? "true" : "false");
  if (!state.showcase.waveformExpanded) return;
  const rect = el.showcaseAudioTimeline.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width || 960));
  const height = 64;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(123, 159, 172, 0.12)";
  ctx.fillRect(0, 0, width, height);
  const total = Math.max(1, totalShowcaseDuration());
  const offsetX = (audioOffsetMs() / total) * width;
  const peaks = state.showcase.waveformPeaks;
  ctx.save();
  ctx.translate(offsetX, 0);
  ctx.strokeStyle = state.config.showcase.ffmpeg_path ? "rgba(0, 255, 255, 0.82)" : "rgba(136, 160, 173, 0.7)";
  ctx.lineWidth = Math.max(1, width / Math.max(1, peaks.length) - 1);
  if (peaks.length) {
    const step = width / peaks.length;
    peaks.forEach((peak, index) => {
      const x = index * step;
      const barHeight = Math.max(2, peak * height * 0.88);
      ctx.beginPath();
      ctx.moveTo(x, height / 2 - barHeight / 2);
      ctx.lineTo(x, height / 2 + barHeight / 2);
      ctx.stroke();
    });
  } else {
    ctx.fillStyle = "rgba(136, 160, 173, 0.72)";
    ctx.font = "650 12px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(effectiveMusicUrl() ? "音频波形解析中或不可用" : "上传背景音乐后显示波形", width / 2, height / 2);
  }
  ctx.restore();
  renderAudioPlayhead();
}

function renderAudioPlayhead() {
  const total = totalShowcaseDuration();
  const progress = total ? Math.min(1, state.showcase.currentTimeMs / total) : 0;
  el.showcaseAudioPlayhead.style.left = `${progress * 100}%`;
}

function setAudioOffsetFromPointer(event) {
  const rect = el.showcaseAudioTimeline.getBoundingClientRect();
  const centerDelta = event.clientX - rect.left - rect.width / 2;
  const total = Math.max(1, totalShowcaseDuration());
  const nextMS = Math.max(-60000, Math.min(60000, Math.round((centerDelta / rect.width) * total)));
  state.config.showcase.audio_offset_ms = nextMS;
  syncAudioOffsetControls();
  syncShowcaseAudioToTimeline(state.showcase.status === "playing");
  renderAudioWaveform();
}

function updateShowcaseControls() {
  const hasSlides = state.showcase.slides.length > 0;
  const hasFFmpeg = Boolean((state.config.showcase?.ffmpeg_path || "").trim());
  el.exportShowcaseVideoBtn.disabled = !hasSlides || !hasFFmpeg || state.showcase.exportingVideo;
  if (!hasFFmpeg) el.showcaseVideoStatus.textContent = "配置 ffmpeg 路径后可导出 MP4。";
  else if (!hasSlides) el.showcaseVideoStatus.textContent = "加入展示轮播后可导出 MP4。";
  else if (!state.showcase.exportingVideo) el.showcaseVideoStatus.textContent = "按当前导出宽高生成 60fps MP4。";
}

function enterShowcaseFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  if (el.showcaseArea.classList.contains("showcase-fullscreen-fallback")) {
    el.showcaseArea.classList.remove("showcase-fullscreen-fallback");
    renderShowcasePreview();
    return;
  }
  const request = el.showcaseArea.requestFullscreen?.();
  if (request?.catch) {
    request.catch(() => {
      el.showcaseArea.classList.add("showcase-fullscreen-fallback");
      renderShowcasePreview();
    });
  } else {
    el.showcaseArea.classList.add("showcase-fullscreen-fallback");
    renderShowcasePreview();
  }
  if (state.showcase.slides.length) {
    seekShowcase(0);
    state.showcase.animationStartTime = performance.now();
  }
}

function toggleAudioWaveform() {
  state.showcase.waveformExpanded = !state.showcase.waveformExpanded;
  renderAudioWaveform();
}

function normalizePoint(clientX, clientY, rect) {
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

function denormalizePoint(point, rect) {
  return {
    x: rect.left + point.x * rect.width,
    y: rect.top + point.y * rect.height,
  };
}

function hitTestShowcaseElement(event) {
  if (!state.showcase.slides.length) return null;
  const canvasRect = el.showcaseCanvas.getBoundingClientRect();
  const scaleX = el.showcaseCanvas.width / canvasRect.width;
  const scaleY = el.showcaseCanvas.height / canvasRect.height;
  const x = (event.clientX - canvasRect.left) * scaleX;
  const y = (event.clientY - canvasRect.top) * scaleY;
  const rects = showcaseElementRects(el.showcaseCanvas, state.config.showcase.layout);
  for (const target of ["radar", "name", "image"]) {
    const rect = rects[target];
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) return target;
  }
  return null;
}

function beginShowcaseDrag(target, event) {
  if (state.view !== "showcase" || document.fullscreenElement || !state.showcase.slides.length || !target) return;
  state.showcase.activeDragTarget = target;
  el.showcaseArea.classList.add("showcase-dragging");
  updateShowcaseDrag(event);
}

function updateShowcaseDrag(event) {
  const target = state.showcase.activeDragTarget;
  if (!target) return;
  const rect = el.showcaseCanvas.getBoundingClientRect();
  const point = normalizePoint(event.clientX, event.clientY, rect);
  const layout = cloneShowcaseLayout(state.config.showcase.layout);
  if (target === "radar") layout.radar_position = point;
  if (target === "name") layout.name_position = point;
  if (target === "image") layout.image_position = point;
  state.config.showcase.layout = layout;
  renderShowcasePreview();
}

async function endShowcaseDrag() {
  if (!state.showcase.activeDragTarget) return;
  state.showcase.activeDragTarget = null;
  el.showcaseArea.classList.remove("showcase-dragging");
  await saveShowcaseLayout(state.config.showcase.layout);
}

function cloneShowcaseLayout(layout) {
  return {
    radar_position: { ...(layout?.radar_position || defaultShowcaseLayout.radar_position) },
    name_position: { ...(layout?.name_position || defaultShowcaseLayout.name_position) },
    image_position: { ...(layout?.image_position || defaultShowcaseLayout.image_position) },
  };
}

async function saveShowcaseLayout(layout) {
  const nextConfig = {
    ...state.config,
    showcase: {
      ...state.config.showcase,
      layout: cloneShowcaseLayout(layout),
    },
  };
  try {
    await api("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextConfig),
    });
    state.config = nextConfig;
  } catch (error) {
    showError(error);
  }
}

async function saveShowcaseSettings(partialShowcase = {}) {
  const nextConfig = {
    ...state.config,
    showcase: {
      ...state.config.showcase,
      ...partialShowcase,
      layout: cloneShowcaseLayout(state.config.showcase.layout),
    },
  };
  try {
    await api("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextConfig),
    });
    state.config = nextConfig;
    updateShowcaseControls();
    renderShowcasePreview();
  } catch (error) {
    showError(error);
  }
}

function syncAudioOffsetControls() {
  const seconds = (audioOffsetMs() / 1000).toFixed(1).replace(/\.0$/, "");
  el.showcaseAudioOffset.value = seconds;
  el.showcaseAudioOffsetSeconds.value = seconds;
}

async function resetShowcaseLayout() {
  state.config.showcase.layout = cloneShowcaseLayout(defaultShowcaseLayout);
  renderShowcasePreview();
  await saveShowcaseLayout(state.config.showcase.layout);
}

el.demoFile.addEventListener("change", () => {
  const file = el.demoFile.files[0];
  el.fileName.textContent = file ? file.name : "选择已解压的 .dem 文件";
});

el.currentDemoTab.addEventListener("click", () => setView("current"));
el.playerRecordsTab.addEventListener("click", () => setView("records"));
el.showcaseTab.addEventListener("click", () => setView("showcase"));

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
      state.showcase.playersLoaded = false;
      if (state.view === "records") loadSavedPlayers();
      if (state.view === "showcase") renderShowcaseQueueList();
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
  const radarData = activeRadarData();
  if (!radarData) return showError({ code: "metric_unavailable", message: "没有可导出的雷达数据。" });
  exportRadarImage(radarData, state.view === "records" ? "aggregate-radar" : "radar");
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

async function exportShowcaseMp4() {
  clearError();
  if (!state.showcase.slides.length) return showError({ code: "invalid_showcase_video", message: "请先加入展示轮播。" });
  if (!(state.config.showcase?.ffmpeg_path || "").trim()) return showError({ code: "showcase_video_unavailable", message: "请先配置 ffmpeg 路径。" });
  const width = Number(el.exportWidth.value);
  const height = Number(el.exportHeight.value);
  const fps = 60;
  const duration = totalShowcaseDuration();
  const frameCount = Math.ceil((duration / 1000) * fps);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return showError({ code: "invalid_export_size", message: "导出宽高必须是正整数。" });
  }
  if (frameCount <= 0 || frameCount > 7200) {
    return showError({ code: "invalid_showcase_video", message: "轮播过长，第一版最多导出 7200 帧。" });
  }
  const snapshot = {
    currentTimeMs: state.showcase.currentTimeMs,
    currentIndex: state.showcase.currentIndex,
    status: state.showcase.status,
    animationStartTime: state.showcase.animationStartTime,
  };
  const wasPlaying = state.showcase.status === "playing";
  pauseShowcase();
  state.showcase.exportingVideo = true;
  updateShowcaseControls();
  const exportCanvas = document.createElement("canvas");
  const frames = [];
  try {
    el.showcaseVideoStatus.textContent = "正在预加载展示资源...";
    await preloadShowcaseAssets();
    for (let frame = 0; frame < frameCount; frame += 1) {
      const timeMs = Math.min(duration - 1, Math.round((frame / fps) * 1000));
      const segment = currentShowcaseSegment(timeMs);
      state.showcase.currentTimeMs = timeMs;
      state.showcase.currentIndex = segment.index;
      drawShowcase(exportCanvas, state.showcase.slides[segment.index], state.config.showcase.layout, { width, height, frameDeltaMs: 1000 / fps, exportMode: true });
      frames.push(exportCanvas.toDataURL("image/png"));
      if (frame % 30 === 0) {
        el.showcaseVideoStatus.textContent = `正在渲染帧 ${frame + 1} / ${frameCount}...`;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    el.showcaseVideoStatus.textContent = "正在调用 ffmpeg 合成 MP4...";
    const response = await fetch("/api/showcase/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        width,
        height,
        fps,
        duration_ms: duration,
        audio_offset_ms: audioOffsetMs(),
        frames,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw data.error || { code: "showcase_video_failed", message: "MP4 导出失败。" };
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `cs2-showcase-${downloadTimestamp()}.mp4`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    el.showcaseVideoStatus.textContent = "MP4 已生成。";
  } catch (error) {
    showError(error);
    el.showcaseVideoStatus.textContent = "MP4 导出失败。";
  } finally {
    state.showcase.currentTimeMs = snapshot.currentTimeMs;
    state.showcase.currentIndex = snapshot.currentIndex;
    state.showcase.status = snapshot.status;
    state.showcase.animationStartTime = snapshot.animationStartTime;
    state.showcase.exportingVideo = false;
    if (wasPlaying) startShowcase();
    else {
      syncShowcaseAudioToTimeline(false);
      renderShowcasePreview();
      updateShowcaseControls();
    }
  }
}

async function preloadShowcaseAssets() {
  const urls = new Set();
  state.showcase.slides.forEach((slide) => {
    const imageUrl = effectiveImageUrl(slide.image);
    const backgroundUrl = effectiveMVPBackgroundUrl(slide.mvpBackground);
    if (imageUrl) urls.add(imageUrl);
    if (backgroundUrl) urls.add(backgroundUrl);
  });
  await Promise.all(Array.from(urls).map(preloadShowcaseImage));
}

function preloadShowcaseImage(url) {
  const cached = showcaseImageCache.get(url);
  if (cached?.status === "loaded" || cached?.status === "error") return Promise.resolve();
  return new Promise((resolve) => {
    const image = cached?.image || new Image();
    showcaseImageCache.set(url, { status: "loading", image });
    image.onload = () => {
      showcaseImageCache.set(url, { status: "loaded", image });
      resolve();
    };
    image.onerror = () => {
      showcaseImageCache.set(url, { status: "error", image });
      resolve();
    };
    if (!cached) image.src = url;
  });
}

function downloadTimestamp() {
  const date = new Date();
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ];
  return parts.join("");
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

el.resetShowcaseLayoutBtn.addEventListener("click", resetShowcaseLayout);
el.toggleAudioWaveformBtn.addEventListener("click", toggleAudioWaveform);
el.showcaseDurationSeconds.addEventListener("change", () => {
  const slide = currentShowcaseResourceSlide();
  if (!slide) return;
  const seconds = Number(el.showcaseDurationSeconds.value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    el.showcaseDurationSeconds.value = ((slide.durationMs || defaultShowcaseDurationMs) / 1000).toFixed(1).replace(/\.0$/, "");
    return showError({ code: "invalid_showcase_duration", message: "显示时长必须大于 0 秒。" });
  }
  slide.durationMs = Math.round(seconds * 1000);
  const total = totalShowcaseDuration();
  state.showcase.currentTimeMs = Math.min(state.showcase.currentTimeMs, Math.max(0, total - 1));
  renderShowcaseTimeline();
  renderShowcasePreview();
});
el.showcaseThemePreset.addEventListener("change", () => {
  const slide = currentShowcaseResourceSlide();
  if (!slide) return;
  const preset = el.showcaseThemePreset.value;
  slide.themePreset = preset;
  slide.themeColor = preset === "random" ? assignShowcaseThemeColor(state.showcase.slides.indexOf(slide)) : showcaseThemeOptions[preset] || presetColors.default;
  state.showcase.animationStartTime = performance.now();
  renderShowcaseQueueList();
  renderShowcasePreview();
});
el.showBestMarkers.addEventListener("change", () => {
  saveShowcaseSettings({ show_best_markers: el.showBestMarkers.checked });
});
el.saveShowcaseSettingsBtn.addEventListener("click", () => {
  const offsetMS = Math.round(Number(el.showcaseAudioOffsetSeconds.value || 0) * 1000);
  saveShowcaseSettings({
    show_best_markers: el.showBestMarkers.checked,
    ffmpeg_path: el.showcaseFFmpegPath.value.trim(),
    audio_offset_ms: offsetMS,
  });
});
el.showcaseAudioOffset.addEventListener("input", () => {
  el.showcaseAudioOffsetSeconds.value = el.showcaseAudioOffset.value;
  const offsetMS = Math.round(Number(el.showcaseAudioOffset.value) * 1000);
  state.config.showcase.audio_offset_ms = offsetMS;
  syncShowcaseAudioToTimeline(state.showcase.status === "playing");
  renderAudioWaveform();
});
el.showcaseAudioOffset.addEventListener("change", () => saveShowcaseSettings({ audio_offset_ms: Math.round(Number(el.showcaseAudioOffset.value) * 1000) }));
el.showcaseAudioOffsetSeconds.addEventListener("change", () => {
  const value = Math.max(-60, Math.min(60, Number(el.showcaseAudioOffsetSeconds.value || 0)));
  el.showcaseAudioOffsetSeconds.value = value.toFixed(1).replace(/\.0$/, "");
  el.showcaseAudioOffset.value = el.showcaseAudioOffsetSeconds.value;
  const offsetMS = Math.round(value * 1000);
  state.config.showcase.audio_offset_ms = offsetMS;
  syncShowcaseAudioToTimeline(state.showcase.status === "playing");
  renderAudioWaveform();
  saveShowcaseSettings({ audio_offset_ms: offsetMS });
});
el.exportShowcaseVideoBtn.addEventListener("click", exportShowcaseMp4);
el.showcaseImageFile.addEventListener("change", async () => {
  const player = currentShowcaseImagePlayer();
  const file = el.showcaseImageFile.files[0];
  el.showcaseImageFileName.textContent = file?.name || "未选择文件";
  if (!player || !file) return;
  try {
    await uploadPlayerImage(player.steam_id, file);
  } catch (error) {
    showError(error);
  }
});
el.saveShowcaseImageUrlBtn.addEventListener("click", async () => {
  const player = currentShowcaseImagePlayer();
  if (!player) return;
  try {
    await savePlayerImageUrl(player.steam_id, el.showcaseImageUrl.value.trim());
  } catch (error) {
    showError(error);
  }
});
el.clearShowcaseImageBtn.addEventListener("click", async () => {
  const player = currentShowcaseImagePlayer();
  if (!player) return;
  try {
    await clearPlayerImage(player.steam_id);
  } catch (error) {
    showError(error);
  }
});
el.showcaseMvpBackgroundFile.addEventListener("change", async () => {
  const player = currentShowcaseImagePlayer();
  const file = el.showcaseMvpBackgroundFile.files[0];
  el.showcaseMvpBackgroundFileName.textContent = file?.name || "未选择文件";
  if (!player || !file) return;
  try {
    await uploadPlayerMVPBackground(player.steam_id, file);
  } catch (error) {
    showError(error);
  }
});
el.clearShowcaseMvpBackgroundBtn.addEventListener("click", async () => {
  const player = currentShowcaseImagePlayer();
  if (!player) return;
  try {
    await clearPlayerMVPBackground(player.steam_id);
  } catch (error) {
    showError(error);
  }
});
el.showcaseMusicFile.addEventListener("change", async () => {
  const file = el.showcaseMusicFile.files[0];
  el.showcaseMusicFileName.textContent = file?.name || "未选择文件";
  if (!file) return;
  try {
    await uploadShowcaseMusic(file);
  } catch (error) {
    showError(error);
  }
});
el.clearShowcaseMusicBtn.addEventListener("click", async () => {
  try {
    await clearShowcaseMusic();
  } catch (error) {
    showError(error);
  }
});
el.showcaseTimeline.addEventListener("mousedown", (event) => {
  if (!state.showcase.slides.length) return;
  state.showcase.timelineDragging = true;
  const rect = el.showcaseTimeline.getBoundingClientRect();
  seekShowcase(((event.clientX - rect.left) / rect.width) * totalShowcaseDuration());
});
el.showcaseAudioTimeline.addEventListener("mousedown", (event) => {
  if (!effectiveMusicUrl()) return;
  state.showcase.waveformDragging = true;
  setAudioOffsetFromPointer(event);
});
window.addEventListener("mousemove", (event) => {
  if (state.showcase.timelineDragging) {
    const rect = el.showcaseTimeline.getBoundingClientRect();
    seekShowcase(((event.clientX - rect.left) / rect.width) * totalShowcaseDuration());
  }
  if (state.showcase.waveformDragging) setAudioOffsetFromPointer(event);
  if (state.showcase.activeDragTarget) updateShowcaseDrag(event);
});
window.addEventListener("mouseup", () => {
  if (state.matchSelectionDragging) {
    state.matchSelectionDragging = false;
    renderPlayerDetail();
  }
  if (state.showcase.waveformDragging) {
    state.showcase.waveformDragging = false;
    saveShowcaseSettings({ audio_offset_ms: state.config.showcase.audio_offset_ms });
  }
  state.showcase.timelineDragging = false;
  endShowcaseDrag();
});
el.showcaseCanvas.addEventListener("mousedown", (event) => beginShowcaseDrag(hitTestShowcaseElement(event), event));
el.showcaseCanvas.addEventListener("mousemove", (event) => {
  if (state.view !== "showcase" || document.fullscreenElement || !state.showcase.slides.length) {
    el.showcaseCanvas.style.cursor = "";
    return;
  }
  el.showcaseCanvas.style.cursor = hitTestShowcaseElement(event) ? "grab" : "";
});
document.addEventListener("keydown", (event) => {
  if (state.view !== "showcase") return;
  if (isEditableEventTarget(event.target)) return;
  if (event.code === "Space") {
    event.preventDefault();
    toggleShowcasePlayback();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    previousShowcaseSlide();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    nextShowcaseSlide();
  } else if (event.key === "f" || event.key === "F" || event.key === "F11") {
    event.preventDefault();
    enterShowcaseFullscreen();
  } else if (event.key === "p" || event.key === "P") {
    state.showcase.particlesEnabled = !state.showcase.particlesEnabled;
    renderShowcasePreview();
  } else if (event.key === "Escape" && el.showcaseArea.classList.contains("showcase-fullscreen-fallback")) {
    el.showcaseArea.classList.remove("showcase-fullscreen-fallback");
    renderShowcasePreview();
  }
});
document.addEventListener("fullscreenchange", () => {
  el.showcaseArea.classList.remove("showcase-fullscreen-fallback");
  if (document.fullscreenElement === el.showcaseArea && state.showcase.slides.length) {
    seekShowcase(0);
    state.showcase.animationStartTime = performance.now();
  }
  renderShowcasePreview();
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderPreview();
    renderShowcasePreview();
    renderAudioWaveform();
  }, 80);
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

loadConfig().then(async () => {
  configureShowcaseAudio();
  await loadShowcaseMusic().catch(() => {});
  configureShowcaseAudio();
  setView(state.view);
});
