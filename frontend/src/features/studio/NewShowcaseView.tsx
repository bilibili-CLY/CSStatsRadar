import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Maximize2, Minimize2, Play, Pause, RotateCcw, ChevronLeft, ChevronRight, Sparkles, Sliders, Volume2, VolumeX } from "lucide-react";
import { bridge } from "../../bridge";
import { useAppStore } from "../../stores/appStore";
import { useStudioStore } from "../../stores/studioStore";
import type { ShowcaseSlide, RadarResponse } from "../../types";

const COLOR_PRESETS = [
  { color: "#00ffff", bg1: "#001a1a", bg2: "#000d0d" },
  { color: "#ff00ff", bg1: "#1a001a", bg2: "#0d000d" },
  { color: "#ffff00", bg1: "#1a1a00", bg2: "#0d0d00" },
  { color: "#00ff00", bg1: "#001a00", bg2: "#000d00" },
  { color: "#ff4500", bg1: "#1a0700", bg2: "#0d0300" },
  { color: "#1e90ff", bg1: "#000f1a", bg2: "#00070d" },
  { color: "#ff0040", bg1: "#1a0006", bg2: "#0d0003" },
  { color: "#7cfc00", bg1: "#0c1a00", bg2: "#060d00" },
  { color: "#ba55d3", bg1: "#13091a", bg2: "#09040d" },
  { color: "#40e0d0", bg1: "#061a18", bg2: "#030d0c" },
  { color: "#f08080", bg1: "#1a0e0e", bg2: "#0d0707" },
  { color: "#00fa9a", bg1: "#001a10", bg2: "#000d08" },
  { color: "#ff8c00", bg1: "#1a0e00", bg2: "#0d0700" },
  { color: "#9370db", bg1: "#0f0b1a", bg2: "#07050d" },
  { color: "#00ced1", bg1: "#00151a", bg2: "#000a0d" },
  { color: "#ff1493", bg1: "#1a0210", bg2: "#0d0108" },
  { color: "#adff2f", bg1: "#111a03", bg2: "#080d01" },
  { color: "#b0c4de", bg1: "#12141a", bg2: "#090a0d" },
  { color: "#eea2ad", bg1: "#1a1112", bg2: "#0d0809" },
  { color: "#00bfff", bg1: "#00131a", bg2: "#00090d" },
];

function hexToRgbA(hex: string, alpha: number) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`
    : `rgba(255,255,255,${alpha})`;
}

function lerpColor(c1: string, c2: string, t: number) {
  const r1 = parseInt(c1.substring(1, 3), 16) || 0;
  const g1 = parseInt(c1.substring(3, 5), 16) || 0;
  const b1 = parseInt(c1.substring(5, 7), 16) || 0;
  const r2 = parseInt(c2.substring(1, 3), 16) || 0;
  const g2 = parseInt(c2.substring(3, 5), 16) || 0;
  const b2 = parseInt(c2.substring(5, 7), 16) || 0;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export interface RockBandItem {
  id: string;
  name: string;
  points: number[];
  baseMaxScores: number[];
  minScores: number[];
  dimNames: string[];
  usePercentage: boolean[];
  desc: string;
  color: string;
  bg1: string;
  bg2: string;
  duration: number; // ms
  imageUrl?: string;
  backgroundUrl?: string;
  precisions: number[];
}

// 缺省明星选手数据（当现有轮播尚未加入选手时展示）
const DEFAULT_BANDS: RockBandItem[] = [
  {
    id: "donk",
    name: "donk",
    points: [0.99, 0.34, 101.4, 0.782, 1.75, 1.49],
    baseMaxScores: [0.8, 0.5, 70, 0.7, 1.0, 1.2],
    minScores: [0, 0, 0, 0, 0, 0],
    dimNames: ["KPR", "Surviving", "ADR", "KAST", "Impact", "Rating"],
    usePercentage: [false, true, false, true, false, false],
    desc: "Team Spirit · 突破之神 · 无需多言",
    color: "#00ffff",
    bg1: "#001a1a",
    bg2: "#000d0d",
    duration: 6000,
    precisions: [2, 1, 1, 1, 2, 2],
  },
  {
    id: "m0nesy",
    name: "m0NESY",
    points: [0.85, 0.41, 85.6, 0.765, 1.35, 1.31],
    baseMaxScores: [0.8, 0.5, 70, 0.7, 1.0, 1.2],
    minScores: [0, 0, 0, 0, 0, 0],
    dimNames: ["KPR", "Surviving", "ADR", "KAST", "Impact", "Rating"],
    usePercentage: [false, true, false, true, false, false],
    desc: "G2 Esports · 天才少年狙击手 · 绝境残局大师",
    color: "#f59e0b",
    bg1: "#1a0e00",
    bg2: "#0d0700",
    duration: 6000,
    precisions: [2, 1, 1, 1, 2, 2],
  },
  {
    id: "zywoo",
    name: "ZywOo",
    points: [0.83, 0.43, 87.2, 0.785, 1.38, 1.33],
    baseMaxScores: [0.8, 0.5, 70, 0.7, 1.0, 1.2],
    minScores: [0, 0, 0, 0, 0, 0],
    dimNames: ["KPR", "Surviving", "ADR", "KAST", "Impact", "Rating"],
    usePercentage: [false, true, false, true, false, false],
    desc: "Team Vitality · 大番薯 · 极致稳定机器",
    color: "#38bdf8",
    bg1: "#000f1a",
    bg2: "#00070d",
    duration: 6000,
    precisions: [2, 1, 1, 1, 2, 2],
  },
  {
    id: "b1t",
    name: "b1t",
    points: [0.75, 0.35, 78.4, 0.742, 1.15, 1.18],
    baseMaxScores: [0.8, 0.5, 70, 0.7, 1.0, 1.2],
    minScores: [0, 0, 0, 0, 0, 0],
    dimNames: ["KPR", "Surviving", "ADR", "KAST", "Impact", "Rating"],
    usePercentage: [false, true, false, true, false, false],
    desc: "Natus Vincere · 爆头机器 · Major 冠军功臣",
    color: "#ffff00",
    bg1: "#1a1a00",
    bg2: "#0d0d00",
    duration: 6000,
    precisions: [2, 1, 1, 1, 2, 2],
  },
  {
    id: "niko",
    name: "NiKo",
    points: [0.82, 0.33, 86.8, 0.735, 1.32, 1.24],
    baseMaxScores: [0.8, 0.5, 70, 0.7, 1.0, 1.2],
    minScores: [0, 0, 0, 0, 0, 0],
    dimNames: ["KPR", "Surviving", "ADR", "KAST", "Impact", "Rating"],
    usePercentage: [false, true, false, true, false, false],
    desc: "沙鹰之王 · 步枪天花板 · 明星突破手",
    color: "#ff0040",
    bg1: "#1a0006",
    bg2: "#0d0003",
    duration: 6000,
    precisions: [2, 1, 1, 1, 2, 2],
  },
];

export function NewShowcaseView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement>(null);
  const particlesCanvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLImageElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const globalBarRef = useRef<HTMLDivElement>(null);
  const sessionTimerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const mvpContainerRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [bands, setBands] = useState<RockBandItem[]>(DEFAULT_BANDS);
  const [activeBandIndex, setActiveBandIndex] = useState(0);

  // 1. 加载现有轮播的草稿数据（确保数据完全一致）
  useEffect(() => {
    let active = true;
    bridge.loadDraft("showcase").then((draftRecord: any) => {
      if (!active || !draftRecord?.payload) return;
      try {
        const parsed = JSON.parse(draftRecord.payload);
        const slides = (parsed.slides as ShowcaseSlide[]) || [];
        if (slides.length > 0) {
          const mapped: RockBandItem[] = slides.map((slide, idx) => {
            const preset = COLOR_PRESETS[idx % COLOR_PRESETS.length];
            const color = slide.color || preset.color;
            const radar = slide.radar?.radar;
            const dims = radar?.dimensions?.length ? radar.dimensions : ["KPR", "Surviving", "ADR", "KAST", "Impact", "Rating"];
            const rawPoints = dims.map((_, i) => radar?.values?.[i] ?? 0);
            const rawMax = dims.map((_, i) => radar?.max_values?.[i] || 1);
            const usePct = dims.map((_, i) => radar?.display_types?.[i] === "percent" || radar?.display_types?.[i] === "percentage");

            // 计算小数位数
            const precisions = rawPoints.map((val, i) => {
              if (usePct[i]) return 1;
              if (val < 2) return 2;
              return 1;
            });

            return {
              id: slide.id || `slide-${idx}`,
              name: slide.title || "CS 选手",
              points: rawPoints,
              baseMaxScores: rawMax,
              minScores: [0, 0, 0, 0, 0, 0],
              dimNames: dims,
              usePercentage: usePct,
              desc: slide.subtitle || "",
              color: color,
              bg1: preset.bg1,
              bg2: preset.bg2,
              duration: (slide.duration || 5) * 1000,
              imageUrl: slide.imageUrl || slide.avatarUrl,
              backgroundUrl: slide.backgroundUrl,
              precisions: precisions,
            };
          });
          setBands(mapped);
        }
      } catch (err) {
        console.warn("未能读取现有轮播草稿，使用内置选手数据", err);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // 全屏监听
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // 2. 核心动画与渲染引擎（移植自 Rock-Radar index - cs.html）
  useEffect(() => {
    const radarCanvas = radarCanvasRef.current;
    const pCanvas = particlesCanvasRef.current;
    if (!radarCanvas || !pCanvas) return;

    const ctx = radarCanvas.getContext("2d");
    const pCtx = pCanvas.getContext("2d");
    if (!ctx || !pCtx) return;

    let animFrameId: number;
    let isDestroyed = false;

    // 时间轴与状态变量
    let globalCurrentTime = 0; // ms
    let currentIndex = -1;
    let isPaused = !isPlaying;
    let lastTimestamp = 0;

    let currentThemeColor = bands[0]?.color || "#00ffff";
    let targetThemeColor = bands[0]?.color || "#00ffff";
    let currentScores = [0, 0, 0, 0, 0, 0];
    let startScores = [0, 0, 0, 0, 0, 0];
    let targetScores = [0, 0, 0, 0, 0, 0];
    let animProgress = 1;
    let animStartTime = 0;

    // 计算分段
    let elapsed = 0;
    const timeSegments = bands.map((band, idx) => {
      const start = elapsed;
      const end = elapsed + band.duration;
      elapsed = end;
      return { start, end, bandIndex: idx };
    });
    const totalDuration = elapsed || 1;

    // 粒子系统
    const resizeCanvas = () => {
      if (!pCanvas) return;
      pCanvas.width = window.innerWidth;
      pCanvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    class Particle {
      type: "normal" | "nebula";
      x = 0;
      y = 0;
      vx = 0;
      vy = 0;
      size = 0;
      bloomMult = 10;
      alphaMult = 0.9;
      life = 1;
      isTop = false;

      constructor(type: "normal" | "nebula" = "normal") {
        this.type = type;
        this.reset(true);
      }

      reset(init = false) {
        if (!pCanvas) return;
        this.x = Math.random() * pCanvas.width;
        this.isTop = Math.random() > 0.5;
        this.y = this.isTop ? -100 : pCanvas.height + 100;
        if (init) this.y = Math.random() * pCanvas.height;

        if (this.type === "normal") {
          this.vy = (this.isTop ? 1 : -1) * (Math.random() * 1.5 + 0.5);
          this.vx = (Math.random() - 0.5) * 1;
          this.size = Math.random() * 2 + 1;
          this.bloomMult = 20;
          this.alphaMult = 1.8;
        } else {
          this.vy = (this.isTop ? 1 : -1) * (Math.random() * 0.4 + 0.2);
          this.vx = (Math.random() - 0.5) * 0.5;
          this.size = Math.random() * 5 + 5;
          this.bloomMult = 30;
          this.alphaMult = 0.5;
        }
      }

      update() {
        if (!pCanvas) return;
        this.x += this.vx;
        this.y += this.vy;
        const dist = Math.abs(this.y - pCanvas.height / 2) / (pCanvas.height / 2);
        this.life = dist;
        if (this.life <= 0.05 || this.y < -150 || this.y > pCanvas.height + 150) {
          this.reset();
        }
      }

      draw() {
        if (!pCtx || !particlesEnabled) return;
        pCtx.save();
        pCtx.globalAlpha = Math.max(0, this.life * this.alphaMult);
        const gradSize = this.size * this.bloomMult;
        const gradient = pCtx.createRadialGradient(this.x, this.y, 0, this.x, this.y, gradSize);
        gradient.addColorStop(0, hexToRgbA(currentThemeColor, 0.7));
        gradient.addColorStop(0.3, hexToRgbA(currentThemeColor, 0.2));
        gradient.addColorStop(1, "transparent");
        pCtx.fillStyle = gradient;
        pCtx.beginPath();
        pCtx.arc(this.x, this.y, gradSize, 0, Math.PI * 2);
        pCtx.fill();
        if (this.type === "normal") {
          pCtx.fillStyle = "#fff";
          pCtx.beginPath();
          pCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
          pCtx.fill();
        }
        pCtx.restore();
      }
    }

    const particles: Particle[] = [];
    for (let i = 0; i < 50; i++) particles.push(new Particle("normal"));
    for (let i = 0; i < 25; i++) particles.push(new Particle("nebula"));

    // 格式化雷达数值
    const formatRadarValue = (value: number, index: number, band: RockBandItem) => {
      const precision = band.precisions[index] ?? 1;
      if (band.usePercentage[index]) {
        const isFractional = value <= 1 && value > 0;
        const pctValue = isFractional ? value * 100 : value;
        return `${pctValue.toFixed(precision)}%`;
      }
      return value.toFixed(precision);
    };

    // 绘制雷达图
    const drawRadar = (band: RockBandItem) => {
      const w = radarCanvas.width;
      const h = radarCanvas.height;
      const centerX = w / 2;
      const centerY = h / 2;
      const maxR = 1000 * 0.4;
      const count = band.dimNames.length || 6;

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.lineWidth = 3;

      // 1. 背景网格 (5 级刻度)
      const gridLevels = 5;
      for (let layer = 1; layer <= gridLevels; layer++) {
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const r = (layer / gridLevels) * maxR;
          const angle = ((i * (360 / count) - 90) * Math.PI) / 180;
          const x = centerX + r * Math.cos(angle);
          const y = centerY + r * Math.sin(angle);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(255, 255, 255, ${layer === gridLevels ? 0.5 : 0.2})`;
        ctx.stroke();
      }

      // 2. 轴向量
      for (let i = 0; i < count; i++) {
        const angle = ((i * (360 / count) - 90) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX + maxR * Math.cos(angle), centerY + maxR * Math.sin(angle));
        ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
        ctx.stroke();
      }

      // 3. 雷达多边形 (允许超出 maxR，越界冲破外圈)
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const dimMaxScore = band.baseMaxScores[i] || 1;
        const dimMinScore = band.minScores[i] || 0;
        const range = Math.max(0.0001, dimMaxScore - dimMinScore);
        const score = currentScores[i] ?? 0;
        const r = ((score - dimMinScore) / range) * maxR;
        const angle = ((i * (360 / count) - 90) * Math.PI) / 180;
        const x = centerX + r * Math.cos(angle);
        const y = centerY + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // 基础填充
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexToRgbA(currentThemeColor, 0.25);
      ctx.fill();

      // 4 重激光边缘辉光叠加 (Rock-Radar 特色高光束)
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // 1. 超宽范围的环境光晕
      ctx.shadowBlur = 100;
      ctx.shadowColor = currentThemeColor;
      ctx.strokeStyle = currentThemeColor;
      ctx.lineWidth = 4;
      ctx.stroke();

      // 2. 中层高饱和度激光束
      ctx.shadowBlur = 40;
      ctx.shadowColor = currentThemeColor;
      ctx.strokeStyle = currentThemeColor;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // 3. 核心亮白色高能射线
      ctx.shadowBlur = 15;
      ctx.shadowColor = "#fff";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 4. 二次强化最亮核心
      ctx.shadowBlur = 5;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.restore();

      // 4. 维度名称与数值文字 (大字号 Orbitron)
      const labelMargin = 30;
      for (let i = 0; i < count; i++) {
        const angle = ((i * (360 / count) - 90) * Math.PI) / 180;
        const x = centerX + (maxR + labelMargin) * Math.cos(angle);
        const y = centerY + (maxR + labelMargin) * Math.sin(angle);

        ctx.textAlign = Math.abs(Math.cos(angle)) < 0.1 ? "center" : Math.cos(angle) > 0 ? "left" : "right";
        ctx.textBaseline = "middle";

        const valStr = formatRadarValue(currentScores[i] ?? 0, i, band);

        // 第一行：维度名
        ctx.font = 'bold 28px "Orbitron", "Noto Sans SC", sans-serif';
        ctx.fillStyle = "#fff";
        ctx.fillText(band.dimNames[i] || `DIM ${i + 1}`, x, y - 18);

        // 第二行：数值
        ctx.font = 'normal 24px "Orbitron", sans-serif';
        ctx.fillStyle = currentThemeColor;
        ctx.fillText(valStr, x, y + 18);
      }

      ctx.restore();
    };

    // UI 更新与选手切换
    const performTransition = (band: RockBandItem, isFirst = false) => {
      targetThemeColor = band.color;
      if (containerRef.current) {
        containerRef.current.style.setProperty("--theme-color", band.color);
        containerRef.current.style.setProperty("--bg-color-1", band.bg1);
        containerRef.current.style.setProperty("--bg-color-2", band.bg2);
      }

      if (nameRef.current) {
        nameRef.current.textContent = band.name;
        nameRef.current.style.animation = "none";
        void nameRef.current.offsetWidth;
        nameRef.current.style.animation = "nameEntrance 1.2s cubic-bezier(0.23, 1, 0.32, 1) forwards";
      }

      if (descRef.current) {
        descRef.current.textContent = band.desc;
      }

      if (photoRef.current) {
        if (band.imageUrl) {
          photoRef.current.src = band.imageUrl;
          photoRef.current.style.opacity = "1";
          photoRef.current.style.transform = "rotateY(0) translateZ(0)";
        } else {
          photoRef.current.style.opacity = "0";
        }
      }

      // MVP 底图更新
      if (mvpContainerRef.current) {
        const oldMvp = mvpContainerRef.current.querySelector(".mvp-bg-image");
        if (oldMvp) oldMvp.remove();

        if (band.backgroundUrl) {
          const img = document.createElement("img");
          img.className = "mvp-bg-image active";
          img.src = band.backgroundUrl;
          img.style.position = "absolute";
          img.style.top = "0";
          img.style.left = "0";
          img.style.width = "100%";
          img.style.height = "100%";
          img.style.objectFit = "contain";
          img.style.objectPosition = "left center";
          img.style.opacity = "0.45";
          img.style.pointerEvents = "none";
          img.style.maskImage = "linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 65%)";
          (img.style as any).webkitMaskImage = "linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 65%)";
          mvpContainerRef.current.appendChild(img);
        }
      }

      // 分数目标缓动
      if (isFirst) {
        startScores = [0, 0, 0, 0, 0, 0];
      } else {
        startScores = [...currentScores];
      }
      targetScores = band.points.map((v, i) => Math.max(band.minScores[i] ?? 0, v));
      animProgress = 0;
      animStartTime = performance.now();
      setActiveBandIndex(bands.indexOf(band));
    };

    const updateUI = (band: RockBandItem, isFirst = false) => {
      if (!isFirst && nameRef.current && photoRef.current) {
        nameRef.current.classList.add("fade-out");
        photoRef.current.style.transform = "scale(0.3) translateZ(-500px)";
        photoRef.current.style.opacity = "0";
        setTimeout(() => {
          nameRef.current?.classList.remove("fade-out");
          performTransition(band, isFirst);
        }, 350);
      } else {
        performTransition(band, isFirst);
      }
    };

    // 核心 Tick 循环
    const tick = (timestamp: number) => {
      if (isDestroyed) return;
      if (!lastTimestamp) lastTimestamp = timestamp;
      const deltaTime = timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      // 1. 全局进度推进
      if (isPlaying && globalCurrentTime < totalDuration) {
        globalCurrentTime += deltaTime;
        if (globalCurrentTime >= totalDuration) {
          globalCurrentTime = 0; // 自动循环播放
        }

        // 更新全局时间轴与倒计时
        if (globalBarRef.current) {
          const pct = (globalCurrentTime / totalDuration) * 100;
          globalBarRef.current.style.width = `${pct}%`;
        }

        // 检查当前应该展示哪个选手
        const currentSegment = timeSegments.find(
          (s) => globalCurrentTime >= s.start && globalCurrentTime < s.end,
        );
        if (currentSegment && currentSegment.bandIndex !== currentIndex) {
          currentIndex = currentSegment.bandIndex;
          updateUI(bands[currentIndex], currentIndex === 0 && globalCurrentTime < 500);
        }

        // 单卡片倒计时进度条
        if (progressBarRef.current && currentSegment) {
          const segmentElapsed = globalCurrentTime - currentSegment.start;
          const segmentDuration = currentSegment.end - currentSegment.start;
          const cardPct = Math.min(100, (segmentElapsed / segmentDuration) * 100);
          progressBarRef.current.style.width = `${cardPct}%`;
        }

        // 顶部时钟
        if (sessionTimerRef.current) {
          const totalSec = Math.floor(globalCurrentTime / 1000);
          const h = Math.floor(totalSec / 3600).toString().padStart(2, "0");
          const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
          const s = (totalSec % 60).toString().padStart(2, "0");
          sessionTimerRef.current.textContent = `${h}:${m}:${s}`;
        }
      }

      // 2. 颜色插值平滑渐变
      if (currentThemeColor !== targetThemeColor) {
        currentThemeColor = lerpColor(currentThemeColor, targetThemeColor, 0.05);
      }

      // 3. 雷达图数值生长与缓动
      const activeBand = bands[currentIndex] || bands[0];
      const animDuration = 1200;
      if (animProgress < 1) {
        animProgress = Math.min(1, (performance.now() - animStartTime) / animDuration);
        const ease = 1 - Math.pow(1 - animProgress, 3); // cubicOut
        currentScores = startScores.map((start, i) => {
          const target = targetScores[i] ?? 0;
          return start + (target - start) * ease;
        });
      }

      // 4. 绘制
      drawRadar(activeBand);

      // 5. 绘制粒子
      if (pCtx && particlesEnabled) {
        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
        particles.forEach((p) => {
          p.update();
          p.draw();
        });
      }

      animFrameId = requestAnimationFrame(tick);
    };

    // 初始启动
    updateUI(bands[0], true);
    currentIndex = 0;
    animFrameId = requestAnimationFrame(tick);

    // 键盘快捷键监听
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setIsPlaying((v) => !v);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        const nextIdx = Math.max(0, currentIndex - 1);
        globalCurrentTime = timeSegments[nextIdx].start;
        currentIndex = nextIdx;
        updateUI(bands[currentIndex], false);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        const nextIdx = Math.min(bands.length - 1, currentIndex + 1);
        globalCurrentTime = timeSegments[nextIdx].start;
        currentIndex = nextIdx;
        updateUI(bands[currentIndex], false);
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "p" || e.key === "P") {
        setParticlesEnabled((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      isDestroyed = true;
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [bands, isPlaying, particlesEnabled]);

  return (
    <div
      ref={containerRef}
      className={`new-showcase-container ${!particlesEnabled ? "particles-disabled" : ""}`}
      style={{
        position: "relative",
        width: "100%",
        minHeight: "calc(100vh - 120px)",
        height: isFullscreen ? "100vh" : "860px",
        background: "#000",
        backgroundImage: "linear-gradient(135deg, var(--bg-color-1, #0f1015), var(--bg-color-2, #1a1a2e), #050508, #111)",
        backgroundSize: "400% 400%",
        animation: "gradientBG 30s ease infinite",
        color: "#fff",
        overflow: "hidden",
        borderRadius: isFullscreen ? "0" : "14px",
        border: isFullscreen ? "none" : "1px solid var(--border)",
        fontFamily: '"Orbitron", "Noto Sans SC", sans-serif',
      }}
    >
      {/* 动态注入 Rock-Radar 原生专属 CSS 样式表 */}
      <style>{`
        @keyframes gradientBG {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes nameEntrance {
          0% { opacity: 0; transform: scale(0.5) translateZ(-200px); filter: blur(10px); }
          100% { opacity: 1; transform: scale(1) translateZ(0); filter: blur(0); }
        }
        @keyframes descEntrance {
          0% { opacity: 0; transform: translateY(20px) translateZ(-50px); }
          100% { opacity: 1; transform: translateY(0) translateZ(0); }
        }
        .band-photo {
          transition: transform 1.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.8s ease;
        }
        .fade-out {
          opacity: 0 !important;
          transform: scale(0.8) translateZ(-100px) !important;
          transition: all 0.4s ease-in !important;
        }
        .hover-control-bar {
          opacity: 0.15;
          transition: opacity 0.3s ease;
        }
        .hover-control-bar:hover {
          opacity: 1;
        }
      `}</style>

      {/* 粒子 Canvas */}
      <canvas
        ref={particlesCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* MVP 背景容器 */}
      <div
        ref={mvpContainerRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 2,
          pointerEvents: "none",
        }}
      />

      {/* 悬浮控制栏 */}
      <div
        className="hover-control-bar"
        style={{
          position: "absolute",
          top: "16px",
          left: "24px",
          right: "24px",
          zIndex: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "rgba(10, 15, 25, 0.75)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          padding: "8px 16px",
          borderRadius: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Sparkles size={16} color="var(--theme-color, #00ffff)" />
          <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "1px" }}>
            ROCK-RADAR 新轮播 · {bands[activeBandIndex]?.name || ""}
          </span>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
            [空格: 播放/暂停] [左右键: 切换选手] [F: 全屏] [P: 粒子开关]
          </span>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            onClick={() => setIsPlaying((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 10px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "6px",
              color: "#fff",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            {isPlaying ? "暂停" : "播放"}
          </button>

          <button
            onClick={() => setParticlesEnabled((v) => !v)}
            style={{
              padding: "4px 10px",
              background: particlesEnabled ? "rgba(34, 211, 238, 0.15)" : "rgba(255,255,255,0.08)",
              border: `1px solid ${particlesEnabled ? "var(--cyan)" : "rgba(255,255,255,0.15)"}`,
              borderRadius: "6px",
              color: "#fff",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            粒子特效: {particlesEnabled ? "开" : "关"}
          </button>

          <button
            onClick={toggleFullscreen}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 10px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "6px",
              color: "#fff",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {isFullscreen ? "退出全屏" : "全屏"}
          </button>
        </div>
      </div>

      {/* 主舞台 (左右分栏，来自 index - cs.html) */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: "2vh 2vw",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "96%",
            maxWidth: "1600px",
            height: "90%",
            alignItems: "center",
          }}
        >
          {/* 左侧：超清 1600x1600 激光雷达 Canvas */}
          <div
            style={{
              flex: 1.3,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              position: "relative",
              overflow: "visible",
            }}
          >
            <canvas
              ref={radarCanvasRef}
              width={1600}
              height={1600}
              style={{
                width: "100%",
                maxWidth: "760px",
                aspectRatio: "1/1",
                transform: "scale(1.2)",
              }}
            />
          </div>

          {/* 右侧：选手信息、3D 立体悬浮照片与倒计时条 */}
          <div
            style={{
              flex: 0.9,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "0 20px",
              marginLeft: "4vw",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              {/* 选手名称 */}
              <div
                ref={nameRef}
                style={{
                  fontFamily: '"Orbitron", "Noto Sans SC", sans-serif',
                  fontSize: "3.2rem",
                  fontWeight: 900,
                  letterSpacing: "4px",
                  color: "#fff",
                  textShadow: "0 0 20px var(--theme-color, #00ffff)",
                  transition: "all 1.5s ease",
                  marginBottom: "16px",
                }}
              >
                {bands[activeBandIndex]?.name}
              </div>

              {/* 选手照片容器 (3D 透视) */}
              <div
                style={{
                  width: "100%",
                  height: "360px",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  perspective: "1200px",
                }}
              >
                <img
                  ref={photoRef}
                  className="band-photo"
                  src={bands[activeBandIndex]?.imageUrl || ""}
                  alt=""
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    opacity: bands[activeBandIndex]?.imageUrl ? 1 : 0,
                    filter: "drop-shadow(0 15px 30px rgba(0,0,0,0.85))",
                  }}
                />
              </div>

              {/* 选手副标题 / 描述信息 */}
              <div style={{ marginTop: "20px" }}>
                <div
                  ref={descRef}
                  style={{
                    display: "inline-block",
                    padding: "10px 18px",
                    background: "rgba(0, 0, 0, 0.45)",
                    borderLeft: "4px solid var(--theme-color, #00ffff)",
                    borderRadius: "0 8px 8px 0",
                    color: "rgba(255, 255, 255, 0.9)",
                    fontSize: "1rem",
                    letterSpacing: "1px",
                    lineHeight: "1.6",
                    backdropFilter: "blur(6px)",
                  }}
                >
                  {bands[activeBandIndex]?.desc}
                </div>
              </div>
            </div>

            {/* 单选手卡片剩余进度条 */}
            <div
              style={{
                width: "100%",
                height: "3px",
                background: "rgba(255, 255, 255, 0.1)",
                borderRadius: "2px",
                overflow: "hidden",
                marginTop: "32px",
              }}
            >
              <div
                ref={progressBarRef}
                style={{
                  width: "0%",
                  height: "100%",
                  background: "var(--theme-color, #00ffff)",
                  boxShadow: "0 0 10px var(--theme-color, #00ffff)",
                  transition: "width 0.1s linear",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 底部全局时间线 */}
      <div
        ref={timelineRef}
        style={{
          position: "absolute",
          bottom: "16px",
          left: "24px",
          right: "24px",
          height: "6px",
          background: "rgba(255, 255, 255, 0.12)",
          borderRadius: "3px",
          cursor: "pointer",
          zIndex: 20,
        }}
      >
        <div
          ref={globalBarRef}
          style={{
            width: "0%",
            height: "100%",
            background: "linear-gradient(90deg, #fff, var(--theme-color, #00ffff))",
            boxShadow: "0 0 10px var(--theme-color, #00ffff)",
            borderRadius: "3px",
          }}
        />
      </div>

      {/* 计时器显示 */}
      <div
        ref={sessionTimerRef}
        style={{
          position: "absolute",
          bottom: "28px",
          right: "32px",
          fontFamily: '"Orbitron", sans-serif',
          fontSize: "0.85rem",
          color: "rgba(255,255,255,0.45)",
          letterSpacing: "2px",
          zIndex: 20,
        }}
      >
        00:00:00
      </div>
    </div>
  );
}
