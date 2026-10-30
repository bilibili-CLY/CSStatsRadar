import { describe, expect, it } from "vitest";
import type { OverlayEntry, RadarResponse, ShowcaseLayoutDraft, ShowcaseSlide } from "../../types";
import { RADAR_VALUE_FONT_SCALE } from "../../components/RadarCanvas";
import { appendOverlayEntry, stripLegacyDraftFields } from "./draftMutations";
import {
  audioOffsetFromDrag,
  audioOffsetLabel,
  averageRadar,
  bestMetricIndexesForSlide,
  clampShowcaseTransform,
  interpolateRadarResponse,
  rating3Available,
  resizedShowcaseDuration,
  normalizeShowcaseDimensions,
  showcasePreviewSize,
  showcaseAverageRadar,
  showcaseBestEntranceDuration,
  SHOWCASE_EXPORT_HEIGHT,
  SHOWCASE_EXPORT_WIDTH,
  SHOWCASE_BEST_ENTRANCE_MS,
  SHOWCASE_BEST_HANDOFF_MS,
  SHOWCASE_INTRO_MS,
  SHOWCASE_INTRO_AVERAGE_TRANSITION_MS,
  SHOWCASE_INTRO_BLACK_FADE_IN_MS,
  SHOWCASE_INTRO_MATCH_INFO_FADE_IN_MS,
  SHOWCASE_TRANSITION_MS,
  FIRST_PLAYER_ARRIVAL_MS,
  FIRST_PLAYER_PANEL_MS,
  FIRST_PLAYER_SUBTITLE_START_MS,
  FIRST_PLAYER_TITLE_START_MS,
  showcaseTextScramble,
  selectionBounds,
  metricGrowthTransform,
  metricStepIndex,
  settledShowcasePreviewTime,
  showcaseBlackFadeInAlpha,
  showcaseCanvasTextAlign,
  showcaseDataPanelJellyTransform,
  showcaseDuration,
  showcaseInnerRadarSwingTransform,
  showcaseIntroAverageTransitionProgress,
  showcaseIntroDuration,
  showcaseIntroState,
  showcaseMatchInfoFadeInOpacity,
  showcaseMatchInfoOpacity,
  DEFAULT_SHOWCASE_INTRO_STAGES,
  showcaseReferenceRadar,
  showcaseZeroRadar,
  normalizeShowcaseLayers,
  showcaseDefaultLayers,
  showcasePaintOrder,
  showcaseRadarFloorValues,
  showcaseSegment,
  showcaseSlideStart,
  showcaseOuterRadarRingDiameter,
  showcaseSwingCanvasWidth,
  showcaseSwingReferenceHalfWidth,
  showcaseTransitionProgress,
  timelineTickStep,
} from "./showcaseMath";
import {
  SHOWCASE_IMAGE_SCALE_MAX,
  SHOWCASE_IMAGE_SCALE_MIN,
  SHOWCASE_SUBTITLE_FONT_SIZE,
  SHOWCASE_SUBTITLE_GLOW_OUTER,
  SHOWCASE_TITLE_FONT_SIZE,
  resolveImageTransform,
  resolveTeamLogoTransform,
  showcaseImageBox,
  showcaseSubtitleTextStyle,
  showcaseTeamLogoSize,
  showcaseTitleFontSize,
  showcaseTitleTextStyle,
  showcaseBestAmounts,
  showcaseRadarLabelRegion,
  showcaseAudioGain,
} from "./showcaseMath";
import {
  selectRatingProfile,
  radarLabelSafeDistance,
  roundSwingBarDistance,
  roundSwingBarRadii,
  roundSwingTrackHeight,
  roundSwingOverflowLimit,
  visibleRadarPointDistance,
  normalizeRadarMetricValue,
  BEST_VALUE_FONT_SCALE,
  BEST_WORD_FONT_SCALE,
  RADAR_BEST_GLOW_RADIUS,
  RADAR_BEST_RADIAL_PUSH,
  RADAR_MULTI_FILL_OPACITY,
  RADAR_MULTI_FOCUSED_FILL_OPACITY,
  RADAR_SINGLE_PLAYER_FILL_OPACITY,
  RADAR_POLYGON_GLOW_INNER_ALPHA,
  RADAR_POLYGON_GLOW_INNER_SCALE,
  radarDisplayFont,
  radarMetricLabelLayout,
  radarPolygonFillOpacity,
  radarPolygonGlowLayers,
  radarValueFont,
} from "../../components/RadarCanvas";
import {
  bestEntranceSidePattern,
  bestEntranceSideScrollDistance,
  bestEntranceImageOpacity,
  bestEntranceTitleLayout,
  bestEntranceTitlePosition,
  bestEntranceHandoffProgress,
  showcasePlayerImageUrl,
} from "./showcaseRender";

const radar = (name: string, values: Array<number | null>): RadarResponse => ({
  player: { name, steam_id: name },
  match_count: 1,
  radar: {
    dimensions: ["A", "B"],
    values,
    display_types: ["number", "number"],
    max_values: [2, 2],
    note: "",
    metrics: values.map((value, index) => ({
      name: index ? "B" : "A",
      value,
      display_type: "number",
      max_value: 2,
      status: "ok",
    })),
  },
});
describe("overlay average", () => {
  it("keeps exceptional radar values outside the reference ring", () => {
    expect(visibleRadarPointDistance(1.6, 100, 220)).toBe(160);
    expect(visibleRadarPointDistance(3, 100, 220)).toBe(220);
  });

  it("keeps measured radar labels inside their axis safe region", () => {
    const bounds = { left: 20, right: 180, top: 20, bottom: 180 };
    const distance = radarLabelSafeDistance(
      100,
      100,
      6,
      1,
      bounds,
      { halfWidth: 24, top: -18, bottom: 26 },
    );
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(100);
  });

  it("accounts for the label box top edge on the upper axis", () => {
    const bounds = { left: 20, right: 180, top: 20, bottom: 180 };
    // 顶部轴：标签框上边缘是相对中心线的负值，安全距离必须让整块框落在 bounds.top 之下
    const distance = radarLabelSafeDistance(100, 100, 6, 0, bounds, {
      halfWidth: 24,
      top: -20,
      bottom: 26,
    });
    expect(distance).toBeCloseTo(60, 5);
    expect(100 - distance + -20).toBeCloseTo(bounds.top, 5);
  });

  it("matches the ±5% reference span to the outer radar ring and preserves Swing overflow", () => {
    const outerRingDiameter = showcaseOuterRadarRingDiameter(400);
    const referenceHalfWidth = showcaseSwingReferenceHalfWidth(outerRingDiameter);
    const overflowHalfWidth = 134;
    const overflowLimit = roundSwingOverflowLimit([25.26, -6]);
    expect(outerRingDiameter).toBe(216);
    expect(referenceHalfWidth).toBe(108);
    expect(showcaseSwingCanvasWidth(outerRingDiameter)).toBe(280.8);
    expect(roundSwingBarDistance(5, referenceHalfWidth, overflowHalfWidth, overflowLimit)).toBe(108);
    expect(roundSwingBarDistance(25.26, referenceHalfWidth, overflowHalfWidth, overflowLimit)).toBe(134);
    expect(roundSwingBarDistance(-6, referenceHalfWidth, overflowHalfWidth, overflowLimit)).toBeGreaterThan(referenceHalfWidth);
    expect(roundSwingBarRadii(true, 6)).toEqual([0, 6, 6, 0]);
    expect(roundSwingBarRadii(false, 6)).toEqual([6, 0, 0, 6]);
    expect(roundSwingTrackHeight(100, 2.25)).toBe(31.5);
    expect(roundSwingTrackHeight(100, 2.25, 0.5)).toBe(15.75);
    expect(roundSwingTrackHeight(100, 2.25, 2)).toBe(63);
  });

  it("uses the full queue even when an entry is hidden", () => {
    const entries: OverlayEntry[] = [
      { id: "a", radar: radar("a", [1, 2]), visible: true, color: "#fff" },
      { id: "b", radar: radar("b", [2, 1]), visible: false, color: "#000" },
    ];
    expect(averageRadar(entries)?.radar.values).toEqual([1.5, 1.5]);
  });

  it("averages and selects the Rating 3.0 profile including Swing", () => {
    const first = radar("a", [1, 2]);
    const second = radar("b", [2, 1]);
    first.profiles = { rating_2: first.radar, rating_3: { ...first.radar, dimensions: ["A", "Multi-Kill"], values: [2, 3], round_swing: 2 } };
    second.profiles = { rating_2: second.radar, rating_3: { ...second.radar, dimensions: ["A", "Multi-Kill"], values: [4, 1], round_swing: -1 } };
    first.rating_3_status = second.rating_3_status = { available: true };
    const average = averageRadar([
      { id: "a", radar: first, visible: true, color: "#fff" },
      { id: "b", radar: second, visible: true, color: "#000" },
    ]);
    expect(average?.profiles?.rating_3?.values).toEqual([3, 2]);
    expect(average?.profiles?.rating_3?.round_swing).toBe(.5);
    expect(selectRatingProfile(first, "rating_3").radar.dimensions).toContain("Multi-Kill");
  });

  it("adds a requested player once after the draft is restored", () => {
    const first = radar("a", [1, 2]);
    const second = radar("b", [2, 1]);
    const entries = appendOverlayEntry([], first);
    expect(
      appendOverlayEntry(entries, second).map((entry) => entry.id),
    ).toEqual(["a", "b"]);
    expect(appendOverlayEntry(entries, first)).toBe(entries);
  });
});

describe("showcase timeline", () => {
  const slides: ShowcaseSlide[] = [
    {
      id: "a",
      radar: radar("a", [1, 2]),
      title: "A",
      subtitle: "",
      duration: 2,
      color: "#22d3ee",
    },
    {
      id: "b",
      radar: radar("b", [2, 1]),
      title: "B",
      subtitle: "",
      duration: 3,
      color: "#f59e0b",
    },
  ];

  it("uses the same boundaries for seeking and playback", () => {
    expect(showcaseDuration(slides)).toBe(5000);
    expect(showcaseSlideStart(slides, 1)).toBe(2000);
    expect(showcaseSegment(slides, 1999)).toMatchObject({ index: 0, offsetMs: 1999, phase: "slide" });
    expect(showcaseSegment(slides, 2000)).toMatchObject({ index: 1, offsetMs: 0, phase: "slide" });
    expect(settledShowcasePreviewTime(slides, 0)).toBe(1000);
    expect(settledShowcasePreviewTime(slides, 2000)).toBe(3000);
  });

  it("uses a fixed 1920×1080 showcase surface and letterboxes previews", () => {
    expect(SHOWCASE_EXPORT_WIDTH).toBe(1920);
    expect(SHOWCASE_EXPORT_HEIGHT).toBe(1080);
    expect(showcasePreviewSize(1000, 1000)).toEqual({ width: 1000, height: 562.5 });
    expect(showcasePreviewSize(2000, 600)).toEqual({ width: 1066.6666666666667, height: 600 });
    expect(normalizeShowcaseDimensions({ width: 1080, height: 1920, name: "legacy" })).toEqual({
      width: 1920,
      height: 1080,
      name: "legacy",
    });
  });

  it("morphs radar points for one second at every player boundary", () => {
    expect(showcaseTransitionProgress(slides, 2000)).toBe(0);
    expect(showcaseTransitionProgress(slides, 2500)).toBe(0.5);
    expect(showcaseTransitionProgress(slides, 3000)).toBe(1);
  });

  it("adds the configured BEST entrance and handoff before every BEST player", () => {
    const animations = { showIntroAnimation: true, showBestEntranceAnimation: true };
    const bestDuration = SHOWCASE_BEST_ENTRANCE_MS + SHOWCASE_BEST_HANDOFF_MS;
    expect(showcaseDuration(slides, animations)).toBe(5_000 + SHOWCASE_INTRO_MS + bestDuration * 2);
    expect(showcaseSegment(slides, 0, animations)).toMatchObject({ index: 0, phase: "intro" });
    expect(showcaseSegment(slides, SHOWCASE_INTRO_MS, animations)).toMatchObject({ index: 0, phase: "entrance", entranceProgress: 0 });
    expect(showcaseSegment(slides, SHOWCASE_INTRO_MS + SHOWCASE_BEST_ENTRANCE_MS - 1, animations)).toMatchObject({ index: 0, phase: "entrance" });
    expect(showcaseSegment(slides, SHOWCASE_INTRO_MS + SHOWCASE_BEST_ENTRANCE_MS, animations)).toMatchObject({ index: 0, phase: "handoff", handoffProgress: 0 });
    expect(showcaseSegment(slides, SHOWCASE_INTRO_MS + bestDuration, animations)).toMatchObject({ index: 0, phase: "slide", offsetMs: 0, usesBestEntrance: true });
    expect(settledShowcasePreviewTime(slides, SHOWCASE_INTRO_MS, animations)).toBe(SHOWCASE_INTRO_MS + bestDuration + 1_000);
    expect(showcaseSlideStart(slides, 1, animations)).toBe(SHOWCASE_INTRO_MS + 2_000 + bestDuration);
    expect(showcaseSegment(slides, SHOWCASE_INTRO_MS + 2_000 + bestDuration, animations)).toMatchObject({ index: 1, phase: "entrance", entranceProgress: 0 });
    expect(showcaseBestEntranceDuration(slides, 0, { ...animations, reduceMotion: true })).toBe(0);
  });

  it("keeps BEST slides out of the normal radar morph after their handoff", () => {
    const animations = { showBestEntranceAnimation: true };
    const stableBestTime = SHOWCASE_BEST_ENTRANCE_MS + SHOWCASE_BEST_HANDOFF_MS;
    expect(showcaseSegment(slides, stableBestTime, animations)).toMatchObject({
      index: 0,
      phase: "slide",
      usesBestEntrance: true,
    });
    expect(showcaseTransitionProgress(slides, stableBestTime, animations)).toBe(1);
  });

  it("builds gapless side-name text and keeps the lower title inside its safe region", () => {
    expect(bestEntranceSidePattern("cly", 4)).toBe("clyclyclycly");
    expect(bestEntranceSideScrollDistance(1, 24)).toBe(144);
    const layout = bestEntranceTitleLayout(1920, 4_000, 111);
    expect(layout.fontSize).toBeLessThan(111);
    expect(layout.finalX).toBeLessThan(1920);
    expect(layout.initialX).toBeLessThan(1920);
    expect(layout.maximumTitleWidth).toBeLessThan(1920);

    // MVP 特效主标题：落位在 3/4 处 (1920 * 0.75 = 1440)，随后持续向左平滑慢移
    const posAt0 = bestEntranceTitlePosition(0, 1920, 200);
    const posAtSettle = bestEntranceTitlePosition(0.35, 1920, 200);
    const posAtEnd = bestEntranceTitlePosition(1.0, 1920, 200);
    expect(posAt0).toBeGreaterThan(1920);
    expect(posAtSettle).toBe(1920 * 0.75);
    expect(posAtEnd).toBeLessThan(posAtSettle);
  });

  it("keeps the BEST entrance motion running while the handoff fades out", () => {
    const atEntranceEnd = bestEntranceHandoffProgress(0);
    const atHandoffEnd = bestEntranceHandoffProgress(1);
    expect(atEntranceEnd).toBe(1);
    expect(atHandoffEnd).toBeGreaterThan(atEntranceEnd);
    // 侧边滚动流与主标题在 handoff 期间继续沿同一方向运动，不停顿
    expect(bestEntranceSideScrollDistance(atHandoffEnd, 24)).toBeGreaterThan(
      bestEntranceSideScrollDistance(atEntranceEnd, 24),
    );
    expect(bestEntranceTitlePosition(atHandoffEnd, 1920, 200)).toBeLessThan(
      bestEntranceTitlePosition(atEntranceEnd, 1920, 200),
    );
  });

  it("fades the BEST entrance portrait in before the shared handoff fades it out", () => {
    expect(bestEntranceImageOpacity(0)).toBe(0);
    expect(bestEntranceImageOpacity(.125)).toBeGreaterThan(0);
    expect(bestEntranceImageOpacity(.25)).toBe(1);
  });

  it("uses the opening stages at their exact shared-renderer boundaries", () => {
    expect(showcaseIntroState(0)).toEqual({ stage: "matchInfo", progress: 0 });
    expect(showcaseIntroState(6_000)).toEqual({ stage: "empty", progress: 0 });
    expect(showcaseIntroState(8_000)).toEqual({ stage: "average", progress: 0 });
    expect(showcaseIntroState(10_000)).toEqual({ stage: "reference", progress: 0 });
    expect(showcaseIntroState(12_000)).toEqual({ stage: "reference", progress: 1 });
    expect(showcaseIntroDuration({ showIntroAnimation: true, reduceMotion: true })).toBe(0);
    expect(SHOWCASE_INTRO_AVERAGE_TRANSITION_MS).toBe(300);
    expect(showcaseIntroAverageTransitionProgress(0)).toBe(0);
    expect(showcaseIntroAverageTransitionProgress(0.15)).toBeCloseTo(1);
    expect(showcaseIntroAverageTransitionProgress(0.5)).toBe(1);

    // 自定义阶段时长测试 (删除阶段四后为 4 阶段)
    const customStages = { matchInfo: 1, empty: 1, reference: 1, average: 1 };
    expect(showcaseIntroDuration({ showIntroAnimation: true }, customStages)).toBe(4000);
    expect(showcaseIntroState(0, customStages)).toEqual({ stage: "matchInfo", progress: 0 });
    expect(showcaseIntroState(1000, customStages)).toEqual({ stage: "empty", progress: 0 });

    // 元素 FadeIn 进场与 FadeOut 退场测试 (时长一致)
    expect(showcaseMatchInfoOpacity(0, 6000)).toBe(0);
    expect(showcaseMatchInfoOpacity(800, 6000)).toBe(1);
    expect(showcaseMatchInfoOpacity(3000, 6000)).toBe(1);
    expect(showcaseMatchInfoOpacity(5200, 6000)).toBe(1);
    expect(showcaseMatchInfoOpacity(6000, 6000)).toBe(0);

    // 开场黑屏渐显测试
    expect(showcaseBlackFadeInAlpha(0)).toBe(1);
    expect(showcaseBlackFadeInAlpha(400)).toBeCloseTo(0.5);
    expect(showcaseBlackFadeInAlpha(800)).toBe(0);
    expect(showcaseBlackFadeInAlpha(1200)).toBe(0);

    // 阶段二六项文字 (及 Round Swing) 三步向上生长测试
    expect(metricStepIndex("Rating")).toBe(0);
    expect(metricStepIndex("KPR")).toBe(0);
    expect(metricStepIndex("Multi-Kill")).toBe(1);
    expect(metricStepIndex("Surviving")).toBe(1);
    expect(metricStepIndex("KAST")).toBe(2);
    expect(metricStepIndex("ADR")).toBe(2);
    expect(metricStepIndex("Round Swing")).toBe(2);

    // 步 0 在 30ms 启动 (每步间隔 100ms，生长过渡时长 500ms)
    const step0 = metricGrowthTransform("Rating", 30, 100, 500);
    expect(step0.opacity).toBeGreaterThan(0);
    expect(step0.translateY).toBeLessThan(8);

    // 步 1 在 50ms 尚未启动，但在 200ms 已启动生长
    const step1Before = metricGrowthTransform("Surviving", 50, 100, 500);
    expect(step1Before.opacity).toBe(0);
    const step1After = metricGrowthTransform("Surviving", 200, 100, 500);
    expect(step1After.opacity).toBeGreaterThan(0);
    expect(step1After.opacity).toBeLessThan(1);

    // 步 2 在 150ms 尚未启动，在 300ms 启动生长，在 700ms 完成生长
    const step2Before = metricGrowthTransform("ADR", 150, 100, 500);
    expect(step2Before.opacity).toBe(0);
    const step2After = metricGrowthTransform("ADR", 300, 100, 500);
    expect(step2After.opacity).toBeGreaterThan(0);
    const step2End = metricGrowthTransform("ADR", 700, 100, 500);
    expect(step2End.opacity).toBe(1);
    expect(step2End.translateY).toBe(0);

    // 阶段一内部 Radar + Swing 从 75% 节点平滑展开测试 (无果冻)
    const before75 = showcaseInnerRadarSwingTransform(0.15);
    expect(before75.active).toBe(false);
    expect(before75.scale).toBe(0);

    const after75 = showcaseInnerRadarSwingTransform(0.32);
    expect(after75.active).toBe(true);
    expect(after75.scale).toBeGreaterThan(0);
    expect(after75.scale).toBeLessThanOrEqual(1);

    const later = showcaseInnerRadarSwingTransform(0.75);
    expect(later.active).toBe(true);
    expect(later.scale).toBe(1);
  });

  it("animates the data panel with jelly spring overshoot and decaying oscillations", () => {
    const w = 1920;
    const h = 1080;
    const start = showcaseDataPanelJellyTransform(0, w, h);
    expect(start.width).toBe(0);
    expect(start.height).toBe(0);
    expect(start.x).toBeCloseTo(w * 0.5);
    expect(start.y).toBeCloseTo(h * 0.8);

    // 连贯冲过 1.0 (w * 0.54) 并在 ampW 严格受控下达到第 1 次过冲波峰
    const peak1 = showcaseDataPanelJellyTransform(0.46, w, h);
    expect(peak1.width).toBeGreaterThan(w * 0.54);
    // 严格受限于 ampW (写死 0.05，过冲精准克制)
    expect(peak1.width).toBeLessThanOrEqual(w * 0.54 * 1.055);

    // 回弹波谷
    const valley1 = showcaseDataPanelJellyTransform(0.58, w, h);
    expect(valley1.width).toBeLessThan(w * 0.54);

    // 第 2 次过冲峰值 (振幅递减)
    const peak2 = showcaseDataPanelJellyTransform(0.70, w, h);
    expect(peak2.width).toBeGreaterThan(w * 0.54);
    expect(peak1.width - w * 0.54).toBeGreaterThan(peak2.width - w * 0.54);

    // 最终稳态收敛：水平居中且垂直居中
    const end = showcaseDataPanelJellyTransform(1.0, w, h);
    expect(end.width).toBeCloseTo(w * 0.54, 0);
    expect(end.height).toBeCloseTo(h * 0.93, 0);
    expect(end.x).toBeCloseTo((w - w * 0.54) / 2, 0);
    expect(end.y).toBeCloseTo((h - h * 0.93) / 2, 0);
  });

  it("uses the outer reference values only as the opener scale", () => {
    const reference = showcaseReferenceRadar(radar("reference", [0, 0]));
    expect(reference.radar.values).toEqual([2, 2]);
  });

  it("starts the final opener player radar at the center", () => {
    const source = radar("first", [1, 1.5]);
    source.radar.round_swing = 2.5;
    const zero = showcaseZeroRadar(source);
    expect(zero.radar.values).toEqual([0, 0]);
    expect(zero.radar.round_swing).toBe(0);
  });

  it("averages showcase metrics by dimension name and preserves Rating 3 Swing", () => {
    const first = radar("a", [1, 2]);
    const second = radar("b", [2, 1]);
    first.profiles = { rating_2: first.radar, rating_3: { ...first.radar, dimensions: ["B", "A"], values: [4, 2], round_swing: 2 } };
    second.profiles = { rating_2: second.radar, rating_3: { ...second.radar, dimensions: ["A", "B"], values: [4, 8], round_swing: -1 } };
    const average = showcaseAverageRadar([
      { ...slides[0], radar: first },
      { ...slides[1], radar: second },
    ], "rating_3");
    expect(average?.radar.dimensions).toEqual(["B", "A"]);
    expect(average?.radar.values).toEqual([6, 3]);
    expect(average?.radar.round_swing).toBe(.5);
  });

  it("morphs every radar point into the next player", () => {
    expect(
      interpolateRadarResponse(slides[0].radar, slides[1].radar, 0.5).radar
        .values,
    ).toEqual([1.5, 1.5]);
  });

  it("marks only strict per-metric winners as BEST", () => {
    expect(bestMetricIndexesForSlide(slides, 0)).toEqual([1]);
    expect(bestMetricIndexesForSlide(slides, 1)).toEqual([0]);
    const tied = [slides[0], { ...slides[1], radar: radar("b", [1, 1]) }];
    expect(bestMetricIndexesForSlide(tied, 0)).toEqual([1]);
  });

  it("maps the inspector labels to the corrected canvas alignment", () => {
    expect(showcaseCanvasTextAlign("left")).toBe("right");
    expect(showcaseCanvasTextAlign("right")).toBe("left");
    expect(showcaseCanvasTextAlign("center")).toBe("center");
  });

  it("treats the first visible layer as the top layer", () => {
    expect(showcasePaintOrder(["title", "image", "radar"])).toEqual([
      "radar",
      "image",
      "title",
    ]);
  });

  it("uses the player avatar when no custom showcase image is set", () => {
    expect(showcasePlayerImageUrl({ avatarUrl: "avatar.jpg" })).toBe("avatar.jpg");
    expect(showcasePlayerImageUrl({ imageUrl: "", avatarUrl: "avatar.jpg" })).toBe("avatar.jpg");
    expect(showcasePlayerImageUrl({ imageUrl: "portrait.png", avatarUrl: "avatar.jpg" })).toBe("portrait.png");
  });

  it("migrates the active legacy image transform into one global transform", () => {
    const migrated = stripLegacyDraftFields({
      active: 1,
      fontScale: 1.4,
      layout: { imageScale: 100 },
      slides: [
        { id: "one", imageTransform: { x: 20, y: 30, scale: 80 } },
        { id: "two", imageTransform: { x: 40, y: 50, scale: 130 } },
      ],
    });
    expect(migrated.layout).toMatchObject({ imageX: 40, imageY: 50, imageScale: 130, metricLabelFontSize: 12 });
    expect((migrated.slides as ShowcaseSlide[]).every((slide) => !("imageTransform" in slide))).toBe(true);
    expect(migrated.fontScale).toBeUndefined();
  });

  it("maps audio volume to gain without imposing limits", () => {
    expect(showcaseAudioGain(100)).toBe(1);
    expect(showcaseAudioGain(250)).toBe(2.5);
    expect(showcaseAudioGain(-50)).toBe(-0.5);
    expect(showcaseAudioGain(1_000_000)).toBe(10_000);
  });

  it("slip-drags audio in useful timeline-sized increments", () => {
    expect(audioOffsetFromDrag(0, 20, 96, 4000, -180_000, 3900)).toBe(833);
    expect(audioOffsetFromDrag(0, -240, 960, 40_000, -180_000, 3900)).toBe(-10_000);
    expect(audioOffsetFromDrag(-179_000, -200, 500, 4000, -180_000, 3900)).toBe(-180_000);
    expect(audioOffsetLabel(-12_300)).toBe("从素材 12.3s 播放");
    expect(audioOffsetLabel(1500)).toBe("延后 1.5s 播放");
    expect(timelineTickStep(4_000, 24)).toBe(5_000);
    expect(timelineTickStep(2_658_560, 24)).toBe(5_000);
  });

  it("resizes either edge in timeline units and keeps a usable minimum", () => {
    expect(resizedShowcaseDuration(4, 100, 500, 5000, "end")).toBe(5);
    expect(resizedShowcaseDuration(4, 100, 500, 5000, "start")).toBe(3);
    expect(resizedShowcaseDuration(1, 1000, 500, 5000, "start")).toBe(0.5);
  });

  it("keeps transformed showcase elements inside their natural safe bounds", () => {
    expect(clampShowcaseTransform("radar", { x: 0, y: 0, scale: 100 })).toEqual({ x: 18, y: 32, scale: 100 });
    // 立绘/Logo 的中心点可以拖到画布边缘，不再被尺寸回顶
    expect(clampShowcaseTransform("image", { x: 99, y: 99, scale: 100 })).toEqual({ x: 99, y: 99, scale: 100 });
    expect(clampShowcaseTransform("teamLogo", { x: 3, y: 97, scale: 120 })).toEqual({ x: 3, y: 97, scale: 120 });
    expect(clampShowcaseTransform("radar", { x: 50, y: 50, scale: 220 }).scale).toBeCloseTo(156.25, 1);
  });

  it("enables Rating 3.0 whenever the actual profile is present", () => {
    const response = radar("rated", [1, 2]);
    response.profiles = {
      rating_2: response.radar,
      rating_3: { ...response.radar },
    };
    expect(rating3Available(response)).toBe(true);
    expect(rating3Available(radar("plain", [1, 2]))).toBe(false);
  });
});

describe("Rating 3.0 showcase center floors", () => {
  it("maps the specified Rating 3.0 values to the center by metric name", () => {
    const floors = showcaseRadarFloorValues("rating_3");
    expect(floors).toEqual({
      KPR: 0.42,
      Surviving: 0.157,
      ADR: 47.5,
      KAST: 0.545,
      "Multi-Kill": 0.07,
      Rating: 0.55,
    });
    expect(showcaseRadarFloorValues("rating_2")).toBeUndefined();
  });

  it("keeps values at or below the floor at center and preserves the outer maximum", () => {
    expect(normalizeRadarMetricValue(0.42, 1, 0.42)).toBe(0);
    expect(normalizeRadarMetricValue(0.2, 1, 0.42)).toBe(0);
    expect(normalizeRadarMetricValue(1, 1, 0.42)).toBe(1);
  });

  it("keeps a finite normalization when a custom cap falls below its floor", () => {
    const normalized = normalizeRadarMetricValue(0.545, 0.35, 0.545);
    expect(Number.isFinite(normalized)).toBe(true);
    expect(normalized).toBeGreaterThan(0);
  });
});

describe("Showcase Opener Stage 3 (Reference) and Swing Growth", () => {
  it("enlarges value font scale only in stage 3 reference and keeps 1.0 at other times", () => {
    expect(RADAR_VALUE_FONT_SCALE).toBe(1.3);
    const labelSize = 12;
    // 阶段三：放大 1.3 倍
    const stage3Scale = 1.3;
    expect(labelSize * stage3Scale).toBeCloseTo(15.6, 1);
    // 其余阶段：保持 1.0 正常大小
    const normalScale = 1.0;
    expect(labelSize * normalScale).toBe(12);
  });

  it("grows Round Swing fill smoothly from average to +5% in reference stage without flickering", () => {
    const avgSwing = 1.2;
    const targetSwing = 5.0;

    // 阶段三进入第 0 帧 (progress = 0)
    const p0 = 0;
    const growEase0 = 1 - Math.pow(1 - p0, 3);
    const swingAtStart = avgSwing + (targetSwing - avgSwing) * growEase0;
    // 必须严格等于阶段二均值，无缝过渡，零闪烁
    expect(swingAtStart).toBe(avgSwing);

    // 阶段三生长中途
    const pMid = 0.5;
    const growEaseMid = 1 - Math.pow(1 - pMid, 3);
    const swingAtMid = avgSwing + (targetSwing - avgSwing) * growEaseMid;
    expect(swingAtMid).toBeGreaterThan(avgSwing);
    expect(swingAtMid).toBeLessThan(targetSwing);

    // 阶段三生长完成 (达到 +5%)
    const pEnd = 1.0;
    const growEaseEnd = 1 - Math.pow(1 - pEnd, 3);
    const swingAtEnd = avgSwing + (targetSwing - avgSwing) * growEaseEnd;
    expect(swingAtEnd).toBe(targetSwing);
  });
});

describe("First Player Arrival Phase and Text Scramble", () => {
  it("defines arrival duration as 1000ms", () => {
    expect(FIRST_PLAYER_ARRIVAL_MS).toBe(1000);
  });

  it("decodes text characters progressively with scramble and restores completely at progress 1.0", () => {
    const text = "NiKo";
    // 0 进度：全部为字符
    const s0 = showcaseTextScramble(text, 0, 10);
    expect(s0.length).toBe(4);

    // 0.5 进度：部分解码
    const sMid = showcaseTextScramble(text, 0.5, 15);
    expect(sMid.length).toBe(4);
    // 第一个字符应该已经解码
    expect(sMid.startsWith("N")).toBe(true);

    // 1.0 进度：完全解码还原
    const sEnd = showcaseTextScramble(text, 1.0, 20);
    expect(sEnd).toBe("NiKo");
  });

  it("grows Data Panel directly to the left target position when targetXRatio is 0.018", () => {
    const width = 1920;
    const height = 1080;
    // 首位玩家入场时，startCXRatio=0.1, startCYRatio=0.5, targetXRatio=0.018
    const rectAt0 = showcaseDataPanelJellyTransform(0, width, height, undefined, 0.1, 0.5, 0.018);
    expect(rectAt0.x + rectAt0.width / 2).toBeCloseTo(width * 0.1, 1);
    expect(rectAt0.y + rectAt0.height / 2).toBeCloseTo(height * 0.5, 1);
    expect(rectAt0.width).toBe(0);
    expect(rectAt0.height).toBe(0);

    // 结束时完全就位在左侧 (x = width * 0.018)
    const rectAt1 = showcaseDataPanelJellyTransform(1, width, height, undefined, 0.1, 0.5, 0.018);
    expect(rectAt1.x).toBeCloseTo(width * 0.018, 1);
    expect(rectAt1.y + rectAt1.height / 2).toBeCloseTo(height * 0.5, 1);
    expect(rectAt1.width).toBeCloseTo(width * 0.54, 1);
    expect(rectAt1.height).toBeCloseTo(height * 0.93, 1);
  });

  it("sequences subtitle after avatar settles, and title after subtitle settles", () => {
    // 玩家头像 700ms 就位
    expect(FIRST_PLAYER_PANEL_MS).toBe(700);
    // 副标题等头像就位后 (700ms) 启动
    expect(FIRST_PLAYER_SUBTITLE_START_MS).toBe(700);
    // 标题等副标题就位后 (1100ms) 启动
    expect(FIRST_PLAYER_TITLE_START_MS).toBe(1100);
    expect(FIRST_PLAYER_TITLE_START_MS).toBeGreaterThan(FIRST_PLAYER_SUBTITLE_START_MS);
  });

  it("measures text selection bounds adapting strictly to measured text width", () => {
    const layout = {
      radarX: 34, radarY: 55, radarScale: 100,
      nameX: 73, nameY: 20, nameScale: 100,
      titleX: 73, titleY: 20, titleScale: 100,
      subtitleX: 73, subtitleY: 24.5, subtitleScale: 100,
      imageX: 73, imageY: 57, imageScale: 100,
      metricLabelFontSize: 12, swingX: 34, swingY: 78, swingScale: 100,
      opacity: 100, layers: ["radar", "image", "name"],
      nameAlign: "left" as const, imageFit: "contain" as const,
    };
    const transform = { x: 50, y: 50, scale: 100 };
    // 当文本较短 (宽 100px)
    const shortBounds = selectionBounds("title", transform, 1920, 1080, layout, 5, 100);
    // 当文本较长 (宽 300px)
    const longBounds = selectionBounds("title", transform, 1920, 1080, layout, 5, 300);
    expect(longBounds.right - longBounds.left).toBeGreaterThan(shortBounds.right - shortBounds.left);
  });
});

const baseShowcaseLayout = (overrides: Partial<ShowcaseLayoutDraft> = {}): ShowcaseLayoutDraft => ({
  radarX: 34, radarY: 55, radarScale: 100,
  nameX: 73, nameY: 20, nameScale: 100,
  titleX: 73, titleY: 20, titleScale: 100,
  subtitleX: 73, subtitleY: 24.5, subtitleScale: 100,
  imageX: 73, imageY: 57, imageScale: 100,
  metricLabelFontSize: 12, swingX: 34, swingY: 78, swingScale: 100,
  opacity: 100, layers: ["radar", "image", "name"],
  nameAlign: "left", imageFit: "contain",
  ...overrides,
});

describe("showcase title and subtitle font scaling", () => {
  it("authorises type in 1920 design space and scales it by the backing canvas", () => {
    const scaled = 1280 / SHOWCASE_EXPORT_WIDTH;
    expect(showcaseTitleFontSize(baseShowcaseLayout(), 1)).toBeCloseTo(SHOWCASE_TITLE_FONT_SIZE, 5);
    expect(showcaseTitleFontSize(baseShowcaseLayout(), scaled)).toBeCloseTo(SHOWCASE_TITLE_FONT_SIZE * scaled, 5);
    expect(showcaseTitleFontSize(baseShowcaseLayout({ titleFontSize: 38 }), 1)).toBeCloseTo(38, 5);
    expect(showcaseTitleFontSize(baseShowcaseLayout({ titleFontSize: 38 }), scaled)).toBeCloseTo(38 * scaled, 5);

    const style = showcaseTitleTextStyle(baseShowcaseLayout({ titleColor: "#abcdef" }), scaled);
    expect(style.fontSize).toBeCloseTo(SHOWCASE_TITLE_FONT_SIZE * scaled, 5);
    expect(style.color).toBe("#abcdef");
    expect(style.font).toBe(`800 ${style.fontSize}px "Noto Sans SC",system-ui`);
  });

  it("keeps the subtitle glow proportional to its scaled font size", () => {
    const full = showcaseSubtitleTextStyle(baseShowcaseLayout({ subtitleItalic: true }), 1);
    expect(full.fontSize).toBeCloseTo(SHOWCASE_SUBTITLE_FONT_SIZE, 5);
    expect(full.glowOuter).toBeCloseTo(SHOWCASE_SUBTITLE_GLOW_OUTER, 5);
    expect(full.font).toContain("italic");
    expect(full.font).toContain("750");
    expect(full.color).toBe("#ffd700");

    const half = showcaseSubtitleTextStyle(baseShowcaseLayout({ subtitleItalic: true }), 0.5);
    expect(half.fontSize).toBeCloseTo(SHOWCASE_SUBTITLE_FONT_SIZE * 0.5, 5);
    expect(half.glowOuter).toBeCloseTo(SHOWCASE_SUBTITLE_GLOW_OUTER * 0.5, 5);
    expect(showcaseSubtitleTextStyle(baseShowcaseLayout({ subtitleBold: false }), 1).font).toContain("500");
  });

  it("keeps title selection bounds proportionally identical across preview sizes", () => {
    const transform = { x: 50, y: 50, scale: 100 };
    const layout = baseShowcaseLayout();
    const big = selectionBounds("title", transform, SHOWCASE_EXPORT_WIDTH, SHOWCASE_EXPORT_HEIGHT, layout, 0, 800);
    const smallWidth = 1280;
    const smallHeight = 720;
    const small = selectionBounds(
      "title",
      transform,
      smallWidth,
      smallHeight,
      layout,
      0,
      800 * (smallWidth / SHOWCASE_EXPORT_WIDTH),
    );
    // 选框坐标是百分比单位：同一标题在两个预览尺寸下换算后偏差应小于 0.2%
    expect(Math.abs((small.right - small.left) - (big.right - big.left))).toBeLessThan(0.2);
    expect(Math.abs((small.bottom - small.top) - (big.bottom - big.top))).toBeLessThan(0.2);
  });
});

describe("single source of truth for the player image transform", () => {
  it("reads one global position and scale for every player", () => {
    const layout = baseShowcaseLayout({ imageX: 60, imageY: 40, imageScale: 120 });
    expect(resolveImageTransform(layout)).toEqual({ x: 60, y: 40, scale: 120 });
    expect(resolveImageTransform(baseShowcaseLayout())).toEqual({ x: 73, y: 57, scale: 100 });
  });

  it("derives the drawn image box from the layout scale", () => {
    const small = showcaseImageBox(baseShowcaseLayout({ imageScale: 50 }), 1920, 1080);
    const full = showcaseImageBox(baseShowcaseLayout({ imageScale: 100 }), 1920, 1080);
    expect(full.boxW).toBeCloseTo(1920 * 0.36, 5);
    expect(full.boxH).toBeCloseTo(1080 * 0.66, 5);
    expect(small.boxW).toBeCloseTo(full.boxW / 2, 5);
    expect(small.boxH).toBeCloseTo(full.boxH / 2, 5);
  });

  it("fits the team logo into one box that the selection outline also uses", () => {
    const wide = showcaseTeamLogoSize(1920, 1080, 100, { width: 600, height: 300 });
    expect(wide.width).toBeCloseTo(1080 * 0.14, 5);
    expect(wide.height).toBeCloseTo(1080 * 0.07, 5);
    const doubled = showcaseTeamLogoSize(1920, 1080, 200, { width: 600, height: 300 });
    expect(doubled.width).toBeCloseTo(wide.width * 2, 5);
    // 预览 backing canvas 缩小后，换算成百分比必须一致
    const preview = showcaseTeamLogoSize(960, 540, 100, { width: 600, height: 300 });
    expect((preview.width / 960) * 100).toBeCloseTo((wide.width / 1920) * 100, 5);
    expect((preview.height / 540) * 100).toBeCloseTo((wide.height / 1080) * 100, 5);
  });

  it("leaves the team logo scale uncapped while the player image keeps its cap", () => {
    expect(clampShowcaseTransform("teamLogo", { x: 28.7, y: 50.2, scale: 900 }))
      .toEqual({ x: 28.7, y: 50.2, scale: 900 });
    expect(clampShowcaseTransform("image", { x: 50, y: 50, scale: 900 }).scale).toBe(SHOWCASE_IMAGE_SCALE_MAX);
    // 比画布还大的 Logo 只约束中心点，不能被推到画布外
    const huge = clampShowcaseTransform("teamLogo", { x: 120, y: -20, scale: 1000 });
    expect(huge.x).toBe(100);
    expect(huge.y).toBe(0);
  });

  it("repairs legacy image scales and removes the per-slide transform", () => {
    // 旧版把比例写在每张幻灯片上（1.8 = 180%），迁移时按 ×100 还原并限幅
    const draft = {
      active: 0,
      layout: { imageScale: 0.3 },
      slides: [{ imageTransform: { x: 11, y: 22, scale: 1.8 } }],
    };
    const repaired = stripLegacyDraftFields(draft);
    const layout = repaired.layout as ShowcaseLayoutDraft;
    const slides = repaired.slides as ShowcaseSlide[];
    expect(layout).toMatchObject({ imageX: 11, imageY: 22, imageScale: 180 });
    expect("imageTransform" in slides[0]).toBe(false);

    const layoutOnly = stripLegacyDraftFields({ active: 0, layout: { imageScale: 0.3 }, slides: [{}] });
    expect((layoutOnly.layout as ShowcaseLayoutDraft).imageScale).toBe(SHOWCASE_IMAGE_SCALE_MIN);

    const tooBig = stripLegacyDraftFields({ active: 0, layout: { imageScale: 400 }, slides: [{}] });
    expect((tooBig.layout as ShowcaseLayoutDraft).imageScale).toBe(SHOWCASE_IMAGE_SCALE_MAX);

    const missing = stripLegacyDraftFields({ active: 0, layout: {}, slides: [{}] });
    expect((missing.layout as ShowcaseLayoutDraft).imageScale).toBe(100);
  });

  it("defaults the layer stack to every canvas element in top-to-bottom order", () => {
    expect(showcaseDefaultLayers("rating_3")).toEqual([
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
    ]);
    expect(showcaseDefaultLayers("rating_2")).toEqual([
      "radar",
      "image",
      "teamLogo",
      "subtitle",
      "title",
      "panel",
      "particles",
      "background",
    ]);
  });

  it("normalizes missing layers while keeping the user's ordering", () => {
    expect(
      normalizeShowcaseLayers(["radar", "image"], "rating_3"),
    ).toEqual([
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
    ]);
    expect(
      normalizeShowcaseLayers(
        ["watermark", "title", "radar", "unknown", "radar", "image"],
        "rating_3",
      ),
    ).toEqual([
      "watermark",
      "teamLogo",
      "subtitle",
      "title",
      "radar",
      "swing",
      "image",
      "panel",
      "particles",
      "background",
    ]);
    expect(normalizeShowcaseLayers(undefined, "rating_2")).not.toContain(
      "swing",
    );
    expect(normalizeShowcaseLayers(undefined, "rating_2")).not.toContain(
      "watermark",
    );
  });

  it("adds the missing teamLogo layer so uploaded logos render immediately", () => {
    const draft = stripLegacyDraftFields({
      active: 0,
      layout: { layers: ["radar", "image", "name"] },
      slides: [{}],
    });
    const layers = (draft.layout as ShowcaseLayoutDraft).layers!;
    expect(layers).toEqual([
      "watermark",
      "radar",
      "image",
      "teamLogo",
      "subtitle",
      "title",
      "panel",
      "particles",
      "background",
    ]);

    const withLogo = stripLegacyDraftFields({
      active: 0,
      layout: { layers: ["radar", "teamLogo", "name"] },
      slides: [{}],
    });
    expect((withLogo.layout as ShowcaseLayoutDraft).layers).toEqual([
      "watermark",
      "radar",
      "image",
      "teamLogo",
      "subtitle",
      "title",
      "panel",
      "particles",
      "background",
    ]);
  });
});

const textMeasurer = () => ({
  font: "",
  measureText(text: string) {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 12);
    return { width: text.length * size * 0.55 };
  },
});
const labelBoundsFor = (width: number, height: number) => ({
  left: 0,
  right: width,
  top: 0,
  bottom: height,
});

describe("BEST radar label layout", () => {
  it("enlarges the BEST value, keeps best at 2/3 size and applies the reference multiplier", () => {
    const measurer = textMeasurer();
    const props = { metricLabelFontSize: 12 };
    const normal = radarMetricLabelLayout(measurer, props, 300, "Rating", 1.3, "number", false, labelBoundsFor(300, 200));
    const best = radarMetricLabelLayout(measurer, props, 300, "Rating", 1.3, "number", true, labelBoundsFor(300, 200));
    expect(normal.valueSize).toBeCloseTo(12, 5);
    expect(best.valueSize).toBeCloseTo(12 * BEST_VALUE_FONT_SCALE, 5);
    expect(best.bestWordSize).toBeCloseTo(best.valueSize * BEST_WORD_FONT_SCALE, 5);
    expect(best.glowRadius).toBeCloseTo(best.valueSize * RADAR_BEST_GLOW_RADIUS, 5);
    expect(normal.glowRadius).toBe(0);
    expect(best.radialPush).toBeCloseTo(normal.radialPush * RADAR_BEST_RADIAL_PUSH, 5);

    const reference = radarMetricLabelLayout(
      measurer,
      { metricLabelFontSize: 12, showReferenceLabels: true },
      300,
      "Rating",
      1.3,
      "number",
      true,
      labelBoundsFor(300, 200),
    );
    expect(reference.valueSize).toBeCloseTo(12 * RADAR_VALUE_FONT_SCALE * BEST_VALUE_FONT_SCALE, 5);
  });

  it("reserves a taller footprint for BEST so the label never covers the vertex", () => {
    const measurer = textMeasurer();
    const props = { metricLabelFontSize: 12 };
    const bounds = labelBoundsFor(300, 200);
    const normal = radarMetricLabelLayout(measurer, props, 300, "Rating", 1.3, "number", false, bounds).footprint;
    const best = radarMetricLabelLayout(measurer, props, 300, "Rating", 1.3, "number", true, bounds).footprint;
    expect(best.bottom - best.top).toBeGreaterThan(normal.bottom - normal.top);
    expect(best.halfWidth).toBeGreaterThan(normal.halfWidth);
  });

  it("shrinks only the BEST block when the axis safe region is too short", () => {
    const measurer = textMeasurer();
    const props = { metricLabelFontSize: 24 };
    const roomy = radarMetricLabelLayout(measurer, props, 300, "Rating", 1.3, "number", true, labelBoundsFor(300, 400));
    const tight = radarMetricLabelLayout(measurer, props, 300, "Rating", 1.3, "number", true, {
      left: 0, right: 300, top: 0, bottom: 60,
    });
    expect(tight.valueSize).toBeLessThan(roomy.valueSize);
    expect(tight.glowRadius).toBeLessThan(roomy.glowRadius);
    // 指标名始终保持用户设定的全局字号，绝不与数值一起被压小
    expect(tight.labelSize).toBeCloseTo(roomy.labelSize, 5);
    expect(tight.footprint.bottom - tight.footprint.top).toBeLessThan(roomy.footprint.bottom - roomy.footprint.top);
  });

  it("draws BEST values and the best word with the bundled display font", () => {
    expect(radarDisplayFont(20)).toContain('italic 900 20px "Playfair Display"');
    expect(radarValueFont(20, true)).toBe(radarDisplayFont(20));
    expect(radarValueFont(20, false)).toBe('750 20px "Noto Sans SC", system-ui');
  });

  it("keeps the Chinese alias row fully below the metric name", () => {
    const measurer = textMeasurer();
    const layout = radarMetricLabelLayout(measurer, { metricLabelFontSize: 12 }, 300, "Rating", 1.3, "number", false, labelBoundsFor(300, 200));
    // 别名中心在名字基线之下时，其顶边仍低于名字底边，两者绝不重叠
    expect(layout.aliasOffsetY - layout.aliasSize / 2).toBeGreaterThanOrEqual(layout.labelSize / 2);
    expect(layout.aliasOffsetY).toBeGreaterThan(layout.line * 0.55);
  });

  it("interpolates the BEST styling by amount instead of switching it abruptly", () => {
    const measurer = textMeasurer();
    const props = { metricLabelFontSize: 12 };
    const normal = radarMetricLabelLayout(measurer, props, 300, "Rating", 1.3, "number", 0, labelBoundsFor(300, 200));
    const half = radarMetricLabelLayout(measurer, props, 300, "Rating", 1.3, "number", 0.5, labelBoundsFor(300, 200));
    const best = radarMetricLabelLayout(measurer, props, 300, "Rating", 1.3, "number", 1, labelBoundsFor(300, 200));
    expect(half.bestAmount).toBeCloseTo(0.5, 5);
    expect(half.valueSize).toBeGreaterThan(normal.valueSize);
    expect(half.valueSize).toBeLessThan(best.valueSize);
    expect(half.glowRadius).toBeCloseTo(half.valueSize * RADAR_BEST_GLOW_RADIUS * 0.5, 5);
    expect(half.radialPush).toBeGreaterThan(normal.radialPush);
    expect(half.radialPush).toBeLessThan(best.radialPush);
  });

  it("fades BEST styling out and in continuously across a player transition", () => {
    expect(showcaseBestAmounts([0, 2], [0, 1], 0.4, 3)).toEqual([1, 1 - 0.4, 0.4]);
    expect(showcaseBestAmounts([1], [], 0, 2)).toEqual([0, 0]);
    expect(showcaseBestAmounts([1], [], 1, 2)).toEqual([0, 1]);
    expect(showcaseBestAmounts([], [1], 1, 2)).toEqual([0, 0]);
  });

  it("clips the label safe region to the Data Panel only when the radar sits inside it", () => {
    const panel = { x: 34.56, y: 37.8, width: 1036.8, height: 1004.4 };
    const inside = showcaseRadarLabelRegion(panel, { x: -33, y: -33, size: 934 });
    expect(inside).not.toBeUndefined();
    expect(inside!.top).toBeCloseTo(panel.y + 33, 5);
    expect(inside!.right).toBeCloseTo(panel.x + panel.width + 33, 5);
    // 雷达大半在面板外时不做裁剪，保持原布局
    expect(showcaseRadarLabelRegion(panel, { x: 900, y: 500, size: 500 })).toBeUndefined();
  });
});

describe("radar polygon glow and fill", () => {
  it("stacks blurred glow layers outside a crisp 2.2x reference stroke", () => {
    const layers = radarPolygonGlowLayers(4, 1200, true);
    expect(layers).toHaveLength(3);
    expect(layers[0].width).toBeGreaterThan(layers[1].width);
    expect(layers[1].width).toBeGreaterThan(layers[2].width);
    expect(layers[2].width).toBeCloseTo(4 * RADAR_POLYGON_GLOW_INNER_SCALE, 5);
    expect(layers[2].alpha).toBeCloseTo(RADAR_POLYGON_GLOW_INNER_ALPHA, 5);
    expect(layers[2].blur).toBeNull();
    expect(layers[0].blur).toBeGreaterThan(0);
    expect(layers[1].blur).toBeGreaterThan(0);
  });

  it("falls back to stacked alpha strokes when canvas filters are unavailable", () => {
    const layers = radarPolygonGlowLayers(4, 1200, false);
    expect(layers).toHaveLength(3);
    expect(layers.every((layer) => layer.blur === null)).toBe(true);
    expect(layers[2].width).toBeCloseTo(4 * RADAR_POLYGON_GLOW_INNER_SCALE, 5);
  });

  it("keeps the average radar unfilled and restores the single-player fill", () => {
    expect(radarPolygonFillOpacity({ average: true, playerCount: 3, focused: true })).toBe(0);
    expect(radarPolygonFillOpacity({ average: false, playerCount: 1, focused: false })).toBeCloseTo(RADAR_SINGLE_PLAYER_FILL_OPACITY, 5);
    expect(radarPolygonFillOpacity({ average: false, playerCount: 2, focused: true })).toBeCloseTo(RADAR_MULTI_FOCUSED_FILL_OPACITY, 5);
    expect(radarPolygonFillOpacity({ average: false, playerCount: 2, focused: false })).toBeCloseTo(RADAR_MULTI_FILL_OPACITY, 5);
    expect(radarPolygonFillOpacity({ average: false, playerCount: 1, focused: false }, 0)).toBe(0);
  });
});

describe("single source of truth for the team logo transform", () => {
  it("resolves team logo position from the slide and scale from slide/layout", () => {
    const layout = baseShowcaseLayout({ teamLogoX: 68, teamLogoY: 50, teamLogoScale: 120 });
    expect(resolveTeamLogoTransform(layout, { teamLogoTransform: { x: 15, y: 25, scale: 150 } }))
      .toEqual({ x: 15, y: 25, scale: 150 });
    expect(resolveTeamLogoTransform(layout, null)).toEqual({ x: 68, y: 50, scale: 120 });
    expect(resolveTeamLogoTransform(baseShowcaseLayout(), undefined)).toEqual({ x: 68, y: 50, scale: 100 });
  });
});
