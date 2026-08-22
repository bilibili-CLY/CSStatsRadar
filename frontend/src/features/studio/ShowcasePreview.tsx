import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { selectRatingProfile } from "../../components/RadarCanvas";
import type { RatingVersion, ShowcaseLayoutDraft, ShowcaseSlide } from "../../types";
import {
  clampShowcaseTransform,
  nearestCornerDistance,
  selectionBounds,
  SHOWCASE_EXPORT_HEIGHT,
  SHOWCASE_EXPORT_WIDTH,
  showcasePreviewSize,
  showcaseSegment,
  targetBaseBounds,
  targetBounds,
  type ShowcaseTarget,
  type ShowcaseTransform,
  type ShowcaseAnimationOptions,
} from "./showcaseMath";
import {
  drawShowcaseSelection,
  ensureShowcaseFonts,
  loadImage,
  renderShowcaseFrame,
  showcasePlayerImageUrl,
} from "./showcaseRender";

export function ShowcasePreview({
  slides,
  layout,
  timeMs,
  playing,
  showBestMarkers,
  radarScaleMode,
  radarScale,
  radarAxisScale,
  ratingVersion,
  showRatingWatermark,
  metricLabelFontSize,
  animations,
  onLayoutChange,
  onImageTransformChange,
  previewTimeRef,
}: {
  slides: ShowcaseSlide[];
  layout: ShowcaseLayoutDraft;
  timeMs: number;
  playing: boolean;
  showBestMarkers: boolean;
  radarScaleMode: string;
  radarScale: number;
  radarAxisScale?: Record<string, number>;
  ratingVersion: RatingVersion;
  showRatingWatermark: boolean;
  metricLabelFontSize: number;
  animations: ShowcaseAnimationOptions;
  onLayoutChange: (layout: ShowcaseLayoutDraft) => void;
  onImageTransformChange: (transform: { x: number; y: number; scale: number }) => void;
  previewTimeRef?: React.MutableRefObject<number>;
}) {
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [assetRevision, setAssetRevision] = useState(0);
  const [fontState, setFontState] = useState<"loading" | "ready" | "error">("loading");
  const [isFullscreen, setIsFullscreen] = useState(false);
  type Target = "radar" | "title" | "subtitle" | "image" | "swing";
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(null);
  const selectionRef = useRef<Target | null>(null);
  const setSelectedTargetRef = (target: Target | null) => {
    selectionRef.current = target;
    setSelectedTarget(target);
  };
  const drag = useRef<{ pointerId: number; target: Target; mode: "move" | "resize"; offsetX: number; offsetY: number; initialScale: number; initialDistance: number; initialTransform: ShowcaseTransform; pendingTransform: ShowcaseTransform | null } | null>(null);
  const dragNeedsRedraw = useRef(false);
  const drawRef = useRef<((forceTimeMs?: number) => void) | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  useEffect(() => {
    const urls = slides.flatMap(
      (item) => [showcasePlayerImageUrl(item), item.backgroundUrl].filter(Boolean) as string[],
    );
    if (!urls.length) return;
    let active = true;
    Promise.allSettled(urls.map(loadImage)).then(() => {
      if (active) setAssetRevision((value) => value + 1);
    });
    return () => {
      active = false;
    };
  }, [slides]);
  useEffect(() => { ensureShowcaseFonts().then(() => { setFontState("ready"); setAssetRevision((value) => value + 1); }).catch(() => setFontState("error")); }, []);
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === fullscreenRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    syncFullscreen();
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || fontState !== "ready") return;
    let rafId = 0;
    const draw = (forceTimeMs?: number) => {
      const drawTimeMs = forceTimeMs ?? (previewTimeRef ? previewTimeRef.current : timeMs);
      const density = Math.min(2, window.devicePixelRatio || 1);
      const display = showcasePreviewSize(sizeRef.current.width, sizeRef.current.height);
      const width = Math.max(1, Math.round(display.width * density));
      const height = Math.max(1, Math.round(width * SHOWCASE_EXPORT_HEIGHT / SHOWCASE_EXPORT_WIDTH));
      canvas.style.width = `${display.width}px`;
      canvas.style.height = `${display.height}px`;
      const effectiveLayout = { ...layout };
      const dragState = drag.current;
      if (dragState?.pendingTransform) {
        const target = dragState.target;
        if (target === "radar") { effectiveLayout.radarX = dragState.pendingTransform.x; effectiveLayout.radarY = dragState.pendingTransform.y; effectiveLayout.radarScale = dragState.pendingTransform.scale; }
        else if (target === "swing") { effectiveLayout.swingX = dragState.pendingTransform.x; effectiveLayout.swingY = dragState.pendingTransform.y; effectiveLayout.swingScale = dragState.pendingTransform.scale; }
        else if (target === "title") { effectiveLayout.titleX = dragState.pendingTransform.x; effectiveLayout.titleY = dragState.pendingTransform.y; effectiveLayout.titleScale = dragState.pendingTransform.scale; }
        else if (target === "subtitle") { effectiveLayout.subtitleX = dragState.pendingTransform.x; effectiveLayout.subtitleY = dragState.pendingTransform.y; effectiveLayout.subtitleScale = dragState.pendingTransform.scale; }
      }
      const segmentIndex = showcaseSegment(slides, drawTimeMs, animations).index;
      const dragTransform =
        dragState?.pendingTransform && dragState.target === "image"
          ? dragState.pendingTransform
          : null;
      if (dragTransform)
        effectiveLayout.imageScale = dragTransform.scale;
      const effectiveSlides = dragTransform
        ? slides.map((item, index) =>
            index === segmentIndex
              ? { ...item, imageTransform: { x: dragTransform.x, y: dragTransform.y } }
              : item,
          )
        : slides;
      renderShowcaseFrame(
        effectiveSlides,
        effectiveLayout,
        width,
        height,
        drawTimeMs,
        canvas,
        showBestMarkers,
        radarScaleMode,
        radarScale,
        radarAxisScale,
        ratingVersion,
        showRatingWatermark,
        1,
        metricLabelFontSize,
        animations,
      );
      const currentSelection = selectionRef.current;
      if (currentSelection) {
        const t = dragState?.pendingTransform && dragState.target === currentSelection ? dragState.pendingTransform : currentTransform(currentSelection);
        drawShowcaseSelection(canvas, currentSelection, t, selectionBounds(currentSelection, t, canvas.width, canvas.height, effectiveLayout));
      }
      if (dragNeedsRedraw.current) {
        dragNeedsRedraw.current = false;
        rafId = requestAnimationFrame(() => draw());
      }
      // Continuous RAF loop only while playing (or while dragging, handled above).
      if (playing) {
        rafId = requestAnimationFrame(() => draw());
      }
    };
    drawRef.current = draw;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      sizeRef.current = { width: rect.width, height: rect.height };
    };
    measure();
    draw();
    const observer = new ResizeObserver(() => { measure(); draw(); });
    observer.observe(container);
    return () => { drawRef.current = null; observer.disconnect(); if (rafId) cancelAnimationFrame(rafId); };
  }, [slides, layout, assetRevision, fontState, showBestMarkers, radarScaleMode, radarScale, radarAxisScale, ratingVersion, showRatingWatermark, metricLabelFontSize, animations, playing, previewTimeRef]);
  useEffect(() => {
    if (playing) return;
    drawRef.current?.();
  }, [timeMs, playing]);
  function pointerPercent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100,
    };
  }
  function currentSlide() { return slides[showcaseSegment(slides, timeMs, animations).index]; }
  function currentTransform(target: Target) {
    if (target === "radar") return { x: layout.radarX, y: layout.radarY, scale: layout.radarScale };
    if (target === "swing") {
      const cw = canvasRef.current?.width ?? 1;
      const ch = canvasRef.current?.height ?? 1;
      const radarSize = (Math.min(cw * 0.48, ch * 0.78) * layout.radarScale) / 100;
      return { x: layout.swingX ?? layout.radarX, y: layout.swingY ?? (layout.radarY + radarSize / 2 / ch * 100 + 8), scale: layout.swingScale ?? 100 };
    }
    if (target === "title") return { x: layout.titleX ?? layout.nameX, y: layout.titleY ?? layout.nameY, scale: layout.titleScale ?? layout.nameScale };
    if (target === "subtitle") return { x: layout.subtitleX ?? layout.nameX, y: layout.subtitleY ?? layout.nameY + 4.5, scale: layout.subtitleScale ?? layout.nameScale };
    return {
      x: currentSlide()?.imageTransform?.x ?? layout.imageX,
      y: currentSlide()?.imageTransform?.y ?? layout.imageY,
      scale: layout.imageScale,
    };
  }
  function patchTransform(target: Target, transform: { x: number; y: number; scale: number }) {
    if (target === "image") return onImageTransformChange(transform);
    const keys = target === "radar" ? ["radarX","radarY","radarScale"] : target === "swing" ? ["swingX","swingY","swingScale"] : target === "title" ? ["titleX","titleY","titleScale"] : ["subtitleX","subtitleY","subtitleScale"];
    onLayoutChange({ ...layout, [keys[0]]: transform.x, [keys[1]]: transform.y, [keys[2]]: transform.scale });
  }
  function hitTarget(point: { x: number; y: number }): Target | null {
    const available: Target[] = [];
    const baseLayers = layout.layers ?? ["radar","image","name"];
    const layers = ratingVersion === "rating_3" && !baseLayers.includes("swing")
      ? [...baseLayers, "swing"]
      : baseLayers;
    for (const layer of layers) layer === "name" ? available.push("subtitle","title") : available.push(layer as Target);
    const canvasWidth = canvasRef.current?.width ?? 1;
    const canvasHeight = canvasRef.current?.height ?? 1;
    const swingIndex = available.indexOf("swing");
    const swingSlide = currentSlide();
    if (
      swingIndex >= 0 &&
      swingSlide &&
      selectRatingProfile(swingSlide.radar, ratingVersion).radar.round_swing !=
        null
    ) {
      const swing = currentTransform("swing");
      const bounds = selectionBounds("swing", swing, canvasWidth, canvasHeight, layout);
      if (point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom) return "swing";
    }
    return available.find((target) => {
      if (target === "swing") return false;
      if (target === "image" && !showcasePlayerImageUrl(currentSlide())) return false;
      const bounds = selectionBounds(target, currentTransform(target), canvasWidth, canvasHeight, layout);
      return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
    }) ?? null;
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === fullscreenRef.current)
        await document.exitFullscreen();
      else await fullscreenRef.current?.requestFullscreen();
    } catch {
      // Browsers may reject fullscreen when it is unavailable; the preview remains usable.
    }
  }
  return (
    <div className="showcase-preview" ref={fullscreenRef}>
      <div
        className={`showcase-canvas ${drag.current ? "dragging-element" : ""}`}
        ref={containerRef}
      >
        <canvas
        ref={canvasRef}
        role="img"
        tabIndex={0}
        aria-label="轮播实时预览；可选择、移动并等比缩放雷达、Round Swing、主标题、副标题和人物图"
        onPointerDown={(event) => {
          const point = pointerPercent(event);
          if (selectedTarget) {
            const transform = currentTransform(selectedTarget);
            const bounds = selectionBounds(selectedTarget, transform, event.currentTarget.width, event.currentTarget.height, layout);
            if (nearestCornerDistance(point, bounds) <= 3) {
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { pointerId: event.pointerId, target: selectedTarget, mode: "resize", offsetX: 0, offsetY: 0, initialScale: transform.scale, initialDistance: Math.max(1, Math.hypot(point.x-transform.x, point.y-transform.y)), initialTransform: transform, pendingTransform: null };
              return;
            }
          }
          const target = hitTarget(point);
          setSelectedTargetRef(target);
          drawRef.current?.();
          if (!target) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const transform = currentTransform(target);
          drag.current = { pointerId: event.pointerId, target, mode: "move", offsetX: transform.x-point.x, offsetY: transform.y-point.y, initialScale: transform.scale, initialDistance: 1, initialTransform: transform, pendingTransform: null };
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state || state.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const point = pointerPercent(event);
          const rounded = (value: number) => Math.round(value * 10) / 10;
          const current = state.initialTransform;
          let next: ShowcaseTransform;
          if (state.mode === "resize") {
            const distance = Math.hypot(point.x-current.x, point.y-current.y);
            next = clampShowcaseTransform(state.target, { ...current, scale: rounded(Math.max(35, Math.min(220, state.initialScale*distance/state.initialDistance))) });
          } else {
            next = clampShowcaseTransform(state.target, { ...current, x: rounded(point.x+state.offsetX), y: rounded(point.y+state.offsetY) });
          }
          state.pendingTransform = next;
          dragNeedsRedraw.current = true;
          drawRef.current?.();
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          const state = drag.current;
          if (state?.pendingTransform) {
            patchTransform(state.target, state.pendingTransform);
          }
          drag.current = null;
          dragNeedsRedraw.current = false;
          drawRef.current?.();
        }}
        onPointerCancel={() => { drag.current = null; dragNeedsRedraw.current = false; drawRef.current?.(); }}
        onKeyDown={(event) => {
          if (!selectedTarget) return;
          const delta = event.shiftKey ? 2 : .5;
          const transform = currentTransform(selectedTarget);
          if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) { event.preventDefault(); patchTransform(selectedTarget, clampShowcaseTransform(selectedTarget, { ...transform, x: transform.x+(event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0), y: transform.y+(event.key === "ArrowDown" ? delta : event.key === "ArrowUp" ? -delta : 0) })); }
          if (event.key === "+" || event.key === "=") { event.preventDefault(); patchTransform(selectedTarget, clampShowcaseTransform(selectedTarget, { ...transform, scale: Math.min(220, transform.scale+5) })); }
          if (event.key === "-") { event.preventDefault(); patchTransform(selectedTarget, clampShowcaseTransform(selectedTarget, { ...transform, scale: Math.max(35, transform.scale-5) })); }
        }}
        />
        {fontState !== "ready" && <span className={`showcase-font-status ${fontState}`} role="status">{fontState === "loading" ? "正在载入离线字体…" : "离线字体加载失败，已暂停预览与导出"}</span>}
      </div>
      <button
        type="button"
        className="quiet showcase-fullscreen-button"
        aria-label={isFullscreen ? "退出全屏预览" : "全屏预览"}
        onClick={toggleFullscreen}
      >
        {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        {isFullscreen ? "退出全屏" : "全屏预览"}
      </button>
    </div>
  );
}
