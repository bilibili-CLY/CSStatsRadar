import type {
  OverlayEntry,
  RadarResponse,
  RatingVersion,
  ShowcaseDataPanelJellyParams,
  ShowcaseElement,
  ShowcaseIntroConfig,
  ShowcaseIntroStageDurations,
  ShowcaseLayoutDraft,
  ShowcaseSlide,
} from "../../types";
import { radarOuterRingDiameter } from "../../lib/radarGeometry";
import {
  ROUND_SWING_TRACK_LIMIT,
  roundSwingTrackHeight,
} from "../../components/RadarCanvas";

export type ShowcaseTarget = "radar" | "title" | "subtitle" | "image" | "swing" | "teamLogo";
export type ShowcaseTransform = { x: number; y: number; scale: number };
export type ShowcaseAnimationOptions = {
  showIntroAnimation?: boolean;
  showBestEntranceAnimation?: boolean;
  reduceMotion?: boolean;
  introStages?: Partial<ShowcaseIntroStageDurations>;
  introElements?: ShowcaseElement[];
  selectedIntroElementId?: string | null;
  blackFadeIn?: boolean;
  jellyParams?: ShowcaseDataPanelJellyParams;
  isEditing?: boolean;
  /** 拖动战队 Logo 时的单帧变换覆盖（位置 + 缩放），同样不重建 slides */
  pendingTeamLogoTransform?: { index: number; transform: ShowcaseTransform };
};
export type ShowcasePhase = "intro" | "entrance" | "handoff" | "slide";
export type ShowcaseIntroStage = "matchInfo" | "empty" | "reference" | "average" | "outro";
export type ShowcaseIntroState = {
  stage: ShowcaseIntroStage;
  progress: number;
};
export type ShowcaseSegment = {
  index: number;
  offsetMs: number;
  phase: ShowcasePhase;
  entranceProgress: number;
  handoffProgress: number;
  usesBestEntrance: boolean;
};
export const DEFAULT_SHOWCASE_INTRO_STAGES: ShowcaseIntroStageDurations = {
  matchInfo: 6.0,
  empty: 2.0,
  average: 2.0,
  reference: 2.0,
};
export const DEFAULT_JELLY_PARAMS: ShowcaseDataPanelJellyParams = {
  expandProgress: 0.40,
  decay: 2.5,
  cycles: 5.0,
  ampW: 0.05,
  ampH: 0.05,
};
export const FIRST_PLAYER_ARRIVAL_MS = 1000;
export const FIRST_PLAYER_PANEL_MS = 700;
export const FIRST_PLAYER_SUBTITLE_START_MS = 700;
export const FIRST_PLAYER_SUBTITLE_DUR_MS = 400;
export const FIRST_PLAYER_TITLE_START_MS = 1100;
export const FIRST_PLAYER_TITLE_DUR_MS = 600;
export const FIRST_PLAYER_RADAR_IN_MS = 500;
export const FIRST_PLAYER_TEXT_START_MS = 1200;
export const FIRST_PLAYER_VALUE_START_MS = 1700;
export const FIRST_PLAYER_ARRIVAL_TOTAL_MS = 2100;
export const SHOWCASE_INTRO_MS = 12000;
export const SHOWCASE_INTRO_EMPTY_MS = 2000;
export const SHOWCASE_INTRO_REFERENCE_MS = 2000;
export const SHOWCASE_INTRO_AVERAGE_MS = 2000;
export const SHOWCASE_INTRO_AVERAGE_TRANSITION_MS = 300;
export const SHOWCASE_INTRO_MATCH_INFO_FADE_IN_MS = 800;
export const SHOWCASE_INTRO_BLACK_FADE_IN_MS = 800;
export const SHOWCASE_BEST_ENTRANCE_MS = 3000;
export const SHOWCASE_BEST_HANDOFF_MS = 1000;
export const SHOWCASE_TRANSITION_MS = 1000;
export const SHOWCASE_EXPORT_WIDTH = 1920;
export const SHOWCASE_EXPORT_HEIGHT = 1080;

/** Aspect ratio templates and dimension definitions (reserved for 9:16 extension). */
export type ShowcaseAspectRatio = "16:9" | "9:16";
export const SHOWCASE_ASPECT_RATIOS: Record<
  ShowcaseAspectRatio,
  { width: number; height: number }
> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};
/** Rating 3.0 values represented by the center of a showcase radar. */
export const SHOWCASE_RATING_3_RADAR_FLOORS: Readonly<Record<string, number>> = {
  KPR: 0.42,
  Surviving: 0.157,
  ADR: 47.5,
  KAST: 0.545,
  "Multi-Kill": 0.07,
  Rating: 0.55,
};

export function showcaseRadarFloorValues(
  ratingVersion: RatingVersion,
  overrides?: Record<string, number>,
) {
  if (ratingVersion !== "rating_3") return undefined;
  if (!overrides) return SHOWCASE_RATING_3_RADAR_FLOORS;
  const merged: Record<string, number> = {
    ...SHOWCASE_RATING_3_RADAR_FLOORS,
  };
  for (const [key, value] of Object.entries(overrides)) merged[key] = value;
  return merged;
}
// The ±5% reference span matches the actual outer ring, not the radar canvas.
// The wider canvas
// reserves independent room for overflow fills and endpoint labels.
export const SHOWCASE_SWING_CANVAS_WIDTH_RATIO = 1.3;
// Overflow beyond ±5% grows proportionally with the queue's largest swing,
// capped so the composition stays sane.
export const SHOWCASE_SWING_OVERFLOW_MULTIPLIER = 2;

export function showcaseOuterRadarRingDiameter(radarCanvasSize: number) {
  return radarOuterRingDiameter(
    { compact: true, hideSwing: true },
    radarCanvasSize,
    radarCanvasSize,
  );
}

export function showcaseSwingReferenceHalfWidth(outerRingDiameter: number) {
  return outerRingDiameter / 2;
}

export function showcaseSwingOverflowLimit(maxSwingMagnitude: number) {
  return Math.min(
    Math.max(ROUND_SWING_TRACK_LIMIT, maxSwingMagnitude),
    ROUND_SWING_TRACK_LIMIT * (1 + SHOWCASE_SWING_OVERFLOW_MULTIPLIER),
  );
}

export function showcaseSwingCanvasWidth(
  outerRingDiameter: number,
  maxSwingMagnitude = ROUND_SWING_TRACK_LIMIT,
) {
  const trackHalfWidth = outerRingDiameter / 2;
  const overflowLimit = showcaseSwingOverflowLimit(maxSwingMagnitude);
  const overflowSpace =
    (trackHalfWidth * (overflowLimit - ROUND_SWING_TRACK_LIMIT)) /
    ROUND_SWING_TRACK_LIMIT;
  const margin = Math.max(12, outerRingDiameter * 0.1);
  const minimumHalf = (outerRingDiameter * SHOWCASE_SWING_CANVAS_WIDTH_RATIO) / 2;
  return Math.max(minimumHalf, trackHalfWidth + overflowSpace + margin) * 2;
}

export function showcaseMaxSwingMagnitude(
  slides: ShowcaseSlide[],
  ratingVersion: RatingVersion,
) {
  const magnitudes = slides.flatMap((slide) => {
    const profile =
      ratingVersion === "rating_3"
        ? slide.radar.profiles?.rating_3
        : slide.radar.profiles?.rating_2;
    const value = profile?.round_swing ?? slide.radar.radar.round_swing;
    return value != null && Number.isFinite(value) ? [Math.abs(value)] : [];
  });
  return Math.max(ROUND_SWING_TRACK_LIMIT, ...magnitudes);
}

export function showcasePreviewSize(availableWidth: number, availableHeight: number) {
  const width = Math.max(0, availableWidth);
  const height = Math.max(0, availableHeight);
  if (width / Math.max(1, height) > SHOWCASE_EXPORT_WIDTH / SHOWCASE_EXPORT_HEIGHT)
    return { width: height * SHOWCASE_EXPORT_WIDTH / SHOWCASE_EXPORT_HEIGHT, height };
  return { width, height: width * SHOWCASE_EXPORT_HEIGHT / SHOWCASE_EXPORT_WIDTH };
}

export function normalizeShowcaseDimensions<T extends { width: number; height: number }>(
  draft: T,
): T {
  if (
    draft.width === SHOWCASE_EXPORT_WIDTH &&
    draft.height === SHOWCASE_EXPORT_HEIGHT
  )
    return draft;
  return {
    ...draft,
    width: SHOWCASE_EXPORT_WIDTH,
    height: SHOWCASE_EXPORT_HEIGHT,
  };
}
/** Title/subtitle authoring sizes live in the 1920×1080 design space and must be
 *  multiplied by `fontScale = canvasWidth / SHOWCASE_EXPORT_WIDTH` before drawing,
 *  otherwise a letterboxed preview renders them proportionally too large. */
export const SHOWCASE_TITLE_FONT_SIZE = SHOWCASE_EXPORT_WIDTH * 0.035;
export const SHOWCASE_SUBTITLE_FONT_SIZE = SHOWCASE_EXPORT_WIDTH * 0.013;
export const SHOWCASE_TITLE_MIN_FONT_SIZE = 28;
export const SHOWCASE_SUBTITLE_MIN_FONT_SIZE = 13;
export const SHOWCASE_SUBTITLE_GLOW_OUTER = 16;
export const SHOWCASE_SUBTITLE_GLOW_INNER = 4;
export const SHOWCASE_IMAGE_SCALE_MIN = 30;
export const SHOWCASE_IMAGE_SCALE_MAX = 250;
export const SHOWCASE_TEAM_LOGO_SCALE_MIN = 20;

export function showcaseTitleFontSize(layout: ShowcaseLayoutDraft, fontScale: number) {
  const designSize = layout.titleFontSize ?? SHOWCASE_TITLE_FONT_SIZE;
  return Math.max(SHOWCASE_TITLE_MIN_FONT_SIZE * fontScale, designSize * fontScale);
}

export function showcaseTitleTextStyle(layout: ShowcaseLayoutDraft, fontScale: number) {
  const fontSize = showcaseTitleFontSize(layout, fontScale);
  return {
    fontSize,
    font: `800 ${fontSize}px "Noto Sans SC",system-ui`,
    color: layout.titleColor ?? "#f4f6f8",
  };
}

export function showcaseSubtitleTextStyle(layout: ShowcaseLayoutDraft, fontScale: number) {
  const designSize = layout.subtitleFontSize ?? SHOWCASE_SUBTITLE_FONT_SIZE;
  const fontSize = Math.max(SHOWCASE_SUBTITLE_MIN_FONT_SIZE * fontScale, designSize * fontScale);
  const weight = layout.subtitleBold !== false ? "750" : "500";
  const style = layout.subtitleItalic ? "italic" : "normal";
  return {
    fontSize,
    font: `${style} ${weight} ${fontSize}px "Noto Sans SC",system-ui`,
    color: layout.subtitleColor ?? "#ffd700",
    glowOuter: SHOWCASE_SUBTITLE_GLOW_OUTER * fontScale,
    glowInner: SHOWCASE_SUBTITLE_GLOW_INNER * fontScale,
  };
}

/** Every player image shares the layout-level position and scale. */
export function resolveImageTransform(layout: ShowcaseLayoutDraft): ShowcaseTransform {
  return {
    x: layout.imageX,
    y: layout.imageY,
    scale: layout.imageScale ?? 100,
  };
}

export function showcaseImageBox(layout: ShowcaseLayoutDraft, width: number, height: number) {
  const scale = (layout.imageScale ?? 100) / 100;
  return { boxW: width * 0.36 * scale, boxH: height * 0.66 * scale };
}

/** Team logo fit box: only renderer-sized source. The selection box and the drawn
 *  logo must come from here, or the dashed outline drifts away from the pixels. */
export const SHOWCASE_TEAM_LOGO_BOX_RATIO = 0.14;

export function showcaseTeamLogoSize(
  width: number,
  height: number,
  scale: number,
  natural?: { width: number; height: number } | null,
) {
  const maxDim = Math.min(width, height) * SHOWCASE_TEAM_LOGO_BOX_RATIO * (scale / 100);
  if (!natural || natural.width <= 0 || natural.height <= 0)
    return { width: maxDim, height: maxDim };
  const factor = Math.min(maxDim / natural.width, maxDim / natural.height);
  return { width: natural.width * factor, height: natural.height * factor };
}

/** Team logo transform resolution: position comes from slide (fallback to layout),
 *  scale comes from slide or layout, unified through this single source of truth. */
export function resolveTeamLogoTransform(
  layout: ShowcaseLayoutDraft,
  slide?: Pick<ShowcaseSlide, "teamLogoTransform"> | null,
): ShowcaseTransform {
  return {
    x: slide?.teamLogoTransform?.x ?? layout.teamLogoX ?? 68,
    y: slide?.teamLogoTransform?.y ?? layout.teamLogoY ?? 50,
    scale: slide?.teamLogoTransform?.scale ?? layout.teamLogoScale ?? 100,
  };
}

export function targetBaseBounds(target: ShowcaseTarget) {
  return target === "radar"
    ? { x: 18, y: 32 }
    : target === "image"
    ? { x: 10, y: 18 }
    : target === "teamLogo"
    ? { x: 7.875, y: 14 }
    : target === "title"
    ? { x: 15, y: 5 }
    : target === "subtitle"
    ? { x: 13, y: 3.5 }
    : { x: 17, y: 17 };
}
export function targetBounds(target: ShowcaseTarget, transform: ShowcaseTransform) {
  const base = targetBaseBounds(target);
  const halfX = base.x*transform.scale/100, halfY = base.y*transform.scale/100;
  return { left: transform.x-halfX, right: transform.x+halfX, top: transform.y-halfY, bottom: transform.y+halfY };
}
export function selectionBounds(
  target: ShowcaseTarget,
  transform: ShowcaseTransform,
  width: number,
  height: number,
  layout: ShowcaseLayoutDraft,
  maxSwingMagnitude?: number,
  measuredTextWidth?: number,
  imageActualDimensions?: { width: number; height: number },
) {
  if (target === "title" || target === "subtitle") {
    if (measuredTextWidth != null && measuredTextWidth > 0) {
      const scale = transform.scale / 100;
      const actualW = measuredTextWidth * scale;
      const fontScale = width / SHOWCASE_EXPORT_WIDTH;
      const fontSize = target === "title"
        ? showcaseTitleFontSize(layout, fontScale)
        : showcaseSubtitleTextStyle(layout, fontScale).fontSize;
      const actualH = fontSize * 1.3 * scale;
      const halfX = ((actualW / width) * 100) / 2 + 1.2;
      const halfY = ((actualH / height) * 100) / 2 + 0.8;
      const align = layout.nameAlign ?? "left";
      let left = transform.x - halfX;
      let right = transform.x + halfX;
      if (align === "left") {
        left = transform.x - 1.2;
        right = transform.x + halfX * 2 - 1.2;
      } else if (align === "right") {
        left = transform.x - halfX * 2 + 1.2;
        right = transform.x + 1.2;
      }
      return {
        left,
        right,
        top: transform.y - halfY * 1.4,
        bottom: transform.y + halfY * 0.6,
      };
    }
  }
  if ((target === "image" || target === "teamLogo") && imageActualDimensions && imageActualDimensions.width > 0 && imageActualDimensions.height > 0) {
    const halfX = ((imageActualDimensions.width / width) * 100) / 2;
    const halfY = ((imageActualDimensions.height / height) * 100) / 2;
    return {
      left: transform.x - halfX,
      right: transform.x + halfX,
      top: transform.y - halfY,
      bottom: transform.y + halfY,
    };
  }
  if (target !== "swing") return targetBounds(target, transform);
  const radarSize = (Math.min(width * 0.48, height * 0.78) * layout.radarScale) / 100;
  const swingScale = transform.scale / 100;
  const outerRingDiameter = showcaseOuterRadarRingDiameter(radarSize);
  const swingCanvasW = showcaseSwingCanvasWidth(outerRingDiameter, maxSwingMagnitude) * swingScale;
  const swingCanvasH = radarSize * 0.22 * swingScale;
  const trackCenterY = transform.y;
  const trackHalfX = Math.max(14, ((swingCanvasW / 2) / width) * 100);
  const trackHeight = roundSwingTrackHeight(swingCanvasH, 2.25, width / SHOWCASE_EXPORT_WIDTH);
  const trackHalfY = Math.max(7.5, ((trackHeight / height) * 100) / 2);
  return { left: transform.x-trackHalfX, right: transform.x+trackHalfX, top: trackCenterY-trackHalfY, bottom: trackCenterY+trackHalfY };
}
export function nearestCornerDistance(point: {x:number;y:number}, bounds: ReturnType<typeof targetBounds>) { return Math.min(...[[bounds.left,bounds.top],[bounds.right,bounds.top],[bounds.left,bounds.bottom],[bounds.right,bounds.bottom]].map(([x,y]) => Math.hypot(point.x-x,point.y-y))); }
export function clampShowcaseTransform(target: ShowcaseTarget, transform: ShowcaseTransform) {
  const base = targetBaseBounds(target);
  // 标题和副标题允许自由横向拖动到画布右侧 (2% ~ 98%)
  if (target === "title" || target === "subtitle") {
    const scale = Math.max(20, Math.min(300, transform.scale));
    return {
      ...transform,
      scale,
      x: Math.max(2, Math.min(98, transform.x)),
      y: Math.max(2, Math.min(98, transform.y)),
    };
  }
  const clampCenter = (value: number) => Math.max(0, Math.min(100, value));
  // 立绘和战队 Logo 的中心点可以拖到画布任意位置；按尺寸向内收缩会把中心顶回来，
  // 形成用户感知到的“无形边界”。超出画布的部分在绘制时自然被裁掉。
  if (target === "image" || target === "teamLogo") {
    const scale = target === "teamLogo"
      ? Math.max(SHOWCASE_TEAM_LOGO_SCALE_MIN, transform.scale)
      : Math.max(SHOWCASE_IMAGE_SCALE_MIN, Math.min(SHOWCASE_IMAGE_SCALE_MAX, transform.scale));
    return { ...transform, scale, x: clampCenter(transform.x), y: clampCenter(transform.y) };
  }
  const scale = Math.max(
    SHOWCASE_IMAGE_SCALE_MIN,
    Math.min(50 / base.x * 100, 50 / base.y * 100, transform.scale),
  );
  const bounds = targetBounds(target, { ...transform, x: 0, y: 0, scale });
  const halfX = (bounds.right - bounds.left) / 2;
  const halfY = (bounds.bottom - bounds.top) / 2;
  return {
    ...transform,
    scale,
    x: Math.max(halfX, Math.min(100 - halfX, transform.x)),
    y: Math.max(halfY, Math.min(100 - halfY, transform.y)),
  };
}

export function showcaseElementBounds(
  element: ShowcaseElement,
  width: number,
  height: number,
  measuredTextWidth?: number,
  naturalAspectRatio?: number,
) {
  const cx = (width * element.x) / 100;
  const cy = (height * element.y) / 100;
  if (element.type === "text") {
    const fontSize = (element.fontSize ?? 42) * (width / 1920);
    const textW = Math.max(40, (measuredTextWidth ?? element.content.length * fontSize * 0.6) + 24);
    const textH = fontSize * 1.3 + 16;
    let left = cx - textW / 2;
    if (element.align === "left") left = cx - 12;
    else if (element.align === "right") left = cx - textW + 12;
    const top = cy - textH / 2;
    return { left, top, width: textW, height: textH, right: left + textW, bottom: top + textH };
  } else {
    const scale = (element.scale ?? 100) / 100;
    let aspect = naturalAspectRatio;
    if (!aspect || !Number.isFinite(aspect) || aspect <= 0) {
      if (element.width && element.height && element.height > 0) {
        aspect = element.width / element.height;
      } else {
        aspect = 1;
      }
    }
    // 以 380px (基于 1920 宽画布) 作为 scale=100% 时的基准长边，保持像素 1:1 绝对不拉扁
    const baseDimension = 380 * (width / 1920) * scale;
    let baseW: number;
    let baseH: number;
    if (aspect >= 1) {
      baseW = baseDimension;
      baseH = baseDimension / aspect;
    } else {
      baseH = baseDimension;
      baseW = baseDimension * aspect;
    }
    const left = cx - baseW / 2;
    const top = cy - baseH / 2;
    return { left, top, width: baseW, height: baseH, right: left + baseW, bottom: top + baseH };
  }
}

function animationsEnabled(options?: ShowcaseAnimationOptions) {
  return !options?.reduceMotion;
}
// 每帧都会查询 BEST 入场；按幻灯片数组身份缓存，避免 O(S²) 逐帧重算。
const bestIndexesCache = new WeakMap<ShowcaseSlide[], number[][]>();
export function bestMetricIndexesBySlide(slides: ShowcaseSlide[]): number[][] {
  let cached = bestIndexesCache.get(slides);
  if (!cached) {
    cached = slides.map((_, index) => bestMetricIndexesForSlide(slides, index));
    bestIndexesCache.set(slides, cached);
  }
  return cached;
}
export function hasBestEntrance(slides: ShowcaseSlide[], index: number, options?: ShowcaseAnimationOptions) {
  return animationsEnabled(options)
    && Boolean(options?.showBestEntranceAnimation)
    && (bestMetricIndexesBySlide(slides)[index]?.length ?? 0) > 0;
}
/** 每个指标 0~1 的 BEST 样式占比：切换玩家时按转场进度连续淡入/淡出。 */
export function showcaseBestAmounts(
  current: readonly number[] | undefined,
  previous: readonly number[] | undefined,
  progress: number,
  count: number,
): number[] {
  const amount = Math.max(0, Math.min(1, progress));
  const currentSet = new Set(current ?? []);
  const previousSet = new Set(previous ?? []);
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const inCurrent = currentSet.has(index);
    const inPrevious = previousSet.has(index);
    if (inCurrent && inPrevious) return 1;
    if (inPrevious) return 1 - amount;
    if (inCurrent) return amount;
    return 0;
  });
}
/** 雷达几乎完全落在 Data Panel 内时，返回面板在雷达子画布坐标系里的标签安全区。 */
export function showcaseRadarLabelRegion(
  panel: { x: number; y: number; width: number; height: number },
  radar: { x: number; y: number; size: number },
): { left: number; top: number; right: number; bottom: number } | undefined {
  if (!(radar.size > 1)) return undefined;
  const overlapX = Math.min(panel.x + panel.width, radar.x + radar.size) - Math.max(panel.x, radar.x);
  const overlapY = Math.min(panel.y + panel.height, radar.y + radar.size) - Math.max(panel.y, radar.y);
  if (overlapX < radar.size * 0.85 || overlapY < radar.size * 0.85) return undefined;
  return {
    left: panel.x - radar.x,
    right: panel.x + panel.width - radar.x,
    top: panel.y - radar.y,
    bottom: panel.y + panel.height - radar.y,
  };
}
export function resolveIntroStageDurations(stages?: Partial<ShowcaseIntroStageDurations>): ShowcaseIntroStageDurations {
  return {
    matchInfo: Math.max(0.1, Number(stages?.matchInfo) || DEFAULT_SHOWCASE_INTRO_STAGES.matchInfo),
    empty: Math.max(0.1, Number(stages?.empty) || DEFAULT_SHOWCASE_INTRO_STAGES.empty),
    average: Math.max(0.1, Number(stages?.average) || DEFAULT_SHOWCASE_INTRO_STAGES.average),
    reference: Math.max(0.1, Number(stages?.reference) || DEFAULT_SHOWCASE_INTRO_STAGES.reference),
  };
}

export function showcaseIntroDuration(options?: ShowcaseAnimationOptions, stages?: Partial<ShowcaseIntroStageDurations>) {
  if (!animationsEnabled(options) || !options?.showIntroAnimation) return 0;
  const resolved = resolveIntroStageDurations(stages ?? options?.introStages);
  return (
    resolved.matchInfo +
    resolved.empty +
    resolved.average +
    resolved.reference
  ) * 1000;
}
export function showcaseIntroState(
  timeMs: number,
  stages?: Partial<ShowcaseIntroStageDurations>,
): ShowcaseIntroState {
  const resolved = resolveIntroStageDurations(stages);
  const matchInfoMs = resolved.matchInfo * 1000;
  const emptyMs = resolved.empty * 1000;
  const avgMs = resolved.average * 1000;
  const refMs = resolved.reference * 1000;
  const totalMs = matchInfoMs + emptyMs + avgMs + refMs;
  const time = Math.max(0, Math.min(totalMs, timeMs));

  if (time < matchInfoMs) {
    return {
      stage: "matchInfo",
      progress: matchInfoMs > 0 ? time / matchInfoMs : 1,
    };
  }
  if (time < matchInfoMs + emptyMs) {
    return {
      stage: "empty",
      progress: emptyMs > 0 ? (time - matchInfoMs) / emptyMs : 1,
    };
  }
  // 阶段二：显示全队平均值 average
  if (time < matchInfoMs + emptyMs + avgMs) {
    return {
      stage: "average",
      progress: avgMs > 0 ? (time - matchInfoMs - emptyMs) / avgMs : 1,
    };
  }
  // 阶段三：显示外圈最大值 reference
  return {
    stage: "reference",
    progress: Math.min(1, refMs > 0 ? (time - matchInfoMs - emptyMs - avgMs) / refMs : 1),
  };
}
export function showcaseIntroAverageTransitionProgress(progress: number) {
  return Math.min(1, Math.max(0, (progress * SHOWCASE_INTRO_AVERAGE_MS) / SHOWCASE_INTRO_AVERAGE_TRANSITION_MS));
}

/** 比赛信息阶段文字与图片 FadeIn 进场与 FadeOut 退场不透明度 (0 -> 1 -> 0)，时长与 FadeIn 一致 */
export function showcaseMatchInfoOpacity(timeMs: number, matchInfoDurationMs: number) {
  const fadeDuration = Math.min(SHOWCASE_INTRO_MATCH_INFO_FADE_IN_MS, Math.max(100, matchInfoDurationMs * 0.45));
  if (timeMs < fadeDuration) {
    const p = Math.max(0, timeMs / fadeDuration);
    return 1 - (1 - p) * (1 - p);
  }
  const remaining = matchInfoDurationMs - timeMs;
  if (remaining < fadeDuration) {
    const p = Math.max(0, remaining / fadeDuration);
    return 1 - (1 - p) * (1 - p);
  }
  return 1;
}
export function showcaseMatchInfoFadeInOpacity(timeMs: number, matchInfoDurationMs: number) {
  return showcaseMatchInfoOpacity(timeMs, matchInfoDurationMs);
}

/** 开场黑屏渐显入场遮罩不透明度 (0s: 1 -> 800ms: 0) */
export function showcaseBlackFadeInAlpha(timeMs: number) {
  const progress = Math.min(1, Math.max(0, timeMs / SHOWCASE_INTRO_BLACK_FADE_IN_MS));
  return Math.max(0, 1 - progress);
}

export const RADAR_METRIC_CHINESE_NAMES: Record<string, string> = {
  KPR: "回合击杀",
  Surviving: "存活率",
  ADR: "回合伤害",
  KAST: "不白给率",
  Kast: "不白给率",
  "Multi-Kill": "回合多杀",
  MultiKill: "回合多杀",
};

export function metricStepIndex(dimension: string): number {
  if (dimension === "Rating" || dimension === "KPR") return 0;
  if (dimension === "Multi-Kill" || dimension === "MultiKill" || dimension === "Surviving") return 1;
  if (dimension === "KAST" || dimension === "Kast" || dimension === "ADR" || dimension === "Round Swing") return 2;
  return 0;
}

export type MetricGrowthTransform = {
  opacity: number;
  translateY: number;
  scale: number;
};

export function metricGrowthTransform(
  dimension: string,
  timeInStageMs: number,
  stepIntervalMs = 100,
  animDurationMs = 500,
): MetricGrowthTransform {
  const step = metricStepIndex(dimension);
  const startMs = step * stepIntervalMs;
  if (timeInStageMs < startMs) {
    return { opacity: 0, translateY: 8, scale: 0.92 };
  }
  const elapsed = timeInStageMs - startMs;
  const p = Math.min(1, elapsed / animDurationMs);
  const ease = 1 - Math.pow(1 - p, 3);
  return {
    opacity: ease,
    translateY: (1 - ease) * 8,
    scale: 0.92 + 0.08 * ease,
  };
}

/**
 * Data Panel 从 Canvas 水平中心和垂直高度 1/5 处 (50%, 20%)，
 * 尺寸从 0 快速变大到达宽 54%、高 93%，
 * 随后呈现过冲再弹回来的果冻阻尼振荡效果（至少 5 次且幅度递减）。
 */
export function showcaseDataPanelJellyTransform(
  progress: number,
  width: number,
  height: number,
  params?: ShowcaseDataPanelJellyParams,
  startCXRatio = 0.5,
  startCYRatio = 0.8,
  targetXRatio?: number,
) {
  const p = Math.max(0, Math.min(1, progress));
  const targetW = width * 0.54;
  const targetH = height * 0.93;
  // 开场动画阶段水平居中对齐 ((width - targetW) / 2)，正片首位玩家直接以左侧面板位置 targetXRatio 为目标
  const targetX = targetXRatio != null ? width * targetXRatio : (width - targetW) / 2;
  const targetY = (height - targetH) / 2;
  const targetCX = targetX + targetW / 2;
  const targetCY = height * 0.5;

  // 起始中心点：
  // 开场阶段一默认：水平中心 50%，垂直 80% (0.5, 0.8)
  // 正片首位玩家：水平中心 10%，垂直 50% (0.1, 0.5)，直接生长到左侧 (0.018)
  const startCX = width * startCXRatio;
  const startCY = height * startCYRatio;

  // 物理弹簧参数：严格控制振幅
  const tExpand = Math.max(0.10, Math.min(0.60, params?.expandProgress ?? DEFAULT_JELLY_PARAMS.expandProgress));
  const decayRate = Math.max(0.5, Math.min(10, params?.decay ?? DEFAULT_JELLY_PARAMS.decay));
  const cycles = Math.max(1, Math.min(15, params?.cycles ?? DEFAULT_JELLY_PARAMS.cycles));
  const ampW = Math.max(0.01, Math.min(0.80, params?.ampW ?? DEFAULT_JELLY_PARAMS.ampW));
  const ampH = Math.max(0.01, Math.min(0.60, params?.ampH ?? DEFAULT_JELLY_PARAMS.ampH));

  const omega = cycles * Math.PI;

  let scaleW: number;
  let scaleH: number;
  let cx: number;
  let cy: number;

  if (p < tExpand) {
    // 0 到 1 快速膨胀冲刺阶段：末端斜率与振荡斜率连续匹配，绝不停顿
    const u = p / tExpand;
    const vW = Math.max(0.2, Math.min(2.5, ampW * omega * (tExpand / Math.max(0.1, 1 - tExpand))));
    const vH = Math.max(0.2, Math.min(2.5, ampH * omega * (tExpand / Math.max(0.1, 1 - tExpand))));

    // Hermite 平滑插值，在 u=1 时值为 1 且导数为 vW / vH
    const baseW = u * u * (3 - 2 * u) + vW * u * u * (u - 1);
    const baseH = u * u * (3 - 2 * u) - vH * u * u * (u - 1);
    scaleW = Math.max(0, baseW);
    scaleH = Math.max(0, baseH);

    // 中心点向目标中心平滑推进
    const easePos = u * u * (3 - 2 * u);
    cx = startCX + (targetCX - startCX) * easePos;
    cy = startCY + (targetCY - startCY) * easePos;
  } else {
    // 振荡阶段：幅值严格以 1 + ampW / 1 - ampH 为包络，绝对不会过冲过头
    const theta = Math.min(1, (p - tExpand) / (1 - tExpand));
    const decay = Math.exp(-decayRate * theta) * (1 - Math.pow(theta, 6));
    const osc = Math.sin(omega * theta);

    scaleW = Math.max(0, 1 + ampW * decay * osc);
    scaleH = Math.max(0, 1 - ampH * decay * osc);
    cx = targetCX;
    cy = targetCY;
  }

  const currentW = Math.max(0, targetW * scaleW);
  const currentH = Math.max(0, targetH * scaleH);
  const x = cx - currentW / 2;
  const y = cy - currentH / 2;

  return { x, y, width: currentW, height: currentH, scaleW, scaleH };
}

/**
 * 阶段一内部 Radar Sub-canvas 和 Round Swing 整体展开动效：
 * 当 Data Panel 尺寸达到目标 size 的 75% 时，整体从 (50%, 20%) 平滑单调放大到 100% 目标位置，无需果冻效果。
 */
export function showcaseInnerRadarSwingTransform(
  progress: number,
  tExpand = DEFAULT_JELLY_PARAMS.expandProgress,
) {
  // 当 Data Panel 尺寸达到 75% 时的 progress 节点 (约 0.70 * tExpand)
  const pTrigger = Math.max(0.04, tExpand * 0.70);
  if (progress < pTrigger) {
    return {
      active: false,
      scale: 0,
      opacity: 0,
      centerProgress: 0,
    };
  }

  // 内部整体展开进度 (采用平滑单调放大，无需果冻效果)
  const animDuration = 0.35;
  const innerProgress = Math.min(1, Math.max(0, (progress - pTrigger) / animDuration));
  const ease = 1 - Math.pow(1 - innerProgress, 3);

  return {
    active: true,
    scale: ease,
    opacity: Math.min(1, ease / 0.25),
    centerProgress: ease,
  };
}
export function showcaseBestEntranceDuration(slides: ShowcaseSlide[], index: number, options?: ShowcaseAnimationOptions) {
  return hasBestEntrance(slides, index, options)
    ? SHOWCASE_BEST_ENTRANCE_MS + SHOWCASE_BEST_HANDOFF_MS
    : 0;
}
export function showcaseDuration(slides: ShowcaseSlide[], options?: ShowcaseAnimationOptions) {
  return showcaseIntroDuration(options) + slides.reduce(
    (sum, slide, index) => sum + slide.duration * 1000 + showcaseBestEntranceDuration(slides, index, options),
    0,
  );
}
export function resizedShowcaseDuration(
  initialDuration: number,
  deltaX: number,
  trackWidth: number,
  timelineDurationMs: number,
  edge: "start" | "end",
) {
  const secondsPerPixel = timelineDurationMs / 1000 / Math.max(1, trackWidth);
  const signedDelta = deltaX * secondsPerPixel * (edge === "end" ? 1 : -1);
  return Math.round(Math.max(0.5, Math.min(60, initialDuration + signedDelta)) * 10) / 10;
}
export function rating3Available(radar: RadarResponse) {
  return Boolean(radar.profiles?.rating_3 || radar.rating_3_status?.available);
}

const SCRAMBLE_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_+-/\\#%*";

export function showcaseTextScramble(targetText: string, progress: number, tickSeed = 0): string {
  const p = Math.max(0, Math.min(1, progress));
  if (p >= 1) return targetText;
  const chars = Array.from(targetText);
  const total = chars.length;
  if (total === 0) return "";

  // 0 到 0.90 逐个解码字符，最后 0.10 全部稳定还原
  const decodeProgress = Math.min(1, p / 0.90);
  const decodedCount = Math.floor(decodeProgress * total);

  return chars
    .map((ch, idx) => {
      if (ch === " ") return " ";
      if (idx < decodedCount) {
        return ch;
      }
      const charSeed = Math.abs(Math.floor(tickSeed * 19 + idx * 37)) % SCRAMBLE_CHARS.length;
      return SCRAMBLE_CHARS[charSeed];
    })
    .join("");
}
export function audioOffsetFromDrag(
  initialOffsetMs: number,
  deltaX: number,
  trackWidth: number,
  timelineDurationMs: number,
  minimumMs: number,
  maximumMs: number,
) {
  const millisecondsPerPixel = timelineDurationMs / Math.max(1, trackWidth);
  const next = initialOffsetMs + deltaX * millisecondsPerPixel;
  return Math.round(Math.max(minimumMs, Math.min(maximumMs, next)));
}
export function timelineTickStep(durationMs: number, pixelsPerSecond: number) {
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const minimumSeconds = Math.max(1, 72 / Math.max(1, pixelsPerSecond));
  const densitySeconds = Math.max(minimumSeconds, durationMs / 1000 / 800);
  return (candidates.find((value) => value >= densitySeconds) ?? 3600) * 1000;
}
export function showcaseAudioGain(volumePercent: number) {
  return volumePercent / 100;
}
export function audioOffsetLabel(offsetMs: number) {
  if (Math.abs(offsetMs) < 50) return "从素材 0.0s 播放";
  if (offsetMs < 0) return `从素材 ${(-offsetMs / 1000).toFixed(1)}s 播放`;
  return `延后 ${(offsetMs / 1000).toFixed(1)}s 播放`;
}
export function showcaseSlideStart(slides: ShowcaseSlide[], index: number, options?: ShowcaseAnimationOptions) {
  return showcaseIntroDuration(options) + slides.slice(0, index).reduce(
    (sum, slide, candidateIndex) => sum + slide.duration * 1000 + showcaseBestEntranceDuration(slides, candidateIndex, options),
    0,
  );
}
export function showcaseSegment(slides: ShowcaseSlide[], timeMs: number, options?: ShowcaseAnimationOptions): ShowcaseSegment {
  const intro = showcaseIntroDuration(options);
  if (timeMs < intro) return { index: 0, offsetMs: 0, phase: "intro", entranceProgress: 0, handoffProgress: 0, usesBestEntrance: false };
  let elapsed = intro;
  for (let index = 0; index < slides.length; index += 1) {
    const duration = slides[index].duration * 1000;
    const bestDuration = showcaseBestEntranceDuration(slides, index, options);
    const usesBestEntrance = bestDuration > 0;
    const entranceEnd = elapsed + (bestDuration ? SHOWCASE_BEST_ENTRANCE_MS : 0);
    const handoffEnd = elapsed + bestDuration;
    const end = handoffEnd + duration;
    if (timeMs < end || index === slides.length - 1) {
      if (bestDuration && timeMs < entranceEnd) {
        return {
          index,
          offsetMs: 0,
          phase: "entrance",
          entranceProgress: (timeMs - elapsed) / SHOWCASE_BEST_ENTRANCE_MS,
          handoffProgress: 0,
          usesBestEntrance,
        };
      }
      if (bestDuration && timeMs < handoffEnd) {
        return {
          index,
          offsetMs: 0,
          phase: "handoff",
          entranceProgress: 1,
          handoffProgress: (timeMs - entranceEnd) / SHOWCASE_BEST_HANDOFF_MS,
          usesBestEntrance,
        };
      }
      return {
        index,
        offsetMs: Math.max(0, timeMs - handoffEnd),
        phase: "slide",
        entranceProgress: 1,
        handoffProgress: 1,
        usesBestEntrance,
      };
    }
    elapsed = end;
  }
  return { index: 0, offsetMs: 0, phase: "slide", entranceProgress: 1, handoffProgress: 1, usesBestEntrance: false };
}
export function settledShowcasePreviewTime(
  slides: ShowcaseSlide[],
  timeMs: number,
  options?: ShowcaseAnimationOptions,
) {
  if (!slides.length) return 0;
  const segment = showcaseSegment(slides, timeMs, options);
  const start = showcaseSlideStart(slides, segment.index, options);
  const stableStart = start + showcaseBestEntranceDuration(slides, segment.index, options);
  return Math.min(showcaseDuration(slides, options), Math.max(timeMs, stableStart + 1000));
}
export function showcaseTransitionProgress(
  slides: ShowcaseSlide[],
  timeMs: number,
  options?: ShowcaseAnimationOptions,
) {
  const segment = showcaseSegment(slides, timeMs, options);
  if (segment.index === 0 || segment.usesBestEntrance) return 1;
  return easeInOut(
    Math.min(1, segment.offsetMs / SHOWCASE_TRANSITION_MS),
  );
}
export function interpolateRadarResponse(
  previous: RadarResponse,
  next: RadarResponse,
  progress: number,
): RadarResponse {
  const amount = Math.max(0, Math.min(1, progress));
  const values = next.radar.dimensions.map((dimension, index) => {
    const previousIndex = previous.radar.dimensions.indexOf(dimension);
    const from =
      previousIndex >= 0 ? previous.radar.values[previousIndex] : null;
    const to = next.radar.values[index];
    if (from == null) return to;
    if (to == null) return from;
    return from + (to - from) * amount;
  });
  const prevSwing = previous.radar.round_swing;
  const nextSwing = next.radar.round_swing;
  const roundSwing = prevSwing != null && nextSwing != null
    ? prevSwing + (nextSwing - prevSwing) * amount
    : (nextSwing ?? prevSwing);
  return {
    ...next,
    radar: {
      ...next.radar,
      values,
      round_swing: roundSwing,
      metrics: next.radar.metrics.map((metric, index) => ({
        ...metric,
        value: values[index] ?? null,
      })),
    },
  };
}
export function showcaseReferenceRadar(response: RadarResponse): RadarResponse {
  const values = response.radar.max_values.map((value) => value ?? null);
  return {
    ...response,
    radar: {
      ...response.radar,
      values,
      metrics: response.radar.metrics.map((metric, index) => ({
        ...metric,
        value: values[index] ?? null,
      })),
    },
  };
}
export function showcaseZeroRadar(response: RadarResponse): RadarResponse {
  const values = response.radar.values.map(() => 0);
  return {
    ...response,
    radar: {
      ...response.radar,
      values,
      round_swing: response.radar.round_swing == null ? undefined : 0,
      metrics: response.radar.metrics.map((metric) => ({ ...metric, value: 0 })),
    },
  };
}
export function stripRatingProfiles(
  response: RadarResponse,
): RadarResponse {
  const { profiles, ...rest } = response;
  void profiles;
  return rest;
}
export function bestMetricIndexesForSlide(
  slides: ShowcaseSlide[],
  slideIndex: number,
) {
  if (slides.length < 2 || !slides[slideIndex]) return [];
  const current = slides[slideIndex];
  return current.radar.radar.dimensions.flatMap((dimension, index) => {
    const value = current.radar.radar.values[index];
    if (value == null || !Number.isFinite(value)) return [];
    const others = slides
      .filter((_, candidateIndex) => candidateIndex !== slideIndex)
      .map((slide) => {
        const candidateIndex = slide.radar.radar.dimensions.indexOf(dimension);
        return candidateIndex >= 0
          ? slide.radar.radar.values[candidateIndex]
          : null;
      })
      .filter((candidate): candidate is number =>
        candidate == null ? false : Number.isFinite(candidate),
      );
    return others.length && others.every((candidate) => value > candidate)
      ? [index]
      : [];
  });
}
export function showcaseCanvasTextAlign(
  alignment: "left" | "center" | "right" | undefined,
) {
  if (alignment === "left") return "right" as const;
  if (alignment === "right") return "left" as const;
  return "center" as const;
}
export function formatDuration(timeMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function averageRadar(entries: OverlayEntry[]): RadarResponse | null {
  if (entries.length < 2) return null;
  const first = entries[0].radar;
  const averagePayload = (payloads: RadarResponse["radar"][]) => {
    const source = payloads[0];
    const values = source.values.map((_, i) => {
      const usable = payloads
      .map((payload) => payload.values[i])
      .filter((value): value is number => value != null);
      return usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : null;
    });
    const swings = payloads.map((payload) => payload.round_swing).filter((value): value is number => value != null);
    return { ...source, values, round_swing: swings.length ? swings.reduce((a, b) => a + b, 0) / swings.length : undefined, metrics: source.metrics.map((metric, i) => ({ ...metric, value: values[i] })) };
  };
  const rating2 = averagePayload(entries.map((entry) => entry.radar.profiles?.rating_2 ?? entry.radar.radar));
  const rating3Payloads = entries.map((entry) => entry.radar.profiles?.rating_3).filter((payload): payload is RadarResponse["radar"] => Boolean(payload));
  const rating3 = rating3Payloads.length === entries.length ? averagePayload(rating3Payloads) : undefined;
  return {
    ...first,
    player: { name: "队列平均", steam_id: "average" },
    match_count: entries.length,
    radar: rating2,
    profiles: { rating_2: rating2, ...(rating3 ? { rating_3: rating3 } : {}) },
    rating_3_status: { available: Boolean(rating3), reason: rating3 ? undefined : "队列中的部分数据不支持 Rating 3.0。" },
  };
}
export function showcaseAverageRadar(slides: ShowcaseSlide[], ratingVersion: "rating_2" | "rating_3"): RadarResponse | null {
  if (!slides.length) return null;
  const responses = slides.map((slide) => slide.radar);
  const payloads = responses
    .map((response) => ratingVersion === "rating_3" ? response.profiles?.rating_3 : response.profiles?.rating_2 ?? response.radar)
    .filter((payload): payload is RadarResponse["radar"] => Boolean(payload));
  if (!payloads.length) return null;
  const source = payloads[0];
  const values = source.dimensions.map((dimension) => {
    const usable = payloads.flatMap((payload) => {
      const index = payload.dimensions.indexOf(dimension);
      const value = index >= 0 ? payload.values[index] : null;
      return value != null && Number.isFinite(value) ? [value] : [];
    });
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
  });
  const swings = payloads.flatMap((payload) => payload.round_swing != null && Number.isFinite(payload.round_swing) ? [payload.round_swing] : []);
  const radar = {
    ...source,
    values,
    round_swing: swings.length ? swings.reduce((sum, value) => sum + value, 0) / swings.length : undefined,
    metrics: source.metrics.map((metric, index) => ({ ...metric, value: values[index] })),
  };
  return {
    ...responses[0],
    player: { name: "队列平均", steam_id: "average" },
    match_count: slides.length,
    radar,
    profiles: ratingVersion === "rating_3"
      ? { rating_2: responses[0].profiles?.rating_2 ?? responses[0].radar, rating_3: radar }
      : { rating_2: radar },
    rating_3_status: { available: ratingVersion === "rating_3" },
  };
}
export function showcasePaintOrder(layers: string[]) {
  return [...layers].reverse();
}
/**
 * 画布图层键，按默认自上而下的顺序排列：`ShowcaseLayoutDraft.layers`
 * 的第一项在最上层，renderer 用 `showcasePaintOrder` 反序绘制。
 * 除雷达/人物等可拖动元素外，背景、数据面板、粒子、水印也属于同一图层栈。
 */
export const SHOWCASE_LAYER_KEYS = [
  "watermark",
  "radar",
  "swing",
  "image",
  "teamLogo",
  "subtitle",
  "title",
  "panel",
  "particles",
  "background",
] as const;
export type ShowcaseLayerKey = (typeof SHOWCASE_LAYER_KEYS)[number];
export const SHOWCASE_LAYER_LABELS: Record<ShowcaseLayerKey, string> = {
  watermark: "Rating 3.0 水印",
  radar: "雷达",
  swing: "Round Swing",
  image: "人物图",
  teamLogo: "战队 Logo",
  subtitle: "副标题",
  title: "主标题",
  panel: "数据面板",
  particles: "粒子",
  background: "背景图（含压暗）",
};
export function showcaseDefaultLayers(ratingVersion: RatingVersion): string[] {
  return SHOWCASE_LAYER_KEYS.filter(
    (layer) =>
      ratingVersion === "rating_3" ||
      (layer !== "swing" && layer !== "watermark"),
  );
}
/**
 * 补齐并迁移图层清单：旧草稿的 `name` 层拆成 `title` + `subtitle`
 * （副标题保持绘制在主标题之上），新增层按默认相对位置插入，
 * 未知键与重复键被剔除。不传 `ratingVersion` 时用于草稿迁移，保留原 swing 状态。
 */
export function normalizeShowcaseLayers(
  layers: unknown,
  ratingVersion?: RatingVersion,
): string[] {
  const known = SHOWCASE_LAYER_KEYS as readonly string[];
  const input = Array.isArray(layers)
    ? layers.filter((layer): layer is string => typeof layer === "string")
    : [];
  const migrated: string[] = [];
  const push = (layer: string) => {
    if (known.includes(layer) && !migrated.includes(layer)) migrated.push(layer);
  };
  for (const layer of input) {
    if (layer === "name") {
      push("subtitle");
      push("title");
      continue;
    }
    if (layer === "swing" && ratingVersion === "rating_2") continue;
    if (layer === "watermark" && ratingVersion === "rating_2") continue;
    push(layer);
  }
  const withSwing = ratingVersion
    ? ratingVersion === "rating_3"
    : migrated.includes("swing");
  const expected = SHOWCASE_LAYER_KEYS.filter(
    (layer) =>
      (layer !== "swing" || withSwing) &&
      (layer !== "watermark" || ratingVersion !== "rating_2"),
  );
  for (const layer of expected) {
    if (migrated.includes(layer)) continue;
    const below = expected
      .slice(expected.indexOf(layer) + 1)
      .find((candidate) => migrated.includes(candidate));
    if (below) migrated.splice(migrated.indexOf(below), 0, layer);
    else migrated.push(layer);
  }
  return migrated;
}
export function easeInOut(progress: number) {
  const value = Math.max(0, Math.min(1, progress));
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
