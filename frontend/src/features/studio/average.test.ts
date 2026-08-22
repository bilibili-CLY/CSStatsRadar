import { describe, expect, it } from "vitest";
import type { OverlayEntry, RadarResponse, ShowcaseSlide } from "../../types";
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
  SHOWCASE_TRANSITION_MS,
  settledShowcasePreviewTime,
  showcaseCanvasTextAlign,
  showcaseDuration,
  showcaseIntroDuration,
  showcaseIntroState,
  showcaseReferenceRadar,
  showcaseZeroRadar,
  showcasePaintOrder,
  showcaseSegment,
  showcaseSlideStart,
  showcaseOuterRadarRingDiameter,
  showcaseSwingCanvasWidth,
  showcaseSwingReferenceHalfWidth,
  showcaseTransitionProgress,
  timelineTickStep,
} from "./showcaseMath";
import {
  selectRatingProfile,
  radarLabelSafeDistance,
  roundSwingBarDistance,
  roundSwingBarRadii,
  roundSwingTrackHeight,
  roundSwingOverflowLimit,
  visibleRadarPointDistance,
} from "../../components/RadarCanvas";
import {
  bestEntranceSidePattern,
  bestEntranceSideScrollDistance,
  bestEntranceImageOpacity,
  bestEntranceTitleLayout,
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
  });

  it("fades the BEST entrance portrait in before the shared handoff fades it out", () => {
    expect(bestEntranceImageOpacity(0)).toBe(0);
    expect(bestEntranceImageOpacity(.125)).toBeGreaterThan(0);
    expect(bestEntranceImageOpacity(.25)).toBe(1);
  });

  it("uses the four opening stages at their exact shared-renderer boundaries", () => {
    expect(showcaseIntroState(0)).toEqual({ stage: "empty", progress: 0 });
    expect(showcaseIntroState(2_000)).toEqual({ stage: "reference", progress: 0 });
    expect(showcaseIntroState(4_000)).toEqual({ stage: "average", progress: 0 });
    expect(showcaseIntroState(6_000)).toEqual({ stage: "outro", progress: 0 });
    expect(showcaseIntroState(8_000)).toEqual({ stage: "outro", progress: 1 });
    expect(showcaseIntroDuration({ showIntroAnimation: true, reduceMotion: true })).toBe(0);
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
    expect(showcasePaintOrder(["name", "image", "radar"])).toEqual([
      "radar",
      "image",
      "name",
    ]);
  });

  it("uses the player avatar when no custom showcase image is set", () => {
    expect(showcasePlayerImageUrl({ avatarUrl: "avatar.jpg" })).toBe("avatar.jpg");
    expect(showcasePlayerImageUrl({ imageUrl: "", avatarUrl: "avatar.jpg" })).toBe("avatar.jpg");
    expect(showcasePlayerImageUrl({ imageUrl: "portrait.png", avatarUrl: "avatar.jpg" })).toBe("portrait.png");
  });

  it("migrates old per-slide image scaling into one global scale", () => {
    const migrated = stripLegacyDraftFields({
      active: 1,
      fontScale: 1.4,
      layout: { imageScale: 100 },
      slides: [
        { id: "one", imageTransform: { x: 20, y: 30, scale: 80 } },
        { id: "two", imageTransform: { x: 40, y: 50, scale: 130 } },
      ],
    });
    expect((migrated.layout as { imageScale: number; metricLabelFontSize: number }).imageScale).toBe(130);
    expect((migrated.layout as { metricLabelFontSize: number }).metricLabelFontSize).toBe(12);
    expect((migrated.slides as ShowcaseSlide[]).map((slide) => slide.imageTransform)).toEqual([
      { x: 20, y: 30 },
      { x: 40, y: 50 },
    ]);
    expect(migrated.fontScale).toBeUndefined();
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
    expect(clampShowcaseTransform("image", { x: 99, y: 99, scale: 100 })).toEqual({ x: 90, y: 82, scale: 100 });
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
