import type {
  OverlayEntry,
  RadarResponse,
  ShowcaseLayoutDraft,
  ShowcaseSlide,
} from "../../types";

export type ShowcaseTarget = "radar" | "title" | "subtitle" | "image" | "swing";
export type ShowcaseTransform = { x: number; y: number; scale: number };
export function targetBaseBounds(target: ShowcaseTarget) { return target === "radar" ? { x: 18, y: 32 } : target === "image" ? { x: 10, y: 18 } : target === "title" ? { x: 15, y: 5 } : target === "subtitle" ? { x: 13, y: 3.5 } : { x: 17, y: 17 }; }
export function targetBounds(target: ShowcaseTarget, transform: ShowcaseTransform) {
  const base = targetBaseBounds(target);
  const halfX = base.x*transform.scale/100, halfY = base.y*transform.scale/100;
  return { left: transform.x-halfX, right: transform.x+halfX, top: transform.y-halfY, bottom: transform.y+halfY };
}
export function selectionBounds(target: ShowcaseTarget, transform: ShowcaseTransform, width: number, height: number, layout: ShowcaseLayoutDraft) {
  if (target !== "swing") return targetBounds(target, transform);
  const radarSize = (Math.min(width * 0.48, height * 0.78) * layout.radarScale) / 100;
  const swingScale = transform.scale / 100;
  const swingCanvasH = radarSize * 0.19 * swingScale;
  const trackCenterY = transform.y + ((0.28 * swingCanvasH) / height) * 100;
  const trackHalfX = Math.max(14, ((0.27 * radarSize * swingScale) / width) * 100);
  return { left: transform.x-trackHalfX, right: transform.x+trackHalfX, top: trackCenterY-6, bottom: trackCenterY+6 };
}
export function nearestCornerDistance(point: {x:number;y:number}, bounds: ReturnType<typeof targetBounds>) { return Math.min(...[[bounds.left,bounds.top],[bounds.right,bounds.top],[bounds.left,bounds.bottom],[bounds.right,bounds.bottom]].map(([x,y]) => Math.hypot(point.x-x,point.y-y))); }
export function clampShowcaseTransform(target: ShowcaseTarget, transform: ShowcaseTransform) { const base=targetBaseBounds(target); const scale=Math.max(35,Math.min(220,50/base.x*100,50/base.y*100,transform.scale)); const bounds = targetBounds(target, { ...transform, x:0, y:0, scale }); const halfX=(bounds.right-bounds.left)/2, halfY=(bounds.bottom-bounds.top)/2; return { ...transform, scale, x:Math.max(halfX,Math.min(100-halfX,transform.x)), y:Math.max(halfY,Math.min(100-halfY,transform.y)) }; }

export function showcaseDuration(slides: ShowcaseSlide[]) {
  return slides.reduce((sum, slide) => sum + slide.duration * 1000, 0);
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
export function showcaseSlideStart(slides: ShowcaseSlide[], index: number) {
  return slides
    .slice(0, index)
    .reduce((sum, slide) => sum + slide.duration * 1000, 0);
}
export function showcaseSegment(slides: ShowcaseSlide[], timeMs: number) {
  let elapsed = 0;
  for (let index = 0; index < slides.length; index += 1) {
    const duration = slides[index].duration * 1000;
    if (timeMs < elapsed + duration || index === slides.length - 1)
      return { index, offsetMs: Math.max(0, timeMs - elapsed) };
    elapsed += duration;
  }
  return { index: 0, offsetMs: 0 };
}
export function settledShowcasePreviewTime(
  slides: ShowcaseSlide[],
  timeMs: number,
) {
  if (!slides.length) return 0;
  const segment = showcaseSegment(slides, timeMs);
  const start = showcaseSlideStart(slides, segment.index);
  return Math.min(showcaseDuration(slides), Math.max(timeMs, start + 1000));
}
export const SHOWCASE_TRANSITION_MS = 1000;
export function showcaseTransitionProgress(
  slides: ShowcaseSlide[],
  timeMs: number,
) {
  const segment = showcaseSegment(slides, timeMs);
  if (segment.index === 0) return 1;
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
export function showcasePaintOrder(layers: string[]) {
  return [...layers].reverse();
}
function easeInOut(progress: number) {
  const value = Math.max(0, Math.min(1, progress));
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
