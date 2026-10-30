import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { OverlayEntry, RadarResponse, RatingVersion } from "../types";
import { radarOuterRingRadius } from "../lib/radarGeometry";

export interface RadarCanvasHandle {
  toDataURL: (width: number, height: number) => string;
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

const textMeasureCache = new Map<string, number>();
function measureCachedText(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  const key = `${font}:${text}`;
  let width = textMeasureCache.get(key);
  if (width == null) {
    ctx.font = font;
    width = ctx.measureText(text).width;
    if (textMeasureCache.size > 800) textMeasureCache.clear();
    textMeasureCache.set(key, width);
  }
  return width;
}

export interface RadarCanvasProps {
  radar?: RadarResponse | null;
  averageRadar?: RadarResponse | null;
  overlays?: OverlayEntry[];
  color?: string;
  title?: string;
  subtitle?: string;
  transparent?: boolean;
  compact?: boolean;
  hideSwing?: boolean;
  previewWidth?: number;
  previewHeight?: number;
  highlightedOverlayId?: string | null;
  bestMetricIndexes?: number[];
  /** 每个指标 0~1 的 BEST 样式占比；用于玩家切换时连续淡入淡出 BEST 视觉。 */
  bestAmounts?: number[];
  showBestMarkers?: boolean;
  /** 标签安全区必须落在该矩形内（雷达子画布坐标），用于把标签收紧在 Data Panel 内。 */
  labelRegion?: RadarBounds;
  radarScaleMode?: string;
  radarScale?: number;
  radarAxisScale?: Record<string, number>;
  ratingVersion?: RatingVersion;
  showRatingWatermark?: boolean;
  fontScale?: number;
  /** Explicit pixel size for metric names, values, and BEST only. */
  metricLabelFontSize?: number;
  /** Explicit value font scale multiplier relative to label size. Defaults to 1.3. */
  valueFontScale?: number;
  averageLineStyle?: "dashed" | "solid";
  hideLabels?: boolean;
  showReferenceLabels?: boolean;
  referenceRadar?: RadarResponse | null;
  /** Optional independent label-value source, used when the chart fades separately. */
  labelRadar?: RadarResponse | null;
  /** Per-axis values that sit at the radar center; lower values remain at center. */
  radarFloorValues?: Record<string, number>;
  /** Keep opener labels at their default position while their values count. */
  fixedLabelPlacement?: boolean;
  gridOpacity?: number;
  highlightOuterRing?: boolean;
  outerRingHighlightOpacity?: number;
  averageColor?: string;
  labelValueColor?: string;
  labelOpacity?: number;
  metricLabelOpacity?: number;
  valueLabelOpacity?: number;
  primaryFillOpacity?: number;
  /** Opacity of the player data polygon only; never use for normal player morphs. */
  primaryOpacity?: number;
  /** Opacity of the average baseline only, for opener fade handoffs. */
  averageOpacity?: number;
  averageGlow?: boolean;
  averageGlowProgress?: number;
  averageGlowColor?: string;
  metricGrowthTransforms?: Record<string, { opacity: number; translateY: number; scale?: number }>;
}

interface Point {
  x: number;
  y: number;
}
export interface RadarBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface RadarLabelFootprint {
  halfWidth: number;
  top: number;
  bottom: number;
}
type Bounds = RadarBounds;
interface RadarDataset {
  id: string;
  radar: RadarResponse;
  color: string;
}

export const ROUND_SWING_TRACK_LIMIT = 5;

export function roundSwingOverflowLimit(values: Array<number | null | undefined>) {
  return Math.max(
    ROUND_SWING_TRACK_LIMIT,
    ...values.flatMap((value) =>
      value != null && Number.isFinite(value) ? [Math.abs(value)] : [],
    ),
  );
}

export function roundSwingBarDistance(
  value: number,
  referenceHalfWidth: number,
  outerHalfWidth: number,
  overflowLimit = ROUND_SWING_TRACK_LIMIT,
) {
  const magnitude = Math.abs(value);
  if (magnitude <= ROUND_SWING_TRACK_LIMIT)
    return referenceHalfWidth * magnitude / ROUND_SWING_TRACK_LIMIT;
  const overflow = Math.max(1, overflowLimit - ROUND_SWING_TRACK_LIMIT);
  return Math.min(
    outerHalfWidth,
    referenceHalfWidth +
      (outerHalfWidth - referenceHalfWidth) * (magnitude - ROUND_SWING_TRACK_LIMIT) / overflow,
  );
}

export function roundSwingBarRadii(
  positive: boolean,
  radius: number,
): [number, number, number, number] {
  return positive ? [0, radius, radius, 0] : [radius, 0, 0, radius];
}

export function roundSwingTrackHeight(
  height: number,
  multiplier = 1,
  fontScale = 1,
) {
  const base = Math.max(10, Math.min(14, height * 0.18));
  return base * multiplier * fontScale;
}

export function formatRoundSwing(value: number) {
  const sign = value > 0 ? "+" : "";
  if (Math.abs(value) >= 100_000) return `${sign}${value.toExponential(2)}%`;
  return `${sign}${value.toFixed(2)}%`;
}

function polygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  points.forEach((point, index) =>
    index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
  );
  ctx.closePath();
}

const geometryCache = new Map<string, ReturnType<typeof computeGeometry>>();
function geometry(props: RadarCanvasProps, width: number, height: number) {
  const showSwing = !props.hideSwing && props.ratingVersion === "rating_3";
  const key = `${props.compact ? 1 : 0}|${showSwing ? 1 : 0}|${width}|${height}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const value = computeGeometry(props, width, height);
  if (geometryCache.size > 128) geometryCache.clear();
  geometryCache.set(key, value);
  return value;
}
function computeGeometry(props: RadarCanvasProps, width: number, height: number) {
  const showSwing = !props.hideSwing && props.ratingVersion === "rating_3";
  return {
    cx: width / 2,
    cy: props.compact
      ? height * (showSwing ? 0.42 : 0.5)
      : height * (showSwing ? 0.45 : 0.52),
    radius: radarOuterRingRadius(props, width, height),
  };
}

function pointAt(
  cx: number,
  cy: number,
  count: number,
  index: number,
  distance: number,
) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  return {
    x: cx + Math.cos(angle) * distance,
    y: cy + Math.sin(angle) * distance,
  };
}

const labelBoundsCache = new Map<string, Bounds>();
function clipToRegion(bounds: Bounds, region?: RadarBounds): Bounds {
  if (!region) return bounds;
  const left = Math.max(bounds.left, region.left);
  const right = Math.min(bounds.right, region.right);
  const top = Math.max(bounds.top, region.top);
  const bottom = Math.min(bounds.bottom, region.bottom);
  // 区域小到放不下任何标签时视为无效（例如雷达被拖到 Data Panel 之外），保留原安全区
  if (right - left < 48 || bottom - top < 32) return bounds;
  return { left, right, top, bottom };
}
function labelRegionKey(region?: RadarBounds) {
  return region
    ? `${Math.round(region.left)},${Math.round(region.top)},${Math.round(region.right)},${Math.round(region.bottom)}`
    : "";
}
function labelBounds(props: RadarCanvasProps, width: number, height: number): Bounds {
  const showSwing = !props.hideSwing && props.ratingVersion === "rating_3";
  const key = `${props.compact ? 1 : 0}|${showSwing ? 1 : 0}|${width}|${height}|${labelRegionKey(props.labelRegion)}`;
  const cached = labelBoundsCache.get(key);
  if (cached) return cached;
  const value = clipToRegion({
    left: width * 0.035,
    right: width * 0.965,
    top: height * 0.035,
    bottom: height * (showSwing ? 0.82 : 0.95),
  }, props.labelRegion);
  if (labelBoundsCache.size > 128) labelBoundsCache.clear();
  labelBoundsCache.set(key, value);
  return value;
}

function axisLabelBounds(
  props: RadarCanvasProps,
  width: number,
  height: number,
  index: number,
  count: number,
): Bounds {
  if (count !== 6) return labelBounds(props, width, height);
  const bottom = height * (!props.hideSwing && props.ratingVersion === "rating_3" ? 0.82 : 0.95);
  const boxes: Bounds[] = [
    { left: width * 0.23, right: width * 0.77, top: height * 0.035, bottom: height * 0.3 },
    { left: width * 0.68, right: width * 0.965, top: height * 0.08, bottom: height * 0.46 },
    { left: width * 0.68, right: width * 0.965, top: height * 0.54, bottom },
    { left: width * 0.23, right: width * 0.77, top: height * 0.68, bottom },
    { left: width * 0.035, right: width * 0.32, top: height * 0.54, bottom },
    { left: width * 0.035, right: width * 0.32, top: height * 0.08, bottom: height * 0.46 },
  ];
  return clipToRegion(boxes[index] ?? labelBounds(props, width, height), props.labelRegion);
}

function distanceToBounds(
  cx: number,
  cy: number,
  count: number,
  index: number,
  bounds: Bounds,
) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const candidates = [
    dx > 0 ? (bounds.right - cx) / dx : dx < 0 ? (bounds.left - cx) / dx : Infinity,
    dy > 0 ? (bounds.bottom - cy) / dy : dy < 0 ? (bounds.top - cy) / dy : Infinity,
  ].filter((distance) => distance > 0 && Number.isFinite(distance));
  return Math.min(...candidates);
}

export function radarLabelSafeDistance(
  cx: number,
  cy: number,
  count: number,
  index: number,
  bounds: RadarBounds,
  footprint: RadarLabelFootprint,
) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const candidates = [
    dx > 0 ? (bounds.right - footprint.halfWidth - cx) / dx : dx < 0 ? (bounds.left + footprint.halfWidth - cx) / dx : Infinity,
    // footprint.top 是相对中心线上移后的负值（标签框上边缘），因此上边界的可行中心是 bounds.top - footprint.top
    dy > 0 ? (bounds.bottom - footprint.bottom - cy) / dy : dy < 0 ? (bounds.top - footprint.top - cy) / dy : Infinity,
  ].filter((distance) => Number.isFinite(distance));
  const limit = Math.min(...candidates);
  // 标签整块比安全区还宽时没有可行解，退回到「中心贴边」，保持对称溢出而不是被画布裁掉
  if (!Number.isFinite(limit) || limit <= 0) {
    const fallback = distanceToBounds(cx, cy, count, index, bounds);
    return Number.isFinite(fallback)
      ? fallback
      : Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top);
  }
  return limit;
}

function metricDistances(
  props: RadarCanvasProps,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  count: number,
  index: number,
  normalized: number,
  clearance: number,
  footprint?: RadarLabelFootprint,
) {
  const bounds = axisLabelBounds(props, width, height, index, count);
  const maximumLabelDistance = footprint
    ? radarLabelSafeDistance(cx, cy, count, index, bounds, footprint)
    : distanceToBounds(cx, cy, count, index, bounds);
  const maximumPointDistance = Math.max(
    radius,
    maximumLabelDistance - clearance,
  );
  const pointDistance = visibleRadarPointDistance(
    normalized,
    radius,
    maximumPointDistance,
  );
  return {
    pointDistance,
    labelDistance: Math.min(
      Math.max(radius * 1.23, pointDistance + clearance),
      maximumLabelDistance,
    ),
  };
}

export function visibleRadarPointDistance(
  normalized: number,
  radius: number,
  safeBoundaryDistance: number,
) {
  return Math.min(
    Math.max(0, normalized) * radius,
    Math.max(radius, safeBoundaryDistance),
  );
}

/**
 * Convert a metric value to a radar radius fraction. A floor is optional so
 * existing radar and overlay rendering continue to use zero as their center.
 * If a custom axis maximum falls below its requested floor, reduce the floor
 * just below that maximum to keep geometry finite and preserve the custom cap.
 */
export function normalizeRadarMetricValue(
  value: number | null | undefined,
  maximum: number,
  floor = 0,
) {
  const upper = Math.max(Number.EPSILON, maximum);
  const requestedFloor = Number.isFinite(floor) ? Math.max(0, floor) : 0;
  const safeFloor = Math.min(
    requestedFloor,
    Math.max(0, upper - Math.max(Number.EPSILON, upper * 0.000001)),
  );
  return Math.max(0, ((value ?? 0) - safeFloor) / Math.max(Number.EPSILON, upper - safeFloor));
}

function radarAxisLimit(
  props: RadarCanvasProps,
  dimension: string,
  maximum: number,
) {
  return props.radarScaleMode === "axis"
    ? props.radarAxisScale?.[dimension] ?? maximum
    : maximum * (props.radarScale ?? 1);
}

function radarNormalizedValue(
  props: RadarCanvasProps,
  dimension: string,
  value: number | null | undefined,
  maximum: number,
) {
  return normalizeRadarMetricValue(
    value,
    radarAxisLimit(props, dimension, maximum),
    props.radarFloorValues?.[dimension],
  );
}

function radarPoints(
  radar: RadarResponse,
  dimensions: string[],
  cx: number,
  cy: number,
  radius: number,
  props: RadarCanvasProps,
  width: number,
  height: number,
  labelFootprints?: RadarLabelFootprint[],
) {
  return dimensions.map((dimension, index) => {
    const sourceIndex = radar.radar.dimensions.indexOf(dimension);
    const value = sourceIndex >= 0 ? radar.radar.values[sourceIndex] : null;
    const maximum =
      sourceIndex >= 0 ? radar.radar.max_values[sourceIndex] || 1 : 1;
    const normalized = radarNormalizedValue(props, dimension, value, maximum);
    const clearance = Math.max(
      // 标签整块的实测高度：BEST 放大后的数值 + 小写 best 会把顶点推得更远，避免相交
      labelFootprints?.[index]
        ? labelFootprints[index].bottom - labelFootprints[index].top
        : 0,
      28,
      width * (props.compact ? 0.055 : 0.038),
    );
    const { pointDistance } = metricDistances(
      props,
      width,
      height,
      cx,
      cy,
      radius,
      dimensions.length,
      index,
      normalized,
      clearance,
      labelFootprints?.[index],
    );
    return pointAt(cx, cy, dimensions.length, index, pointDistance);
  });
}

export interface MetricLabelLayout {
  displayValue: string;
  labelSize: number;
  valueSize: number;
  line: number;
  isBest: boolean;
  /** 0~1 的 BEST 样式占比：玩家切换时用来平滑混入/淡出 BEST 视觉。 */
  bestAmount: number;
  nameWidth: number;
  valueWidth: number;
  bestWordSize: number;
  bestWordWidth: number;
  /** 相对第一行中线的纵向偏移；非 BEST 为 0 */
  bestWordOffsetY: number;
  gap: number;
  rowWidth: number;
  aliasSize: number;
  /** 相对第一行中线的纵向偏移 */
  aliasOffsetY: number;
  /** BEST 数值与 best 小字的字形发光模糊半径；非 BEST 为 0 */
  glowRadius: number;
  radialPush: number;
  footprint: RadarLabelFootprint;
}

export const BEST_VALUE_FONT_SCALE = 1.45;
export const BEST_WORD_FONT_SCALE = 2 / 3;
export const RADAR_BEST_WORD = "best";
export const RADAR_BEST_RADIAL_PUSH = 1.3;
/** 光晕用字形阴影绘制，此值是相对数值字号的模糊半径倍数（不是圆形光斑半径）。 */
export const RADAR_BEST_GLOW_RADIUS = 0.7;

/** 只依赖 font 与 measureText，便于在 node 环境断言排版。 */
export interface RadarTextMeasurer {
  font: string;
  measureText(text: string): { width: number };
}

function compactRadarValue(value: number | null, type: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (type === "percentage") {
    const percentage = value * 100;
    return Math.abs(percentage) >= 100_000
      ? `${percentage.toExponential(2)}%`
      : `${Math.round(percentage)}%`;
  }
  return Math.abs(value) >= 100_000 ? value.toExponential(2) : formatValue(value, type);
}

export const RADAR_VALUE_FONT_SCALE = 1.3;

// BEST 数值与 best 小字共用的展示字体（自托管 OFL 字体，运行期不请求外网）
export const SHOWCASE_DISPLAY_FONT = "Playfair Display";
export const SHOWCASE_DISPLAY_FONT_URL = "/fonts/PlayfairDisplay-Italic-VF.ttf";
export function radarDisplayFont(size: number) {
  return `italic 900 ${size}px "${SHOWCASE_DISPLAY_FONT}", "Noto Sans SC", system-ui`;
}

export const RADAR_SINGLE_PLAYER_FILL_OPACITY = 0.27;
export const RADAR_MULTI_FOCUSED_FILL_OPACITY = 0.24;
export const RADAR_MULTI_FILL_OPACITY = 0.105;
/** AGENTS.md 规定：数值多边形外圈为 2.2 倍线宽、40% 透明的柔和高光。 */
export const RADAR_POLYGON_GLOW_INNER_SCALE = 2.2;
export const RADAR_POLYGON_GLOW_INNER_ALPHA = 0.4;
export type RadarGlowLayer = { width: number; alpha: number; blur: number | null };
export function radarPolygonGlowLayers(lineWidth: number, width: number, blurred: boolean): RadarGlowLayer[] {
  if (!blurred)
    return [
      { width: lineWidth * 5.0, alpha: 0.05, blur: null },
      { width: lineWidth * 3.6, alpha: 0.10, blur: null },
      { width: lineWidth * RADAR_POLYGON_GLOW_INNER_SCALE, alpha: RADAR_POLYGON_GLOW_INNER_ALPHA, blur: null },
    ];
  return [
    { width: lineWidth * 4.2, alpha: 0.16, blur: Math.max(8, Math.round(width / 70)) },
    { width: lineWidth * 2.8, alpha: 0.28, blur: Math.max(3, Math.round(width / 220)) },
    { width: lineWidth * RADAR_POLYGON_GLOW_INNER_SCALE, alpha: RADAR_POLYGON_GLOW_INNER_ALPHA, blur: null },
  ];
}
export function radarPolygonFillOpacity(
  input: { average: boolean; playerCount: number; focused: boolean },
  multiplier = 1,
) {
  if (input.average) return 0;
  const base = input.playerCount <= 1
    ? RADAR_SINGLE_PLAYER_FILL_OPACITY
    : input.focused ? RADAR_MULTI_FOCUSED_FILL_OPACITY : RADAR_MULTI_FILL_OPACITY;
  return base * Math.max(0, Math.min(1, multiplier));
}

export function radarValueFont(size: number, isBest: boolean) {
  return isBest ? radarDisplayFont(size) : `750 ${size}px "Noto Sans SC", system-ui`;
}

export function radarMetricLabelLayout(
  measurer: RadarTextMeasurer,
  props: RadarCanvasProps,
  width: number,
  label: string,
  value: number | null,
  type: string,
  best: boolean | number,
  bounds: Bounds,
): MetricLabelLayout {
  const bestAmount = typeof best === "number" ? Math.max(0, Math.min(1, best)) : best ? 1 : 0;
  const isBest = bestAmount > 0.001;
  const fontScale = props.fontScale ?? 1;
  const requestedSize = props.metricLabelFontSize;
  const baseLabelSize = requestedSize != null
    ? requestedSize * fontScale
    : Math.max(12, width * (props.compact ? 0.018 : 0.012)) * fontScale;
  const isReference = Boolean(props.showReferenceLabels);
  // 只有阶段三 (reference) 数值调大字号，其余时间保持正常大小
  const valueMultiplier = props.valueFontScale ?? (isReference ? RADAR_VALUE_FONT_SCALE : 1);
  const baseValueSize = (requestedSize != null
    ? requestedSize * fontScale
    : Math.max(11, width * (props.compact ? 0.015 : 0.011)) * fontScale) * valueMultiplier;
  const maxWidth = Math.max(28, bounds.right - bounds.left - 8);
  const displayValue = compactRadarValue(value, type);
  const gap = Math.max(4, Math.round(width * 0.004));
  // BEST 数值放大后仍与 best 小字共用同一字体，按实际绘制字体测量
  const bestBoost = 1 + (BEST_VALUE_FONT_SCALE - 1) * bestAmount;
  let scale = 1;
  let nameWidth = 0;
  let valueWidth = 0;
  let bestWordWidth = 0;
  const measureAt = (candidate: number) => {
    const candidateLabelSize = baseLabelSize * candidate;
    const candidateValueSize = baseValueSize * candidate * bestBoost;
    measurer.font = `700 ${candidateLabelSize}px "Noto Sans SC", system-ui`;
    nameWidth = measurer.measureText(label).width;
    measurer.font = radarValueFont(candidateValueSize, isBest);
    valueWidth = measurer.measureText(displayValue).width;
    measurer.font = radarDisplayFont(candidateValueSize * BEST_WORD_FONT_SCALE);
    bestWordWidth = isBest ? measurer.measureText(RADAR_BEST_WORD).width : 0;
  };
  while (scale > 0.58) {
    measureAt(scale);
    if (nameWidth + gap + Math.max(valueWidth, bestWordWidth) <= maxWidth) break;
    scale -= 0.08;
  }
  // 循环可能因下限退出，最后重新按落到的最小字号测量，避免宽度与绘制字号脱节
  scale = Math.max(0.5, scale);
  measureAt(scale);
  const labelSize = baseLabelSize * scale;
  let valueSize = baseValueSize * scale * bestBoost;
  let bestWordSize = valueSize * BEST_WORD_FONT_SCALE;
  const line = Math.max(12, labelSize * 1.05);
  const aliasSize = Math.max(9, Math.round(labelSize * 0.76));
  let bestWordOffsetY = isBest ? valueSize * 0.52 + bestWordSize * 0.5 : 0;
  // 别名必须整行落在「指标名 + 数值」这一行下方，不能压住指标名本身
  let aliasOffsetY = isBest
    ? bestWordOffsetY + bestWordSize * 0.55 + aliasSize * 0.6
    : Math.max(labelSize, valueSize) * 0.5 + aliasSize * 0.68;

  const blockExtent = () => ({
    top: -Math.max(labelSize, valueSize) * 0.62,
    bottom: Math.max(
      aliasOffsetY + aliasSize * 0.55,
      isBest ? bestWordOffsetY + bestWordSize * 0.55 : Number.NEGATIVE_INFINITY,
    ),
  });
  let block = blockExtent();
  const availableH = Math.max(0, bounds.bottom - bounds.top);
  // 高度超出该轴安全区时只收缩数值与 best，指标名保持全局字号，保证整块仍然完整可见
  if (isBest && block.bottom - block.top > availableH) {
    const fit = Math.max(0.5, Math.min(1, availableH / (block.bottom - block.top)));
    valueSize *= fit;
    bestWordSize = valueSize * BEST_WORD_FONT_SCALE;
    bestWordOffsetY = valueSize * 0.52 + bestWordSize * 0.5;
    aliasOffsetY = bestWordOffsetY + bestWordSize * 0.55 + aliasSize * 0.6;
    block = blockExtent();
  }
  const rowWidth = nameWidth + gap + Math.max(valueWidth, bestWordWidth);
  const radialPush = Math.max(16, Math.round(width * 0.024))
    * (1 + (RADAR_BEST_RADIAL_PUSH - 1) * bestAmount);
  // 绘制时会再沿径向推开 radialPush，安全区必须完整扣掉「半个实际行宽 + 位移」，
  // 不能用 maxWidth 截断，否则侧边指标会被雷达子画布左/右边缘裁掉。
  const halfWidth = rowWidth / 2 + 2 + radialPush;
  return {
    displayValue,
    labelSize,
    valueSize,
    line,
    isBest,
    bestAmount,
    nameWidth,
    valueWidth,
    bestWordSize,
    bestWordWidth,
    bestWordOffsetY,
    gap,
    rowWidth,
    aliasSize,
    aliasOffsetY,
    glowRadius: isBest ? valueSize * RADAR_BEST_GLOW_RADIUS * bestAmount : 0,
    radialPush,
    // 一个整体框：指标名 + 数值 + best + 中文别名，BEST 放大后自动把标签推得更远
    footprint: {
      halfWidth,
      top: block.top - radialPush * 1.2,
      bottom: block.bottom + radialPush * 1.2,
    },
  };
}

function datasetsFor(props: RadarCanvasProps): RadarDataset[] {
  if (props.overlays?.length)
    return props.overlays
      .filter((entry) => entry.visible)
      .map((entry) => ({
        id: entry.id,
        radar: selectRatingProfile(entry.radar, props.ratingVersion),
        color: entry.color,
      }));
  if (!props.radar) return props.averageRadar ? [{
    id: "average",
    radar: selectRatingProfile(props.averageRadar, props.ratingVersion),
    color: "#ef4444",
  }] : [];
  const datasets: RadarDataset[] = [
    {
      id: props.radar.player.steam_id,
      radar: selectRatingProfile(props.radar, props.ratingVersion),
      color: props.color ?? "#22d3ee",
    },
  ];
  if (props.averageRadar) datasets.push({
    id: "average",
    radar: selectRatingProfile(props.averageRadar, props.ratingVersion),
    color: props.averageColor ?? "#ef4444",
  });
  return datasets;
}

export function selectRatingProfile(response: RadarResponse, version: RatingVersion = "rating_2"): RadarResponse {
  const profile = version === "rating_3" ? response.profiles?.rating_3 : response.profiles?.rating_2;
  return profile ? { ...response, radar: profile } : response;
}

function createRadarCanvas(width: number, height: number) {
  const canvas =
    typeof document !== "undefined"
      ? document.createElement("canvas")
      : new OffscreenCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvas2D(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): CanvasRenderingContext2D | null {
  return canvas.getContext("2d") as CanvasRenderingContext2D | null;
}

export function renderRadarCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  props: RadarCanvasProps,
  width: number,
  height: number,
) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas2D(canvas);
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  if (!props.transparent) {
    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#15191f");
    background.addColorStop(1, "#090b0e");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  const datasets = datasetsFor(props);
  const referenceRadar = props.referenceRadar
    ? selectRatingProfile(props.referenceRadar, props.ratingVersion)
    : undefined;
  ctx.textBaseline = "middle";
  if (!props.compact) {
    ctx.fillStyle = "#f4f6f8";
    ctx.textAlign = "left";
    ctx.font = `700 ${Math.max(22, width * 0.026)}px "Noto Sans SC", system-ui`;
    ctx.fillText(
      props.title || (datasets[0]?.radar.player.name ?? "选择玩家和比赛"),
      width * 0.035,
      height * 0.06,
    );
    if (props.subtitle) {
      ctx.fillStyle = "#9aa3ad";
      ctx.font = `500 ${Math.max(13, width * 0.012)}px "Noto Sans SC", system-ui`;
      ctx.fillText(props.subtitle, width * 0.035, height * 0.1);
    }
  }
  if (!datasets.length && !referenceRadar) {
    ctx.fillStyle = "#727b86";
    ctx.textAlign = "center";
    ctx.font = `500 ${Math.max(16, width * 0.016)}px "Noto Sans SC", system-ui`;
    ctx.fillText("从资料库选择素材后开始制作", width / 2, height / 2);
    return;
  }

  const dimensions = datasets[0]?.radar.radar.dimensions ?? referenceRadar?.radar.dimensions ?? [];
  const { cx, cy, radius } = geometry(props, width, height);
  const highlighted = props.highlightedOverlayId
    ? datasets.find((dataset) => dataset.id === props.highlightedOverlayId)
    : undefined;
  const valueDataset =
    highlighted ??
    datasets.find((dataset) => dataset.id !== "average") ??
    datasets[0];
  const labelRadar = props.labelRadar ?? valueDataset?.radar ?? referenceRadar;
  if (!labelRadar || !dimensions.length) return;
  const labelLayouts = dimensions.map((label, index) => {
    const sourceIndex = labelRadar.radar.dimensions.indexOf(label);
    const playerValue = sourceIndex >= 0 ? labelRadar.radar.values[sourceIndex] : null;
    const displayType = sourceIndex >= 0 ? labelRadar.radar.display_types[sourceIndex] : "number";
    const valueMaximum = sourceIndex >= 0 ? labelRadar.radar.max_values[sourceIndex] || 1 : 1;
    const displayedValue = props.showReferenceLabels ? valueMaximum : playerValue;
    return radarMetricLabelLayout(
      ctx,
      props,
      width,
      label,
      displayedValue,
      displayType,
      props.showBestMarkers
        ? props.bestAmounts?.[index] ?? (props.bestMetricIndexes?.includes(index) ? 1 : 0)
        : 0,
      axisLabelBounds(props, width, height, index, dimensions.length),
    );
  });
  ctx.save();
  const gridOpacity = Math.max(0, Math.min(1, props.gridOpacity ?? 1));
  ctx.globalAlpha = gridOpacity;
  ctx.strokeStyle = "rgba(184,196,208,.18)";
  ctx.lineWidth = Math.max(1, width / 1200);
  for (let level = 1; level <= 5; level += 1) {
    polygon(
      ctx,
      dimensions.map((_, index) =>
        pointAt(cx, cy, dimensions.length, index, (radius * level) / 5),
      ),
    );
    if (level === 5) {
      // The reference outer ring is persistent. Only its highlight animates.
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(184,196,208,.18)";
      ctx.lineWidth = Math.max(1, width / 1200);
      ctx.stroke();
      if (props.highlightOuterRing) {
        const highlightOpacity = Math.max(0, Math.min(1, props.outerRingHighlightOpacity ?? 1));
        if (highlightOpacity > 0.01) {
          ctx.save();
          ctx.strokeStyle = `rgba(244,246,248,${0.25 * highlightOpacity})`;
          ctx.lineWidth = Math.max(5, width / 240);
          ctx.stroke();
          ctx.strokeStyle = `rgba(244,246,248,${0.95 * highlightOpacity})`;
          ctx.lineWidth = Math.max(2, width / 480);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
    } else ctx.stroke();
  }
  dimensions.forEach((_, index) => {
    const axis = pointAt(cx, cy, dimensions.length, index, radius);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(axis.x, axis.y);
    ctx.stroke();
  });
  ctx.restore();

  datasets.forEach((dataset) => {
    const points = radarPoints(
      dataset.radar,
      dimensions,
      cx,
      cy,
      radius,
      props,
      width,
      height,
      labelLayouts.map((item) => item.footprint),
    );
    const muted = Boolean(highlighted && highlighted.id !== dataset.id);
    const focused = highlighted?.id === dataset.id;
    const average = dataset.id === "average";
    ctx.save();
    const datasetOpacity = Math.max(0, Math.min(1, average
      ? props.averageOpacity ?? 1
      : props.primaryOpacity ?? 1));
    ctx.globalAlpha = (muted ? 0.2 : 1) * datasetOpacity;
    if (average && props.averageGlow) {
      const glowProgress = Math.max(0, Math.min(1, props.averageGlowProgress ?? 1));
      if (glowProgress > 0.01) {
        ctx.save();
        ctx.setLineDash([]);

        // 1. 内部微弱暗红呼吸面 (复刻参考图内部隐约透出的深红环境光)
        ctx.fillStyle = `rgba(220, 38, 38, ${0.045 * glowProgress})`;
        polygon(ctx, points);
        ctx.fill();

        // 2. 外部深红与亮红弥散光雾 (复刻参考图中深邃柔和、大范围扩散的光雾)
        const hasNativeFilter = typeof ctx.filter === "string";
        if (hasNativeFilter) {
          // (a) 外围超宽深邃绯红光雾 (扩散极开，柔和无边)
          ctx.filter = `blur(${Math.max(12, Math.round(width / 65))}px)`;
          ctx.strokeStyle = `rgba(220, 38, 38, ${0.42 * glowProgress})`;
          ctx.lineWidth = Math.max(6, width / 180);
          polygon(ctx, points);
          ctx.stroke();

          // (b) 近核亮绯红光雾
          ctx.filter = `blur(${Math.max(4, Math.round(width / 180))}px)`;
          ctx.strokeStyle = `rgba(255, 60, 75, ${0.68 * glowProgress})`;
          ctx.lineWidth = Math.max(3, width / 340);
          polygon(ctx, points);
          ctx.stroke();

          ctx.filter = "none";
        } else {
          // 优雅降级多层弥散
          const layers = [
            { w: Math.max(24, width / 45), a: 0.08, c: "rgba(220, 38, 38," },
            { w: Math.max(15, width / 75), a: 0.18, c: "rgba(235, 45, 55," },
            { w: Math.max(8, width / 130), a: 0.35, c: "rgba(255, 60, 70," },
            { w: Math.max(4, width / 240), a: 0.65, c: "rgba(255, 80, 95," },
          ];
          for (const l of layers) {
            ctx.lineWidth = l.w;
            ctx.strokeStyle = `${l.c}${l.a * glowProgress})`;
            polygon(ctx, points);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
    if (average && props.averageLineStyle !== "solid")
      ctx.setLineDash([Math.max(6, width / 180), Math.max(4, width / 260)]);
    polygon(ctx, points);
    const lineWidth = average && props.averageGlow
      ? Math.max(1.8, width / 680)
      : Math.max(focused ? 3.5 : 2.5, width / (focused ? 420 : 520));
    const playerCount = datasets.reduce(
      (count, entry) => count + (entry.id === "average" ? 0 : 1),
      0,
    );
    ctx.fillStyle = hexAlpha(
      dataset.color,
      radarPolygonFillOpacity(
        { average, playerCount, focused },
        props.primaryFillOpacity ?? 1,
      ),
    );
    ctx.fill();

    // 先填充再叠发光：填充不会盖掉光晕的一半，模糊层负责真正的向外扩散
    if (!average) {
      const blurred = typeof ctx.filter === "string";
      for (const layer of radarPolygonGlowLayers(lineWidth, width, blurred)) {
        ctx.filter = layer.blur != null ? `blur(${layer.blur}px)` : "none";
        ctx.lineWidth = layer.width;
        ctx.strokeStyle = hexAlpha(dataset.color, layer.alpha);
        polygon(ctx, points);
        ctx.stroke();
      }
      ctx.filter = "none";
    }
    if (focused) {
      ctx.shadowColor = dataset.color;
      ctx.shadowBlur = Math.max(14, width / 55);
    }

    // 复刻参考图：发光时核心线极其纤细 (1.8px)、明亮通透，呈高亮珊瑚粉霓虹色 (#ffa088)
    ctx.strokeStyle = average && props.averageGlow ? "#ffa088" : dataset.color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.setLineDash([]);
    // 代表每项数值的点已按要求删除，保持数值线条清爽利落
    ctx.restore();
  });

  if (!props.hideLabels) {
    ctx.save();
    const baseLabelOpacity = Math.max(0, Math.min(1, props.labelOpacity ?? 1));
    const metricLabelOpacity = Math.max(0, Math.min(1, props.metricLabelOpacity ?? baseLabelOpacity));
    const valueLabelOpacity = Math.max(0, Math.min(1, props.valueLabelOpacity ?? baseLabelOpacity));
    dimensions.forEach((_, index) => {
      const layout = labelLayouts[index];
      const label = dimensions[index];
      const sourceIndex = labelRadar.radar.dimensions.indexOf(label);
      const value = sourceIndex >= 0 ? labelRadar.radar.values[sourceIndex] : null;
      const maximum = sourceIndex >= 0 ? labelRadar.radar.max_values[sourceIndex] || 1 : 1;
      const normalized = props.fixedLabelPlacement
        ? 0
        : radarNormalizedValue(props, label, value, maximum);
      // 标签整块 (名字 + 数值 + best + 别名) 的实测高度即为与顶点之间的安全距离
      const clearance = Math.max(
        layout.line * 2.05,
        layout.footprint.bottom - layout.footprint.top,
        width * (props.compact ? 0.055 : 0.038),
      );
      const { labelDistance } = metricDistances(
        props,
        width,
        height,
        cx,
        cy,
        radius,
        dimensions.length,
        index,
        normalized,
        clearance,
        layout.footprint,
      );
      const text = pointAt(cx, cy, dimensions.length, index, labelDistance);

      const growth = props.metricGrowthTransforms?.[label];
      if (growth && growth.opacity <= 0.001) return;

      // 径向向外推开充足的安全呼吸间距，确保 Rating/Surviving/MultiKill/ADR 各项绝对不遮挡雷达图
      const angle = (index * 2 * Math.PI) / dimensions.length - Math.PI / 2;
      const radialPush = layout.radialPush;
      const renderCenterX = text.x + Math.cos(angle) * radialPush;
      const renderCenterY = text.y + Math.sin(angle) * (radialPush * 1.2) - (growth?.translateY ?? 0);

      const itemOpacity = growth?.opacity ?? 1;
      const row1Y = renderCenterY;
      const chineseName = RADAR_METRIC_CHINESE_NAMES[label];
      const valueLeft = renderCenterX - layout.rowWidth / 2 + layout.nameWidth + layout.gap;

      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      // 1. 第一行：指标名与数值同排
      ctx.globalAlpha = metricLabelOpacity * itemOpacity;
      ctx.fillStyle = "#d7dde3";
      ctx.font = `700 ${layout.labelSize}px "Noto Sans SC", system-ui`;
      ctx.fillText(label, valueLeft - layout.gap - layout.nameWidth, row1Y);

      // 2. BEST：数值放大 + 沿字形轮廓扩散的发光（不是圆形光斑）
      ctx.globalAlpha = valueLabelOpacity * itemOpacity;
      if (layout.bestAmount > 0.001) {
        // BEST 切换：先画淡出的普通字形，再叠入金色字形，避免样式硬切
        if (layout.bestAmount < 0.999) {
          ctx.globalAlpha = valueLabelOpacity * itemOpacity * (1 - layout.bestAmount);
          ctx.fillStyle = props.labelValueColor ?? (props.showReferenceLabels ? "#f4f6f8" : valueDataset?.color ?? "#ef4444");
          ctx.font = radarValueFont(layout.valueSize, false);
          ctx.fillText(layout.displayValue, valueLeft, row1Y);
          ctx.globalAlpha = valueLabelOpacity * itemOpacity;
        }
        ctx.save();
        ctx.globalAlpha *= layout.bestAmount;
        const bestX = valueLeft - layout.valueSize * 0.02;
        const bestY = row1Y + layout.bestWordOffsetY;
        const bestValueFont = radarDisplayFont(layout.valueSize);
        const bestWordFont = radarDisplayFont(layout.bestWordSize);
        const glyphGlow = layout.glowRadius;
        if (glyphGlow > 0.5) {
          // 先用模糊阴影把数值与 best 本身的字形轮廓投成柔光，再叠一层贴字热芯
          ctx.font = bestValueFont;
          ctx.shadowColor = "rgba(255,184,72,.45)";
          ctx.shadowBlur = glyphGlow;
          ctx.fillStyle = "rgba(255,206,116,.5)";
          ctx.fillText(layout.displayValue, valueLeft, row1Y);
          ctx.font = bestWordFont;
          ctx.fillText(RADAR_BEST_WORD, bestX, bestY);
          ctx.font = bestValueFont;
          ctx.shadowColor = "rgba(255,240,196,.92)";
          ctx.shadowBlur = Math.max(2, glyphGlow * 0.32);
          ctx.fillStyle = "rgba(255,246,220,.85)";
          ctx.fillText(layout.displayValue, valueLeft, row1Y);
          ctx.font = bestWordFont;
          ctx.fillText(RADAR_BEST_WORD, bestX, bestY);
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
        }
        ctx.font = bestValueFont;
        ctx.lineJoin = "round";
        // 先描深金外缘、再描奶油内缘，最后填充金面渐变，得到参考图的微立体高光感
        ctx.strokeStyle = "rgba(120,66,10,.85)";
        ctx.lineWidth = Math.max(1, layout.valueSize * 0.05);
        ctx.strokeText(layout.displayValue, valueLeft, row1Y);
        ctx.strokeStyle = "rgba(255,247,224,.8)";
        ctx.lineWidth = Math.max(0.6, layout.valueSize * 0.03);
        ctx.strokeText(layout.displayValue, valueLeft, row1Y);
        const face = ctx.createLinearGradient(
          0, row1Y - layout.valueSize * 0.55,
          0, row1Y + layout.valueSize * 0.55,
        );
        face.addColorStop(0, "#fff4d2");
        face.addColorStop(0.55, "#f6c968");
        face.addColorStop(1, "#e8a12a");
        ctx.fillStyle = face;
        ctx.fillText(layout.displayValue, valueLeft, row1Y);

        // 小写 best 紧跟数值左下角，字号为数值的 2/3，与数值同一字体
        ctx.fillStyle = "#f7d98a";
        ctx.font = bestWordFont;
        ctx.fillText(RADAR_BEST_WORD, bestX, bestY);
        ctx.restore();
      } else {
        ctx.fillStyle = props.labelValueColor ?? (props.showReferenceLabels ? "#f4f6f8" : valueDataset?.color ?? "#ef4444");
        ctx.font = radarValueFont(layout.valueSize, false);
        ctx.fillText(layout.displayValue, valueLeft, row1Y);
      }

      // 3. 中文别名括号标签，整行排在「指标名 + 数值/best」下方
      if (chineseName) {
        ctx.globalAlpha = metricLabelOpacity * itemOpacity * 0.85;
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(215, 221, 227, 0.82)";
        ctx.font = `600 ${layout.aliasSize}px "Noto Sans SC", system-ui`;
        ctx.fillText(`(${chineseName})`, renderCenterX, row1Y + layout.aliasOffsetY);
      }
      ctx.restore();
    });
    ctx.restore();
  }

  if (!props.hideSwing) {
    if (props.overlays?.length && !props.compact) {
      drawOverlayLegend(
        ctx,
        datasets,
        width,
        height,
        props.highlightedOverlayId,
        props.ratingVersion === "rating_3",
        radius,
        props.fontScale,
      );
    } else if (props.ratingVersion === "rating_3") {
      drawSwingRows(
        ctx,
        datasets,
        width,
        height,
        props.compact ?? false,
        radius,
        props.fontScale,
      );
    }
  }
  if (props.ratingVersion === "rating_3" && props.showRatingWatermark) {
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(245,158,11,.72)";
    ctx.font = `650 ${Math.max(10, width * 0.0085)}px "Noto Sans SC", system-ui`;
    ctx.fillText("Rating 3.0 本地近似 · 非 HLTV 官方", width * 0.022, height * 0.972);
  }
}

function drawOverlayLegend(
  ctx: CanvasRenderingContext2D,
  datasets: RadarDataset[],
  width: number,
  height: number,
  highlightedId?: string | null,
  showSwing = false,
  halfWidth?: number,
  fontScale = 1,
) {
  if (showSwing) {
    drawSwingRows(ctx, datasets, width, height, true, halfWidth, fontScale);
    return;
  }
  const gap = Math.max(16, width * 0.018);
  const fontSize = Math.max(11, width * 0.0095) * fontScale;
  ctx.font = `650 ${fontSize}px "Noto Sans SC", system-ui`;
  const items = datasets.map((dataset) => ({
    ...dataset,
    label: dataset.id === "average" ? "队列平均" : dataset.radar.player.name,
  }));
  const widths = items.map((item) => ctx.measureText(item.label).width + 36);
  const total =
    widths.reduce((sum, value) => sum + value, 0) + gap * (items.length - 1);
  let x = Math.max(20, (width - total) / 2);
  const y = height * 0.935;
  items.forEach((item, index) => {
    const muted = Boolean(highlightedId && highlightedId !== item.id);
    ctx.save();
    ctx.globalAlpha = muted ? 0.3 : 1;
    ctx.strokeStyle = item.color;
    ctx.fillStyle = hexAlpha(item.color, item.id === "average" ? 0.04 : 0.2);
    ctx.lineWidth = Math.max(2, width / 900);
    if (item.id === "average") ctx.setLineDash([5, 4]);
    ctx.fillRect(x, y - 6, 20, 12);
    ctx.strokeRect(x, y - 6, 20, 12);
    ctx.setLineDash([]);
    ctx.fillStyle = item.color;
    ctx.textAlign = "left";
    ctx.fillText(item.label, x + 28, y);
    ctx.restore();
    x += widths[index] + gap;
  });
}

function drawSwingRows(
  ctx: CanvasRenderingContext2D,
  datasets: RadarDataset[],
  width: number,
  height: number,
  compact: boolean,
  halfWidth?: number,
  fontScale = 1,
) {
  const rows = datasets.filter((dataset) => dataset.radar.radar.round_swing != null);
  if (!rows.length) return;
  const rowHeight = Math.max(24, height * (compact ? 0.036 : 0.034));
  const totalHeight = rows.length * rowHeight;
  const startY = height * (compact ? 0.78 : 0.84) - totalHeight / 2;
  const centerX = width / 2;
  const trackHalfWidth = halfWidth ?? width * (compact ? 0.22 : 0.27);
  const fontSize = Math.max(11, width * 0.0095) * fontScale;
  const tickSize = Math.max(9, width * 0.007) * fontScale;
  const barRadius = Math.max(2, rowHeight * 0.06);
  const overflowLimit = roundSwingOverflowLimit(
    rows.map((dataset) => dataset.radar.radar.round_swing),
  );
  const overflowHalfWidth = Math.max(
    trackHalfWidth,
    Math.min(width / 2 - 12, trackHalfWidth + width * 0.15),
  );
  rows.forEach((dataset, index) => {
    const value = dataset.radar.radar.round_swing ?? 0;
    const barWidth = roundSwingBarDistance(
      value,
      trackHalfWidth,
      overflowHalfWidth,
      overflowLimit,
    );
    const y = startY + index * rowHeight;
    const isPositive = value > 0;
    const isNegative = value < 0;
    const color = isPositive ? "#35d07f" : isNegative ? "#f05252" : "#8b949e";
    // Background track
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,.06)";
    ctx.beginPath();
    ctx.roundRect(centerX - trackHalfWidth, y, trackHalfWidth * 2, Math.max(10, rowHeight * 0.5), barRadius);
    ctx.fill();
    // Filled bar with gradient
    if (barWidth > 1) {
      const barX = isNegative ? centerX - barWidth : centerX;
      const barY = y + 1;
      const barH = Math.max(8, rowHeight * 0.5) - 2;
      const grad = ctx.createLinearGradient(barX, barY, barX + (isNegative ? -barWidth : barWidth), barY);
      grad.addColorStop(0, color + "88");
      grad.addColorStop(1, color);
      ctx.fillStyle = grad;
      ctx.beginPath();
      const radius = Math.min(barRadius, barWidth / 2);
      ctx.roundRect(
        barX,
        barY,
        barWidth,
        barH,
        roundSwingBarRadii(isPositive, radius),
      );
      ctx.fill();
    }
    // Center line
    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.fillRect(centerX - 1, y - 2, 2, Math.max(12, rowHeight * 0.55));
    // ±5% is fixed at the original track edges; larger values continue outside it.
    ctx.font = `650 ${tickSize}px "Noto Sans SC", system-ui`;
    ctx.fillStyle = "rgba(190,200,210,.72)";
    ctx.textAlign = "center";
    ctx.fillText("-5%", centerX - trackHalfWidth, y + rowHeight * 0.42);
    ctx.fillText("+5%", centerX + trackHalfWidth, y + rowHeight * 0.42);
    // Label
    ctx.font = `700 ${fontSize}px "Noto Sans SC", system-ui`;
    ctx.textAlign = "left";
    ctx.fillStyle = dataset.color;
    const label = datasets.length > 1
      ? dataset.radar.player.name
      : compact
        ? "Round Swing"
        : "Round Swing（回合影响）";
    ctx.fillText(label, centerX - trackHalfWidth, y - fontSize * 0.5);
    // Value
    ctx.textAlign = "right";
    ctx.fillStyle = color;
    ctx.font = `750 ${fontSize}px ui-monospace, monospace`;
    ctx.fillText(formatRoundSwing(value), centerX + trackHalfWidth, y - fontSize * 0.5);
    ctx.restore();
  });
}

export function renderSwingCanvas(
  dataset: { id: string; radar: RadarResponse; color: string } | null,
  width: number,
  height: number,
  halfWidth?: number,
  fontScale = 1,
  average?: RadarResponse | null,
  stage: "empty" | "reference" | "average" | "outro" | "player" = "player",
  appearance = 1,
  playerFillOpacity = 1,
  averageLineColor = "#ef4444",
  referenceLabelOpacity = stage === "reference" || stage === "player" ? 1 : 0,
  averageLineOpacity = 1,
  displayValue?: number | null,
  textOpacity = 1,
  valueOpacity = textOpacity,
  displayValueColor?: string,
  overflowLimit?: number | null,
  metricLabelFontSize?: number,
  targetCanvas?: HTMLCanvasElement | OffscreenCanvas,
  displayFillValue?: number | null,
  valueFontScale?: number,
) {
  const canvas = targetCanvas ?? createRadarCanvas(width, height);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas2D(canvas);
  if (!ctx) return canvas;
  ctx.clearRect(0, 0, width, height);
  const value = dataset?.radar.radar.round_swing;
  if (stage === "player" && value == null) return canvas;
  const centerX = width / 2;
  const trackHalfWidth = halfWidth ?? width * 0.3;
  // Round Swing 赛道条高度增加 50%
  const trackHeight = Math.round(roundSwingTrackHeight(height, 2.25, fontScale) * 1.5);
  const y = height * 0.5 - trackHeight / 2;
  const fontSize = metricLabelFontSize != null
    ? metricLabelFontSize * fontScale
    : Math.max(12, width * 0.012) * fontScale;
  const isReferenceStage = stage === "reference";
  // 只有阶段三调大数值字号，其余时间字号调整为正常大小
  const valMultiplier = valueFontScale ?? (isReferenceStage ? RADAR_VALUE_FONT_SCALE : 1);
  const valFontSize = fontSize * valMultiplier;
  const averageValue = average?.radar.round_swing;
  const effectiveOverflowLimit = Math.max(
    ROUND_SWING_TRACK_LIMIT,
    overflowLimit != null && Number.isFinite(overflowLimit)
      ? Math.abs(overflowLimit)
      : ROUND_SWING_TRACK_LIMIT,
  );
  const overflowHalfWidth = Math.max(
    trackHalfWidth,
    width / 2 - Math.max(6 * fontScale, width * 0.03),
  );
  const isAverageStage = stage === "average";
  const isReferenceFill = isReferenceStage;
  const isAverageFill = isAverageStage && averageValue != null && Number.isFinite(averageValue);

  let activeFillValue = (value ?? 0);
  if (isReferenceFill) {
    activeFillValue = displayFillValue ?? 5;
  } else if (isAverageFill) {
    activeFillValue = averageValue * Math.max(0, Math.min(1, playerFillOpacity));
  }
  const positive = activeFillValue >= 0;
  const barWidth = roundSwingBarDistance(
    activeFillValue,
    trackHalfWidth,
    overflowHalfWidth,
    effectiveOverflowLimit,
  );
  const color = positive ? "#35d07f" : "#f05252";
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, appearance));

  // 条内数值块 (直角矩形，阶段二生长到平均线位置，阶段三生长到 +5% 位置)
  if ((((stage === "player" || stage === "outro") && dataset) || isAverageFill || isReferenceFill) && barWidth > 1) {
    const barX = positive ? centerX : centerX - barWidth;
    const gradient = ctx.createLinearGradient(barX, y, barX + (positive ? barWidth : -barWidth), y);
    if (isReferenceFill) {
      if (positive) {
        // 数值块为+值时，颜色为绿色而不是白色
        gradient.addColorStop(0, "rgba(53, 208, 127, 0.28)");
        gradient.addColorStop(0.75, "rgba(53, 208, 127, 0.72)");
        gradient.addColorStop(1, "rgba(53, 208, 127, 0.95)");
      } else {
        gradient.addColorStop(0, "rgba(240, 82, 82, 0.28)");
        gradient.addColorStop(0.75, "rgba(240, 82, 82, 0.72)");
        gradient.addColorStop(1, "rgba(240, 82, 82, 0.95)");
      }
    } else {
      const barColor = isAverageFill ? averageLineColor : color;
      gradient.addColorStop(0, `${barColor}66`);
      gradient.addColorStop(1, barColor);
    }
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, isReferenceFill ? 1 : playerFillOpacity));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    const barPad = Math.max(1, Math.round(1.5 * fontScale));
    ctx.rect(
      barX,
      y + barPad,
      barWidth,
      Math.max(1, trackHeight - barPad * 2),
    );
    ctx.fill();

    // 阶段三端点边缘垂直高亮线 (+值时为亮绿)
    if (isReferenceFill) {
      ctx.fillStyle = positive ? "#5efca8" : "#f05252";
      ctx.fillRect(positive ? barX + barWidth - 1 : barX, y, 2, trackHeight);
    }
    ctx.restore();
  }

  // 中心点 0 点的白色线 (任何阶段均呈现，包括入场阶段)
  ctx.fillStyle = "rgba(255,255,255,.85)";
  const centerLineW = Math.max(1, Math.round(2 * fontScale));
  const centerLineOver = Math.max(2, Math.round(4 * fontScale));
  ctx.fillRect(centerX - centerLineW / 2, y - centerLineOver, centerLineW, trackHeight + centerLineOver * 2);
  if (averageValue != null && Number.isFinite(averageValue)) {
    const averageDistance = roundSwingBarDistance(
      averageValue,
      trackHalfWidth,
      overflowHalfWidth,
      effectiveOverflowLimit,
    );
    const averageX = centerX + (averageValue < 0 ? -averageDistance : averageDistance);
    const avgLineOver = Math.max(3, Math.round(7 * fontScale));
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, averageLineOpacity));
    ctx.strokeStyle = averageLineColor;
    ctx.lineWidth = Math.max(2, Math.round(3 * fontScale));
    ctx.beginPath();
    ctx.moveTo(averageX, y - avgLineOver);
    ctx.lineTo(averageX, y + trackHeight + avgLineOver);
    ctx.stroke();
    ctx.restore();
  }
  const shownValue = displayValue ?? ((stage === "average" || stage === "outro") ? averageValue : value);
  if ((stage === "average" || stage === "reference" || stage === "outro" || stage === "player") && (shownValue != null || isReferenceStage)) {
    const titleText = "Round Swing";
    const valText = isReferenceStage ? "+5%" : formatRoundSwing(shownValue ?? 0);
    const titleFont = `700 ${fontSize}px "Noto Sans SC", system-ui`;
    // 与雷达图数值字号严格保持一致
    const valFont = `750 ${valFontSize}px "Noto Sans SC", system-ui`;
    const gap = Math.max(8, Math.round(fontSize * 0.45));

    const titleW = measureCachedText(ctx, titleText, titleFont);
    const valW = measureCachedText(ctx, valText, valFont);
    const totalRowW = titleW + gap + valW;

    const row1Y = y + trackHeight + Math.max(6, fontSize * 0.4);
    const row1StartX = centerX - totalRowW / 2;

    // 1. 同行第一行：左侧为 "Round Swing"，右边紧接着数值文字
    ctx.save();
    ctx.textBaseline = "top";

    // 标题文字 (颜色用六项文字同样的颜色 #d7dde3)
    ctx.textAlign = "left";
    ctx.globalAlpha = Math.max(0, Math.min(1, textOpacity));
    ctx.fillStyle = "#d7dde3";
    ctx.font = titleFont;
    ctx.fillText(titleText, row1StartX, row1Y);

    // 数值文字 (在同一行的右边)
    ctx.globalAlpha = Math.max(0, Math.min(1, appearance)) * Math.max(0, Math.min(1, valueOpacity));
    ctx.fillStyle = isReferenceStage
      ? (displayValueColor ?? "#f4f6f8")
      : (displayValueColor ?? (stage === "average" ? averageLineColor : color));
    ctx.font = valFont;
    ctx.fillText(valText, row1StartX + titleW + gap, row1Y);
    ctx.restore();

    // 2. 底部用括号居中显示 "(回合影响)"
    ctx.save();
    const row2Y = row1Y + fontSize * 1.16;
    const subFontSize = Math.max(9, Math.round(fontSize * 0.76));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.globalAlpha = Math.max(0, Math.min(1, textOpacity)) * 0.85;
    ctx.fillStyle = "rgba(215, 221, 227, 0.85)";
    ctx.font = `600 ${subFontSize}px "Noto Sans SC", system-ui`;
    ctx.fillText("(回合影响)", centerX, row2Y);
    ctx.restore();
  }
  if (referenceLabelOpacity > 0 && !isReferenceStage) {
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, referenceLabelOpacity));
    const refFontSize = Math.max(8 * fontScale, fontSize * .78);
    ctx.font = `650 ${refFontSize}px "Noto Sans SC", system-ui`;
    ctx.fillStyle = "rgba(244,246,248,.92)";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("-5%", centerX - trackHalfWidth, y + trackHeight + Math.max(5, fontSize * 0.4));
    ctx.textAlign = "right";
    ctx.fillText("+5%", centerX + trackHalfWidth, y + trackHeight + Math.max(5, fontSize * 0.4));
    ctx.restore();
  }
  ctx.restore();
  return canvas;
}

export function formatRadarValue(value: number | null, type: string) {
  return formatValue(value, type);
}

function formatValue(value: number | null, type: string) {
  if (value == null) return "—";
  return type === "percentage"
    ? `${Math.round(value * 100)}%`
    : value.toFixed(value >= 10 ? 1 : 2);
}

function hexAlpha(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return `rgba(34,211,238,${alpha})`;
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${alpha})`;
}

function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function pointInPolygon(point: Point, points: Point[]) {
  let inside = false;
  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index, index += 1
  ) {
    const a = points[index];
    const b = points[previous];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x <
        ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function hitTestOverlay(
  props: RadarCanvasProps,
  width: number,
  height: number,
  point: Point,
) {
  const datasets = datasetsFor(props).filter(
    (dataset) => dataset.id !== "average",
  );
  if (!datasets.length) return null;
  const dimensions = datasets[0].radar.radar.dimensions;
  const { cx, cy, radius } = geometry(props, width, height);
  let best: { id: string; distance: number } | null = null;
  datasets.forEach((dataset) => {
    const points = radarPoints(
      dataset.radar,
      dimensions,
      cx,
      cy,
      radius,
      props,
      width,
      height,
    );
    let distance = Infinity;
    points.forEach((start, index) => {
      distance = Math.min(
        distance,
        pointToSegmentDistance(
          point,
          start,
          points[(index + 1) % points.length],
        ),
      );
    });
    if (!pointInPolygon(point, points) && distance > Math.max(14, width / 80))
      return;
    if (!best || distance < best.distance) best = { id: dataset.id, distance };
  });
  return best ? (best as { id: string; distance: number }).id : null;
}

export const RadarCanvas = memo(
  forwardRef<RadarCanvasHandle, RadarCanvasProps>(
    (props, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [hoveredOverlayId, setHoveredOverlayId] = useState<string | null>(
      null,
    );
    const effectiveProps = props.overlays?.length
      ? { ...props, highlightedOverlayId: hoveredOverlayId }
      : props;
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const draw = () => {
        const rect = parent.getBoundingClientRect();
        const aspect =
          Math.max(1, props.previewWidth ?? 16) /
          Math.max(1, props.previewHeight ?? 9);
        const availableWidth = Math.max(240, rect.width - 36);
        const availableHeight = Math.max(180, rect.height - 36);
        let displayWidth = availableWidth;
        let displayHeight = displayWidth / aspect;
        if (displayHeight > availableHeight) {
          displayHeight = availableHeight;
          displayWidth = displayHeight * aspect;
        }
        const density = Math.min(2, window.devicePixelRatio || 1);
        canvas.style.width = `${Math.floor(displayWidth)}px`;
        canvas.style.height = `${Math.floor(displayHeight)}px`;
        renderRadarCanvas(
          canvas,
          effectiveProps,
          Math.max(320, Math.floor(displayWidth * density)),
          Math.max(180, Math.floor(displayHeight * density)),
        );
      };
      draw();
      const observer = new ResizeObserver(draw);
      observer.observe(parent);
      return () => observer.disconnect();
    }, [props, hoveredOverlayId]);
    useImperativeHandle(
      ref,
      () => ({
        toDataURL(width, height) {
          const canvas = document.createElement("canvas");
          renderRadarCanvas(canvas, props, width, height);
          return canvas.toDataURL("image/png");
        },
      }),
      [props],
    );
    return (
      <canvas
        ref={canvasRef}
        className={`radar-canvas ${props.transparent ? "transparent" : ""} ${hoveredOverlayId ? "is-hovering-dataset" : ""}`}
        role="img"
        aria-label="雷达图预览"
        onPointerMove={(event) => {
          if (!props.overlays?.length || !canvasRef.current) return;
          const rect = canvasRef.current.getBoundingClientRect();
          const next = hitTestOverlay(
            props,
            canvasRef.current.width,
            canvasRef.current.height,
            {
              x:
                (event.clientX - rect.left) *
                (canvasRef.current.width / rect.width),
              y:
                (event.clientY - rect.top) *
                (canvasRef.current.height / rect.height),
            },
          );
          setHoveredOverlayId(next);
        }}
        onPointerLeave={() => setHoveredOverlayId(null)}
      />
    );
  },
  ),
);
