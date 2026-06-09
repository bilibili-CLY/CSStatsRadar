const state = {
  demoId: null,
  players: [],
  selectedPlayer: null,
  radarData: null,
  tooltipZones: [],
  config: {
    export_width: 1920,
    export_height: 1080,
    theme_color: "#00ffff",
    color_preset: "default",
    last_player_identifier_type: "name",
  },
};

const el = {
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
  themeColor: document.querySelector("#themeColor"),
  colorPreset: document.querySelector("#colorPreset"),
  canvas: document.querySelector("#radarCanvas"),
  chartTooltip: document.querySelector("#chartTooltip"),
};

const presetColors = {
  default: "#00ffff",
  ember: "#ff4d5f",
  lime: "#7dff6a",
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

function formatMetric(value, type) {
  if (value === null || value === undefined) return "不可用";
  if (type === "percentage") return `${Math.round(value * 100)}%`;
  return Number(value).toFixed(value >= 10 ? 1 : 2);
}

function renderCandidates(players) {
  el.candidates.innerHTML = "";
  if (!players.length) {
    el.candidates.innerHTML = `<div class="muted">暂无可选玩家。</div>`;
    return;
  }
  players.forEach((player) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "candidate";
    if (state.selectedPlayer?.steam_id === player.steam_id) button.classList.add("selected");
    button.innerHTML = `<strong>${escapeHtml(player.name)}</strong><br><span>${escapeHtml(player.steam_id)}</span>`;
    button.addEventListener("click", () => selectPlayer(player));
    el.candidates.appendChild(button);
  });
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
  const rect = el.canvas.parentElement.getBoundingClientRect();
  const width = Math.max(640, Math.floor(rect.width));
  const height = Math.max(420, Math.floor(rect.height));
  drawRadar(el.canvas, state.radarData, { width, height, themeColor: state.config.theme_color });
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

  const playerName = radarData?.player?.name || "请上传 Demo";
  ctx.textAlign = "left";
  ctx.font = `800 ${Math.max(32, width / 24)}px Inter, sans-serif`;
  ctx.fillStyle = "#f0fbff";
  ctx.fillText(playerName, width * 0.06, height * 0.12);
  ctx.font = `500 ${Math.max(14, width / 88)}px Inter, sans-serif`;
  ctx.fillStyle = "#88a0ad";
  ctx.fillText("每回合击杀 / 存活率 / 平均伤害 / 没白给 / 影响力 / 综合评分", width * 0.06, height * 0.16);
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
    el.themeColor.value = state.config.theme_color;
    el.colorPreset.value = state.config.color_preset;
    setAccent(state.config.theme_color);
    if (config.warning) showError({ code: "config_read_failed", message: config.warning });
  } catch (error) {
    showError(error);
  }
}

async function saveConfig() {
  state.config = {
    export_width: Number(el.exportWidth.value),
    export_height: Number(el.exportHeight.value),
    theme_color: el.themeColor.value,
    color_preset: el.colorPreset.value,
    last_player_identifier_type: "steam_id",
  };
  setAccent(state.config.theme_color);
  renderPreview();
  try {
    await api("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.config),
    });
  } catch (error) {
    showError(error);
  }
}

el.demoFile.addEventListener("change", () => {
  const file = el.demoFile.files[0];
  el.fileName.textContent = file ? file.name : "选择已解压的 .dem 文件";
});

el.uploadBtn.addEventListener("click", async () => {
  clearError();
  const file = el.demoFile.files[0];
  if (!file) return showError({ code: "invalid_file_type", message: "请选择已解压的 .dem 文件。" });
  const form = new FormData();
  form.append("file", file);
  el.uploadBtn.disabled = true;
  el.uploadState.textContent = "正在上传并解析...";
  try {
    const data = await api("/api/demos", { method: "POST", body: form });
    state.demoId = data.demo_id;
    state.players = data.players;
    state.selectedPlayer = null;
    state.radarData = null;
    el.exportBtn.disabled = true;
    renderMetricList(null);
    renderPreview();
    el.uploadState.textContent = `已解析 ${data.players.length} 名玩家，请点击玩家生成雷达图。`;
    renderCandidates(data.players);
  } catch (error) {
    showError(error);
    el.uploadState.textContent = "解析失败。";
  } finally {
    el.uploadBtn.disabled = false;
  }
});

el.exportBtn.addEventListener("click", () => {
  clearError();
  if (!state.radarData) return showError({ code: "metric_unavailable", message: "没有可导出的雷达数据。" });
  const width = Number(el.exportWidth.value);
  const height = Number(el.exportHeight.value);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return showError({ code: "invalid_export_size", message: "导出宽高必须是正整数。" });
  }
  const exportCanvas = document.createElement("canvas");
  drawRadar(exportCanvas, state.radarData, { width, height, themeColor: state.config.theme_color });
  const link = document.createElement("a");
  const safeName = (state.radarData.player.name || state.radarData.player.steam_id).replace(/[^a-z0-9_-]+/gi, "-");
  link.download = `${safeName}-radar.png`;
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
});

el.themeColor.addEventListener("input", saveConfig);
el.colorPreset.addEventListener("change", () => {
  const color = presetColors[el.colorPreset.value] || presetColors.default;
  el.themeColor.value = color;
  saveConfig();
});
el.exportWidth.addEventListener("change", saveConfig);
el.exportHeight.addEventListener("change", saveConfig);

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

loadConfig().then(renderPreview);
