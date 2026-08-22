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
  showBestMarkers?: boolean;
  radarScaleMode?: string;
  radarScale?: number;
  radarAxisScale?: Record<string, number>;
  ratingVersion?: RatingVersion;
  showRatingWatermark?: boolean;
  fontScale?: number;
  /** Explicit pixel size for metric names, values, and BEST only. */
  metricLabelFontSize?: number;
  averageLineStyle?: "dashed" | "solid";
  hideLabels?: boolean;
  showReferenceLabels?: boolean;
  referenceRadar?: RadarResponse | null;
  /** Optional independent label-value source, used when the chart fades separately. */
  labelRadar?: RadarResponse | null;
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
  return referenceHalfWidth +
    (outerHalfWidth - referenceHalfWidth) * (magnitude - ROUND_SWING_TRACK_LIMIT) / overflow;
}

export function roundSwingBarRadii(
  positive: boolean,
  radius: number,
): [number, number, number, number] {
  return positive ? [0, radius, radius, 0] : [radius, 0, 0, radius];
}

export function roundSwingTrackHeight(height: number, multiplier = 1) {
  const base = Math.max(10, Math.min(14, height * 0.18));
  return base * multiplier;
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
function labelBounds(props: RadarCanvasProps, width: number, height: number): Bounds {
  const showSwing = !props.hideSwing && props.ratingVersion === "rating_3";
  const key = `${props.compact ? 1 : 0}|${showSwing ? 1 : 0}|${width}|${height}`;
  const cached = labelBoundsCache.get(key);
  if (cached) return cached;
  const value = {
    left: width * 0.035,
    right: width * 0.965,
    top: height * 0.035,
    bottom: height * (showSwing ? (props.compact ? 0.82 : 0.82) : 0.95),
  };
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
  return boxes[index] ?? labelBounds(props, width, height);
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
    dy > 0 ? (bounds.bottom - footprint.bottom - cy) / dy : dy < 0 ? (bounds.top - footprint.top - cy) / dy : Infinity,
  ].filter((distance) => distance > 0 && Number.isFinite(distance));
  return Math.min(...candidates);
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
    const limit =
      props.radarScaleMode === "axis"
        ? props.radarAxisScale?.[dimension] ?? maximum
        : maximum * (props.radarScale ?? 1);
    const normalized = Math.max(
      0,
      (value ?? 0) / Math.max(Number.EPSILON, limit),
    );
    const clearance = Math.max(
      props.showBestMarkers && props.bestMetricIndexes?.includes(index)
        ? width * (props.compact ? 0.075 : 0.055)
        : 28,
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

interface MetricLabelLayout {
  labelLines: string[];
  displayValue: string;
  labelSize: number;
  valueSize: number;
  line: number;
  labelStart: number;
  valueOffset: number;
  bestOffset?: number;
  footprint: RadarLabelFootprint;
}

function wrapMetricLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  maxWidth: number,
  font: string,
) {
  ctx.font = font;
  if (ctx.measureText(label).width <= maxWidth) return [label];
  const lines: string[] = [];
  let line = "";
  for (const character of Array.from(label)) {
    const candidate = `${line}${character}`;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
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

function metricLabelLayout(
  ctx: CanvasRenderingContext2D,
  props: RadarCanvasProps,
  width: number,
  label: string,
  value: number | null,
  type: string,
  isBest: boolean,
  bounds: Bounds,
): MetricLabelLayout {
  const fontScale = props.fontScale ?? 1;
  const requestedSize = props.metricLabelFontSize;
  const baseLabelSize = requestedSize ?? Math.max(12, width * (props.compact ? 0.018 : 0.012)) * fontScale;
  const baseValueSize = requestedSize ?? Math.max(11, width * (props.compact ? 0.015 : 0.011)) * fontScale;
  const maxWidth = Math.max(28, bounds.right - bounds.left - 8);
  const displayValue = compactRadarValue(value, type);
  let scale = 1;
  let labelLines: string[] = [label];
  while (scale > 0.58) {
    const labelSize = baseLabelSize * scale;
    const valueSize = baseValueSize * scale;
    labelLines = wrapMetricLabel(ctx, label, maxWidth, `700 ${labelSize}px "Noto Sans SC", system-ui`);
    ctx.font = `700 ${valueSize}px "Bangers", "Noto Sans SC", system-ui`;
    if (ctx.measureText(displayValue).width <= maxWidth && labelLines.length <= 2) break;
    scale -= 0.08;
  }
  const labelSize = baseLabelSize * scale;
  const valueSize = baseValueSize * scale;
  const line = Math.max(12, labelSize * 1.05);
  labelLines = wrapMetricLabel(ctx, label, maxWidth, `700 ${labelSize}px "Noto Sans SC", system-ui`).slice(0, 2);
  const labelStart = (isBest ? -line * 1.15 : -line * 0.72) - (labelLines.length - 1) * line * 0.42;
  const valueOffset = labelStart + labelLines.length * line * 0.94;
  const bestOffset = isBest ? valueOffset + line * 0.92 : undefined;
  ctx.font = `700 ${labelSize}px "Noto Sans SC", system-ui`;
  const labelWidth = Math.max(...labelLines.map((lineText) => ctx.measureText(lineText).width));
  ctx.font = `700 ${valueSize}px "Bangers", "Noto Sans SC", system-ui`;
  const valueWidth = ctx.measureText(displayValue).width;
  const bestWidth = isBest ? ctx.measureText("BEST").width : 0;
  const bestValueSize = valueSize;
  return {
    labelLines,
    displayValue,
    labelSize,
    valueSize: bestValueSize,
    line,
    labelStart,
    valueOffset,
    bestOffset,
    footprint: {
      halfWidth: Math.min(maxWidth / 2, Math.max(labelWidth, valueWidth, bestWidth) / 2 + 2),
      top: labelStart - labelSize * 0.55,
      bottom: (bestOffset ?? valueOffset) + bestValueSize * 0.62,
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
  canvas.width = width;
  canvas.height = height;
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
    return metricLabelLayout(
      ctx,
      props,
      width,
      label,
      displayedValue,
      displayType,
      Boolean(props.showBestMarkers && props.bestMetricIndexes?.includes(index)),
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
      ctx.strokeStyle = `rgba(244,246,248,${0.9 * highlightOpacity})`;
      ctx.lineWidth = Math.max(2, width / 480);
      ctx.shadowColor = "rgba(244,246,248,.72)";
      ctx.shadowBlur = Math.max(6, width / 150);
      ctx.stroke();
      ctx.strokeStyle = "rgba(184,196,208,.18)";
      ctx.lineWidth = Math.max(1, width / 1200);
      ctx.shadowBlur = 0;
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
    if (focused) {
      ctx.shadowColor = dataset.color;
      ctx.shadowBlur = Math.max(14, width / 55);
    }
    if (average && props.averageLineStyle !== "solid")
      ctx.setLineDash([Math.max(6, width / 180), Math.max(4, width / 260)]);
    polygon(ctx, points);
    const baseFillOpacity = average ? 0 : datasets.length > 1 ? (focused ? 0.16 : 0.07) : 0.18;
    ctx.fillStyle = hexAlpha(
      dataset.color,
      average ? 0 : baseFillOpacity * Math.max(0, Math.min(1, props.primaryFillOpacity ?? 1)),
    );
    ctx.strokeStyle = dataset.color;
    ctx.lineWidth = Math.max(focused ? 3 : 2, width / (focused ? 480 : 650));
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (!average) points.forEach((point) => {
      ctx.beginPath();
      ctx.fillStyle = dataset.color;
      ctx.arc(
        point.x,
        point.y,
        Math.max(focused ? 4 : 3, width / 430),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });
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
    const limit = props.radarScaleMode === "axis"
      ? props.radarAxisScale?.[label] ?? maximum
      : maximum * (props.radarScale ?? 1);
    const normalized = props.fixedLabelPlacement
      ? 0
      : Math.max(0, (value ?? 0) / Math.max(Number.EPSILON, limit));
    const clearance = Math.max(
      layout.line * (layout.bestOffset != null ? 3.5 : 2.05),
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
    ctx.textAlign = "center";
    ctx.globalAlpha = metricLabelOpacity;
    ctx.fillStyle = "#d7dde3";
    ctx.font = `700 ${layout.labelSize}px "Noto Sans SC", system-ui`;
    layout.labelLines.forEach((lineText, lineIndex) => {
      ctx.fillText(lineText, text.x, text.y + layout.labelStart + lineIndex * layout.line * 0.84);
    });
    const isBest = layout.bestOffset != null;
    ctx.globalAlpha = valueLabelOpacity;
    ctx.fillStyle = isBest ? "#ffd76a" : props.labelValueColor ?? (props.showReferenceLabels ? "#f4f6f8" : valueDataset?.color ?? "#ef4444");
    ctx.font = `700 ${layout.valueSize}px "Bangers", "Noto Sans SC", system-ui`;
    ctx.fillText(layout.displayValue, text.x, text.y + layout.valueOffset);
    if (isBest && layout.bestOffset != null) {
      ctx.font = `700 ${layout.valueSize}px "Bangers", "Noto Sans SC", system-ui`;
      ctx.fillText("BEST", text.x, text.y + layout.bestOffset);
    }
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

function drawBestMarkers(
  ctx: CanvasRenderingContext2D,
  props: RadarCanvasProps,
  dimensions: string[],
  width: number,
  height: number,
  fontScale: number,
) {
  const best = (props.bestMetricIndexes ?? []).filter(
    (index) => index >= 0 && index < dimensions.length,
  );
  if (!best.length) return;
  const datasets = datasetsFor(props);
  const highlighted = props.highlightedOverlayId
    ? datasets.find((dataset) => dataset.id === props.highlightedOverlayId)
    : undefined;
  const valueDataset =
    highlighted ??
    datasets.find((dataset) => dataset.id !== "average") ??
    datasets[0];
  const count = dimensions.length;
  const { cx, cy, radius } = geometry(props, width, height);
  const bounds = labelBounds(props, width, height);
  const size = Math.max(15, width * 0.022) * fontScale;
  const half = size / 2;
  const labelSize =
    Math.max(12, width * (props.compact ? 0.018 : 0.012)) * fontScale;
  const line = Math.max(14, labelSize * 1.05);
  const clearance = Math.max(
    line * 2.05,
    width * (props.compact ? 0.055 : 0.038),
  );
  const clamp = (point: Point) => ({
    x: Math.max(bounds.left + half, Math.min(bounds.right - half, point.x)),
    y: Math.max(bounds.top + half, Math.min(bounds.bottom - half, point.y)),
  });
  ctx.save();
  ctx.fillStyle = "#ffd76a";
  ctx.shadowColor = "#ffd76a";
  ctx.shadowBlur = Math.max(10, width / 55);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.font = `400 ${size}px "Bangers", "Noto Sans SC", system-ui`;
  best.forEach((index) => {
    const dimension = dimensions[index] ?? "";
    const sourceIndex = valueDataset?.radar.radar.dimensions.indexOf(dimension) ?? -1;
    const value = sourceIndex >= 0 ? valueDataset?.radar.radar.values[sourceIndex] : null;
    const maximum = sourceIndex >= 0 ? valueDataset?.radar.radar.max_values[sourceIndex] || 1 : 1;
    const limit =
      props.radarScaleMode === "axis"
        ? props.radarAxisScale?.[dimension] ?? maximum
        : maximum * (props.radarScale ?? 1);
    const normalized = Math.max(
      0,
      (value ?? 0) / Math.max(Number.EPSILON, limit),
    );
    const { labelDistance } = metricDistances(
      props,
      width,
      height,
      cx,
      cy,
      radius,
      count,
      index,
      normalized,
      clearance,
    );
    const text = pointAt(cx, cy, count, index, labelDistance);
    const isBottom = index === Math.floor(count / 2);
    const point = clamp({
      x: isBottom ? text.x + Math.max(size * 1.5, line * 2) : text.x,
      y: isBottom ? text.y + line * 0.65 : text.y + line * 2,
    });
    ctx.fillText("BEST", point.x, point.y);
  });
  ctx.restore();
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
  overflowReferenceValue?: number | null,
  metricLabelFontSize?: number,
) {
  const canvas = createRadarCanvas(width, height);
  const ctx = canvas2D(canvas);
  if (!ctx) return canvas;
  ctx.clearRect(0, 0, width, height);
  const value = dataset?.radar.radar.round_swing;
  if (stage === "player" && value == null) return canvas;
  const centerX = width / 2;
  const trackHalfWidth = halfWidth ?? width * 0.3;
  const trackHeight = roundSwingTrackHeight(height, 2.25);
  const y = height * 0.5 - trackHeight / 2;
  const fontSize = metricLabelFontSize ?? Math.max(12, width * 0.012) * fontScale;
  const averageValue = average?.radar.round_swing;
  const overflowLimit = roundSwingOverflowLimit([value, averageValue, overflowReferenceValue]);
  const overflowHalfWidth = Math.max(
    trackHalfWidth,
    Math.min(width / 2 - Math.max(6, width * 0.03), trackHalfWidth + width * 0.15),
  );
  const barWidth = roundSwingBarDistance(
    value ?? 0,
    trackHalfWidth,
    overflowHalfWidth,
    overflowLimit,
  );
  const positive = (value ?? 0) >= 0;
  const color = positive ? "#35d07f" : "#f05252";
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, appearance));
  ctx.fillStyle = "rgba(255,255,255,.1)";
  ctx.beginPath();
  ctx.roundRect(centerX - trackHalfWidth, y, trackHalfWidth * 2, trackHeight, trackHeight / 2);
  ctx.fill();
  if ((stage === "player" || stage === "outro") && dataset && barWidth > 1) {
    const barX = positive ? centerX : centerX - barWidth;
    const gradient = ctx.createLinearGradient(barX, y, barX + (positive ? barWidth : -barWidth), y);
    gradient.addColorStop(0, `${color}88`);
    gradient.addColorStop(1, color);
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, playerFillOpacity));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    const radius = Math.min((trackHeight - 4) / 2, barWidth / 2);
    ctx.roundRect(
      barX,
      y + 2,
      barWidth,
      trackHeight - 4,
      roundSwingBarRadii(positive, radius),
    );
    ctx.fill();
    ctx.restore();
  }
  if (stage !== "empty") {
    ctx.fillStyle = "rgba(255,255,255,.72)";
    ctx.fillRect(centerX - 1, y - 4, 2, trackHeight + 8);
  }
  if ((stage === "average" || stage === "outro" || stage === "player") && averageValue != null && Number.isFinite(averageValue)) {
    const averageDistance = roundSwingBarDistance(
      averageValue,
      trackHalfWidth,
      overflowHalfWidth,
      overflowLimit,
    );
    const averageX = centerX + (averageValue < 0 ? -averageDistance : averageDistance);
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, averageLineOpacity));
    ctx.strokeStyle = averageLineColor;
    ctx.lineWidth = Math.max(3, width / 500);
    ctx.beginPath();
    ctx.moveTo(averageX, y - 7);
    ctx.lineTo(averageX, y + trackHeight + 7);
    ctx.stroke();
    ctx.restore();
  }
  const shownValue = displayValue ?? ((stage === "average" || stage === "outro") ? averageValue : value);
  if ((stage === "average" || stage === "outro" || stage === "player") && shownValue != null) {
    ctx.save();
    ctx.font = `700 ${fontSize}px "Noto Sans SC", system-ui`;
    ctx.textAlign = "left";
    ctx.globalAlpha *= Math.max(0, Math.min(1, textOpacity));
    ctx.fillStyle = stage === "average" ? averageLineColor : dataset?.color ?? averageLineColor;
    ctx.fillText("Round Swing", centerX - trackHalfWidth, y - fontSize * 0.75);
    ctx.textAlign = "right";
    ctx.globalAlpha = Math.max(0, Math.min(1, appearance)) * Math.max(0, Math.min(1, valueOpacity));
    ctx.fillStyle = displayValueColor ?? (stage === "average" ? averageLineColor : color);
    ctx.font = `750 ${fontSize}px ui-monospace, monospace`;
    ctx.fillText(formatRoundSwing(shownValue), centerX + trackHalfWidth, y - fontSize * 0.75);
    ctx.restore();
  }
  if (referenceLabelOpacity > 0) {
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, referenceLabelOpacity));
    ctx.font = `650 ${Math.max(10, fontSize * .78)}px "Noto Sans SC", system-ui`;
    ctx.fillStyle = "rgba(244,246,248,.92)";
    ctx.textAlign = "left";
    ctx.fillText("-5%", centerX - trackHalfWidth, y + trackHeight + fontSize * 1.05);
    ctx.textAlign = "right";
    ctx.fillText("+5%", centerX + trackHalfWidth, y + trackHeight + fontSize * 1.05);
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
