import { describe, expect, it } from "vitest";
import type { OverlayEntry, RadarResponse } from "../../types";
import {
  appendOverlayEntry,
  audioOffsetFromDrag,
  audioOffsetLabel,
  timelineTickStep,
  averageRadar,
  bestMetricIndexesForSlide,
  interpolateRadarResponse,
  clampShowcaseTransform,
  rating3Available,
  resizedShowcaseDuration,
  showcaseCanvasTextAlign,
  showcaseDuration,
  showcasePaintOrder,
  showcaseSegment,
  showcaseSlideStart,
  showcaseTransitionProgress,
  settledShowcasePreviewTime,
  type ShowcaseSlide,
} from "./StudioView";
import {
  selectRatingProfile,
  visibleRadarPointDistance,
} from "../../components/RadarCanvas";

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
    expect(showcaseSegment(slides, 1999)).toEqual({ index: 0, offsetMs: 1999 });
    expect(showcaseSegment(slides, 2000)).toEqual({ index: 1, offsetMs: 0 });
    expect(settledShowcasePreviewTime(slides, 0)).toBe(1000);
    expect(settledShowcasePreviewTime(slides, 2000)).toBe(3000);
  });

  it("morphs radar points for one second at every player boundary", () => {
    expect(showcaseTransitionProgress(slides, 2000)).toBe(0);
    expect(showcaseTransitionProgress(slides, 2500)).toBe(0.5);
    expect(showcaseTransitionProgress(slides, 3000)).toBe(1);
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
