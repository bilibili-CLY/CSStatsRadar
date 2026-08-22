import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Download, GripVertical, Pause, Play, Plus, SkipBack, SkipForward, SlidersHorizontal, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { bridge } from "../../bridge";
import { Spinner } from "../../components/Busy";
import { PlayerAvatarView } from "../../components/PlayerAvatar";
import { Field, Range, SaveStatus } from "../../components/ui";
import type { AppConfig, PlayerAvatar, PlayerMedia, ShowcaseLayoutDraft, ShowcaseSlide, StudioKind, StudioSeed } from "../../types";
import { draftColors as colors } from "./draftMutations";
import { ShowcasePreview } from "./ShowcasePreview";
import {
  audioOffsetFromDrag,
  audioOffsetLabel,
  formatDuration,
  rating3Available,
  resizedShowcaseDuration,
  SHOWCASE_TRANSITION_MS,
  SHOWCASE_EXPORT_HEIGHT,
  SHOWCASE_EXPORT_WIDTH,
  normalizeShowcaseDimensions,
  showcaseBestEntranceDuration,
  showcaseDuration,
  showcaseIntroDuration,
  showcaseSegment,
  showcaseSlideStart,
  timelineTickStep,
} from "./showcaseMath";
import {
  ensureShowcaseFonts,
  loadImage,
  renderShowcaseFrame,
  showcasePlayerImageUrl,
} from "./showcaseRender";
import { useDraft } from "./useDraft";

export function ShowcaseEditor({
  seed,
  config,
  onNeedMaterial,
  onShowMethodology,
}: {
  seed: StudioSeed | null;
  config: AppConfig;
  onNeedMaterial: () => void;
  onShowMethodology: () => void;
}) {
  const [draft, setDraft, saveState, retrySave, draftReady] = useDraft(
    "showcase",
    {
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
        layers: config.rating_version === "rating_3"
          ? ["radar", "swing", "image", "name"]
          : ["radar", "image", "name"],
        nameAlign: "center" as "left" | "center" | "right",
        imageFit: "contain" as "contain" | "cover",
      },
      fps: config.video_fps,
      width: SHOWCASE_EXPORT_WIDTH,
      height: SHOWCASE_EXPORT_HEIGHT,
      audioOffsetMs: config.showcase.audio_offset_ms,
    },
  );
  const [exportState, setExportState] = useState<{
    running: boolean;
    progress: number;
    message: string;
  }>({ running: false, progress: 0, message: "" });
  const exportID = useRef("");
  const cancelRequested = useRef(false);
  const exportWorker = useRef<Worker | null>(null);
  const [musicURL, setMusicURL] = useState("");
  const [musicDurationMs, setMusicDurationMs] = useState(0);
  const [timelinePixelsPerSecond, setTimelinePixelsPerSecond] = useState(24);
  const [previewTime, setPreviewTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playbackFrame = useRef(0);
  const playbackStopAt = useRef<number | null>(null);
  const previewTimeRef = useRef(0);
  const lastSyncedActive = useRef(false);
  const avatarFetched = useRef(new Set<string>());
  const lastPreviewUiUpdate = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timelineTrackRef = useRef<HTMLDivElement>(null);
  const slideResize = useRef<{
    pointerId: number;
    index: number;
    edge: "start" | "end";
    startX: number;
    initialDuration: number;
    timelineDuration: number;
    trackWidth: number;
  } | null>(null);
  const audioDrag = useRef<{
    pointerId: number;
    startX: number;
    initialOffsetMs: number;
    trackWidth: number;
  } | null>(null);
  const animationOptions = useMemo(() => ({
    showIntroAnimation: config.showcase.show_intro_animation,
    showBestEntranceAnimation: config.showcase.show_best_entrance_animation,
    reduceMotion: config.reduce_motion,
  }), [
    config.reduce_motion,
    config.showcase.show_best_entrance_animation,
    config.showcase.show_intro_animation,
  ]);
  const totalDuration = showcaseDuration(draft.slides, animationOptions);
  const introDuration = showcaseIntroDuration(animationOptions);
  const previewIndex = showcaseSegment(draft.slides, previewTime, animationOptions).index;
  const audioOffsetMs =
    draft.audioOffsetMs ?? config.showcase.audio_offset_ms ?? 0;
  const audioOffsetMin = -Math.max(1_000, musicDurationMs - 100);
  const audioOffsetMax = Math.max(0, totalDuration - 100);
  const visibleAudioDurationMs = musicURL
    ? Math.max(100, (musicDurationMs || totalDuration) + Math.min(0, audioOffsetMs))
    : 0;
  const audioTimelineStartMs = Math.max(0, audioOffsetMs);
  const timelineSpanMs = Math.max(
    totalDuration,
    audioTimelineStartMs + visibleAudioDurationMs,
  );
  const timelineWidth = Math.max(
    1,
    Math.ceil((timelineSpanMs / 1000) * timelinePixelsPerSecond),
  );
  const timelineTickStepMs = timelineTickStep(
    timelineSpanMs,
    timelinePixelsPerSecond,
  );
  const timelineTicks = useMemo(
    () =>
      Array.from(
        { length: Math.floor(timelineSpanMs / timelineTickStepMs) + 1 },
        (_, index) => index * timelineTickStepMs,
      ),
    [timelineSpanMs, timelineTickStepMs],
  );
  const renderTime = previewTime;
  useEffect(() => {
    if (!draftReady) return;
    setDraft((current) => normalizeShowcaseDimensions(current));
  }, [draftReady, setDraft]);
  useEffect(() => {
    if (previewTime > totalDuration) setPreviewTime(totalDuration);
  }, [previewTime, totalDuration]);
  useEffect(() => {
    bridge
      .getShowcaseMusicInfo()
      .then((music) => {
        setMusicURL(music.url);
        setMusicDurationMs(music.duration_ms);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!playing || !totalDuration) return;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(1000, now - previous);
      previous = now;
      previewTimeRef.current = Math.min(previewTimeRef.current + delta, totalDuration);
      const next = previewTimeRef.current;
      // Throttle React state updates to ~30fps for UI elements
      if (now - lastPreviewUiUpdate.current > 33) {
        lastPreviewUiUpdate.current = now;
        setPreviewTime(next);
      }
      if (playbackStopAt.current != null && next >= playbackStopAt.current) {
        const stop = playbackStopAt.current;
        playbackStopAt.current = null;
        setPlaying(false);
        setPreviewTime(stop);
        return;
      }
      if (next >= totalDuration) {
        setPlaying(false);
        setPreviewTime(totalDuration);
        return;
      }
      playbackFrame.current = requestAnimationFrame(tick);
    };
    playbackFrame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(playbackFrame.current);
  }, [playing, totalDuration]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !musicURL) return;
    const raw = previewTime - audioOffsetMs;
    if (raw < 0) {
      audio.pause();
      return;
    }
    const target = audio.duration ? (raw / 1000) % audio.duration : raw / 1000;
    if (Number.isFinite(target) && Math.abs(audio.currentTime - target) > 0.2)
      audio.currentTime = target;
    if (playing) audio.play().catch(() => undefined);
    else audio.pause();
  }, [playing, previewTime, musicURL, audioOffsetMs]);
  useEffect(() => {
    if (!draftReady || !seed?.radar) return;
    const playerId = seed.player.steam_id;
    Promise.all([
      bridge.getPlayerMedia(playerId).catch(() => ({}) as PlayerMedia),
      bridge.getPlayerAvatars([playerId]).catch(() => [] as PlayerAvatar[]),
    ])
      .then(([media, avatars]) => {
        const avatarUrl = avatars[0]?.data_url;
        setDraft((current) => {
          const existingIndex = current.slides.findIndex(
            (slide) => slide.id === playerId,
          );
          if (existingIndex >= 0) {
            return {
              ...current,
              active: existingIndex,
              slides: current.slides.map((item, index) =>
                index === existingIndex
                  ? {
                      ...item,
                      radar: seed.radar!,
                      imageUrl: media.image_url || item.imageUrl,
                      backgroundUrl: media.background_url || item.backgroundUrl,
                      avatarUrl: avatarUrl || item.avatarUrl,
                    }
                  : item,
              ),
            };
          }
          return {
                ...current,
                active: current.slides.length,
                slides: [
                  ...current.slides,
                  {
                    id: playerId,
                    radar: seed.radar!,
                    title: seed.player.name,
                    subtitle: `${seed.matchIds.length} 场综合数据`,
                    duration: 4,
                    color: colors[current.slides.length % colors.length],
                    imageUrl: media.image_url,
                    avatarUrl,
                    backgroundUrl: media.background_url,
                  },
                ],
              };
        });
      });
  }, [seed, draftReady]);
  useEffect(() => {
    if (!draftReady || !draft.slides.length) return;
    const missing = draft.slides
      .filter(
        (slide) => !slide.avatarUrl && !avatarFetched.current.has(slide.id),
      )
      .map((slide) => slide.id);
    if (!missing.length) return;
    missing.forEach((id) => avatarFetched.current.add(id));
    bridge
      .getPlayerAvatars(missing)
      .then((values) => {
        const byId = new Map(values.map((value) => [value.steam_id, value.data_url]));
        setDraft((current) => {
          let changed = false;
          const slides = current.slides.map((item) => {
            const url = byId.get(item.id);
            if (url && !item.avatarUrl) {
              changed = true;
              return { ...item, avatarUrl: url };
            }
            return item;
          });
          return changed ? { ...current, slides } : current;
        });
      })
      .catch(() => undefined);
  }, [draftReady, draft.slides]);
  useEffect(() => {
    if (!draftReady || !draft.slides.length) return;
    if (lastSyncedActive.current) return;
    lastSyncedActive.current = true;
    const index = Math.max(
      0,
      Math.min(draft.slides.length - 1, draft.active),
    );
    seekPreview(index === 0 ? 0 : showcaseSlideStart(draft.slides, index, animationOptions));
  }, [draftReady, draft.slides]);
  useEffect(() => {
    if (!playing || !draft.slides.length) return;
    setDraft((current) =>
      current.active === previewIndex
        ? current
        : { ...current, active: previewIndex },
    );
  }, [playing, previewIndex]);
  const slide = draft.slides[draft.active];
  function seekPreview(time: number) {
    const clamped = Math.max(0, Math.min(time, totalDuration));
    previewTimeRef.current = clamped;
    setPreviewTime(clamped);
  }
  function selectSlide(index: number) {
    setDraft({ ...draft, active: index });
    const start = index === 0 ? 0 : showcaseSlideStart(draft.slides, index, animationOptions);
    seekPreview(start);
    if (index > 0) { playbackStopAt.current = Math.min(totalDuration, start + SHOWCASE_TRANSITION_MS + showcaseBestEntranceDuration(draft.slides, index, animationOptions)); setPlaying(true); }
    else { playbackStopAt.current = null; setPlaying(false); }
  }
  function togglePlayback() {
    if (!draft.slides.length) return;
    if (!playing && previewTime >= totalDuration) setPreviewTime(0);
    playbackStopAt.current = null;
    setPlaying((current) => !current);
  }
  function patchSlide(patch: Partial<ShowcaseSlide>) {
    setDraft({
      ...draft,
      slides: draft.slides.map((item, index) =>
        index === draft.active ? { ...item, ...patch } : item,
      ),
    });
  }
  function patchSlideAt(index: number, patch: Partial<ShowcaseSlide>) {
    if (index < 0 || index >= draft.slides.length) return;
    setDraft({
      ...draft,
      slides: draft.slides.map((item, candidateIndex) =>
        candidateIndex === index ? { ...item, ...patch } : item,
      ),
    });
  }
  function moveSlide(from: number, to: number) {
    if (from === to || to < 0 || to >= draft.slides.length) return;
    const activeID = draft.slides[draft.active]?.id;
    const slides = [...draft.slides];
    const [item] = slides.splice(from, 1);
    slides.splice(to, 0, item);
    setDraft({
      ...draft,
      slides,
      active: Math.max(
        0,
        slides.findIndex((slide) => slide.id === activeID),
      ),
    });
  }
  function deleteSlide(index: number) {
    const slides = draft.slides.filter((_, candidate) => candidate !== index);
    const active = slides.length
      ? Math.min(index < draft.active ? draft.active - 1 : draft.active, slides.length - 1)
      : 0;
    setPlaying(false);
    setDraft({ ...draft, slides, active });
    seekPreview(active === 0 ? 0 : showcaseSlideStart(slides, active, animationOptions));
  }
  function startSlideResize(
    event: ReactPointerEvent<HTMLSpanElement>,
    index: number,
    edge: "start" | "end",
  ) {
    const trackWidth = timelineTrackRef.current?.getBoundingClientRect().width ?? 1;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    slideResize.current = {
      pointerId: event.pointerId,
      index,
      edge,
      startX: event.clientX,
      initialDuration: draft.slides[index].duration,
      timelineDuration: timelineSpanMs,
      trackWidth,
    };
  }
  function continueSlideResize(event: ReactPointerEvent<HTMLSpanElement>) {
    const resize = slideResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const duration = resizedShowcaseDuration(
      resize.initialDuration,
      event.clientX - resize.startX,
      resize.trackWidth,
      resize.timelineDuration,
      resize.edge,
    );
    setDraft((current) => ({
      ...current,
      slides: current.slides.map((item, index) =>
        index === resize.index ? { ...item, duration } : item,
      ),
    }));
  }
  function finishSlideResize(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    slideResize.current = null;
  }
  function moveLayer(from: number, to: number) {
    if (from === to || to < 0 || to >= draft.layout.layers.length) return;
    const layers = [...draft.layout.layers];
    const [layer] = layers.splice(from, 1);
    layers.splice(to, 0, layer);
    setDraft({ ...draft, layout: { ...draft.layout, layers } });
  }
  async function exportVideo() {
    if (!draft.slides.length || exportState.running) return;
    cancelRequested.current = false;
    // Export must use the same timeline as preview: it includes the optional
    // opener and each qualifying BEST entrance/handoff, not only slide holds.
    const durationMs = totalDuration;
    const frameCount = Math.ceil((durationMs / 1000) * draft.fps);
    if (frameCount > 7200) {
      setExportState({
        running: false,
        progress: 0,
        message: "轮播超过 7200 帧，请降低帧率或缩短时长。",
      });
      return;
    }
    if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined")
      return exportVideoWithWorker(frameCount, durationMs);
    return exportVideoMainThread(frameCount, durationMs);
  }
  async function exportVideoWithWorker(frameCount: number, durationMs: number) {
    let exportId = "";
    let worker: Worker | null = null;
    try {
      setExportState({
        running: true,
        progress: 0,
        message: "正在预加载人物资源…",
      });
      worker = new Worker(
        new URL("./showcaseExportWorker.ts", import.meta.url),
        { type: "module" },
      );
      exportWorker.current = worker;
      await new Promise<void>((resolve, reject) => {
        worker!.onmessage = (event) => {
          const message = event.data as
            | { type: "ready" }
            | { type: "error"; message: string };
          if (message.type === "ready") resolve();
          else reject(new Error(message.message));
        };
        worker!.postMessage({
          type: "init",
          config: {
            slides: draft.slides,
            layout: draft.layout,
            fps: draft.fps,
            showBestMarkers: config.showcase.show_best_markers,
            radarScaleMode: config.showcase.radar_scale_mode,
            radarScale: config.showcase.radar_scale,
            radarAxisScale: config.showcase.radar_axis_scale,
            ratingVersion: config.rating_version,
            showRatingWatermark: config.show_rating_watermark,
            fontScale: 1,
            metricLabelFontSize: draft.layout.metricLabelFontSize ?? 12,
            animations: animationOptions,
          },
          imageUrls: Array.from(
            new Set(
              draft.slides.flatMap((item) =>
                [showcasePlayerImageUrl(item), item.backgroundUrl].filter(
                  (url): url is string => Boolean(url),
                ),
              ),
            ),
          ),
        });
      });
      exportId = await bridge.beginVideoExport(
        SHOWCASE_EXPORT_WIDTH,
        SHOWCASE_EXPORT_HEIGHT,
        draft.fps,
        durationMs,
        audioOffsetMs,
        "cs2-showcase.mp4",
      );
      if (!exportId) {
        setExportState({ running: false, progress: 0, message: "已取消导出" });
        return;
      }
      exportID.current = exportId;
      const batchSize = 30;
      let frame = 0;
      while (frame < frameCount) {
        if (cancelRequested.current) throw new Error("视频导出已取消");
        const count = Math.min(batchSize, frameCount - frame);
        const blobs = await new Promise<Blob[]>((resolve, reject) => {
          const onMessage = (event: MessageEvent) => {
            const message = event.data as
              | { type: "frames"; blobs: Blob[] }
              | { type: "cancelled" }
              | { type: "error"; message: string };
            worker!.removeEventListener("message", onMessage);
            if (message.type === "frames") resolve(message.blobs);
            else if (message.type === "cancelled")
              reject(new Error("视频导出已取消"));
            else reject(new Error(message.message));
          };
          worker!.addEventListener("message", onMessage);
          worker!.postMessage({ type: "render", start: frame, count });
        });
        await bridge.appendVideoFramesBinary(exportId, frame, blobs);
        frame += count;
        setExportState({
          running: true,
          progress: frame / frameCount,
          message: `正在渲染 ${frame} / ${frameCount} 帧`,
        });
      }
      worker.terminate();
      exportWorker.current = null;
      const result = await bridge.finishVideoExport(exportId);
      exportID.current = "";
      window.location.href = result.url;
      setExportState({
        running: false,
        progress: 1,
        message: `已导出 ${result.name}，浏览器正在下载…`,
      });
    } catch (value) {
      if (exportId)
        await bridge.cancelVideoExport(exportId).catch(() => undefined);
      exportID.current = "";
      if (worker) {
        worker.postMessage({ type: "cancel" });
        worker.terminate();
        exportWorker.current = null;
      }
      setExportState({
        running: false,
        progress: 0,
        message: value instanceof Error ? value.message : String(value),
      });
    }
  }
  async function exportVideoMainThread(frameCount: number, durationMs: number) {
    let exportId = "";
    try {
      setExportState({
        running: true,
        progress: 0,
        message: "正在预加载人物资源…",
      });
      await ensureShowcaseFonts();
      await Promise.all(
        draft.slides.flatMap((item) =>
          [showcasePlayerImageUrl(item), item.backgroundUrl]
            .filter(Boolean)
            .map((url) => loadImage(url!)),
        ),
      );
      exportId = await bridge.beginVideoExport(
        SHOWCASE_EXPORT_WIDTH,
        SHOWCASE_EXPORT_HEIGHT,
        draft.fps,
        durationMs,
        audioOffsetMs,
        "cs2-showcase.mp4",
      );
      if (!exportId) {
        setExportState({ running: false, progress: 0, message: "已取消导出" });
        return;
      }
      exportID.current = exportId;
      const batch: string[] = [];
      let batchStart = 0;
      for (let frame = 0; frame < frameCount; frame++) {
        if (cancelRequested.current) throw new Error("视频导出已取消");
        const timeMs = (frame / draft.fps) * 1000;
        const frameCanvas = renderShowcaseFrame(
          draft.slides,
          draft.layout,
          SHOWCASE_EXPORT_WIDTH,
          SHOWCASE_EXPORT_HEIGHT,
          timeMs,
          undefined,
          config.showcase.show_best_markers,
          config.showcase.radar_scale_mode,
          config.showcase.radar_scale,
          config.showcase.radar_axis_scale,
          config.rating_version,
          config.show_rating_watermark,
          1,
          draft.layout.metricLabelFontSize ?? 12,
          animationOptions,
        );
        if (!batch.length) batchStart = frame;
        batch.push((frameCanvas as HTMLCanvasElement).toDataURL("image/png"));
        if (batch.length === 10 || frame === frameCount - 1) {
          await bridge.appendVideoFrames(exportId, batchStart, batch.splice(0));
          setExportState({
            running: true,
            progress: (frame + 1) / frameCount,
            message: `正在渲染 ${frame + 1} / ${frameCount} 帧`,
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      const result = await bridge.finishVideoExport(exportId);
      exportID.current = "";
      window.location.href = result.url;
      setExportState({
        running: false,
        progress: 1,
        message: `已导出 ${result.name}，浏览器正在下载…`,
      });
    } catch (value) {
      if (exportId)
        await bridge.cancelVideoExport(exportId).catch(() => undefined);
      exportID.current = "";
      setExportState({
        running: false,
        progress: 0,
        message: value instanceof Error ? value.message : String(value),
      });
    }
  }
  async function cancelVideo() {
    cancelRequested.current = true;
    setExportState((current) => ({
      ...current,
      message: "正在取消并清理临时文件…",
    }));
    if (exportWorker.current) {
      exportWorker.current.postMessage({ type: "cancel" });
      exportWorker.current.terminate();
      exportWorker.current = null;
    }
    if (exportID.current)
      await bridge.cancelVideoExport(exportID.current).catch(() => undefined);
  }
  async function chooseMedia(kind: "image" | "background") {
    const target = draft.slides[previewIndex];
    if (!target) return;
    const media = await bridge.choosePlayerMedia(target.id, kind);
    patchSlideAt(previewIndex, {
      imageUrl: media.image_url,
      backgroundUrl: media.background_url,
    });
  }
  async function chooseMusic() {
    const music = await bridge.chooseShowcaseMusic();
    setMusicURL(music.url);
    setMusicDurationMs(music.duration_ms);
  }
  async function clearMusic() {
    try {
      audioRef.current?.pause();
      await bridge.clearShowcaseMusic();
      setMusicURL("");
      setMusicDurationMs(0);
      setDraft((current) => ({ ...current, audioOffsetMs: 0 }));
    } catch (e) {
      console.error("Failed to clear music:", e);
    }
  }
  function startAudioDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const track = event.currentTarget.parentElement;
    if (!track) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    audioDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      initialOffsetMs: audioOffsetMs,
      trackWidth: track.getBoundingClientRect().width,
    };
  }
  function continueAudioDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = audioDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = audioOffsetFromDrag(
      drag.initialOffsetMs,
      event.clientX - drag.startX,
      drag.trackWidth,
      timelineSpanMs,
      audioOffsetMin,
      audioOffsetMax,
    );
    setDraft((current) => ({ ...current, audioOffsetMs: next }));
  }
  function finishAudioDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    audioDrag.current = null;
  }
  return (
    <div className="editor-layout showcase-editor">
      <aside className="card editor-queue">
        <div className="section-heading">
          <div>
            <h2>播放队列</h2>
            <p>
              {draft.slides.length} 页 ·{" "}
              {draft.slides
                .reduce((sum, item) => sum + item.duration, 0)
                .toFixed(1)}{" "}
              秒
            </p>
          </div>
          <button
            className="icon-button"
            onClick={onNeedMaterial}
            aria-label="添加玩家页"
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="slide-list">
          {draft.slides.map((item, index) => (
            <div
              key={item.id}
              className={`slide-list-item ${
                (playing ? previewIndex : draft.active) === index
                  ? "active"
                  : ""
              }`}
              draggable
              title="拖动排序；Alt + 方向键也可调整"
              onDragStart={(event) =>
                event.dataTransfer.setData("text/slide-index", String(index))
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                moveSlide(
                  Number(event.dataTransfer.getData("text/slide-index")),
                  index,
                );
              }}
            >
              <button
                className="slide-select"
                onClick={() => selectSlide(index)}
                onKeyDown={(event) => {
                  if (!event.altKey) return;
                  if (event.key === "ArrowUp") moveSlide(index, index - 1);
                  if (event.key === "ArrowDown") moveSlide(index, index + 1);
                }}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <PlayerAvatarView name={item.radar.player.name} steamId={item.radar.player.steam_id}/>
                <span className="slide-copy">
                  <strong>{item.title}</strong>
                  <small>{item.duration.toFixed(1)}s</small>
                </span>
              </button>
              <button
                className="icon-button slide-delete"
                aria-label={`删除 ${item.title}`}
                title={`删除 ${item.title}`}
                onClick={() => deleteSlide(index)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button className="quiet full" onClick={onNeedMaterial}>
          <Plus size={16} />
          添加玩家页
        </button>
      </aside>
      <main className="canvas-stage">
        <div className="stage-toolbar">
          <SaveStatus state={saveState} onRetry={retrySave} />
          <span>{draft.fps} FPS · 画布内可拖动布局</span>
        </div>
        <ShowcasePreview
          slides={draft.slides}
          layout={draft.layout}
          timeMs={renderTime}
          playing={playing}
          previewTimeRef={previewTimeRef}
          showBestMarkers={config.showcase.show_best_markers}
          radarScaleMode={config.showcase.radar_scale_mode}
          radarScale={config.showcase.radar_scale}
          radarAxisScale={config.showcase.radar_axis_scale}
          ratingVersion={config.rating_version}
          showRatingWatermark={config.show_rating_watermark}
          metricLabelFontSize={draft.layout.metricLabelFontSize ?? 12}
          animations={animationOptions}
          onLayoutChange={(layout) =>
            setDraft((current) => ({ ...current, layout }))
          }
          onImageTransformChange={(imageTransform) =>
            setDraft((current) => ({
              ...current,
              layout: { ...current.layout, imageScale: imageTransform.scale },
              slides: current.slides.map((item, index) =>
                index === previewIndex
                  ? { ...item, imageTransform: { x: imageTransform.x, y: imageTransform.y } }
                  : item,
              ),
            }))
          }
        />
        <div className="timeline">
          <div className="playback-controls">
            <button
              className="icon-button"
              aria-label="上一页"
              disabled={!draft.slides.length || previewIndex === 0}
              onClick={() => selectSlide(Math.max(0, previewIndex - 1))}
            >
              <SkipBack size={15} />
            </button>
            <button
              className="play-button"
              disabled={!draft.slides.length}
              onClick={togglePlayback}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
              {playing ? "暂停" : "播放预览"}
            </button>
            <button
              className="icon-button"
              aria-label="下一页"
              disabled={
                !draft.slides.length || previewIndex >= draft.slides.length - 1
              }
              onClick={() =>
                selectSlide(Math.min(draft.slides.length - 1, previewIndex + 1))
              }
            >
              <SkipForward size={15} />
            </button>
            <input
              aria-label="轮播播放进度"
              type="range"
              min="0"
              max={Math.max(1, totalDuration)}
              value={Math.min(previewTime, totalDuration)}
              onChange={(event) => {
                setPlaying(false);
                seekPreview(Number(event.target.value));
              }}
            />
            <output>
              {formatDuration(previewTime)} / {formatDuration(totalDuration)}
            </output>
            <div className="timeline-zoom" aria-label="时间轴缩放">
              <button
                className="icon-button"
                aria-label="缩小时间轴"
                disabled={timelinePixelsPerSecond <= 8}
                onClick={() =>
                  setTimelinePixelsPerSecond((current) => Math.max(8, current / 2))
                }
              >
                <ZoomOut size={13} />
              </button>
              <span>{timelinePixelsPerSecond}px/s</span>
              <button
                className="icon-button"
                aria-label="放大时间轴"
                disabled={timelinePixelsPerSecond >= 96}
                onClick={() =>
                  setTimelinePixelsPerSecond((current) => Math.min(96, current * 2))
                }
              >
                <ZoomIn size={13} />
              </button>
            </div>
          </div>
          <div className="timeline-track-shell">
            <div className="timeline-track-labels" aria-hidden="true">
              <span>时间</span>
              <span>画面</span>
              <span>音频</span>
            </div>
            <div className="timeline-scroll-viewport">
              <div
                className="timeline-scroll-content"
                style={{ width: `max(100%, ${timelineWidth}px)` }}
              >
                <div className="timeline-time-ruler" aria-hidden="true">
                  {timelineTicks.map((tick) => (
                    <span
                      key={tick}
                      style={{ left: `${(tick / 1000) * timelinePixelsPerSecond}px` }}
                    >
                      {formatDuration(tick)}
                    </span>
                  ))}
                </div>
                <div className="showcase-clip-track" ref={timelineTrackRef}>
                  {introDuration > 0 && (
                    <div
                      className="showcase-clip intro-clip"
                      style={{ flex: `0 0 ${(introDuration / 1000) * timelinePixelsPerSecond}px` }}
                    >
                      <span className="clip-title">开场动画</span>
                      <small>6.0s</small>
                    </div>
                  )}
                  {draft.slides.map((item, index) => (
                    <div
                      style={{ flex: `0 0 ${(item.duration + showcaseBestEntranceDuration(draft.slides, index, animationOptions) / 1000) * timelinePixelsPerSecond}px` }}
                      className={`showcase-clip ${index === previewIndex ? "active" : ""}`}
                      onClick={() => selectSlide(index)}
                      key={item.id}
                      draggable
                      onDragStart={(event) =>
                        event.dataTransfer.setData("text/slide-index", String(index))
                      }
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        moveSlide(Number(event.dataTransfer.getData("text/slide-index")), index);
                      }}
                    >
                      <span
                        className="clip-resize-handle start"
                        role="separator"
                        aria-label={`调整 ${item.title} 起点`}
                        onPointerDown={(event) => startSlideResize(event, index, "start")}
                        onPointerMove={continueSlideResize}
                        onPointerUp={finishSlideResize}
                        onPointerCancel={finishSlideResize}
                      />
                      <span className="clip-title">{item.title}</span>
                      <small>{item.duration.toFixed(1)}s{showcaseBestEntranceDuration(draft.slides, index, animationOptions) ? " + BEST 4.0s" : ""}</small>
                      <span
                        className="clip-resize-handle end"
                        role="separator"
                        aria-label={`调整 ${item.title} 终点`}
                        onPointerDown={(event) => startSlideResize(event, index, "end")}
                        onPointerMove={continueSlideResize}
                        onPointerUp={finishSlideResize}
                        onPointerCancel={finishSlideResize}
                      />
                    </div>
                  ))}
                  <span
                    className="timeline-playhead"
                    style={{ left: `${(previewTime / 1000) * timelinePixelsPerSecond}px` }}
                  />
                </div>
                {musicURL ? (
                  <div className="audio-guide">
                    <div
                      className="audio-clip"
                      role="slider"
                      tabIndex={0}
                      aria-label="背景音乐起始位置"
                      aria-valuemin={audioOffsetMin}
                      aria-valuemax={audioOffsetMax}
                      aria-valuenow={audioOffsetMs}
                      aria-valuetext={audioOffsetLabel(audioOffsetMs)}
                      style={{
                        left: `${(audioTimelineStartMs / 1000) * timelinePixelsPerSecond}px`,
                        width: `${(visibleAudioDurationMs / 1000) * timelinePixelsPerSecond}px`,
                        backgroundPositionX: `${Math.round(audioOffsetMs / 80)}px`,
                      }}
                      onPointerDown={startAudioDrag}
                      onPointerMove={continueAudioDrag}
                      onPointerUp={finishAudioDrag}
                      onPointerCancel={finishAudioDrag}
                      onKeyDown={(event) => {
                        if (event.key === "Home") {
                          event.preventDefault();
                          setDraft((current) => ({ ...current, audioOffsetMs: 0 }));
                          return;
                        }
                        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                        event.preventDefault();
                        const step = event.shiftKey ? 1_000 : 100;
                        const delta = event.key === "ArrowLeft" ? -step : step;
                        setDraft((current) => ({
                          ...current,
                          audioOffsetMs: Math.max(
                            audioOffsetMin,
                            Math.min(audioOffsetMax, audioOffsetMs + delta),
                          ),
                        }));
                      }}
                    >
                      <span className="audio-trim-handle" aria-hidden="true" />
                      <span className="audio-clip-label">
                        <strong>背景音乐</strong>
                        {formatDuration(musicDurationMs)} · {audioOffsetLabel(audioOffsetMs)}
                      </span>
                    </div>
                    <span
                      className="audio-playhead"
                      style={{ left: `${(previewTime / 1000) * timelinePixelsPerSecond}px` }}
                    />
                  </div>
                ) : (
                  <button className="audio-track audio-import-track" onClick={chooseMusic}>
                    点击音频导轨导入背景音乐
                  </button>
                )}
              </div>
            </div>
            {musicURL ? (
              <button
                className="icon-button audio-delete"
                aria-label="删除背景音乐"
                title="删除背景音乐"
                onClick={clearMusic}
              >
                <Trash2 size={14} />
              </button>
            ) : <span />}
          </div>
          {exportState.message && (
            <div className="audio-track export-status">
              {exportState.running
                ? `${Math.round(exportState.progress * 100)}% · ${exportState.message}`
                : exportState.message}
            </div>
          )}
          {musicURL && (
            <audio
              ref={audioRef}
              src={musicURL}
              loop
              className="music-preview"
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration * 1000;
                if (Number.isFinite(duration)) setMusicDurationMs(duration);
              }}
            />
          )}
        </div>
      </main>
      <aside className="card inspector">
        <div className="inspector-title">
          <SlidersHorizontal size={17} />
          <h2>属性检查器</h2>
        </div>
        {slide ? (
          <>
            <Field label="页面标题">
              <input
                value={slide.title}
                onChange={(e) => patchSlide({ title: e.target.value })}
              />
            </Field>
            <Field label="副标题">
              <input
                value={slide.subtitle}
                onChange={(e) => patchSlide({ subtitle: e.target.value })}
              />
            </Field>
            <div className="two-fields">
              <Field label="时长（秒）">
                <input
                  type="number"
                  min=".5"
                  step=".5"
                  value={slide.duration}
                  onChange={(e) =>
                    patchSlide({ duration: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="主题色">
                <input
                  type="color"
                  value={slide.color}
                  onChange={(e) => patchSlide({ color: e.target.value })}
                />
              </Field>
            </div>
            {config.rating_version === "rating_3" && !rating3Available(slide.radar) && (
              <div className="notice warning compact">
                <AlertTriangle size={16} />
                当前玩家页缺少源 DEM 或增强事件数据，将以 Rating 2.0 数值渲染。
              </div>
            )}
            <div className="media-actions">
              {slide.imageUrl ? (
                <button
                  className="danger-action"
                  onClick={() =>
                    patchSlideAt(previewIndex, { imageUrl: undefined })
                  }
                >
                  清除人物图
                </button>
              ) : (
                <button onClick={() => chooseMedia("image")}>人物图</button>
              )}
              {slide.backgroundUrl ? (
                <button
                  className="danger-action"
                  onClick={() =>
                    patchSlideAt(previewIndex, { backgroundUrl: undefined })
                  }
                >
                  清除背景图
                </button>
              ) : (
                <button onClick={() => chooseMedia("background")}>
                  背景图
                </button>
              )}
            </div>
            <Field label="雷达与 Round Swing 文字字号（px）">
              <input
                type="number"
                min="8"
                max="32"
                step="1"
                value={draft.layout.metricLabelFontSize ?? 12}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  setDraft({
                    ...draft,
                    layout: {
                      ...draft.layout,
                      metricLabelFontSize: Math.max(8, Math.min(32, next)),
                    },
                  });
                }}
              />
            </Field>
            <div className="two-fields">
              <Field label="文字对齐">
                <select
                  value={draft.layout.nameAlign ?? "center"}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      layout: {
                        ...draft.layout,
                        nameAlign: event.target.value as
                          "left" | "center" | "right",
                      },
                    })
                  }
                >
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </Field>
              <Field label="图片适配">
                <select
                  value={draft.layout.imageFit ?? "contain"}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      layout: {
                        ...draft.layout,
                        imageFit: event.target.value as "contain" | "cover",
                      },
                    })
                  }
                >
                  <option value="contain">完整显示</option>
                  <option value="cover">填满区域</option>
                </select>
              </Field>
            </div>
            <h3>图层顺序（上方优先）</h3>
            <div className="layer-order">
              {draft.layout.layers.map((layer, index) => (
                <div
                  key={layer}
                  draggable
                  onDragStart={(event) =>
                    event.dataTransfer.setData(
                      "text/showcase-layer-index",
                      String(index),
                    )
                  }
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    moveLayer(
                      Number(
                        event.dataTransfer.getData("text/showcase-layer-index"),
                      ),
                      index,
                    );
                  }}
                >
                  <GripVertical size={15} />
                  {
                    (
                      {
                        radar: "雷达",
                        swing: "Round Swing",
                        image: "人物图",
                        name: "姓名",
                      } as Record<string, string>
                    )[layer]
                  }
                  <span className="layer-move-actions">
                    <button
                      className="icon-button"
                      aria-label={`上移 ${layer}`}
                      disabled={index === 0}
                      onClick={() => moveLayer(index, index - 1)}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`下移 ${layer}`}
                      disabled={index === draft.layout.layers.length - 1}
                      onClick={() => moveLayer(index, index + 1)}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="two-fields">
              <Field label="帧率">
                <select
                  value={draft.fps}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      fps: Number(e.target.value) as 30 | 60,
                    })
                  }
                >
                  <option value="30">30 FPS</option>
                  <option value="60">60 FPS</option>
                </select>
              </Field>
            </div>
            <button
              className="primary export-action"
              disabled={exportState.running}
              onClick={exportVideo}
            >
              {exportState.running ? <Spinner /> : <Download size={17} />}
              {exportState.running
                ? `导出中 ${Math.round(exportState.progress * 100)}%`
                : "导出 MP4"}
            </button>
            {exportState.running && (
              <button className="danger-action full" onClick={cancelVideo}>
                取消导出
              </button>
            )}
          </>
        ) : (
          <button className="empty-action" onClick={onNeedMaterial}>
            选择素材
          </button>
        )}
      </aside>
    </div>
  );
}
