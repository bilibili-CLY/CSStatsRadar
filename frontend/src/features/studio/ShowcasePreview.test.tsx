// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RadarResponse, ShowcaseLayoutDraft, ShowcaseSlide } from "../../types";
import { ShowcasePreview } from "./ShowcasePreview";
import {
  resolveImageTransform,
  resolveTeamLogoTransform,
  type ShowcaseTarget,
  type ShowcaseTransform,
} from "./showcaseMath";

const { ensureFonts, loadImage, renderFrame, selectTarget, transformPreview } = vi.hoisted(() => ({
  ensureFonts: vi.fn(),
  loadImage: vi.fn(),
  renderFrame: vi.fn(),
  selectTarget: vi.fn(),
  transformPreview: vi.fn(),
}));

vi.mock("./showcaseRender", () => ({
  drawShowcaseSelection: vi.fn(),
  ensureShowcaseFonts: ensureFonts,
  loadImage,
  retainShowcaseImages: vi.fn(),
  renderShowcaseFrame: renderFrame,
  showcasePlayerImageUrl: (slide: ShowcaseSlide) => slide.imageUrl ?? slide.avatarUrl,
  imageWidth: (image: { width: number }) => image.width,
  imageHeight: (image: { height: number }) => image.height,
  showcaseImageCache: new Map(),
}));

const radar: RadarResponse = {
  player: { name: "Player", steam_id: "1" },
  match_count: 1,
  radar: {
    dimensions: ["A", "B"],
    values: [1, 1],
    display_types: ["number", "number"],
    max_values: [2, 2],
    round_swing: 1,
    note: "",
    metrics: [],
  },
};

const initialLayout: ShowcaseLayoutDraft = {
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
  teamLogoX: 68,
  teamLogoY: 50,
  teamLogoScale: 100,
  metricLabelFontSize: 12,
  swingX: 34,
  swingY: 78,
  swingScale: 100,
  opacity: 100,
  layers: [],
  nameAlign: "center",
  imageFit: "contain",
};

const initialTransforms: Record<ShowcaseTarget, ShowcaseTransform> = {
  radar: { x: 34, y: 55, scale: 100 },
  title: { x: 73, y: 20, scale: 100 },
  subtitle: { x: 73, y: 24.5, scale: 100 },
  image: { x: 73, y: 57, scale: 100 },
  swing: { x: 34, y: 78, scale: 100 },
  teamLogo: { x: 68, y: 50, scale: 100 },
};

function Harness({ target }: { target: ShowcaseTarget }) {
  const [layout, setLayout] = useState(initialLayout);
  const [slides, setSlides] = useState<ShowcaseSlide[]>([{
    id: "slide",
    radar,
    title: "Player",
    subtitle: "#1",
    duration: 4,
    color: "#22d3ee",
    imageUrl: target === "image" ? "data:image/png;base64,image" : undefined,
    teamLogoUrl: target === "teamLogo" ? "data:image/png;base64,logo" : undefined,
  }]);
  const patchTeamLogoTransform = (transform: ShowcaseTransform) => {
    setSlides((current) => current.map((slide, index) => index === 0
      ? { ...slide, teamLogoTransform: transform }
      : slide));
    setLayout((current) => ({
      ...current,
      teamLogoX: transform.x,
      teamLogoY: transform.y,
      teamLogoScale: transform.scale,
    }));
  };
  return (
    <ShowcasePreview
      slides={slides}
      layout={layout}
      timeMs={13000}
      playing={false}
      showBestMarkers
      radarScaleMode="global"
      radarScale={1}
      ratingVersion="rating_3"
      showRatingWatermark
      metricLabelFontSize={12}
      animations={{ showIntroAnimation: false, showBestEntranceAnimation: false }}
      onLayoutChange={setLayout}
      onImageTransformChange={(transform) =>
        setLayout((current) => ({
          ...current,
          imageX: transform.x,
          imageY: transform.y,
          imageScale: transform.scale,
        }))
      }
      onTeamLogoTransformChange={patchTeamLogoTransform}
      onSelectTarget={selectTarget}
      onTransformPreview={transformPreview}
    />
  );
}

function frameTransform(call: any[], target: ShowcaseTarget): ShowcaseTransform {
  const slides = call[0] as ShowcaseSlide[];
  const layout = call[1] as ShowcaseLayoutDraft;
  const animations = call[14];
  if (target === "image") return resolveImageTransform(layout);
  if (target === "teamLogo")
    return animations.pendingTeamLogoTransform?.transform ?? resolveTeamLogoTransform(layout, slides[0]);
  const keys = {
    radar: ["radarX", "radarY", "radarScale"],
    swing: ["swingX", "swingY", "swingScale"],
    title: ["titleX", "titleY", "titleScale"],
    subtitle: ["subtitleX", "subtitleY", "subtitleScale"],
  }[target] as ["radarX" | "swingX" | "titleX" | "subtitleX", "radarY" | "swingY" | "titleY" | "subtitleY", "radarScale" | "swingScale" | "titleScale" | "subtitleScale"];
  return { x: layout[keys[0]], y: layout[keys[1]], scale: layout[keys[2]] };
}

beforeEach(() => {
  renderFrame.mockReset();
  selectTarget.mockReset();
  transformPreview.mockReset();
  ensureFonts.mockResolvedValue(undefined);
  loadImage.mockResolvedValue(null);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 960, 540));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    save: vi.fn(),
    restore: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 10 }),
  } as any);
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("showcase element drag commit", () => {
  it.each<ShowcaseTarget>(["radar", "swing", "title", "subtitle", "image", "teamLogo"])(
    "never redraws the old %s transform after pointer up",
    async (target) => {
      const view = render(<Harness target={target} />);
      const canvas = view.getByRole("img");
      await waitFor(() => expect(renderFrame).toHaveBeenCalled());
      const initial = initialTransforms[target];
      const pointer = (type: string, x: number, y: number) => {
        const event = new MouseEvent(type, {
          bubbles: true,
          clientX: 960 * x / 100,
          clientY: 540 * y / 100,
        });
        Object.defineProperty(event, "pointerId", { value: 1 });
        return event;
      };
      fireEvent(canvas, pointer("pointerdown", initial.x, initial.y));
      expect(selectTarget).toHaveBeenLastCalledWith(target);
      fireEvent(canvas, pointer("pointermove", 55, 40));
      expect(frameTransform(renderFrame.mock.calls.at(-1)!, target)).toEqual({ x: 55, y: 40, scale: 100 });
      const firstReleaseFrame = renderFrame.mock.calls.length;
      fireEvent(canvas, pointer("pointerup", 55, 40));
      const releaseFrames = renderFrame.mock.calls.slice(firstReleaseFrame);
      expect(releaseFrames.length).toBeGreaterThan(0);
      expect(releaseFrames.map((call) => frameTransform(call, target))).toEqual(
        releaseFrames.map(() => ({ x: 55, y: 40, scale: 100 })),
      );
      const settled = frameTransform(renderFrame.mock.calls.at(-1)!, target);
      expect(settled).toEqual({ x: 55, y: 40, scale: 100 });
    },
  );
});
