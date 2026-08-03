import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { OverlayEntry, RadarResponse } from "../types";

export interface RadarCanvasHandle {
  toDataURL: (width: number, height: number) => string;
}
export interface RadarCanvasProps {
  radar?: RadarResponse | null;
  overlays?: OverlayEntry[];
  color?: string;
  title?: string;
  subtitle?: string;
  transparent?: boolean;
  compact?: boolean;
  previewWidth?: number;
  previewHeight?: number;
  highlightedOverlayId?: string | null;
  bestMetricIndexes?: number[];
  showBestMarkers?: boolean;
}

interface Point {
  x: number;
  y: number;
}
interface RadarDataset {
  id: string;
  radar: RadarResponse;
  color: string;
}

function polygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  points.forEach((point, index) =>
    index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
  );
  ctx.closePath();
}

function geometry(props: RadarCanvasProps, width: number, height: number) {
  return {
    cx: width / 2,
    cy: props.compact ? height / 2 : height * 0.52,
    radius:
      Math.min(width, height) *
      (props.compact ? 0.31 : props.overlays?.length ? 0.275 : 0.3),
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

function radarPoints(
  radar: RadarResponse,
  dimensions: string[],
  cx: number,
  cy: number,
  radius: number,
) {
  return dimensions.map((dimension, index) => {
    const sourceIndex = radar.radar.dimensions.indexOf(dimension);
    const value = sourceIndex >= 0 ? radar.radar.values[sourceIndex] : null;
    const maximum =
      sourceIndex >= 0 ? radar.radar.max_values[sourceIndex] || 1 : 1;
    const normalized = Math.max(0, Math.min(1.12, (value ?? 0) / maximum));
    return pointAt(cx, cy, dimensions.length, index, radius * normalized);
  });
}

function datasetsFor(props: RadarCanvasProps): RadarDataset[] {
  if (props.overlays?.length)
    return props.overlays
      .filter((entry) => entry.visible)
      .map((entry) => ({
        id: entry.id,
        radar: entry.radar,
        color: entry.color,
      }));
  if (!props.radar) return [];
  return [
    {
      id: props.radar.player.steam_id,
      radar: props.radar,
      color: props.color ?? "#22d3ee",
    },
  ];
}

export function renderRadarCanvas(
  canvas: HTMLCanvasElement,
  props: RadarCanvasProps,
  width: number,
  height: number,
) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
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
  ctx.textBaseline = "middle";
  if (!props.compact) {
    ctx.fillStyle = "#f4f6f8";
    ctx.textAlign = "center";
    ctx.font = `700 ${Math.max(22, width * 0.026)}px Inter, system-ui`;
    ctx.fillText(
      props.title || (datasets[0]?.radar.player.name ?? "选择玩家和比赛"),
      width / 2,
      height * 0.075,
    );
    if (props.subtitle) {
      ctx.fillStyle = "#9aa3ad";
      ctx.font = `500 ${Math.max(13, width * 0.012)}px Inter, system-ui`;
      ctx.fillText(props.subtitle, width / 2, height * 0.115);
    }
  }
  if (!datasets.length) {
    ctx.fillStyle = "#727b86";
    ctx.textAlign = "center";
    ctx.font = `500 ${Math.max(16, width * 0.016)}px Inter, system-ui`;
    ctx.fillText("从资料库选择素材后开始制作", width / 2, height / 2);
    return;
  }

  const dimensions = datasets[0].radar.radar.dimensions;
  const { cx, cy, radius } = geometry(props, width, height);
  ctx.strokeStyle = "rgba(184,196,208,.18)";
  ctx.lineWidth = Math.max(1, width / 1200);
  for (let level = 1; level <= 5; level += 1) {
    polygon(
      ctx,
      dimensions.map((_, index) =>
        pointAt(cx, cy, dimensions.length, index, (radius * level) / 5),
      ),
    );
    ctx.stroke();
  }
  dimensions.forEach((_, index) => {
    const axis = pointAt(cx, cy, dimensions.length, index, radius);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(axis.x, axis.y);
    ctx.stroke();
  });

  const highlighted = props.highlightedOverlayId
    ? datasets.find((dataset) => dataset.id === props.highlightedOverlayId)
    : undefined;
  const valueDataset =
    highlighted ??
    datasets.find((dataset) => dataset.id === "average") ??
    datasets[0];

  datasets.forEach((dataset) => {
    const points = radarPoints(dataset.radar, dimensions, cx, cy, radius);
    const muted = Boolean(highlighted && highlighted.id !== dataset.id);
    const focused = highlighted?.id === dataset.id;
    const average = dataset.id === "average";
    ctx.save();
    ctx.globalAlpha = muted ? 0.2 : 1;
    if (focused) {
      ctx.shadowColor = dataset.color;
      ctx.shadowBlur = Math.max(14, width / 55);
    }
    if (average)
      ctx.setLineDash([Math.max(6, width / 180), Math.max(4, width / 260)]);
    polygon(ctx, points);
    ctx.fillStyle = hexAlpha(
      dataset.color,
      average ? 0.025 : datasets.length > 1 ? (focused ? 0.16 : 0.07) : 0.18,
    );
    ctx.strokeStyle = dataset.color;
    ctx.lineWidth = Math.max(focused ? 3 : 2, width / (focused ? 480 : 650));
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    points.forEach((point) => {
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

  dimensions.forEach((label, index) => {
    const text = pointAt(cx, cy, dimensions.length, index, radius * 1.23);
    const sourceIndex = valueDataset.radar.radar.dimensions.indexOf(label);
    const value =
      sourceIndex >= 0 ? valueDataset.radar.radar.values[sourceIndex] : null;
    const displayType =
      sourceIndex >= 0
        ? valueDataset.radar.radar.display_types[sourceIndex]
        : "number";
    const labelSize = Math.max(12, width * (props.compact ? 0.018 : 0.012));
    const valueSize = Math.max(11, width * (props.compact ? 0.015 : 0.011));
    const line = Math.max(14, labelSize * 1.05);
    ctx.textAlign = "center";
    ctx.fillStyle = "#d7dde3";
    ctx.font = `700 ${labelSize}px Inter, system-ui`;
    ctx.fillText(label, text.x, text.y - line * 0.48);
    ctx.fillStyle = valueDataset.color;
    ctx.font = `750 ${valueSize}px ui-monospace, SFMono-Regular, monospace`;
    ctx.fillText(formatValue(value, displayType), text.x, text.y + line * 0.65);
    if (props.showBestMarkers && props.bestMetricIndexes?.includes(index)) {
      ctx.save();
      ctx.fillStyle = "#ffd76a";
      ctx.shadowColor = "#ffd76a";
      ctx.shadowBlur = Math.max(10, width / 55);
      ctx.font = `900 ${Math.max(10, valueSize * 0.82)}px Inter, system-ui`;
      ctx.fillText("BEST", text.x, text.y + line * 1.7);
      ctx.restore();
    }
  });

  if (props.overlays?.length && !props.compact) {
    drawOverlayLegend(ctx, datasets, width, height, props.highlightedOverlayId);
  }
}

function drawOverlayLegend(
  ctx: CanvasRenderingContext2D,
  datasets: RadarDataset[],
  width: number,
  height: number,
  highlightedId?: string | null,
) {
  const gap = Math.max(16, width * 0.018);
  const fontSize = Math.max(11, width * 0.0095);
  ctx.font = `650 ${fontSize}px Inter, system-ui`;
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
    const points = radarPoints(dataset.radar, dimensions, cx, cy, radius);
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

export const RadarCanvas = forwardRef<RadarCanvasHandle, RadarCanvasProps>(
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
);
