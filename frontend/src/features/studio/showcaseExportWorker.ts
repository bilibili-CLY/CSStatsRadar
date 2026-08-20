import {
  ensureShowcaseFonts,
  loadImage,
  renderShowcaseFrame,
} from "./showcaseRender";
import type {
  RatingVersion,
  ShowcaseLayoutDraft,
  ShowcaseSlide,
} from "../../types";

type ExportConfig = {
  slides: ShowcaseSlide[];
  layout: ShowcaseLayoutDraft;
  width: number;
  height: number;
  fps: number;
  showBestMarkers: boolean;
  radarScaleMode: string;
  radarScale: number;
  radarAxisScale: Record<string, number> | undefined;
  ratingVersion: RatingVersion;
  showRatingWatermark: boolean;
  fontScale: number;
};

type WorkerMessage =
  | { type: "init"; config: ExportConfig; imageUrls: string[] }
  | { type: "render"; start: number; count: number }
  | { type: "cancel" };

type WorkerResponse =
  | { type: "ready" }
  | { type: "frames"; start: number; blobs: Blob[] }
  | { type: "error"; message: string }
  | { type: "cancelled" };

let config: ExportConfig | null = null;
let cancelled = false;

function post(message: WorkerResponse) {
  (self as unknown as { postMessage(m: WorkerResponse): void }).postMessage(
    message,
  );
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    config = message.config;
    cancelled = false;
    void (async () => {
      try {
        await ensureShowcaseFonts();
        await Promise.all(
          message.imageUrls.map((url) => loadImage(url).catch(() => undefined)),
        );
        post({ type: "ready" });
      } catch (value) {
        post({
          type: "error",
          message: value instanceof Error ? value.message : String(value),
        });
      }
    })();
    return;
  }
  if (message.type === "cancel") {
    cancelled = true;
    return;
  }
  if (message.type !== "render" || !config) return;
  const active = config;
  void (async () => {
    if (cancelled) {
      post({ type: "cancelled" });
      return;
    }
    const blobs: Blob[] = [];
    for (let index = 0; index < message.count; index += 1) {
      if (cancelled) {
        post({ type: "cancelled" });
        return;
      }
      const frameIndex = message.start + index;
      const timeMs = (frameIndex / active.fps) * 1000;
      const canvas = new OffscreenCanvas(active.width, active.height);
      renderShowcaseFrame(
        active.slides,
        active.layout,
        active.width,
        active.height,
        timeMs,
        canvas,
        active.showBestMarkers,
        active.radarScaleMode,
        active.radarScale,
        active.radarAxisScale,
        active.ratingVersion,
        active.showRatingWatermark,
        active.fontScale,
      );
      blobs.push(await canvas.convertToBlob({ type: "image/png" }));
    }
    post({ type: "frames", start: message.start, blobs });
  })();
};