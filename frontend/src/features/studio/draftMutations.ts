import { bridge } from "../../bridge";
import type {
  AppConfig,
  OverlayEntry,
  PlayerMedia,
  RadarResponse,
  ShowcaseLayoutDraft,
  ShowcaseSlide,
  StudioKind,
  StudioSeed,
} from "../../types";
import {
  SHOWCASE_EXPORT_HEIGHT,
  SHOWCASE_EXPORT_WIDTH,
  SHOWCASE_IMAGE_SCALE_MAX,
  SHOWCASE_IMAGE_SCALE_MIN,
  normalizeShowcaseLayers,
  showcaseDefaultLayers,
} from "./showcaseMath";

export type DraftRecord = Record<string, unknown>;

export const draftColors = [
  "#22d3ee",
  "#f59e0b",
  "#a78bfa",
  "#34d399",
  "#fb7185",
  "#60a5fa",
  "#facc15",
  "#f472b6",
];

export function makeInitialDraft(
  kind: StudioKind,
  config: AppConfig,
): DraftRecord {
  if (kind === "radar") {
    return {
      radar: null,
      title: "",
      subtitle: "",
      color: "#22d3ee",
      width: config.export_width,
      height: config.export_height,
      fontScale: 1,
    };
  }
  if (kind === "overlay") {
    return {
      entries: [] as OverlayEntry[],
      title: "CS2 玩家叠图雷达",
      subtitle: "队列平均（含隐藏玩家）",
      width: config.export_width,
      height: config.export_height,
      fontScale: 1,
    };
  }
  return {
    slides: [] as ShowcaseSlide[],
    active: 0,
    layout: {
      radarX: 34,
      radarY: 55,
      radarScale: 100,
      nameX: 73,
      nameY: 20,
      nameScale: 100,
      titleX: 73,
      titleY: 20,
      titleScale: 100,
      subtitleX: 73,
      subtitleY: 24.5,
      subtitleScale: 100,
      imageX: 73,
      imageY: 57,
      imageScale: 100,
      metricLabelFontSize: 12,
      swingX: 34,
      swingY: 78,
      swingScale: 100,
      opacity: 100,
      layers: showcaseDefaultLayers(config.rating_version),
      nameAlign: "center" as "left" | "center" | "right",
      imageFit: "contain" as "contain" | "cover",
    } as ShowcaseLayoutDraft,
    fps: config.video_fps,
    width: SHOWCASE_EXPORT_WIDTH,
    height: SHOWCASE_EXPORT_HEIGHT,
    audioOffsetMs: config.showcase.audio_offset_ms,
    audioVolume: 100,
  };
}

export function stripLegacyDraftFields(draft: DraftRecord): DraftRecord {
  const next = { ...draft };
  delete next.ratingVersion;
  delete next.showRatingWatermark;
  if (Array.isArray(next.slides)) {
    const slides = next.slides as Array<ShowcaseSlide & {
      imageTransform?: { x: number; y: number; scale?: number };
    }>;
    const active = typeof next.active === "number" ? next.active : 0;
    const layout = { ...((next.layout as ShowcaseLayoutDraft | undefined) ?? {}) };
    const activeTransform = slides[active]?.imageTransform;
    layout.imageX = activeTransform?.x ?? layout.imageX ?? 73;
    layout.imageY = activeTransform?.y ?? layout.imageY ?? 57;
    const activeScale = activeTransform?.scale;
    // 旧版「人物立绘比例」滑杆把百分比当成 0.3~2.5 的倍数写入，这里按 ×100 修复后限幅
    const rawScale = Number(activeScale ?? layout.imageScale ?? 100);
    const repairedScale = Number.isFinite(rawScale) && rawScale > 0
      ? (rawScale < 10 ? rawScale * 100 : rawScale)
      : 100;
    layout.imageScale = Math.max(
      SHOWCASE_IMAGE_SCALE_MIN,
      Math.min(SHOWCASE_IMAGE_SCALE_MAX, repairedScale),
    );
    layout.metricLabelFontSize = Math.max(
      8,
      Math.min(32, Number(layout.metricLabelFontSize) || 12),
    );
    // 图层清单补齐/迁移：旧版的 name 层拆成 title+subtitle，新增背景/面板/粒子/水印层
    layout.layers = normalizeShowcaseLayers(layout.layers);
    next.layout = layout;
    next.slides = slides.map((slide) => {
      if (!slide.imageTransform) return slide;
      const migrated = { ...slide };
      delete migrated.imageTransform;
      return migrated;
    });
    delete next.fontScale;
  }
  return next;
}

export function appendOverlayEntry(
  entries: OverlayEntry[],
  radar: RadarResponse,
): OverlayEntry[] {
  if (entries.some((entry) => entry.id === radar.player.steam_id))
    return entries;
  return [
    ...entries,
    {
      id: radar.player.steam_id,
      radar,
      visible: true,
      color: draftColors[entries.length % draftColors.length],
    },
  ];
}

async function mediaForPlayer(steamId: string): Promise<PlayerMedia> {
  try {
    return await bridge.getPlayerMedia(steamId);
  } catch {
    return {};
  }
}

export function mergeRadarSeed(
  draft: DraftRecord,
  seed: StudioSeed,
): DraftRecord {
  if (!seed.radar) return draft;
  return {
    ...draft,
    radar: seed.radar,
    title: seed.player.name,
    subtitle: `已选 ${seed.matchIds.length} 场比赛`,
  };
}

export function mergeOverlaySeed(
  draft: DraftRecord,
  seed: StudioSeed,
): DraftRecord {
  if (!seed.radar) return draft;
  const entries = appendOverlayEntry(
    (draft.entries as OverlayEntry[] | undefined) ?? [],
    seed.radar,
  );
  return entries === draft.entries ? draft : { ...draft, entries };
}

export const studioToastLabels: Record<StudioKind, string> = {
  radar: "已保存到雷达制作",
  overlay: "已加入叠图队列",
  showcase: "已加入轮播",
};

export async function saveSeedToDraft(
  kind: StudioKind,
  seed: StudioSeed,
  config: AppConfig,
  extraProps?: Partial<ShowcaseSlide>,
): Promise<void> {
  const existing = await bridge.loadDraft(kind);
  let draft = existing
    ? stripLegacyDraftFields(JSON.parse(existing.payload))
    : makeInitialDraft(kind, config);
  if (kind === "radar") draft = mergeRadarSeed(draft, seed);
  else if (kind === "overlay") draft = mergeOverlaySeed(draft, seed);
  else draft = await mergeShowcaseSeed(draft, seed, extraProps);
  await bridge.saveDraft(kind, JSON.stringify(draft));
}

export async function mergeShowcaseSeed(
  draft: DraftRecord,
  seed: StudioSeed,
  extraProps?: Partial<ShowcaseSlide>,
): Promise<DraftRecord> {
  if (!seed.radar) return draft;
  const media = await mediaForPlayer(seed.player.steam_id);
  const slides = (draft.slides as ShowcaseSlide[] | undefined) ?? [];
  const existingIndex = slides.findIndex(
    (slide) => slide.id === seed.player.steam_id,
  );
  if (existingIndex >= 0) {
    return {
      ...draft,
      active: existingIndex,
      slides: slides.map((item, index) =>
        index === existingIndex
          ? {
              ...item,
              radar: seed.radar!,
              imageUrl: media.image_url || item.imageUrl,
              backgroundUrl: media.background_url || item.backgroundUrl,
              teamLogoUrl: extraProps?.teamLogoUrl || item.teamLogoUrl,
              ...extraProps,
            }
          : item,
      ),
    };
  }
  return {
    ...draft,
    active: slides.length,
    slides: [
      ...slides,
      {
        id: seed.player.steam_id,
        radar: seed.radar,
        title: seed.player.name,
        subtitle: `#${slides.length + 1}`,
        duration: 4,
        color: draftColors[slides.length % draftColors.length],
        imageUrl: media.image_url,
        backgroundUrl: media.background_url,
        teamLogoUrl: extraProps?.teamLogoUrl,
        ...extraProps,
      },
    ],
  };
}
