import { describe, expect, it } from "vitest";
import type { OverlayEntry, RadarResponse } from "../../types";
import {
  appendOverlayEntry,
  audioOffsetFromTrackPosition,
  averageRadar,
  bestMetricIndexesForSlide,
  interpolateRadarResponse,
  showcaseCanvasTextAlign,
  showcaseDuration,
  showcasePaintOrder,
  showcaseSegment,
  showcaseSlideStart,
  settledShowcasePreviewTime,
  type ShowcaseSlide,
} from "./StudioView";

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
  it("uses the full queue even when an entry is hidden", () => {
    const entries: OverlayEntry[] = [
      { id: "a", radar: radar("a", [1, 2]), visible: true, color: "#fff" },
      { id: "b", radar: radar("b", [2, 1]), visible: false, color: "#000" },
    ];
    expect(averageRadar(entries)?.radar.values).toEqual([1.5, 1.5]);
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

  it("maps the draggable music guide around a zero-offset center", () => {
    expect(audioOffsetFromTrackPosition(50, 0, 100, 4000)).toBe(0);
    expect(audioOffsetFromTrackPosition(75, 0, 100, 4000)).toBe(2000);
    expect(audioOffsetFromTrackPosition(-50, 0, 100, 4000)).toBe(-4000);
  });
});
