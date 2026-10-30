import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { selectRatingProfile } from "../../components/RadarCanvas";
import type { RatingVersion, ShowcaseImageElement, ShowcaseLayoutDraft, ShowcaseSlide } from "../../types";
import {
  clampShowcaseTransform,
  nearestCornerDistance,
  resolveImageTransform,
  resolveTeamLogoTransform,
  selectionBounds,
  SHOWCASE_EXPORT_HEIGHT,
  SHOWCASE_EXPORT_WIDTH,
  showcaseElementBounds,
  showcaseImageBox,
  showcaseIntroState,
  showcaseMaxSwingMagnitude,
  showcasePreviewSize,
  showcaseSegment,
  showcaseSubtitleTextStyle,
  showcaseTeamLogoSize,
  showcaseTitleTextStyle,
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
  retainShowcaseImages,
  renderShowcaseFrame,
  showcasePlayerImageUrl,
  imageWidth,
  imageHeight,
  showcaseImageCache,
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
  radarFloorValues,
  onLayoutChange,
  onImageTransformChange,
  onTeamLogoTransformChange,
  previewTimeRef,
  selectedIntroElementId,
  onSelectIntroElement,
  onDeleteIntroElement,
  onUpdateIntroElement,
  onSelectTarget,
  onTransformPreview,
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
  radarFloorValues?: Record<string, number>;
  onLayoutChange: (layout: ShowcaseLayoutDraft) => void;
  onImageTransformChange: (transform: { x: number; y: number; scale: number }) => void;
  onTeamLogoTransformChange?: (transform: { x: number; y: number; scale: number }, slideIndex?: number) => void;
  previewTimeRef?: React.MutableRefObject<number>;
  selectedIntroElementId?: string | null;
  onSelectIntroElement?: (elementId: string | null) => void;
  onDeleteIntroElement?: (elementId: string) => void;
  onUpdateIntroElement?: (elementId: string, patch: Record<string, any>) => void;
  onSelectTarget?: (target: ShowcaseTarget | null) => void;
  /** 拖动过程中的实时变换：仅供属性面板显示，不写入草稿 */
  onTransformPreview?: (target: ShowcaseTarget | null, transform: ShowcaseTransform | null) => void;
}) {
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [assetRevision, setAssetRevision] = useState(0);
  const [fontState, setFontState] = useState<"loading" | "ready" | "error">("loading");
  const [isFullscreen, setIsFullscreen] = useState(false);
  type Target = "radar" | "title" | "subtitle" | "image" | "swing" | "teamLogo";
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(null);
  const selectionRef = useRef<Target | null>(null);
  // 绘制时使用的分段索引：命中测试/选框必须与画面同一帧，不能用被节流的 timeMs 现算
  const drawSegmentIndexRef = useRef<number | null>(null);
  const setSelectedTargetRef = (target: Target | null) => {
    selectionRef.current = target;
    setSelectedTarget(target);
    onSelectTarget?.(target);
  };
  const elementDrag = useRef<{
    pointerId: number;
    elementId: string;
    initialX: number;
    initialY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const drag = useRef<{ pointerId: number; target: Target; mode: "move" | "resize"; offsetX: number; offsetY: number; initialScale: number; initialDistance: number; initialTransform: ShowcaseTransform; pendingTransform: ShowcaseTransform | null; committed?: boolean } | null>(null);
  const dragNeedsRedraw = useRef(false);
  const drawRef = useRef<((forceTimeMs?: number) => void) | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const maxSwing = useMemo(
    () => showcaseMaxSwingMagnitude(slides, ratingVersion),
    [slides, ratingVersion],
  );
  useEffect(() => {
    const introImageUrls = (animations?.introElements ?? [])
      .filter((el): el is ShowcaseImageElement => el.type === "image" && Boolean(el.url))
      .map((el) => el.url);
    const urls = [
      ...slides.flatMap(
        (item) => [showcasePlayerImageUrl(item), item.backgroundUrl, item.teamLogoUrl].filter(Boolean) as string[],
      ),
      ...introImageUrls,
    ];
    retainShowcaseImages(urls);
    if (!urls.length) return;
    let active = true;
    Promise.allSettled(urls.map(loadImage)).then(() => {
      if (active) setAssetRevision((value) => value + 1);
    });
    return () => {
      active = false;
    };
  }, [slides, animations?.introElements]);
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
    // 已提交的拖动可以随新 props 一起清除；过早清除会用旧草稿画出一帧回弹。
    if (drag.current?.committed) drag.current = null;
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
        else if (target === "image") { effectiveLayout.imageX = dragState.pendingTransform.x; effectiveLayout.imageY = dragState.pendingTransform.y; effectiveLayout.imageScale = dragState.pendingTransform.scale; }
        else if (target === "teamLogo") { effectiveLayout.teamLogoX = dragState.pendingTransform.x; effectiveLayout.teamLogoY = dragState.pendingTransform.y; effectiveLayout.teamLogoScale = dragState.pendingTransform.scale; }
      }
      const segmentIndex = showcaseSegment(slides, drawTimeMs, animations).index;
      drawSegmentIndexRef.current = segmentIndex;
      const dragTransform =
        dragState?.pendingTransform && dragState.target === "image"
          ? dragState.pendingTransform
          : null;
      const dragTeamLogoTransform =
        dragState?.pendingTransform && dragState.target === "teamLogo"
          ? dragState.pendingTransform
          : null;
      if (dragTeamLogoTransform)
        effectiveLayout.teamLogoScale = dragTeamLogoTransform.scale;
      // Logo 拖动只覆盖当前帧，不重建 slides 数组，否则 ratedDerivationCache 每帧失效、拖动会发滞
      renderShowcaseFrame(
        slides,
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
        width / SHOWCASE_EXPORT_WIDTH,
        metricLabelFontSize,
        {
          ...animations,
          selectedIntroElementId,
          isEditing: !playing,
          pendingTeamLogoTransform: dragTeamLogoTransform
            ? { index: segmentIndex, transform: dragTeamLogoTransform }
            : undefined,
        },
        radarFloorValues,
      );
      const currentSelection = selectionRef.current;
      if (currentSelection) {
        const t = dragState?.pendingTransform && dragState.target === currentSelection ? dragState.pendingTransform : currentTransform(currentSelection);
        const curSlide = currentSlide();
        const ctx = canvas.getContext("2d");
        const textFontScale = width / SHOWCASE_EXPORT_WIDTH;
        let textW: number | undefined;
        if (currentSelection === "title" && ctx) {
          ctx.save();
          ctx.font = showcaseTitleTextStyle(effectiveLayout, textFontScale).font;
          textW = ctx.measureText(curSlide?.title ?? "").width;
          ctx.restore();
        } else if (currentSelection === "subtitle" && ctx) {
          ctx.save();
          ctx.font = showcaseSubtitleTextStyle(effectiveLayout, textFontScale).font;
          textW = ctx.measureText(curSlide?.subtitle ?? "").width;
          ctx.restore();
        }
        const targetDim = currentSelection === "teamLogo"
          ? getTeamLogoDimensions(t.scale)
          : getImageDimensions(dragTransform?.scale);
        drawShowcaseSelection(canvas, currentSelection, t, selectionBounds(currentSelection, t, canvas.width, canvas.height, effectiveLayout, maxSwing, textW, targetDim));
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
  }, [slides, layout, assetRevision, fontState, showBestMarkers, radarScaleMode, radarScale, radarAxisScale, ratingVersion, showRatingWatermark, metricLabelFontSize, animations, radarFloorValues, playing, previewTimeRef, selectedIntroElementId]);
  useEffect(() => {
    if (playing) return;
    drawRef.current?.();
  }, [timeMs, playing, animations, selectedIntroElementId, layout, slides]);
  function pointerPercent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100,
    };
  }
  function currentSlideIndex() {
    return drawSegmentIndexRef.current ?? showcaseSegment(slides, timeMs, animations).index;
  }
  function currentSlide() { return slides[currentSlideIndex()]; }
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
    if (target === "teamLogo") return resolveTeamLogoTransform(layout, currentSlide());
    return resolveImageTransform(layout);
  }
  function getImageDimensions(scaleOverride?: number) {
    const slide = currentSlide();
    const imageUrl = showcasePlayerImageUrl(slide);
    if (!imageUrl) return undefined;
    const img = showcaseImageCache.get(imageUrl);
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const cw = canvas.width || 1920;
    const ch = canvas.height || 1080;
    const { boxW, boxH } = showcaseImageBox(
      scaleOverride != null ? { ...layout, imageScale: scaleOverride } : layout,
      cw,
      ch,
    );
    if (!img) return { width: boxW, height: boxH };
    const iw = imageWidth(img);
    const ih = imageHeight(img);
    const scale = (layout.imageFit ?? "contain") === "cover"
      ? Math.max(boxW / iw, boxH / ih)
      : Math.min(boxW / iw, boxH / ih);
    return { width: iw * scale, height: ih * scale };
  }
  function getTeamLogoDimensions(scaleOverride?: number) {
    const slide = currentSlide();
    if (!slide?.teamLogoUrl) return undefined;
    const img = showcaseImageCache.get(slide.teamLogoUrl);
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const cw = canvas.width || 1920;
    const ch = canvas.height || 1080;
    const scale = scaleOverride ?? currentTransform("teamLogo").scale;
    return showcaseTeamLogoSize(
      cw,
      ch,
      scale,
      img ? { width: imageWidth(img), height: imageHeight(img) } : null,
    );
  }
  function getTextWidth(target: Target) {
    const curSlide = currentSlide();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !curSlide) return undefined;
    const canvasW = canvasRef.current?.width ?? 1920;
    const fontScale = canvasW / SHOWCASE_EXPORT_WIDTH;
    ctx.save();
    if (target === "title") {
      ctx.font = showcaseTitleTextStyle(layout, fontScale).font;
      const w = ctx.measureText(curSlide.title || "").width;
      ctx.restore();
      return w;
    }
    if (target === "subtitle") {
      ctx.font = showcaseSubtitleTextStyle(layout, fontScale).font;
      const w = ctx.measureText(curSlide.subtitle || "").width;
      ctx.restore();
      return w;
    }
    ctx.restore();
    return undefined;
  }
  function patchTransform(target: Target, transform: { x: number; y: number; scale: number }) {
    if (target === "image") return onImageTransformChange(transform);
    if (target === "teamLogo") {
      if (onTeamLogoTransformChange) return onTeamLogoTransformChange(transform, currentSlideIndex());
      onLayoutChange({
        ...layout,
        teamLogoX: transform.x,
        teamLogoY: transform.y,
        teamLogoScale: transform.scale,
      });
      return;
    }
    const keys = target === "radar" ? ["radarX","radarY","radarScale"] : target === "swing" ? ["swingX","swingY","swingScale"] : target === "title" ? ["titleX","titleY","titleScale"] : ["subtitleX","subtitleY","subtitleScale"];
    onLayoutChange({ ...layout, [keys[0]]: transform.x, [keys[1]]: transform.y, [keys[2]]: transform.scale });
  }
  function hitTarget(point: { x: number; y: number }): Target | null {
    const canvasWidth = canvasRef.current?.width ?? 1;
    const canvasHeight = canvasRef.current?.height ?? 1;

    // 命中测试顺序：标题/副标题优先 -> 战队 Logo 优先 -> 人物立绘 -> Swing -> 雷达
    const checkOrder: Target[] = ["subtitle", "title", "teamLogo", "image", "swing", "radar"];
    const swingSlide = currentSlide();

    for (const target of checkOrder) {
      if (target === "image" && !showcasePlayerImageUrl(swingSlide)) continue;
      if (target === "teamLogo" && !swingSlide?.teamLogoUrl) continue;
      if (target === "swing") {
        if (!swingSlide || selectRatingProfile(swingSlide.radar, ratingVersion).radar.round_swing == null) continue;
        const swing = currentTransform("swing");
        const bounds = selectionBounds("swing", swing, canvasWidth, canvasHeight, layout, maxSwing);
        if (point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom) return "swing";
        continue;
      }

      const textW = getTextWidth(target);
      const targetDim = target === "teamLogo" ? getTeamLogoDimensions() : getImageDimensions();
      const bounds = selectionBounds(target, currentTransform(target), canvasWidth, canvasHeight, layout, maxSwing, textW, targetDim);
      if (point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom) {
        return target;
      }
    }
    return null;
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
          const canvas = event.currentTarget;
          const rect = canvas.getBoundingClientRect();
          const drawTimeMs = playing && previewTimeRef?.current != null ? previewTimeRef.current : timeMs;
          const intro = showcaseIntroState(drawTimeMs, animations.introStages);

          if (intro.stage === "matchInfo") {
            const elements = animations.introElements ?? [];
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const clickCanvasX = (event.clientX - rect.left) * scaleX;
            const clickCanvasY = (event.clientY - rect.top) * scaleY;

            // 1. 检查是否点击在已选元素的右上角红色删除圆圈 (圆内 X)
            if (selectedIntroElementId) {
              const selectedEl = elements.find((el) => el.id === selectedIntroElementId);
              if (selectedEl) {
                const bounds = showcaseElementBounds(selectedEl, canvas.width, canvas.height);
                const btnRadius = Math.max(11, canvas.width * 0.0095);
                const dist = Math.hypot(clickCanvasX - bounds.right, clickCanvasY - bounds.top);
                if (dist <= btnRadius + 6) {
                  onDeleteIntroElement?.(selectedIntroElementId);
                  drawRef.current?.();
                  return;
                }
              }
            }

            // 2. 检查是否点击在某个比赛信息元素上
            let hitElement: any = null;
            for (let i = elements.length - 1; i >= 0; i--) {
              const el = elements[i];
              const bounds = showcaseElementBounds(el, canvas.width, canvas.height);
              if (
                clickCanvasX >= bounds.left &&
                clickCanvasX <= bounds.right &&
                clickCanvasY >= bounds.top &&
                clickCanvasY <= bounds.bottom
              ) {
                hitElement = el;
                break;
              }
            }

            if (hitElement) {
              onSelectIntroElement?.(hitElement.id);
              canvas.setPointerCapture(event.pointerId);
              elementDrag.current = {
                pointerId: event.pointerId,
                elementId: hitElement.id,
                initialX: hitElement.x,
                initialY: hitElement.y,
                startX: event.clientX,
                startY: event.clientY,
              };
            } else {
              onSelectIntroElement?.(null);
            }
            drawRef.current?.();
            return;
          }

          const point = pointerPercent(event);
          if (selectedTarget) {
            const transform = currentTransform(selectedTarget);
            const textW = getTextWidth(selectedTarget);
            const targetDim = selectedTarget === "teamLogo" ? getTeamLogoDimensions() : getImageDimensions();
            const bounds = selectionBounds(selectedTarget, transform, event.currentTarget.width, event.currentTarget.height, layout, maxSwing, textW, targetDim);
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
          if (elementDrag.current && elementDrag.current.pointerId === event.pointerId) {
            const canvas = event.currentTarget;
            const rect = canvas.getBoundingClientRect();
            const deltaX = ((event.clientX - elementDrag.current.startX) / rect.width) * 100;
            const deltaY = ((event.clientY - elementDrag.current.startY) / rect.height) * 100;
            const nextX = Math.round(Math.max(2, Math.min(98, elementDrag.current.initialX + deltaX)) * 10) / 10;
            const nextY = Math.round(Math.max(2, Math.min(98, elementDrag.current.initialY + deltaY)) * 10) / 10;
            onUpdateIntroElement?.(elementDrag.current.elementId, { x: nextX, y: nextY });
            drawRef.current?.();
            return;
          }

          const state = drag.current;
          if (!state || state.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const point = pointerPercent(event);
          const rounded = (value: number) => Math.round(value * 10) / 10;
          const current = state.initialTransform;
          let next: ShowcaseTransform;
          if (state.mode === "resize") {
            const distance = Math.hypot(point.x-current.x, point.y-current.y);
            next = clampShowcaseTransform(state.target, { ...current, scale: rounded(state.initialScale*distance/state.initialDistance) });
          } else {
            next = clampShowcaseTransform(state.target, { ...current, x: rounded(point.x+state.offsetX), y: rounded(point.y+state.offsetY) });
          }
          state.pendingTransform = next;
          onTransformPreview?.(state.target, next);
          dragNeedsRedraw.current = true;
          drawRef.current?.();
        }}
        onPointerUp={(event) => {
          if (elementDrag.current && elementDrag.current.pointerId === event.pointerId) {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            elementDrag.current = null;
            drawRef.current?.();
            return;
          }
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          const state = drag.current;
          if (state?.pendingTransform) {
            state.committed = true;
            patchTransform(state.target, state.pendingTransform);
          }
          if (state) onTransformPreview?.(state.target, null);
          if (!state?.pendingTransform) drag.current = null;
          dragNeedsRedraw.current = false;
          drawRef.current?.();
        }}
        onPointerCancel={() => {
          elementDrag.current = null;
          if (drag.current?.committed) return;
          if (drag.current) onTransformPreview?.(drag.current.target, null);
          drag.current = null;
          dragNeedsRedraw.current = false;
          drawRef.current?.();
        }}
        onKeyDown={(event) => {
          if (!selectedTarget) return;
          const delta = event.shiftKey ? 2 : .5;
          const transform = currentTransform(selectedTarget);
          if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) { event.preventDefault(); patchTransform(selectedTarget, clampShowcaseTransform(selectedTarget, { ...transform, x: transform.x+(event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0), y: transform.y+(event.key === "ArrowDown" ? delta : event.key === "ArrowUp" ? -delta : 0) })); }
          if (event.key === "+" || event.key === "=") { event.preventDefault(); patchTransform(selectedTarget, clampShowcaseTransform(selectedTarget, { ...transform, scale: transform.scale+5 })); }
          if (event.key === "-") { event.preventDefault(); patchTransform(selectedTarget, clampShowcaseTransform(selectedTarget, { ...transform, scale: transform.scale-5 })); }
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
