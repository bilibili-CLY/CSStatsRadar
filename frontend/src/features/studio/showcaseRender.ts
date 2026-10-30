import {
  SHOWCASE_DISPLAY_FONT,
  SHOWCASE_DISPLAY_FONT_URL,
  renderRadarCanvas,
  renderSwingCanvas,
  selectRatingProfile,
} from "../../components/RadarCanvas";
import type {
  RatingVersion,
  ShowcaseElement,
  ShowcaseLayoutDraft,
  ShowcaseSlide,
} from "../../types";
import {
  SHOWCASE_BEST_ENTRANCE_MS,
  SHOWCASE_BEST_HANDOFF_MS,
  bestMetricIndexesBySlide,
  hasBestEntrance,
  easeInOut,
  interpolateRadarResponse,
  showcaseAverageRadar,
  showcaseBestAmounts,
  showcaseBlackFadeInAlpha,
  showcaseDataPanelJellyTransform,
  showcaseElementBounds,
  showcaseImageBox,
  showcaseTeamLogoSize,
  resolveImageTransform,
  resolveTeamLogoTransform,
  DEFAULT_SHOWCASE_INTRO_STAGES,
  FIRST_PLAYER_PANEL_MS,
  FIRST_PLAYER_SUBTITLE_START_MS,
  FIRST_PLAYER_SUBTITLE_DUR_MS,
  FIRST_PLAYER_TITLE_START_MS,
  FIRST_PLAYER_TITLE_DUR_MS,
  FIRST_PLAYER_RADAR_IN_MS,
  FIRST_PLAYER_TEXT_START_MS,
  FIRST_PLAYER_VALUE_START_MS,
  FIRST_PLAYER_ARRIVAL_TOTAL_MS,
  showcaseTextScramble,
  SHOWCASE_INTRO_BLACK_FADE_IN_MS,
  metricGrowthTransform,
  type MetricGrowthTransform,
  showcaseInnerRadarSwingTransform,
  showcaseMatchInfoOpacity,
  showcaseMaxSwingMagnitude,
  showcaseOuterRadarRingDiameter,
  showcaseSwingCanvasWidth,
  showcaseSwingOverflowLimit,
  showcaseSwingReferenceHalfWidth,
  showcaseCanvasTextAlign,
  showcaseIntroAverageTransitionProgress,
  showcaseIntroState,
  normalizeShowcaseLayers,
  showcasePaintOrder,
  showcaseReferenceRadar,
  showcaseRadarFloorValues,
  showcaseRadarLabelRegion,
  showcaseZeroRadar,
  showcaseSegment,
  showcaseSubtitleTextStyle,
  showcaseTitleTextStyle,
  showcaseTransitionProgress,
  stripRatingProfiles,
  targetBounds,
  type ShowcaseTarget,
  type ShowcaseAnimationOptions,
  type ShowcaseTransform,
} from "./showcaseMath";
import type { RadarResponse } from "../../types";

export function drawShowcaseSelection(canvas: HTMLCanvasElement, target: ShowcaseTarget, transform: ShowcaseTransform, bounds: ReturnType<typeof targetBounds>) {
  const ctx=canvas.getContext("2d"); if(!ctx)return; const sx=canvas.width/100, sy=canvas.height/100; ctx.save(); ctx.strokeStyle="#f3f5f7"; ctx.lineWidth=Math.max(1,canvas.width/1200); ctx.setLineDash([6,5]); ctx.strokeRect(bounds.left*sx,bounds.top*sy,(bounds.right-bounds.left)*sx,(bounds.bottom-bounds.top)*sy); ctx.setLineDash([]); ctx.fillStyle="#f3f5f7"; ctx.strokeStyle="#111418"; const size=Math.max(5,canvas.width/240); for(const [x,y] of [[bounds.left,bounds.top],[bounds.right,bounds.top],[bounds.left,bounds.bottom],[bounds.right,bounds.bottom]]) { ctx.fillRect(x*sx-size/2,y*sy-size/2,size,size); ctx.strokeRect(x*sx-size/2,y*sy-size/2,size,size); } ctx.font=`600 ${Math.max(9,canvas.width/140)}px "Noto Sans SC",system-ui`; ctx.fillStyle="#f3f5f7"; ctx.fillText(({radar:"雷达",title:"主标题",subtitle:"副标题",image:"人物图",swing:"Round Swing",teamLogo:"战队Logo"} as Record<string,string>)[target] ?? target,bounds.left*sx,bounds.top*sy-size); ctx.restore(); void transform;
}
type ShowcaseImage = HTMLImageElement | ImageBitmap;
export const showcaseImageCache = new Map<string, ShowcaseImage>();
type ShowcaseCanvas = HTMLCanvasElement | OffscreenCanvas;

export function retainShowcaseImages(urls: Iterable<string>) {
  const retained = new Set(urls);
  for (const [url, image] of showcaseImageCache) {
    if (retained.has(url)) continue;
    if ("close" in image && typeof image.close === "function") image.close();
    else {
      const element = image as HTMLImageElement;
      element.onload = null;
      element.onerror = null;
      element.src = "";
    }
    showcaseImageCache.delete(url);
  }
}
export function showcasePlayerImageUrl(
  slide?: Pick<ShowcaseSlide, "imageUrl" | "avatarUrl"> | null,
) {
  return slide?.imageUrl || slide?.avatarUrl;
}
export function imageWidth(image: ShowcaseImage) {
  return "naturalWidth" in image ? image.naturalWidth : image.width;
}
export function imageHeight(image: ShowcaseImage) {
  return "naturalHeight" in image ? image.naturalHeight : image.height;
}
function createCanvas(width: number, height: number): ShowcaseCanvas {
  const canvas =
    typeof document !== "undefined"
      ? document.createElement("canvas")
      : new OffscreenCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
function canvas2D(
  canvas: ShowcaseCanvas,
): CanvasRenderingContext2D {
  return canvas.getContext("2d") as CanvasRenderingContext2D;
}
function resizeCanvas(canvas: ShowcaseCanvas, width: number, height: number) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}
export function loadImage(url: string): Promise<ShowcaseImage> {
  if (typeof document === "undefined") {
    const cached = showcaseImageCache.get(url);
    if (cached) return Promise.resolve(cached);
    return fetch(url)
      .then((response) => {
        if (!response.ok)
          throw new Error("人物图片加载失败，请检查外部 URL 或重新上传");
        return response.blob();
      })
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        showcaseImageCache.set(url, bitmap);
        return bitmap;
      });
  }
  const cached = showcaseImageCache.get(url);
  if (cached && "complete" in cached && cached.complete)
    return Promise.resolve(cached);
  return new Promise<ShowcaseImage>((resolve, reject) => {
    const image = (cached instanceof HTMLImageElement ? cached : null) ?? new Image();
    showcaseImageCache.set(url, image);
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("人物图片加载失败，请检查外部 URL 或重新上传"));
    if (!image.src) image.src = url;
  });
}
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: ShowcaseImage,
  width: number,
  height: number,
) {
  const scale = Math.max(
    width / imageWidth(image),
    height / imageHeight(image),
  );
  const w = imageWidth(image) * scale,
    h = imageHeight(image) * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}
export function bestEntranceSidePattern(title: string, repeats: number) {
  return title.repeat(Math.max(1, Math.ceil(repeats)));
}
export function bestEntranceSideScrollDistance(
  progress: number,
  measuredNameWidth: number,
) {
  // 滚动流持续平滑滚动，最后不停止
  return Math.max(0, progress) * 6 * Math.max(1, measuredNameWidth);
}
export function bestEntranceImageOpacity(progress: number) {
  return easeInOut(Math.min(1, Math.max(0, progress) / .25));
}
export function bestEntranceTitleLayout(
  width: number,
  measuredTitleWidth: number,
  fontSize: number,
) {
  const safeInset = Math.max(32, width * .045);
  const maximumTitleWidth = Math.max(1, width - safeInset * 2);
  const fontScale = Math.min(1, maximumTitleWidth / Math.max(1, measuredTitleWidth));
  const finalX = width - safeInset;
  const initialX = Math.min(
    width - Math.max(2, width * .005),
    finalX + width * .04,
  );
  return { fontSize: fontSize * fontScale, finalX, initialX, maximumTitleWidth };
}
export function bestEntranceTitlePosition(
  progress: number,
  width: number,
  titleWidth: number,
) {
  // 目标落位点：Canvas 3/4 处 (0.75)
  const amount = Math.max(0, progress);
  const targetX = width * 0.75;
  const startX = width + titleWidth / 2 + 50;
  if (amount < 0.35) {
    const inProgress = easeInOut(amount / 0.35);
    return startX + (targetX - startX) * inProgress;
  }
  // 落位在 3/4 处后持续向左缓慢移动；handoff 阶段传入 > 1 的连续进度时继续漂移不停止
  const driftProgress = (amount - 0.35) / 0.65;
  const driftDistance = width * 0.045 * driftProgress;
  return targetX - driftDistance;
}
// handoff 阶段沿用入场阶段的速度继续推进进度，保证滚动流与主标题在淡出时不静止
export function bestEntranceHandoffProgress(handoffProgress: number) {
  const clamped = Math.max(0, Math.min(1, handoffProgress));
  return 1 + clamped * (SHOWCASE_BEST_HANDOFF_MS / SHOWCASE_BEST_ENTRANCE_MS);
}
function drawBestEntrance(
  ctx: CanvasRenderingContext2D,
  slide: ShowcaseSlide,
  width: number,
  height: number,
  progress: number,
  opacity = 1,
) {
  // handoff 阶段会传入 > 1 的连续进度，让两侧滚动流与主标题在淡出的同时继续运动
  const continuousProgress = Math.max(0, progress);
  const amount = Math.min(1, continuousProgress);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  // Let the entering player's own background/theme remain visible in the
  // spotlight scene, as in the reference video.
  ctx.fillStyle = "rgba(3,5,10,.45)";
  ctx.fillRect(0, 0, width, height);
  const drawSideName = (side: "left" | "right") => {
    ctx.save();
    const x = side === "left" ? width * .06 : width * .94;
    ctx.textAlign = "center";
    ctx.font = `800 ${Math.max(28, width * .065)}px "Noto Sans SC",system-ui`;
    ctx.lineWidth = Math.max(2, width / 700);
    ctx.strokeStyle = "rgba(244,246,248,.9)";
    ctx.fillStyle = "rgba(10,16,30,.15)";
    const nameWidth = Math.max(1, ctx.measureText(slide.title).width);
    const pattern = bestEntranceSidePattern(slide.title, Math.ceil(height * 3 / nameWidth) + 2);
    const patternWidth = ctx.measureText(pattern).width;
    // 左右两侧滚动流在最后持续滚动不停
    const travel = bestEntranceSideScrollDistance(continuousProgress, nameWidth);
    const offset = wrap(travel, patternWidth);
    for (let repeat = -1; repeat <= 1; repeat += 1) {
      ctx.save();
      ctx.translate(x, height / 2);
      ctx.rotate(side === "left" ? -Math.PI / 2 : Math.PI / 2);
      ctx.strokeText(pattern, -height * 1.5 + offset + repeat * patternWidth, 0);
      ctx.fillText(pattern, -height * 1.5 + offset + repeat * patternWidth, 0);
      ctx.restore();
    }
    ctx.restore();
  };
  drawSideName("left");
  drawSideName("right");
  const image = showcaseImageCache.get(showcasePlayerImageUrl(slide) ?? "");
  if (image) {
    const boxW = width * .4;
    const boxH = height * .72;
    const portraitScale = 1 + easeInOut(amount) * .04;
    const scale = Math.min(boxW / imageWidth(image), boxH / imageHeight(image)) * portraitScale;
    const imageW = imageWidth(image) * scale;
    const imageH = imageHeight(image) * scale;
    ctx.save();
    ctx.globalAlpha *= bestEntranceImageOpacity(amount);
    ctx.drawImage(image, width / 2 - imageW / 2, height * .56 - imageH / 2, imageW, imageH);
    ctx.restore();
  }
  // 右下角主标题入场后在 Canvas 3/4 处落位，然后再持续向左缓慢移动
  const titleFontSize = Math.max(32, width * .058);
  ctx.font = `900 italic ${titleFontSize}px "Noto Sans SC",system-ui`;
  const titleWidth = ctx.measureText(slide.title).width;
  const titleX = bestEntranceTitlePosition(continuousProgress, width, titleWidth);
  ctx.textAlign = "center";
  ctx.font = `900 italic ${titleFontSize}px "Noto Sans SC",system-ui`;
  ctx.fillStyle = "#f4f6f8";
  ctx.fillText(slide.title, titleX, height * 0.83);
  ctx.restore();
}
function colorAlpha(color: string, alpha: number) {
  const value = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return `rgba(34,211,238,${alpha})`;
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${alpha})`;
}
function interpolateHexColor(previous: string, next: string, progress: number) {
  const parse = (color: string) => {
    const value = color.replace("#", "");
    return [0, 2, 4].map((start) =>
      parseInt(value.slice(start, start + 2), 16),
    );
  };
  const from = parse(previous);
  const to = parse(next);
  if ([...from, ...to].some((value) => !Number.isFinite(value))) return next;
  return `#${from
    .map((value, index) =>
      Math.round(value + (to[index] - value) * progress)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
function wrap(value: number, size: number) {
  return ((value % size) + size) % size;
}
const particleSpriteCache = new Map<number, ShowcaseCanvas>();
function particleGlowSprite(bloom: number): ShowcaseCanvas {
  const cached = particleSpriteCache.get(bloom);
  if (cached) return cached;
  const size = Math.ceil(bloom * 2) + 2;
  const sprite = createCanvas(size, size);
  const ctx = canvas2D(sprite);
  const cx = size / 2;
  const glow = ctx.createRadialGradient(cx, cx, 0, cx, cx, bloom);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.3, "rgba(255,255,255,.35)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cx, bloom, 0, Math.PI * 2);
  ctx.fill();
  particleSpriteCache.set(bloom, sprite);
  return sprite;
}

type ShowcaseRenderResources = {
  radar: ShowcaseCanvas;
  swing: ShowcaseCanvas;
  particleMask: ShowcaseCanvas;
  particleTint: ShowcaseCanvas;
};
const renderResources = new WeakMap<ShowcaseCanvas, ShowcaseRenderResources>();
function resourcesFor(canvas: ShowcaseCanvas, width: number, height: number) {
  let resources = renderResources.get(canvas);
  if (!resources) {
    resources = {
      radar: createCanvas(1, 1),
      swing: createCanvas(1, 1),
      particleMask: createCanvas(width, height),
      particleTint: createCanvas(width, height),
    };
    renderResources.set(canvas, resources);
  }
  resizeCanvas(resources.particleMask, width, height);
  resizeCanvas(resources.particleTint, width, height);
  return resources;
}

export function showcaseParticleSpriteCacheSize() {
  return particleSpriteCache.size;
}
function drawShowcaseParticles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
  timeMs: number,
  resources: ShowcaseRenderResources,
) {
  const frame = timeMs / 16.67;
  const mask = resources.particleMask;
  const maskContext = canvas2D(mask);
  maskContext.clearRect(0, 0, width, height);
  maskContext.save();
  for (let index = 0; index < 75; index += 1) {
    const nebula = index >= 50;
    const seedA = Math.sin(index * 43.7) * 0.5 + 0.5;
    const seedB = Math.cos(index * 29.1) * 0.5 + 0.5;
    const direction = index % 2 === 0 ? 1 : -1;
    const vx = (seedB - 0.5) * (nebula ? 0.16 : 0.28);
    const vy =
      direction *
      (nebula ? 0.08 + (index % 5) * 0.025 : 0.16 + (index % 7) * 0.035);
    const x = wrap(seedA * width + vx * frame + 80, width + 160) - 80;
    const y = wrap(seedB * height + vy * frame + 150, height + 300) - 150;
    const size = nebula ? 5 + (index % 5) : 1 + (index % 3);
    const distance = Math.abs(y - height / 2) / Math.max(1, height / 2);
    const alpha =
      Math.max(0.05, Math.min(1, distance)) * (nebula ? 0.22 : 0.65);
    const bloom = size * (nebula ? 15 : 10);
    const sprite = particleGlowSprite(bloom);
    maskContext.globalAlpha = alpha;
    maskContext.drawImage(sprite, x - sprite.width / 2, y - sprite.height / 2);
    maskContext.globalAlpha = 1;
    if (!nebula) {
      maskContext.fillStyle = `rgba(255,255,255,${Math.min(0.75, alpha)})`;
      maskContext.beginPath();
      maskContext.arc(x, y, size, 0, Math.PI * 2);
      maskContext.fill();
    }
  }
  maskContext.restore();
  const tint = resources.particleTint;
  const tintContext = canvas2D(tint);
  tintContext.clearRect(0, 0, width, height);
  tintContext.drawImage(mask, 0, 0);
  tintContext.save();
  tintContext.globalCompositeOperation = "source-in";
  tintContext.fillStyle = colorAlpha(color, 1);
  tintContext.fillRect(0, 0, width, height);
  tintContext.restore();
  ctx.drawImage(tint, 0, 0);
}

export function drawElementSelection(
  ctx: CanvasRenderingContext2D,
  bounds: { left: number; top: number; width: number; height: number; right: number; bottom: number },
  width: number,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(244,246,248,0.95)";
  ctx.lineWidth = Math.max(1.5, width / 1100);
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
  ctx.setLineDash([]);

  // 右上角红色圆形删除按钮 (圆内 X，点击后删除)
  const btnRadius = Math.max(11, width * 0.0095);
  const btnX = bounds.right;
  const btnY = bounds.top;

  ctx.beginPath();
  ctx.arc(btnX, btnY, btnRadius, 0, Math.PI * 2);
  ctx.fillStyle = "#ef4444";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.5, btnRadius * 0.18);
  ctx.stroke();

  // 圆内绘制白色 "X"
  const cross = btnRadius * 0.42;
  ctx.beginPath();
  ctx.moveTo(btnX - cross, btnY - cross);
  ctx.lineTo(btnX + cross, btnY + cross);
  ctx.moveTo(btnX + cross, btnY - cross);
  ctx.lineTo(btnX - cross, btnY + cross);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(2, btnRadius * 0.22);
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.restore();
}

export function drawMatchInfoElements(
  ctx: CanvasRenderingContext2D,
  elements: ShowcaseElement[],
  width: number,
  height: number,
  selectedElementId?: string | null,
  opacity = 1,
) {
  if (opacity <= 0.001) return;
  for (const element of elements) {
    const isSelected = element.id === selectedElementId;
    const bounds = showcaseElementBounds(element, width, height);

    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, opacity));
    if (element.type === "text") {
      const fontSize = (element.fontSize ?? 42) * (width / 1920);
      const fontWeight = element.fontWeight ?? "bold";
      ctx.font = `${fontWeight === "800" ? "800" : fontWeight === "bold" ? "700" : "500"} ${fontSize}px "Noto Sans SC", system-ui`;
      ctx.textAlign = element.align ?? "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = element.color ?? "#f4f6f8";

      const cx = (width * element.x) / 100;
      const cy = (height * element.y) / 100;
      ctx.fillText(element.content, cx, cy);
    } else if (element.type === "image") {
      const image = element.url ? showcaseImageCache.get(element.url) : null;
      let aspect = 1;
      if (image) {
        const iw = imageWidth(image);
        const ih = imageHeight(image);
        if (iw > 0 && ih > 0) aspect = iw / ih;
      } else if (element.width && element.height && element.height > 0) {
        aspect = element.width / element.height;
      }
      const imgBounds = showcaseElementBounds(element, width, height, undefined, aspect);
      if (image) {
        ctx.drawImage(image, imgBounds.left, imgBounds.top, imgBounds.width, imgBounds.height);
      } else if (element.url) {
        loadImage(element.url).catch(() => {});
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.strokeRect(imgBounds.left, imgBounds.top, imgBounds.width, imgBounds.height);
      }

      if (isSelected) {
        drawElementSelection(ctx, imgBounds, width);
      }
      ctx.restore();
      continue;
    }

    if (isSelected) {
      drawElementSelection(ctx, bounds, width);
    }
    ctx.restore();
  }
}

function drawDataPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  accent: string,
  opacity: number,
  rect?: { x: number; y: number; width: number; height: number },
  isIntro = false,
  matchCount?: number,
) {
  if (opacity <= 0.001) return;
  const panelWidth = rect?.width ?? width * 0.54;
  const panelHeight = rect?.height ?? height * 0.93;
  const x = rect?.x ?? (isIntro ? (width - panelWidth) / 2 : width * 0.018);
  const y = rect?.y ?? (height - panelHeight) / 2;
  if (panelWidth <= 2 || panelHeight <= 2) return;
  const radius = Math.min(panelWidth / 2, panelHeight / 2, height * 0.045);
  const fill = ctx.createLinearGradient(x, y, x + panelWidth, y + panelHeight);
  fill.addColorStop(0, "rgba(3,7,8,.9)");
  fill.addColorStop(0.62, "rgba(4,7,8,.82)");
  fill.addColorStop(1, "rgba(6,10,11,.72)");
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, opacity));
  ctx.beginPath();
  ctx.roundRect(x, y, panelWidth, panelHeight, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, width / 1200);
  ctx.strokeStyle = "rgba(218,230,222,.24)";
  ctx.stroke();
  const accentLine = ctx.createLinearGradient(0, y + panelHeight * 0.18, 0, y + panelHeight * 0.84);
  accentLine.addColorStop(0, colorAlpha(accent, 0));
  accentLine.addColorStop(0.52, colorAlpha(accent, 0.72));
  accentLine.addColorStop(1, colorAlpha(accent, 0));
  ctx.beginPath();
  ctx.moveTo(x + panelWidth - 1, y + panelHeight * 0.18);
  ctx.lineTo(x + panelWidth - 1, y + panelHeight * 0.84);
  ctx.strokeStyle = accentLine;
  ctx.lineWidth = Math.max(2, width / 800);
  ctx.stroke();

  // 正片阶段在 Data Panel 右下角内侧显示“地图数: n”
  if (!isIntro && matchCount != null && matchCount > 0) {
    ctx.save();
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(180, 195, 210, 0.65)";
    ctx.font = `600 ${Math.max(10, width * 0.0085)}px "Noto Sans SC", system-ui`;
    ctx.fillText(`地图数: ${matchCount}`, x + panelWidth - Math.max(18, width * 0.012), y + panelHeight - Math.max(12, height * 0.016));
    ctx.restore();
  }
  ctx.restore();
}
// 每帧渲染的派生数据按 slides 数组身份 + rating 版本缓存：
// 预览与导出的整个时间线内 slides 身份稳定，单帧成本因此与轮播页数解耦。
type RatedDerivation = { rated: ShowcaseSlide[]; average: RadarResponse | null; maxSwing: number };
const ratedDerivationCache = new WeakMap<ShowcaseSlide[], Map<string, RatedDerivation>>();
function deriveRatedSlides(slides: ShowcaseSlide[], ratingVersion: RatingVersion): RatedDerivation {
  let perVersion = ratedDerivationCache.get(slides);
  if (!perVersion) {
    perVersion = new Map();
    ratedDerivationCache.set(slides, perVersion);
  }
  const existing = perVersion.get(ratingVersion);
  if (existing) return existing;
  const rated = slides.map((item) => ({ ...item, radar: selectRatingProfile(item.radar, ratingVersion) }));
  const entry: RatedDerivation = {
    rated,
    average: showcaseAverageRadar(rated, ratingVersion),
    maxSwing: showcaseMaxSwingMagnitude(rated, ratingVersion),
  };
  perVersion.set(ratingVersion, entry);
  return entry;
}

export function renderShowcaseFrame(
  slides: ShowcaseSlide[],
  layout: ShowcaseLayoutDraft,
  width: number,
  height: number,
  timeMs: number,
  targetCanvas?: HTMLCanvasElement | OffscreenCanvas,
  showBestMarkers = false,
  radarScaleMode = "global",
  radarScale = 1,
  radarAxisScale?: Record<string, number>,
  ratingVersion: RatingVersion = "rating_2",
  showRatingWatermark = true,
  fontScale = 1,
  metricLabelFontSize = 12,
  animations: ShowcaseAnimationOptions = {},
  radarFloorValues?: Record<string, number>,
) {
  // 任何以 1920×1080 设计空间书写的尺寸都必须乘 fontScale 再落到画布像素，
  // 否则窗口化预览（backing canvas 更小）会按设计像素绘制而显得偏大。
  const derived = deriveRatedSlides(slides, ratingVersion);
  const ratedSlides = derived.rated;
  const segment = showcaseSegment(ratedSlides, timeMs, animations);
  const slide = ratedSlides[segment.index];
  const intro = segment.phase === "intro"
    ? showcaseIntroState(timeMs, animations.introStages)
    : null;
  const canvas = targetCanvas ?? createCanvas(width, height);
  resizeCanvas(canvas, width, height);
  const resources = resourcesFor(canvas, width, height);
  const ctx = canvas2D(canvas);
  ctx.clearRect(0, 0, width, height);
  const previousSlide =
    segment.phase === "intro" ||
    segment.phase === "entrance" ||
    segment.phase === "handoff" ||
    segment.usesBestEntrance ||
    segment.index === 0
      ? null
      : ratedSlides[segment.index - 1];
  const morphProgress = previousSlide
    ? showcaseTransitionProgress(ratedSlides, timeMs, animations)
    : 1;
  // 所有画布元素（含背景、数据面板、粒子、水印）共用一份图层顺序
  const layerOrder = normalizeShowcaseLayers(layout.layers, ratingVersion);

  const isEditing = Boolean(animations.isEditing);

  // 判定下一个玩家是否为有 BEST 的 MVP 玩家，或者跨战队切换
  const nextSlide = segment.index < ratedSlides.length - 1 ? ratedSlides[segment.index + 1] : null;
  const nextHasBest = nextSlide && hasBestEntrance(ratedSlides, segment.index + 1, animations);
  const isNextCrossTeam = nextSlide && (
    Boolean(slide?.teamLogoUrl) !== Boolean(nextSlide?.teamLogoUrl) ||
    (Boolean(slide?.teamLogoUrl) && slide?.teamLogoUrl !== nextSlide?.teamLogoUrl)
  );

  // 玩家之间切换时：若下个玩家有 BEST MVP 特效，或跨战队切换，前一个玩家在最后 500ms 内 FadeOut 退场
  const needsExitFadeOut = segment.phase === "slide" && Boolean(nextHasBest || isNextCrossTeam);
  const currentSlideDurationMs = (slide?.duration ?? 4) * 1000;
  const remainingSlideMs = currentSlideDurationMs - segment.offsetMs;
  const exitFadeOutOpacity = needsExitFadeOut && remainingSlideMs < 500
    ? Math.max(0, remainingSlideMs / 500)
    : 1;

  // 判定当前玩家是否来自跨战队切换
  const prevSlideReal = segment.index > 0 ? ratedSlides[segment.index - 1] : null;
  const isCrossTeamFromPrev = prevSlideReal && (
    Boolean(slide?.teamLogoUrl) !== Boolean(prevSlideReal?.teamLogoUrl) ||
    (Boolean(slide?.teamLogoUrl) && slide?.teamLogoUrl !== prevSlideReal?.teamLogoUrl)
  );

  // 就位入场动画触发条件：首位玩家、下个有 BEST 的玩家在 MVP 特效后进入展示、或跨战队切换进入的新玩家
  const isArrivalPhase = !isEditing && segment.phase === "slide" && (
    (segment.index === 0 && !previousSlide) ||
    Boolean(segment.usesBestEntrance) ||
    Boolean(isCrossTeamFromPrev)
  ) && segment.offsetMs < FIRST_PLAYER_ARRIVAL_TOTAL_MS;
  const arrivalOffsetMs = segment.offsetMs;
  // 就位入场时战队 Logo 在副标题就位后 (1100ms 起) 淡入；编辑模式下始终完全可见
  const arrivalTeamLogoAlpha = !isArrivalPhase || isEditing
    ? 1
    : arrivalOffsetMs < FIRST_PLAYER_TITLE_START_MS
    ? 0
    : 1 - Math.pow(1 - Math.min(1, (arrivalOffsetMs - FIRST_PLAYER_TITLE_START_MS) / 500), 3);

  const accent = slide
    ? previousSlide
      ? interpolateHexColor(previousSlide.color, slide.color, morphProgress)
      : slide.color
    : "#22d3ee";
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, colorAlpha(accent, 0.2));
  gradient.addColorStop(0.5, "#071018");
  gradient.addColorStop(1, "#020304");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const drawBackgroundImage = (item: ShowcaseSlide | null, opacity: number) => {
    if (!item?.backgroundUrl || opacity <= 0) return;
    const image = showcaseImageCache.get(item.backgroundUrl);
    if (image) {
      ctx.save();
      ctx.globalAlpha = 0.48 * opacity * exitFadeOutOpacity;
      drawCover(ctx, image, width, height);
      ctx.restore();
    }
  };
  const drawBackgroundLayer = () => {
    // 战队 Logo 只由 teamLogo 图层绘制一次（可拖动/缩放）；不再额外画一份背景水印，避免同一张图重复出现
    if (previousSlide && morphProgress < 1)
      drawBackgroundImage(previousSlide, 1 - morphProgress);
    drawBackgroundImage(slide ?? null, previousSlide ? morphProgress : 1);
    if (slide?.backgroundUrl || previousSlide?.backgroundUrl) {
      ctx.fillStyle = `rgba(5,7,9,${.46 * exitFadeOutOpacity})`;
      ctx.fillRect(0, 0, width, height);
    }
  };
  const drawParticlesLayer = () =>
    drawShowcaseParticles(ctx, width, height, accent, timeMs, resources);
  // 无幻灯片、MVP 入场与开场文字阶段只绘制背景与粒子，但顺序仍遵循图层设置
  const paintBackdrop = () => {
    for (const layer of showcasePaintOrder(layerOrder)) {
      if (layer === "background") drawBackgroundLayer();
      else if (layer === "particles") drawParticlesLayer();
    }
  };
  if (!slide) {
    paintBackdrop();
    ctx.fillStyle = "#88a0ad";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(18, width / 48)}px "Noto Sans SC",system-ui`;
    ctx.fillText("从资料库添加玩家后预览轮播", width / 2, height / 2);
    return canvas;
  }
  if (segment.phase === "entrance") {
    paintBackdrop();
    drawBestEntrance(ctx, slide, width, height, segment.entranceProgress);
    return canvas;
  }
  const average = derived.average;

  const applyBlackFadeInOverlay = () => {
    if (animations.blackFadeIn && timeMs < SHOWCASE_INTRO_BLACK_FADE_IN_MS) {
      const blackAlpha = showcaseBlackFadeInAlpha(timeMs);
      if (blackAlpha > 0.001) {
        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${blackAlpha})`;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
    }
  };

  if (intro?.stage === "matchInfo") {
    const matchInfoDurationMs = (animations.introStages?.matchInfo ?? DEFAULT_SHOWCASE_INTRO_STAGES.matchInfo) * 1000;
    const elementOpacity = showcaseMatchInfoOpacity(timeMs, matchInfoDurationMs);
    paintBackdrop();
    drawMatchInfoElements(
      ctx,
      animations.introElements ?? [],
      width,
      height,
      animations.selectedIntroElementId,
      elementOpacity,
    );
    applyBlackFadeInOverlay();
    return canvas;
  }

  const referenceRadar = showcaseReferenceRadar(slide.radar);
  referenceRadar.radar.round_swing = 5;
  // The opener is a fade handoff, not a player-transition morph. Only regular
  // slide boundaries interpolate radar vertices directly.
  const introAverage = average;
  const zeroRadar = showcaseZeroRadar(slide.radar);
  const playerColor = accent;

  // 阶段三数值块从阶段二结束时的全队平均值平滑生长到 +5%，动画时长 500ms
  const refDurationMs = (animations.introStages?.reference ?? DEFAULT_SHOWCASE_INTRO_STAGES.reference) * 1000;
  const timeInRefStageMs = intro?.stage === "reference" ? intro.progress * refDurationMs : 0;
  const refGrowProgress = intro?.stage === "reference" ? Math.min(1, timeInRefStageMs / 500) : 1;
  const refGrowEase = 1 - Math.pow(1 - refGrowProgress, 3);
  const avgSwing = average?.radar.round_swing ?? 0;
  const currentReferenceSwingFillValue = avgSwing + (5 - avgSwing) * refGrowEase;

  // 阶段三结束后 Data Panel 整体 FadeOut（最后 400ms 内平滑淡出到 0，然后衔接正片）
  const refFadeOutMs = Math.min(500, refDurationMs * 0.25);
  const refRemainingMs = (1 - (intro?.progress ?? 0)) * refDurationMs;
  const stage3FadeOut = intro?.stage === "reference" && refRemainingMs < refFadeOutMs
    ? Math.max(0, refRemainingMs / refFadeOutMs)
    : 1;

  const firstPlayerPanelP = Math.min(1, arrivalOffsetMs / FIRST_PLAYER_PANEL_MS);

  // 头像入场 (0 ~ 700ms)
  const firstPlayerAvatarP = Math.min(1, arrivalOffsetMs / FIRST_PLAYER_PANEL_MS);
  const firstPlayerAvatarEase = 1 - Math.pow(1 - firstPlayerAvatarP, 3);

  // 副标题在头像就位后入场 (700 ~ 1100ms)
  const isFirstPlayerSubtitlePhase = isArrivalPhase && arrivalOffsetMs >= FIRST_PLAYER_SUBTITLE_START_MS;
  const firstPlayerSubtitleP = isArrivalPhase
    ? arrivalOffsetMs < FIRST_PLAYER_SUBTITLE_START_MS
      ? 0
      : Math.min(1, (arrivalOffsetMs - FIRST_PLAYER_SUBTITLE_START_MS) / FIRST_PLAYER_SUBTITLE_DUR_MS)
    : 1;
  const firstPlayerSubtitleEase = 1 - Math.pow(1 - firstPlayerSubtitleP, 3);

  // 标题在副标题就位后入场 (1100 ~ 1700ms)
  const isFirstPlayerTitlePhase = isArrivalPhase && arrivalOffsetMs >= FIRST_PLAYER_TITLE_START_MS;
  const firstPlayerTitleP = isArrivalPhase
    ? arrivalOffsetMs < FIRST_PLAYER_TITLE_START_MS
      ? 0
      : Math.min(1, (arrivalOffsetMs - FIRST_PLAYER_TITLE_START_MS) / FIRST_PLAYER_TITLE_DUR_MS)
    : 1;

  // 雷达图与 Swing 从 Data Panel 竖向中心下方入场 (700 ~ 1200ms)
  const firstPlayerRadarInP = arrivalOffsetMs < FIRST_PLAYER_PANEL_MS
    ? 0
    : Math.min(1, (arrivalOffsetMs - FIRST_PLAYER_PANEL_MS) / FIRST_PLAYER_RADAR_IN_MS);
  const firstPlayerRadarInEase = 1 - Math.pow(1 - firstPlayerRadarInP, 3);

  // 项目文字显现 (1200 ~ 1700ms，同开场动画三步向上浮现)
  const isFirstPlayerTextPhase = isArrivalPhase && arrivalOffsetMs >= FIRST_PLAYER_TEXT_START_MS;
  const timeInFirstPlayerTextMs = isFirstPlayerTextPhase ? arrivalOffsetMs - FIRST_PLAYER_TEXT_START_MS : 0;
  const firstPlayerMetricGrowth = isFirstPlayerTextPhase
    ? slide.radar.radar.dimensions.reduce((acc, dim) => {
        acc[dim] = metricGrowthTransform(dim, timeInFirstPlayerTextMs, 100, 500);
        return acc;
      }, {} as Record<string, MetricGrowthTransform>)
    : undefined;
  const firstPlayerSwingGrowth = isFirstPlayerTextPhase
    ? metricGrowthTransform("Round Swing", timeInFirstPlayerTextMs, 100, 500)
    : { opacity: 0, translateY: 8, scale: 0.92 };

  // 数值显现 (1700 ~ 2100ms)
  const isFirstPlayerValuePhase = !isArrivalPhase || arrivalOffsetMs >= FIRST_PLAYER_VALUE_START_MS;
  const firstPlayerValueProgress = !isArrivalPhase
    ? 1
    : arrivalOffsetMs < FIRST_PLAYER_VALUE_START_MS
    ? 0
    : Math.min(1, (arrivalOffsetMs - FIRST_PLAYER_VALUE_START_MS) / 400);
  const firstPlayerValueEase = 1 - Math.pow(1 - firstPlayerValueProgress, 3);

  // Data Panel：阶段一从垂直 80% 快速膨胀，正片首位玩家就位从横向中心 1/10 处 (0.1, 0.5) 直接生长到左侧目标位置 (0.018)
  const dataPanelRect = intro?.stage === "empty"
    ? showcaseDataPanelJellyTransform(intro.progress, width, height, animations.jellyParams, 0.5, 0.8)
    : isArrivalPhase
    ? showcaseDataPanelJellyTransform(firstPlayerPanelP, width, height, animations.jellyParams, 0.1, 0.5, 0.018)
    : undefined;

  const dataPanelOpacity = (segment.phase === "handoff"
    ? 0
    : intro?.stage === "reference"
    ? stage3FadeOut
    : isArrivalPhase
    ? Math.min(1, firstPlayerPanelP / 0.15)
    : 1) * exitFadeOutOpacity;

  const drawPanelLayer = () =>
    drawDataPanel(
      ctx,
      width,
      height,
      accent,
      dataPanelOpacity,
      dataPanelRect,
      Boolean(intro || isArrivalPhase),
      slide?.radar?.match_count,
    );

  // 阶段二 (average) 各指标分三步向上生长 (三组间隔 0.1s，单组生长动画时长 0.5s)
  const avgDurationMs = (animations.introStages?.average ?? DEFAULT_SHOWCASE_INTRO_STAGES.average) * 1000;
  const timeInAvgStageMs = intro?.stage === "average" ? intro.progress * avgDurationMs : 1000;
  const metricGrowthTransforms = intro?.stage === "average"
    ? slide.radar.radar.dimensions.reduce((acc, dim) => {
        acc[dim] = metricGrowthTransform(dim, timeInAvgStageMs, 100, 500);
        return acc;
      }, {} as Record<string, MetricGrowthTransform>)
    : undefined;

  const swingGrowth = intro?.stage === "average"
    ? metricGrowthTransform("Round Swing", timeInAvgStageMs, 100, 500)
    : { opacity: 1, translateY: 0, scale: 1 };

  // 平均线发光光晕与 Round Swing 数据块生长动画时长完全同步对齐为 0.5s (500ms)
  const anim500Progress = intro?.stage === "average" ? Math.min(1, timeInAvgStageMs / 500) : 1;
  const anim500Ease = 1 - Math.pow(1 - anim500Progress, 3);

  const averageTransitionProgress = intro?.stage === "average"
    ? Math.min(1, intro.progress / 0.3)
    : 1;

  // 阶段二为全队均值红 (#ef4444)，阶段三为外圈基准白 (#f4f6f8)
  const introColor = intro?.stage === "average"
    ? "#ef4444"
    : intro?.stage === "reference"
      ? "#f4f6f8"
      : playerColor;

  // 均值雷达线在阶段一展开后持续保持 100% 显示，阶段二无缝衔接绝不跳变闪烁
  const averageRadarOpacity = 1;

  const handoffProgress = segment.phase === "handoff"
    ? easeInOut(segment.handoffProgress)
    : 1;
  const renderedRadar = segment.phase === "handoff"
    ? interpolateRadarResponse(zeroRadar, slide.radar, handoffProgress)
    : intro && average
    ? intro.stage === "average"
      ? introAverage!
      : slide.radar
    : isArrivalPhase
    ? interpolateRadarResponse(zeroRadar, slide.radar, firstPlayerValueEase)
    : (previousSlide
    ? interpolateRadarResponse(previousSlide.radar, slide.radar, morphProgress)
    : slide.radar);

  // 阶段二显示全队均值，阶段三显示外圈最大值
  const labelRadar = segment.phase === "handoff"
    ? renderedRadar
    : intro?.stage === "average"
    ? (introAverage ?? renderedRadar)
    : intro?.stage === "reference"
    ? referenceRadar
    : renderedRadar;

  const profilelessRadar = stripRatingProfiles(renderedRadar);
  // BEST 特效的 handoff 阶段只淡出特效本身：正片场景保持隐藏，交给紧随其后的就位入场动画，
  // 否则旧版静态雷达/头像/主副标题会先淡入一帧再被入场动画重播（穿帮闪烁）。
  const sceneOpacity = (segment.phase === "handoff" ? 0 : 1) * exitFadeOutOpacity;
  const radarSize =
    (Math.min(width * 0.48, height * 0.78) * layout.radarScale) / 100;
  const radar = resizeCanvas(
    resources.radar,
    Math.round(radarSize),
    Math.round(radarSize),
  );
  // BEST 视觉按指标连续混入/淡出：从 BEST 玩家切到普通玩家时不再瞬间硬切
  const perSlideBest = bestMetricIndexesBySlide(ratedSlides);
  const bestAmounts = segment.phase === "intro"
    ? []
    : showcaseBestAmounts(
        perSlideBest[segment.index],
        previousSlide ? perSlideBest[segment.index - 1] : undefined,
        morphProgress,
        labelRadar.radar.dimensions.length,
      );
  // 雷达完整落在 Data Panel 内时，把标签安全区收紧到面板矩形，避免 KPR 等标签越出面板边框
  const panelRect = dataPanelRect ?? {
    x: width * 0.018,
    y: (height - height * 0.93) / 2,
    width: width * 0.54,
    height: height * 0.93,
  };
  const labelRegion = intro
    ? undefined
    : showcaseRadarLabelRegion(panelRect, {
        x: (width * layout.radarX) / 100 - radarSize / 2,
        y: (height * layout.radarY) / 100 - radarSize / 2,
        size: radarSize,
      });
  renderRadarCanvas(
    radar,
    {
      radar: intro ? null : profilelessRadar,
      averageRadar: (intro?.stage === "empty" || intro?.stage === "average" || intro?.stage === "reference") && introAverage
        ? stripRatingProfiles(introAverage)
        : average && !intro ? stripRatingProfiles(average) : null,
      referenceRadar: stripRatingProfiles(slide.radar),
      labelRadar: stripRatingProfiles(labelRadar),
      fixedLabelPlacement: Boolean(intro),
      color: playerColor,
      compact: true,
      transparent: true,
      hideSwing: true,
      bestAmounts: showBestMarkers ? bestAmounts : undefined,
      labelRegion,
      showBestMarkers,
      radarScaleMode,
      radarScale,
      radarAxisScale,
      radarFloorValues: showcaseRadarFloorValues(ratingVersion, radarFloorValues),
      ratingVersion,
      showRatingWatermark: false,
      fontScale,
      metricLabelFontSize,
      averageLineStyle: "solid",
      hideLabels: intro?.stage === "empty" || (isArrivalPhase && arrivalOffsetMs < FIRST_PLAYER_TEXT_START_MS),
      showReferenceLabels: intro?.stage === "reference",
      valueFontScale: intro?.stage === "reference" ? 1.3 : 1,
      gridOpacity: intro?.stage === "empty" ? intro.progress : 1,
      highlightOuterRing: intro?.stage === "reference",
      outerRingHighlightOpacity: intro?.stage === "reference" ? Math.min(1, intro.progress / 0.3) : 0,
      averageColor: "#ef4444",
      labelValueColor: intro?.stage === "average" ? "#ef4444" : intro?.stage === "reference" ? "#f4f6f8" : undefined,
      labelOpacity: 1,
      metricLabelOpacity: isArrivalPhase && arrivalOffsetMs < FIRST_PLAYER_TEXT_START_MS ? 0 : 1,
      valueLabelOpacity: isArrivalPhase ? firstPlayerValueEase : 1,
      primaryOpacity: 1,
      averageOpacity: 1,
      averageGlow: intro?.stage === "average",
      averageGlowProgress: anim500Ease,
      metricGrowthTransforms: intro?.stage === "average" ? metricGrowthTransforms : firstPlayerMetricGrowth,
    },
    Math.round(radarSize),
    Math.round(radarSize),
  );
  // Render swing separately
  const outerRingDiameter = showcaseOuterRadarRingDiameter(radarSize);
  const swingWidth = Math.round(showcaseSwingCanvasWidth(outerRingDiameter, derived.maxSwing));
  const swingStage = intro?.stage ?? "player";
  const swingCanvas = ratingVersion === "rating_3" && (swingStage !== "player" || renderedRadar.radar.round_swing != null)
    ? renderSwingCanvas(
        swingStage === "player" ? { id: slide.id, radar: renderedRadar, color: playerColor } : null,
        swingWidth,
        Math.round(radarSize * 0.22),
        Math.round(showcaseSwingReferenceHalfWidth(outerRingDiameter)),
        fontScale,
        (intro?.stage === "empty" || intro?.stage === "average" || intro?.stage === "reference") && introAverage
          ? stripRatingProfiles(introAverage)
          : average ? stripRatingProfiles(average) : null,
        swingStage,
        intro?.stage === "empty" ? intro.progress : 1,
        intro?.stage === "empty" ? 0 : intro?.stage === "average" ? anim500Ease : isArrivalPhase ? firstPlayerValueEase : 1,
        "#ef4444",
        0,
        1,
        intro?.stage === "average"
          ? average?.radar.round_swing
          : intro?.stage === "reference"
            ? 5
            : undefined,
        intro?.stage === "average"
          ? swingGrowth.opacity
          : isArrivalPhase
          ? (arrivalOffsetMs >= FIRST_PLAYER_TEXT_START_MS ? firstPlayerSwingGrowth.opacity : 0)
          : 1,
        intro?.stage === "average"
          ? swingGrowth.opacity
          : isArrivalPhase
          ? firstPlayerValueEase
          : 1,
        introColor,
        showcaseSwingOverflowLimit(derived.maxSwing),
        metricLabelFontSize,
        resizeCanvas(
          resources.swing,
          swingWidth,
          Math.round(radarSize * 0.22),
        ),
        intro?.stage === "reference" ? currentReferenceSwingFillValue : undefined,
        intro?.stage === "reference" ? 1.3 : 1,
      )
    : null;
  const drawRadar = () => {
    ctx.save();
    if (isArrivalPhase) {
      if (firstPlayerRadarInP <= 0.001) {
        ctx.restore();
        return;
      }
      const targetRadarY = (height * layout.radarY) / 100;
      const startRadarY = height * 0.5 + height * 0.18;
      const currentRadarY = startRadarY + (targetRadarY - startRadarY) * firstPlayerRadarInEase;
      const currentSize = radarSize * firstPlayerRadarInEase;
      ctx.globalAlpha = (layout.opacity / 100) * sceneOpacity * firstPlayerRadarInEase;
      ctx.translate((width * layout.radarX) / 100, currentRadarY);
      ctx.drawImage(radar, -currentSize / 2, -currentSize / 2, currentSize, currentSize);
      ctx.restore();
      return;
    }
    ctx.globalAlpha = (layout.opacity / 100) * sceneOpacity;
    ctx.translate(
      (width * layout.radarX) / 100,
      (height * layout.radarY) / 100,
    );
    ctx.drawImage(radar, -radarSize / 2, -radarSize / 2, radarSize, radarSize);
    ctx.restore();
  };
  const innerMotion = intro?.stage === "empty"
    ? showcaseInnerRadarSwingTransform(intro.progress, animations.jellyParams?.expandProgress)
    : { active: true, scale: 1, opacity: 1, centerProgress: 1 };

  const drawIntroRadar = () => {
    if (!innerMotion.active || innerMotion.scale <= 0.001) return;
    // 起始中心点：Canvas 水平中心 50%，垂直高度 4/5 处 (80%)
    const startCY = height * 0.8;
    // 开场动画 X 轴严格保持居中对齐 (不同步自定义 X)，Y 轴与缩放大小完全同步用户的配置
    const targetRadarY = (height * layout.radarY) / 100;
    const radarX = width * 0.5;
    const radarY = startCY + (targetRadarY - startCY) * innerMotion.centerProgress;
    const currentRadarSize = radarSize * innerMotion.scale;
    ctx.save();
    ctx.globalAlpha = (layout.opacity / 100) * sceneOpacity * innerMotion.opacity * stage3FadeOut;
    ctx.translate(radarX, radarY);
    ctx.drawImage(radar, -currentRadarSize / 2, -currentRadarSize / 2, currentRadarSize, currentRadarSize);
    ctx.restore();
  };
  const drawIntroSwing = () => {
    if (!innerMotion.active || innerMotion.scale <= 0.001 || !swingCanvas) return;
    const startCY = height * 0.8;
    const targetSwingY = height * (layout.swingY ?? (layout.radarY + radarSize / 2 / height * 100 + 8)) / 100;
    const swingX = width * 0.5;
    const swingY = startCY + (targetSwingY - startCY) * innerMotion.centerProgress;
    const scale = ((layout.swingScale ?? 100) / 100) * innerMotion.scale;
    ctx.save();
    ctx.globalAlpha = (layout.opacity / 100) * sceneOpacity * innerMotion.opacity * stage3FadeOut;
    ctx.drawImage(
      swingCanvas,
      swingX - (swingCanvas.width * scale) / 2,
      swingY - (swingCanvas.height * scale) / 2,
      swingCanvas.width * scale,
      swingCanvas.height * scale,
    );
    ctx.restore();
  };
  const drawIntroWatermark = () => {
    if (ratingVersion !== "rating_3" || !showRatingWatermark) return;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(245,158,11,.78)";
    ctx.font = `650 ${Math.max(11, width * 0.009)}px "Noto Sans SC",system-ui`;
    ctx.fillText("Rating 3.0 本地近似 · 非 HLTV 官方", width * 0.022, height * 0.965);
    ctx.restore();
  };
  if (intro) {
    const introRenderers: Record<string, () => void> = {
      background: drawBackgroundLayer,
      particles: drawParticlesLayer,
      panel: drawPanelLayer,
      radar: drawIntroRadar,
      swing: drawIntroSwing,
      watermark: drawIntroWatermark,
    };
    for (const layer of showcasePaintOrder(layerOrder))
      introRenderers[layer]?.();
    applyBlackFadeInOverlay();
    return canvas;
  }
  const drawSwing = () => {
    if (!swingCanvas) return;
    ctx.save();
    if (isArrivalPhase) {
      if (firstPlayerRadarInP <= 0.001) {
        ctx.restore();
        return;
      }
      const targetSwingY = height * (layout.swingY ?? (layout.radarY + radarSize / 2 / height * 100 + 8)) / 100;
      const startSwingY = height * 0.5 + height * 0.25;
      const currentSwingY = startSwingY + (targetSwingY - startSwingY) * firstPlayerRadarInEase;
      const scale = ((layout.swingScale ?? 100) / 100) * firstPlayerRadarInEase;
      const sw = swingCanvas.width * scale;
      const sh = swingCanvas.height * scale;
      const swingX = width * (layout.swingX ?? layout.radarX) / 100;
      ctx.globalAlpha = (layout.opacity / 100) * sceneOpacity * firstPlayerRadarInEase;
      ctx.drawImage(swingCanvas, swingX - sw / 2, currentSwingY - sh / 2, sw, sh);
      ctx.restore();
      return;
    }
    ctx.globalAlpha = (layout.opacity / 100) * sceneOpacity;
    const swingX = width * (layout.swingX ?? layout.radarX) / 100;
    const swingY = height * (layout.swingY ?? (layout.radarY + radarSize / 2 / height * 100 + 8)) / 100;
    const scale = (layout.swingScale ?? 100) / 100;
    const sw = swingCanvas.width * scale;
    const sh = swingCanvas.height * scale;
    ctx.drawImage(swingCanvas, swingX - sw / 2, swingY - sh / 2, sw, sh);
    ctx.restore();
  };
  const drawImageFor = (item: ShowcaseSlide, opacity: number) => {
    const imageUrl = showcasePlayerImageUrl(item);
    if (!imageUrl || opacity <= 0) return;
    const image = showcaseImageCache.get(imageUrl);
    if (!image) return;
    const transform = resolveImageTransform(layout);
    const { boxW, boxH } = showcaseImageBox(layout, width, height);
    const scale =
      (layout.imageFit ?? "contain") === "cover"
        ? Math.max(boxW / imageWidth(image), boxH / imageHeight(image))
        : Math.min(boxW / imageWidth(image), boxH / imageHeight(image));
    const w = imageWidth(image) * scale;
    const h = imageHeight(image) * scale;
    const targetX = (width * transform.x) / 100;
    // 就位阶段：Player Image 从画布右侧入场到目标位置
    const startX = width + w / 2 + 60;
    const x = isArrivalPhase
      ? startX + (targetX - startX) * firstPlayerAvatarEase
      : targetX;
    const y = (height * transform.y) / 100;
    const arrivalImgAlpha = isArrivalPhase ? Math.min(1, firstPlayerAvatarP / 0.25) : 1;

    ctx.save();
    ctx.globalAlpha = opacity * sceneOpacity * arrivalImgAlpha;
    if ((layout.imageFit ?? "contain") === "cover") {
      ctx.beginPath();
      ctx.rect(x - boxW / 2, y - boxH / 2, boxW, boxH);
      ctx.clip();
    }
    ctx.drawImage(image, x - w / 2, y - h / 2, w, h);
    ctx.restore();
  };
  const drawImage = () => {
    if (previousSlide && morphProgress < 1)
      drawImageFor(previousSlide, 1 - morphProgress);
    drawImageFor(slide, previousSlide ? morphProgress : 1);
  };
  const drawTeamLogoFor = (item: ShowcaseSlide, opacity: number) => {
    if (!item.teamLogoUrl || opacity <= 0) return;
    const image = showcaseImageCache.get(item.teamLogoUrl);
    if (!image) return;
    // 拖动 Logo 时用单帧覆盖，避免预览每帧重建 slides 让派生缓存失效（拖拽会因此发滞）
    const pending = animations.pendingTeamLogoTransform;
    const transform =
      pending && pending.index === segment.index
        ? pending.transform
        : resolveTeamLogoTransform(layout, item);
    const size = showcaseTeamLogoSize(width, height, transform.scale, {
      width: imageWidth(image),
      height: imageHeight(image),
    });
    const w = size.width;
    const h = size.height;
    const x = (width * transform.x) / 100;
    const y = (height * transform.y) / 100;
    ctx.save();
    ctx.globalAlpha = opacity * sceneOpacity * arrivalTeamLogoAlpha;
    ctx.drawImage(image, x - w / 2, y - h / 2, w, h);
    ctx.restore();
  };
  const drawTeamLogo = () => {
    if (previousSlide && morphProgress < 1)
      drawTeamLogoFor(previousSlide, 1 - morphProgress);
    drawTeamLogoFor(slide, previousSlide ? morphProgress : 1);
  };
  const drawTitleFor = (item: ShowcaseSlide, opacity: number) => {
    ctx.save();
    // 标题要等副标题就位后 (FIRST_PLAYER_TITLE_START_MS)，才入场
    if (isArrivalPhase && arrivalOffsetMs < FIRST_PLAYER_TITLE_START_MS) {
      ctx.restore();
      return;
    }
    const arrivalTitleAlpha = isArrivalPhase ? Math.min(1, firstPlayerTitleP / 0.25) : 1;
    ctx.globalAlpha = opacity * sceneOpacity * arrivalTitleAlpha;
    ctx.translate((width * (layout.titleX ?? layout.nameX)) / 100, (height * (layout.titleY ?? layout.nameY)) / 100);
    ctx.scale((layout.titleScale ?? layout.nameScale) / 100, (layout.titleScale ?? layout.nameScale) / 100);
    ctx.textAlign = showcaseCanvasTextAlign(layout.nameAlign);
    const titleStyle = showcaseTitleTextStyle(layout, fontScale);
    ctx.fillStyle = titleStyle.color;
    ctx.font = titleStyle.font;
    // 就位阶段：Title 采用 Text Scramble 乱码解密入场
    const titleText = isArrivalPhase
      ? showcaseTextScramble(item.title, firstPlayerTitleP, Math.floor(arrivalOffsetMs / 40))
      : item.title;
    ctx.fillText(titleText, 0, 0);
    ctx.restore();
  };
  const drawSubtitleFor = (item: ShowcaseSlide, opacity: number) => {
    ctx.save();
    // 副标题要等玩家头像就位后 (FIRST_PLAYER_SUBTITLE_START_MS)，才入场
    if (isArrivalPhase && arrivalOffsetMs < FIRST_PLAYER_SUBTITLE_START_MS) {
      ctx.restore();
      return;
    }
    const baseScale = (layout.subtitleScale ?? layout.nameScale) / 100;
    // 副标题 size 从 0 变大到目标值
    const currentScale = isArrivalPhase ? baseScale * firstPlayerSubtitleEase : baseScale;
    const arrivalSubAlpha = isArrivalPhase ? Math.min(1, firstPlayerSubtitleP / 0.25) : 1;
    ctx.globalAlpha = opacity * sceneOpacity * arrivalSubAlpha;

    const subX = (width * (layout.subtitleX ?? layout.nameX)) / 100;
    const subY = (height * (layout.subtitleY ?? layout.nameY + 4.5)) / 100;

    ctx.translate(subX, subY);
    ctx.scale(currentScale, currentScale);
    ctx.textAlign = showcaseCanvasTextAlign(layout.nameAlign);

    const subStyle = showcaseSubtitleTextStyle(layout, fontScale);
    const subColor = subStyle.color;
    const subPreset = layout.subtitlePreset;
    // 金、银、铜、白四种外发光效果
    const glowColor =
      subPreset === "gold" || subColor.toLowerCase() === "#ffd700" || subColor.toLowerCase() === "#ffd76a" || subColor.toLowerCase() === "gold"
        ? "rgba(255, 215, 0, 0.85)"
        : subPreset === "silver" || subColor.toLowerCase() === "#e2e8f0" || subColor.toLowerCase() === "#c0c8d0" || subColor.toLowerCase() === "silver"
        ? "rgba(200, 220, 245, 0.85)"
        : subPreset === "bronze" || subColor.toLowerCase() === "#cd7f32" || subColor.toLowerCase() === "bronze"
        ? "rgba(205, 127, 50, 0.85)"
        : "rgba(244, 246, 248, 0.80)";

    const fontWeight = layout.subtitleBold !== false ? "750" : "500";
    const fontStyle = layout.subtitleItalic ? "italic" : "normal";
    const subFontSize = layout.subtitleFontSize ?? Math.max(13, width * 0.013);
    const subFont = `${fontStyle} ${fontWeight} ${subFontSize}px "Noto Sans SC",system-ui`;

    // 双层外发光效果
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = subStyle.glowOuter;
    ctx.font = subStyle.font;
    ctx.fillStyle = subColor;
    ctx.fillText(item.subtitle, 0, 0);
    // 叠加一层增强核心文字清晰度
    ctx.shadowBlur = subStyle.glowInner;
    ctx.fillText(item.subtitle, 0, 0);
    ctx.restore();
  };
  const drawTitle = () => {
    if (previousSlide && morphProgress < 1)
      drawTitleFor(previousSlide, 1 - morphProgress);
    drawTitleFor(slide, previousSlide ? morphProgress : 1);
  };
  const drawSubtitle = () => {
    if (previousSlide && morphProgress < 1)
      drawSubtitleFor(previousSlide, 1 - morphProgress);
    drawSubtitleFor(slide, previousSlide ? morphProgress : 1);
  };
  const drawWatermark = () => {
    if (ratingVersion !== "rating_3" || !showRatingWatermark) return;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    // 就位入场阶段让水印随 Data Panel 一同淡入，避免 handoff 结束瞬间突然出现
    const watermarkOpacity = isArrivalPhase ? Math.min(1, firstPlayerPanelP / 0.15) : 1;
    ctx.fillStyle = `rgba(245,158,11,${.78 * sceneOpacity * watermarkOpacity})`;
    ctx.font = `650 ${Math.max(11, width * 0.009)}px "Noto Sans SC",system-ui`;
    ctx.fillText(
      "Rating 3.0 本地近似 · 非 HLTV 官方",
      width * 0.022,
      height * 0.965,
    );
    ctx.restore();
  };
  const layerRenderers: Record<string, () => void> = {
    watermark: drawWatermark,
    radar: drawRadar,
    swing: drawSwing,
    image: drawImage,
    teamLogo: drawTeamLogo,
    subtitle: drawSubtitle,
    title: drawTitle,
    panel: drawPanelLayer,
    particles: drawParticlesLayer,
    background: drawBackgroundLayer,
  };
  for (const layer of showcasePaintOrder(layerOrder))
    layerRenderers[layer]?.();
  if (segment.phase === "handoff")
    drawBestEntrance(
      ctx,
      slide,
      width,
      height,
      bestEntranceHandoffProgress(segment.handoffProgress),
      1 - handoffProgress,
    );
  applyBlackFadeInOverlay();
  return canvas;
}
export async function ensureShowcaseFonts() {
  if (typeof document === "undefined") {
    const fonts = (globalThis as unknown as { fonts?: { add(font: FontFace): void } }).fonts;
    if (!fonts) throw new Error("当前运行环境不支持字体加载检测。");
    await Promise.all([
      new FontFace("Noto Sans SC", "url(/fonts/NotoSansSC-Variable.ttf)").load().then((font) => fonts.add(font)),
      new FontFace("Bangers", "url(/fonts/Bangers-Regular.ttf)").load().then((font) => fonts.add(font)),
      new FontFace(SHOWCASE_DISPLAY_FONT, `url(${SHOWCASE_DISPLAY_FONT_URL})`, { style: "italic", weight: "400 900" })
        .load()
        .then((font) => fonts.add(font)),
    ]);
    return;
  }
  if (!document.fonts) throw new Error("当前运行环境不支持字体加载检测。");
  const [radarFont, bestFont, displayFont] = await Promise.all([
    document.fonts.load('700 32px "Noto Sans SC"'),
    document.fonts.load('400 24px "Bangers"'),
    document.fonts.load(`italic 900 32px "${SHOWCASE_DISPLAY_FONT}"`),
  ]);
  if (
    !radarFont.length ||
    !bestFont.length ||
    !displayFont.length ||
    !document.fonts.check('700 32px "Noto Sans SC"') ||
    !document.fonts.check('400 24px "Bangers"') ||
    !document.fonts.check(`italic 900 32px "${SHOWCASE_DISPLAY_FONT}"`)
  ) {
    throw new Error("离线字体加载失败，已取消渲染以避免系统字体回退。");
  }
}
