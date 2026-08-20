import {
  renderRadarCanvas,
  renderSwingCanvas,
  selectRatingProfile,
} from "../../components/RadarCanvas";
import type {
  RatingVersion,
  ShowcaseLayoutDraft,
  ShowcaseSlide,
} from "../../types";
import {
  bestMetricIndexesForSlide,
  interpolateRadarResponse,
  showcaseCanvasTextAlign,
  showcasePaintOrder,
  showcaseSegment,
  showcaseTransitionProgress,
  stripRatingProfiles,
  targetBounds,
  type ShowcaseTarget,
  type ShowcaseTransform,
} from "./showcaseMath";

export function drawShowcaseSelection(canvas: HTMLCanvasElement, target: ShowcaseTarget, transform: ShowcaseTransform, bounds: ReturnType<typeof targetBounds>) {
  const ctx=canvas.getContext("2d"); if(!ctx)return; const sx=canvas.width/100, sy=canvas.height/100; ctx.save(); ctx.strokeStyle="#f3f5f7"; ctx.lineWidth=Math.max(1,canvas.width/1200); ctx.setLineDash([6,5]); ctx.strokeRect(bounds.left*sx,bounds.top*sy,(bounds.right-bounds.left)*sx,(bounds.bottom-bounds.top)*sy); ctx.setLineDash([]); ctx.fillStyle="#f3f5f7"; ctx.strokeStyle="#111418"; const size=Math.max(5,canvas.width/240); for(const [x,y] of [[bounds.left,bounds.top],[bounds.right,bounds.top],[bounds.left,bounds.bottom],[bounds.right,bounds.bottom]]) { ctx.fillRect(x*sx-size/2,y*sy-size/2,size,size); ctx.strokeRect(x*sx-size/2,y*sy-size/2,size,size); } ctx.font=`600 ${Math.max(9,canvas.width/140)}px "Noto Sans SC",system-ui`; ctx.fillStyle="#f3f5f7"; ctx.fillText(({radar:"雷达",title:"主标题",subtitle:"副标题",image:"人物图",swing:"Round Swing"} as Record<string,string>)[target],bounds.left*sx,bounds.top*sy-size); ctx.restore(); void transform;
}
type ShowcaseImage = HTMLImageElement | ImageBitmap;
const showcaseImageCache = new Map<string, ShowcaseImage>();
function imageWidth(image: ShowcaseImage) {
  return "naturalWidth" in image ? image.naturalWidth : image.width;
}
function imageHeight(image: ShowcaseImage) {
  return "naturalHeight" in image ? image.naturalHeight : image.height;
}
function createCanvas(width: number, height: number) {
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
): CanvasRenderingContext2D {
  return canvas.getContext("2d") as CanvasRenderingContext2D;
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
const particleSpriteCache = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
function particleGlowSprite(color: string, bloom: number): HTMLCanvasElement | OffscreenCanvas {
  const key = `${color}|${bloom}`;
  const cached = particleSpriteCache.get(key);
  if (cached) return cached;
  const size = Math.ceil(bloom * 2) + 2;
  const sprite = createCanvas(size, size);
  const ctx = canvas2D(sprite);
  const cx = size / 2;
  const glow = ctx.createRadialGradient(cx, cx, 0, cx, cx, bloom);
  glow.addColorStop(0, colorAlpha(color, 1));
  glow.addColorStop(0.3, colorAlpha(color, 0.35));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cx, bloom, 0, Math.PI * 2);
  ctx.fill();
  particleSpriteCache.set(key, sprite);
  return sprite;
}
function drawShowcaseParticles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
  timeMs: number,
) {
  const frame = timeMs / 16.67;
  ctx.save();
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
    const sprite = particleGlowSprite(color, bloom);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x - sprite.width / 2, y - sprite.height / 2);
    ctx.globalAlpha = 1;
    if (!nebula) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.75, alpha)})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
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
) {
  const ratedSlides = slides.map((item) => ({ ...item, radar: selectRatingProfile(item.radar, ratingVersion) }));
  const segment = showcaseSegment(ratedSlides, timeMs);
  const slide = ratedSlides[segment.index];
  const canvas = targetCanvas ?? createCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas2D(canvas);
  const previousSlide = segment.index > 0 ? ratedSlides[segment.index - 1] : null;
  const morphProgress = previousSlide
    ? showcaseTransitionProgress(ratedSlides, timeMs)
    : 1;
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
  const drawBackground = (item: ShowcaseSlide | null, opacity: number) => {
    if (!item?.backgroundUrl || opacity <= 0) return;
    const image = showcaseImageCache.get(item.backgroundUrl);
    if (image) {
      ctx.save();
      ctx.globalAlpha = 0.48 * opacity;
      drawCover(ctx, image, width, height);
      ctx.restore();
    }
  };
  if (previousSlide && morphProgress < 1)
    drawBackground(previousSlide, 1 - morphProgress);
  drawBackground(slide ?? null, previousSlide ? morphProgress : 1);
  if (slide?.backgroundUrl || previousSlide?.backgroundUrl) {
    ctx.fillStyle = "rgba(5,7,9,.46)";
    ctx.fillRect(0, 0, width, height);
  }
  drawShowcaseParticles(ctx, width, height, accent, timeMs);
  if (!slide) {
    ctx.fillStyle = "#88a0ad";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(18, width / 48)}px "Noto Sans SC",system-ui`;
    ctx.fillText("从资料库添加玩家后预览轮播", width / 2, height / 2);
    return canvas;
  }
  const renderedRadar = (previousSlide
    ? interpolateRadarResponse(previousSlide.radar, slide.radar, morphProgress)
    : slide.radar);
  const profilelessRadar = stripRatingProfiles(renderedRadar);
  const radarSize =
    (Math.min(width * 0.48, height * 0.78) * layout.radarScale) / 100;
  const radar = createCanvas(Math.round(radarSize), Math.round(radarSize));
  renderRadarCanvas(
    radar,
    {
      radar: profilelessRadar,
      color: accent,
      compact: true,
      transparent: true,
      hideSwing: true,
      bestMetricIndexes:
        morphProgress > 0.65
          ? bestMetricIndexesForSlide(ratedSlides, segment.index)
          : [],
      showBestMarkers,
      radarScaleMode,
      radarScale,
      radarAxisScale,
      ratingVersion,
      showRatingWatermark: false,
      fontScale,
    },
    Math.round(radarSize),
    Math.round(radarSize),
  );
  // Render swing separately
  const swingSize = Math.round(radarSize);
  const swingCanvas = ratingVersion === "rating_3" && renderedRadar.radar.round_swing != null
    ? renderSwingCanvas(
        { id: slide.id, radar: renderedRadar, color: accent },
        swingSize,
        Math.round(radarSize * 0.19),
        Math.round(radarSize * 0.27),
        fontScale,
      )
    : null;
  const drawRadar = () => {
    ctx.save();
    ctx.globalAlpha = layout.opacity / 100;
    ctx.translate(
      (width * layout.radarX) / 100,
      (height * layout.radarY) / 100,
    );
    ctx.drawImage(radar, -radarSize / 2, -radarSize / 2, radarSize, radarSize);
    ctx.restore();
  };
  const drawSwing = () => {
    if (!swingCanvas) return;
    ctx.save();
    ctx.globalAlpha = layout.opacity / 100;
    const swingX = width * (layout.swingX ?? layout.radarX) / 100;
    const swingY = height * (layout.swingY ?? (layout.radarY + radarSize / 2 / height * 100 + 8)) / 100;
    const scale = (layout.swingScale ?? 100) / 100;
    const sw = swingCanvas.width * scale;
    const sh = swingCanvas.height * scale;
    ctx.drawImage(swingCanvas, swingX - sw / 2, swingY - sh / 2, sw, sh);
    ctx.restore();
  };
  const drawImageFor = (item: ShowcaseSlide, opacity: number) => {
    if (!item.imageUrl || opacity <= 0) return;
    const image = showcaseImageCache.get(item.imageUrl);
    if (!image) return;
    const transform = item.imageTransform ?? { x: layout.imageX, y: layout.imageY, scale: layout.imageScale };
    const boxW = (width * 0.28 * transform.scale) / 100;
    const boxH = (height * 0.5 * transform.scale) / 100;
    const scale =
      (layout.imageFit ?? "contain") === "cover"
        ? Math.max(boxW / imageWidth(image), boxH / imageHeight(image))
        : Math.min(boxW / imageWidth(image), boxH / imageHeight(image));
    const w = imageWidth(image) * scale;
    const h = imageHeight(image) * scale;
    const x = (width * transform.x) / 100;
    const y = (height * transform.y) / 100;
    ctx.save();
    ctx.globalAlpha = opacity;
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
  const drawTitleFor = (item: ShowcaseSlide, opacity: number) => {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate((width * (layout.titleX ?? layout.nameX)) / 100, (height * (layout.titleY ?? layout.nameY)) / 100);
    ctx.scale((layout.titleScale ?? layout.nameScale) / 100, (layout.titleScale ?? layout.nameScale) / 100);
    ctx.textAlign = showcaseCanvasTextAlign(layout.nameAlign);
    ctx.fillStyle = "#f4f6f8";
    ctx.font = `800 ${Math.max(28, width * 0.035)}px "Noto Sans SC",system-ui`;
    ctx.fillText(item.title, 0, 0);
    ctx.restore();
  };
  const drawSubtitleFor = (item: ShowcaseSlide, opacity: number) => {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate((width * (layout.subtitleX ?? layout.nameX)) / 100, (height * (layout.subtitleY ?? layout.nameY + 4.5)) / 100);
    ctx.scale((layout.subtitleScale ?? layout.nameScale) / 100, (layout.subtitleScale ?? layout.nameScale) / 100);
    ctx.textAlign = showcaseCanvasTextAlign(layout.nameAlign);
    ctx.fillStyle = "#aab3bc";
    ctx.font = `500 ${Math.max(13, width * 0.013)}px "Noto Sans SC",system-ui`;
    ctx.fillText(item.subtitle, 0, 0);
    ctx.restore();
  };
  const drawName = () => {
    if (previousSlide && morphProgress < 1) { drawTitleFor(previousSlide, 1 - morphProgress); drawSubtitleFor(previousSlide, 1 - morphProgress); }
    drawTitleFor(slide, previousSlide ? morphProgress : 1);
    drawSubtitleFor(slide, previousSlide ? morphProgress : 1);
  };
  const renderers: Record<string, () => void> = {
    radar: drawRadar,
    swing: drawSwing,
    image: drawImage,
    name: drawName,
  };
  const defaultLayers = ratingVersion === "rating_3" ? ["radar", "swing", "image", "name"] : ["radar", "image", "name"];
  const effectiveLayers =
    ratingVersion === "rating_3"
      ? (layout.layers ?? defaultLayers).includes("swing")
        ? layout.layers!
        : [...(layout.layers ?? defaultLayers), "swing"]
      : (layout.layers ?? defaultLayers).filter((layer) => layer !== "swing");
  for (const layer of showcasePaintOrder(effectiveLayers))
    renderers[layer]?.();
  if (ratingVersion === "rating_3" && showRatingWatermark) {
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(245,158,11,.78)";
    ctx.font = `650 ${Math.max(11, width * 0.009)}px "Noto Sans SC",system-ui`;
    ctx.fillText(
      "Rating 3.0 本地近似 · 非 HLTV 官方",
      width * 0.022,
      height * 0.965,
    );
    ctx.restore();
  }
  return canvas;
}
export async function ensureShowcaseFonts() {
  if (typeof document === "undefined") {
    const fonts = (globalThis as unknown as { fonts?: { add(font: FontFace): void } }).fonts;
    if (!fonts) throw new Error("当前运行环境不支持字体加载检测。");
    await Promise.all([
      new FontFace("Noto Sans SC", "url(/fonts/NotoSansSC-Variable.ttf)").load().then((font) => fonts.add(font)),
      new FontFace("Bangers", "url(/fonts/Bangers-Regular.ttf)").load().then((font) => fonts.add(font)),
    ]);
    return;
  }
  if (!document.fonts) throw new Error("当前运行环境不支持字体加载检测。");
  const [radarFont, bestFont] = await Promise.all([document.fonts.load('700 32px "Noto Sans SC"'), document.fonts.load('400 24px "Bangers"')]);
  if (!radarFont.length || !bestFont.length || !document.fonts.check('700 32px "Noto Sans SC"') || !document.fonts.check('400 24px "Bangers"')) throw new Error("离线字体加载失败，已取消渲染以避免系统字体回退。");
}
