import type {
  OverlayEntry,
  RadarResponse,
  RatingVersion,
  ShowcaseLayoutDraft,
  ShowcaseSlide,
} from "../../types";
import { radarOuterRingDiameter } from "../../lib/radarGeometry";
import { ROUND_SWING_TRACK_LIMIT } from "../../components/RadarCanvas";

export type ShowcaseTarget = "radar" | "title" | "subtitle" | "image" | "swing";
export type ShowcaseTransform = { x: number; y: number; scale: number };
export type ShowcaseAnimationOptions = {
  showIntroAnimation?: boolean;
  showBestEntranceAnimation?: boolean;
  reduceMotion?: boolean;
};
export type ShowcasePhase = "intro" | "entrance" | "handoff" | "slide";
export type ShowcaseIntroStage = "empty" | "reference" | "average" | "outro";
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
export const SHOWCASE_INTRO_MS = 8000;
export const SHOWCASE_INTRO_EMPTY_MS = 2000;
export const SHOWCASE_INTRO_REFERENCE_MS = 2000;
export const SHOWCASE_INTRO_AVERAGE_MS = 2000;
export const SHOWCASE_INTRO_OUTRO_MS = 2000;
export const SHOWCASE_BEST_ENTRANCE_MS = 3000;
export const SHOWCASE_BEST_HANDOFF_MS = 1000;
export const SHOWCASE_TRANSITION_MS = 1000;
export const SHOWCASE_EXPORT_WIDTH = 1920;
export const SHOWCASE_EXPORT_HEIGHT = 1080;
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
export function targetBaseBounds(target: ShowcaseTarget) { return target === "radar" ? { x: 18, y: 32 } : target === "image" ? { x: 10, y: 18 } : target === "title" ? { x: 15, y: 5 } : target === "subtitle" ? { x: 13, y: 3.5 } : { x: 17, y: 17 }; }
export function targetBounds(target: ShowcaseTarget, transform: ShowcaseTransform) {
  const base = targetBaseBounds(target);
  const halfX = base.x*transform.scale/100, halfY = base.y*transform.scale/100;
  return { left: transform.x-halfX, right: transform.x+halfX, top: transform.y-halfY, bottom: transform.y+halfY };
}
export function selectionBounds(target: ShowcaseTarget, transform: ShowcaseTransform, width: number, height: number, layout: ShowcaseLayoutDraft, maxSwingMagnitude?: number) {
  if (target !== "swing") return targetBounds(target, transform);
  const radarSize = (Math.min(width * 0.48, height * 0.78) * layout.radarScale) / 100;
  const swingScale = transform.scale / 100;
  const outerRingDiameter = showcaseOuterRadarRingDiameter(radarSize);
  const swingCanvasW = showcaseSwingCanvasWidth(outerRingDiameter, maxSwingMagnitude) * swingScale;
  const swingCanvasH = radarSize * 0.22 * swingScale;
  const trackCenterY = transform.y;
  const trackHalfX = Math.max(14, ((swingCanvasW / 2) / width) * 100);
  const trackHalfY = Math.max(7.5, ((Math.max(10, Math.min(14, swingCanvasH * 0.18)) * 2.25 / height) * 100) / 2);
  return { left: transform.x-trackHalfX, right: transform.x+trackHalfX, top: trackCenterY-trackHalfY, bottom: trackCenterY+trackHalfY };
}
export function nearestCornerDistance(point: {x:number;y:number}, bounds: ReturnType<typeof targetBounds>) { return Math.min(...[[bounds.left,bounds.top],[bounds.right,bounds.top],[bounds.left,bounds.bottom],[bounds.right,bounds.bottom]].map(([x,y]) => Math.hypot(point.x-x,point.y-y))); }
export function clampShowcaseTransform(target: ShowcaseTarget, transform: ShowcaseTransform) { const base=targetBaseBounds(target); const scale=Math.max(35,Math.min(220,50/base.x*100,50/base.y*100,transform.scale)); const bounds = targetBounds(target, { ...transform, x:0, y:0, scale }); const halfX=(bounds.right-bounds.left)/2, halfY=(bounds.bottom-bounds.top)/2; return { ...transform, scale, x:Math.max(halfX,Math.min(100-halfX,transform.x)), y:Math.max(halfY,Math.min(100-halfY,transform.y)) }; }

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
function hasBestEntrance(slides: ShowcaseSlide[], index: number, options?: ShowcaseAnimationOptions) {
  return animationsEnabled(options)
    && Boolean(options?.showBestEntranceAnimation)
    && (bestMetricIndexesBySlide(slides)[index]?.length ?? 0) > 0;
}
export function showcaseIntroDuration(options?: ShowcaseAnimationOptions) {
  return animationsEnabled(options) && options?.showIntroAnimation ? SHOWCASE_INTRO_MS : 0;
}
export function showcaseIntroState(timeMs: number): ShowcaseIntroState {
  const time = Math.max(0, Math.min(SHOWCASE_INTRO_MS, timeMs));
  if (time < SHOWCASE_INTRO_EMPTY_MS)
    return { stage: "empty", progress: time / SHOWCASE_INTRO_EMPTY_MS };
  if (time < SHOWCASE_INTRO_EMPTY_MS + SHOWCASE_INTRO_REFERENCE_MS)
    return {
      stage: "reference",
      progress: (time - SHOWCASE_INTRO_EMPTY_MS) / SHOWCASE_INTRO_REFERENCE_MS,
    };
  if (time < SHOWCASE_INTRO_EMPTY_MS + SHOWCASE_INTRO_REFERENCE_MS + SHOWCASE_INTRO_AVERAGE_MS)
    return {
      stage: "average",
      progress: (time - SHOWCASE_INTRO_EMPTY_MS - SHOWCASE_INTRO_REFERENCE_MS) / SHOWCASE_INTRO_AVERAGE_MS,
    };
  return {
    stage: "outro",
    progress: Math.min(1, (time - SHOWCASE_INTRO_EMPTY_MS - SHOWCASE_INTRO_REFERENCE_MS - SHOWCASE_INTRO_AVERAGE_MS) / SHOWCASE_INTRO_OUTRO_MS),
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
export function easeInOut(progress: number) {
  const value = Math.max(0, Math.min(1, progress));
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
