import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  Layers3,
  Pause,
  Play,
  Plus,
  Save,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Trash2,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { bridge } from "../../bridge";
import { Spinner } from "../../components/Busy";
import { PlayerAvatarView } from "../../components/PlayerAvatar";
import {
  RadarCanvas,
  renderRadarCanvas,
  renderSwingCanvas,
  selectRatingProfile,
  type RadarCanvasHandle,
} from "../../components/RadarCanvas";
import type {
  AppConfig,
  OverlayEntry,
  PlayerMedia,
  RadarResponse,
  RatingVersion,
  ShowcaseLayoutDraft,
  ShowcaseSlide,
  StudioKind,
  StudioSeed,
} from "../../types";
import {
  draftColors as colors,
  makeInitialDraft,
  stripLegacyDraftFields,
} from "./draftMutations";
import { appendOverlayEntry } from "./draftMutations";

interface Props {
  seed: StudioSeed | null;
  initialKind: StudioKind;
  config: AppConfig;
  onNeedMaterial: () => void;
  onShowMethodology: () => void;
}
type SaveState = "idle" | "saving" | "saved" | "error";

export function StudioView({
  seed,
  initialKind,
  config,
  onNeedMaterial,
  onShowMethodology,
}: Props) {
  const [kind, setKind] = useState<StudioKind>(initialKind);
  useEffect(() => setKind(initialKind), [initialKind]);
  return (
    <div className="page studio-page">
      <header className="page-header compact-header">
        <div>
          <span className="eyebrow">制作工作区</span>
          <h1>制作</h1>
        </div>
        <div className="studio-tabs">
          <button
            className={kind === "radar" ? "active" : ""}
            onClick={() => setKind("radar")}
          >
            雷达图
          </button>
          <button
            className={kind === "overlay" ? "active" : ""}
            onClick={() => setKind("overlay")}
          >
            叠图对比
          </button>
          <button
            className={kind === "showcase" ? "active" : ""}
            onClick={() => setKind("showcase")}
          >
            展示轮播
          </button>
        </div>
      </header>
      {kind === "radar" && (
        <RadarEditor
          seed={seed}
          config={config}
          onNeedMaterial={onNeedMaterial}
          onShowMethodology={onShowMethodology}
        />
      )}{" "}
      {kind === "overlay" && (
        <OverlayEditor
          seed={seed}
          config={config}
          onNeedMaterial={onNeedMaterial}
          onShowMethodology={onShowMethodology}
        />
      )}{" "}
      {kind === "showcase" && (
        <ShowcaseEditor
          seed={seed}
          config={config}
          onNeedMaterial={onNeedMaterial}
          onShowMethodology={onShowMethodology}
        />
      )}
    </div>
  );
}

function useDraft<T>(kind: StudioKind, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveRevision, setSaveRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    loaded.current = false;
    setReady(false);
    bridge
      .loadDraft(kind)
      .then((draft) => {
        if (draft)
          setValue(stripLegacyDraftFields(JSON.parse(draft.payload)) as T);
      })
      .finally(() => {
        loaded.current = true;
        setReady(true);
      });
  }, [kind]);
  useEffect(() => {
    if (!loaded.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(
      () =>
        bridge
          .saveDraft(kind, JSON.stringify(value))
          .then(() => setSaveState("saved"))
          .catch(() => setSaveState("error")),
      500,
    );
    return () => clearTimeout(timer);
  }, [kind, value, saveRevision]);
  return [
    value,
    setValue,
    saveState,
    () => setSaveRevision((value) => value + 1),
    ready,
  ] as const;
}

function RadarEditor({
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
    "radar",
    {
      radar: null as RadarResponse | null,
      title: "",
      subtitle: "",
      color: "#22d3ee",
      width: config.export_width,
      height: config.export_height,
      fontScale: 1,
    },
  );
  const canvas = useRef<RadarCanvasHandle>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (draftReady && seed?.radar)
      setDraft((current) => ({
        ...current,
        radar: seed.radar!,
        title: seed.player.name,
        subtitle: `已选 ${seed.matchIds.length} 场比赛`,
      }));
  }, [seed, draftReady]);
  async function exportImage() {
    if (!canvas.current || !draft.radar) return;
    try {
      setExporting(true);
      await bridge.exportPNG(
        canvas.current.toDataURL(draft.width, draft.height),
        `${draft.title || draft.radar.player.name}-radar.png`,
      );
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="editor-layout">
      <aside className="card editor-queue">
        <div className="section-heading">
          <div>
            <h2>当前素材</h2>
            <p>单场与综合雷达共用编辑器</p>
          </div>
        </div>
        {draft.radar ? (
          <div className="material-card">
            <PlayerAvatarView name={draft.radar.player.name} steamId={draft.radar.player.steam_id}/>
            <div>
              <strong>{draft.radar.player.name}</strong>
              <p>{draft.radar.match_count} 场比赛</p>
            </div>
          </div>
        ) : (
          <button className="empty-action" onClick={onNeedMaterial}>
            <Plus />
            从资料库选择
          </button>
        )}
      </aside>
      <main className="canvas-stage">
        <div className="stage-toolbar">
          <SaveStatus state={saveState} onRetry={retrySave} />
          <span>
            {draft.width} × {draft.height}
          </span>
        </div>
        <div className="canvas-frame">
          <RadarCanvas
            ref={canvas}
            radar={draft.radar}
            color={draft.color}
            title={draft.title}
            subtitle={draft.subtitle}
            previewWidth={draft.width}
            previewHeight={draft.height}
            radarScaleMode={config.showcase.radar_scale_mode}
            radarScale={config.showcase.radar_scale}
            radarAxisScale={config.showcase.radar_axis_scale}
            ratingVersion={config.rating_version}
            showRatingWatermark={config.show_rating_watermark}
            fontScale={draft.fontScale}
          />
        </div>
      </main>
      <aside className="card inspector">
        <div className="inspector-title">
          <SlidersHorizontal size={17} />
          <h2>雷达设置</h2>
        </div>
        <Field label="标题">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </Field>
        <Field label="副标题">
          <input
            value={draft.subtitle}
            onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
          />
        </Field>
        <Field label="雷达颜色">
          <input
            type="color"
            value={draft.color}
            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
          />
        </Field>
        {config.rating_version === "rating_3" && !(draft.radar && rating3Available(draft.radar)) && (
          <div className="notice warning compact">
            <AlertTriangle size={16} />
            {draft.radar?.rating_3_status?.reason ?? "此素材缺少 Rating 3.0 增强事件数据，将以 Rating 2.0 数值渲染。"}
          </div>
        )}
        <Range
          label="文字大小"
          min={0.7}
          max={1.5}
          step={0.05}
          value={draft.fontScale ?? 1}
          onChange={(fontScale) => setDraft({ ...draft, fontScale })}
        />
        <SizePreset
          value={{ w: draft.width, h: draft.height }}
          onChange={(w, h) => setDraft({ ...draft, width: w, height: h })}
        />
        <button
          className="primary export-action"
          disabled={!draft.radar || exporting}
          onClick={exportImage}
        >
          {exporting ? <Spinner /> : <Download size={17} />}
          {exporting ? "正在导出" : "导出 PNG"}
        </button>
      </aside>
    </div>
  );
}

function OverlayEditor({
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
    "overlay",
    {
      entries: [] as OverlayEntry[],
      title: "CS2 玩家叠图雷达",
      subtitle: "队列平均（含隐藏玩家）",
      width: config.export_width,
      height: config.export_height,
      fontScale: 1,
    },
  );
  const canvas = useRef<RadarCanvasHandle>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (!draftReady || !seed?.radar) return;
    setDraft((current) => {
      const entries = appendOverlayEntry(current.entries, seed.radar!);
      return entries === current.entries ? current : { ...current, entries };
    });
  }, [seed, draftReady]);
  const average = useMemo(() => averageRadar(draft.entries), [draft.entries]);
  const overlays = average
    ? [
        ...draft.entries,
        { id: "average", radar: average, visible: true, color: "#f4f6f8" },
      ]
    : draft.entries;
  async function exportImage() {
    if (!canvas.current) return;
    try {
      setExporting(true);
      await bridge.exportPNG(
        canvas.current.toDataURL(draft.width, draft.height),
        "cs2-overlay-radar.png",
      );
    } finally {
      setExporting(false);
    }
  }
  function moveEntry(from: number, to: number) {
    if (from === to || to < 0 || to >= draft.entries.length) return;
    const entries = [...draft.entries];
    const [entry] = entries.splice(from, 1);
    entries.splice(to, 0, entry);
    setDraft({ ...draft, entries });
  }
  return (
    <div className="editor-layout">
      <aside className="card editor-queue">
        <div className="section-heading">
          <div>
            <h2>叠图队列</h2>
            <p>{draft.entries.length} 名玩家</p>
          </div>
          <button
            className="icon-button"
            onClick={onNeedMaterial}
            aria-label="添加玩家"
          >
            <Plus size={17} />
          </button>
        </div>
        {draft.entries.length > 6 && (
          <div className="notice warning compact">
            <AlertTriangle size={16} />
            超过 6 人可能影响可读性
          </div>
        )}
        <div className="layer-list">
          {draft.entries.map((entry, index) => (
            <div
              className="layer-row"
              key={entry.id}
              draggable
              tabIndex={0}
              title="拖动排序；Alt + 方向键也可调整"
              onDragStart={(event) =>
                event.dataTransfer.setData("text/overlay-index", String(index))
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                moveEntry(
                  Number(event.dataTransfer.getData("text/overlay-index")),
                  index,
                );
              }}
              onKeyDown={(event) => {
                if (!event.altKey) return;
                if (event.key === "ArrowUp") moveEntry(index, index - 1);
                if (event.key === "ArrowDown") moveEntry(index, index + 1);
              }}
            >
              <GripVertical size={15} />
              <span className="color-dot" style={{ background: entry.color }} />
              <PlayerAvatarView name={entry.radar.player.name} steamId={entry.radar.player.steam_id}/>
              <strong>{entry.radar.player.name}</strong>
              <button
                className="icon-button"
                aria-label={`${entry.visible ? "隐藏" : "显示"} ${entry.radar.player.name}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    entries: draft.entries.map((item) =>
                      item.id === entry.id
                        ? { ...item, visible: !item.visible }
                        : item,
                    ),
                  })
                }
              >
                {entry.visible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <button
                className="icon-button"
                aria-label={`移除 ${entry.radar.player.name}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    entries: draft.entries.filter((_, i) => i !== index),
                  })
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <button className="quiet full" onClick={onNeedMaterial}>
          <Plus size={16} />
          从资料库添加
        </button>
      </aside>
      <main className="canvas-stage">
        <div className="stage-toolbar">
          <SaveStatus state={saveState} onRetry={retrySave} />
          <span>平均值始终包含完整队列</span>
        </div>
        <div className="canvas-frame">
          <RadarCanvas
            ref={canvas}
            overlays={overlays}
            title={draft.title}
            subtitle={draft.subtitle}
            previewWidth={draft.width}
            previewHeight={draft.height}
            radarScaleMode={config.showcase.radar_scale_mode}
            radarScale={config.showcase.radar_scale}
            radarAxisScale={config.showcase.radar_axis_scale}
            ratingVersion={config.rating_version}
            showRatingWatermark={config.show_rating_watermark}
            fontScale={draft.fontScale}
          />
        </div>
      </main>
      <aside className="card inspector">
        <div className="inspector-title">
          <Layers3 size={17} />
          <h2>叠图设置</h2>
        </div>
        <Field label="标题">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </Field>
        <Field label="副标题">
          <input
            value={draft.subtitle}
            onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
          />
        </Field>
        {draft.entries.map((entry) => (
          <Field key={entry.id} label={entry.radar.player.name}>
            <input
              type="color"
              value={entry.color}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  entries: draft.entries.map((item) =>
                    item.id === entry.id
                      ? { ...item, color: e.target.value }
                      : item,
                  ),
                })
              }
            />
          </Field>
        ))}
        {config.rating_version === "rating_3" && (
          draft.entries.length === 0 || !draft.entries.every((entry) => rating3Available(entry.radar)) ? (
            <div className="notice warning compact">
              <AlertTriangle size={16} />
              队列中的部分比赛缺少源 DEM 或增强事件数据，将以 Rating 2.0 数值渲染。
            </div>
          ) : null
        )}
        <Range
          label="文字大小"
          min={0.7}
          max={1.5}
          step={0.05}
          value={draft.fontScale ?? 1}
          onChange={(fontScale) => setDraft({ ...draft, fontScale })}
        />
        <SizePreset
          value={{ w: draft.width, h: draft.height }}
          onChange={(w, h) => setDraft({ ...draft, width: w, height: h })}
        />
        <button
          className="primary export-action"
          disabled={!draft.entries.length || exporting}
          onClick={exportImage}
        >
          {exporting ? <Spinner /> : <Download size={17} />}
          {exporting ? "正在导出" : "导出叠图 PNG"}
        </button>
      </aside>
    </div>
  );
}

export type { ShowcaseSlide } from "../../types";
function ShowcaseEditor({
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
      width: config.export_width,
      height: config.export_height,
      audioOffsetMs: config.showcase.audio_offset_ms,
      fontScale: 1,
    },
  );
  const [exportState, setExportState] = useState<{
    running: boolean;
    progress: number;
    message: string;
  }>({ running: false, progress: 0, message: "" });
  const exportID = useRef("");
  const cancelRequested = useRef(false);
  const [musicURL, setMusicURL] = useState("");
  const [musicDurationMs, setMusicDurationMs] = useState(0);
  const [timelinePixelsPerSecond, setTimelinePixelsPerSecond] = useState(24);
  const [previewTime, setPreviewTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playbackFrame = useRef(0);
  const playbackStopAt = useRef<number | null>(null);
  const previewTimeRef = useRef(0);
  const lastSyncedActive = useRef(false);
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
  const totalDuration = showcaseDuration(draft.slides);
  const previewIndex = showcaseSegment(draft.slides, previewTime).index;
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
    bridge
      .getPlayerMedia(seed.player.steam_id)
      .catch(() => ({}) as PlayerMedia)
      .then((media) =>
        setDraft((current) => {
          const existingIndex = current.slides.findIndex(
            (slide) => slide.id === seed.player.steam_id,
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
                    id: seed.player.steam_id,
                    radar: seed.radar!,
                    title: seed.player.name,
                    subtitle: `${seed.matchIds.length} 场综合数据`,
                    duration: 4,
                    color: colors[current.slides.length % colors.length],
                    imageUrl: media.image_url,
                    backgroundUrl: media.background_url,
                  },
                ],
              };
        }),
      );
  }, [seed, draftReady]);
  useEffect(() => {
    if (!draftReady || !draft.slides.length) return;
    if (lastSyncedActive.current) return;
    lastSyncedActive.current = true;
    const index = Math.max(
      0,
      Math.min(draft.slides.length - 1, draft.active),
    );
    seekPreview(showcaseSlideStart(draft.slides, index));
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
    const start = showcaseSlideStart(draft.slides, index);
    seekPreview(start);
    if (index > 0) { playbackStopAt.current = Math.min(totalDuration, start + SHOWCASE_TRANSITION_MS); setPlaying(true); }
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
    seekPreview(showcaseSlideStart(slides, active));
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
    const durationMs = Math.round(
      draft.slides.reduce((sum, item) => sum + item.duration, 0) * 1000,
    );
    const frameCount = Math.ceil((durationMs / 1000) * draft.fps);
    if (frameCount > 7200) {
      setExportState({
        running: false,
        progress: 0,
        message: "轮播超过 7200 帧，请降低帧率或缩短时长。",
      });
      return;
    }
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
          [item.imageUrl, item.backgroundUrl]
            .filter(Boolean)
            .map((url) => loadImage(url!)),
        ),
      );
      exportId = await bridge.beginVideoExport(
        draft.width,
        draft.height,
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
          draft.width,
          draft.height,
          timeMs,
          undefined,
          config.showcase.show_best_markers,
          config.showcase.radar_scale_mode,
          config.showcase.radar_scale,
          config.showcase.radar_axis_scale,
          config.rating_version,
          config.show_rating_watermark,
          draft.fontScale ?? 1,
        );
        if (!batch.length) batchStart = frame;
        batch.push(frameCanvas.toDataURL("image/png"));
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
      const path = await bridge.finishVideoExport(exportId);
      exportID.current = "";
      setExportState({
        running: false,
        progress: 1,
        message: `已导出到 ${path}`,
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
          fontScale={draft.fontScale ?? 1}
          onLayoutChange={(layout) =>
            setDraft((current) => ({ ...current, layout }))
          }
          onImageTransformChange={(imageTransform) =>
            patchSlideAt(previewIndex, { imageTransform })
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
                  {draft.slides.map((item, index) => (
                    <div
                      style={{ flex: `0 0 ${item.duration * timelinePixelsPerSecond}px` }}
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
                      <small>{item.duration.toFixed(1)}s</small>
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
            <Range
              label="文字大小"
              min={0.7}
              max={1.5}
              step={0.05}
              value={draft.fontScale ?? 1}
              onChange={(fontScale) => setDraft({ ...draft, fontScale })}
            />
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

function ShowcasePreview({
  slides,
  layout,
  timeMs,
  playing,
  showBestMarkers,
  radarScaleMode,
  radarScale,
  radarAxisScale,
  ratingVersion,
  showRatingWatermark,
  fontScale,
  onLayoutChange,
  onImageTransformChange,
  previewTimeRef,
}: {
  slides: ShowcaseSlide[];
  layout: ShowcaseLayoutDraft;
  timeMs: number;
  playing: boolean;
  showBestMarkers: boolean;
  radarScaleMode: string;
  radarScale: number;
  radarAxisScale?: Record<string, number>;
  ratingVersion: RatingVersion;
  showRatingWatermark: boolean;
  fontScale: number;
  onLayoutChange: (layout: ShowcaseLayoutDraft) => void;
  onImageTransformChange: (transform: { x: number; y: number; scale: number }) => void;
  previewTimeRef?: React.MutableRefObject<number>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [assetRevision, setAssetRevision] = useState(0);
  const [fontState, setFontState] = useState<"loading" | "ready" | "error">("loading");
  type Target = "radar" | "title" | "subtitle" | "image" | "swing";
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(null);
  const selectionRef = useRef<Target | null>(null);
  const setSelectedTargetRef = (target: Target | null) => {
    selectionRef.current = target;
    setSelectedTarget(target);
  };
  const drag = useRef<{ pointerId: number; target: Target; mode: "move" | "resize"; offsetX: number; offsetY: number; initialScale: number; initialDistance: number; initialTransform: ShowcaseTransform; pendingTransform: ShowcaseTransform | null } | null>(null);
  const dragNeedsRedraw = useRef(false);
  const drawRef = useRef<((forceTimeMs?: number) => void) | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  useEffect(() => {
    const urls = slides.flatMap(
      (item) => [item.imageUrl, item.backgroundUrl].filter(Boolean) as string[],
    );
    if (!urls.length) return;
    let active = true;
    Promise.allSettled(urls.map(loadImage)).then(() => {
      if (active) setAssetRevision((value) => value + 1);
    });
    return () => {
      active = false;
    };
  }, [slides]);
  useEffect(() => { ensureShowcaseFonts().then(() => { setFontState("ready"); setAssetRevision((value) => value + 1); }).catch(() => setFontState("error")); }, []);
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || fontState !== "ready") return;
    let rafId = 0;
    const draw = (forceTimeMs?: number) => {
      const drawTimeMs = forceTimeMs ?? (previewTimeRef ? previewTimeRef.current : timeMs);
      const density = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(640, Math.floor(sizeRef.current.width * density));
      const height = Math.floor((width * 9) / 16);
      const effectiveLayout = { ...layout };
      const dragState = drag.current;
      if (dragState?.pendingTransform) {
        const target = dragState.target;
        if (target === "radar") { effectiveLayout.radarX = dragState.pendingTransform.x; effectiveLayout.radarY = dragState.pendingTransform.y; effectiveLayout.radarScale = dragState.pendingTransform.scale; }
        else if (target === "swing") { effectiveLayout.swingX = dragState.pendingTransform.x; effectiveLayout.swingY = dragState.pendingTransform.y; effectiveLayout.swingScale = dragState.pendingTransform.scale; }
        else if (target === "title") { effectiveLayout.titleX = dragState.pendingTransform.x; effectiveLayout.titleY = dragState.pendingTransform.y; effectiveLayout.titleScale = dragState.pendingTransform.scale; }
        else if (target === "subtitle") { effectiveLayout.subtitleX = dragState.pendingTransform.x; effectiveLayout.subtitleY = dragState.pendingTransform.y; effectiveLayout.subtitleScale = dragState.pendingTransform.scale; }
      }
      const segmentIndex = showcaseSegment(slides, drawTimeMs).index;
      const dragTransform =
        dragState?.pendingTransform && dragState.target === "image"
          ? dragState.pendingTransform
          : null;
      const effectiveSlides = dragTransform
        ? slides.map((item, index) =>
            index === segmentIndex ? { ...item, imageTransform: dragTransform } : item,
          )
        : slides;
      renderShowcaseFrame(
        effectiveSlides,
        effectiveLayout,
        width,
        height,
        drawTimeMs,
        canvas,
        showBestMarkers,
        radarScaleMode,
        radarScale,
        radarAxisScale,
        ratingVersion,
        showRatingWatermark,
        fontScale,
      );
      const currentSelection = selectionRef.current;
      if (currentSelection) {
        const t = dragState?.pendingTransform && dragState.target === currentSelection ? dragState.pendingTransform : currentTransform(currentSelection);
        drawShowcaseSelection(canvas, currentSelection, t, selectionBounds(currentSelection, t, canvas.width, canvas.height, effectiveLayout));
      }
      if (dragNeedsRedraw.current) {
        dragNeedsRedraw.current = false;
        rafId = requestAnimationFrame(() => draw());
      }
      // Continuous RAF loop only while playing (or while dragging, handled above).
      if (playing) {
        rafId = requestAnimationFrame(() => draw());
      }
    };
    drawRef.current = draw;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      sizeRef.current = { width: rect.width, height: rect.height };
    };
    measure();
    draw();
    const observer = new ResizeObserver(() => { measure(); draw(); });
    observer.observe(container);
    return () => { drawRef.current = null; observer.disconnect(); if (rafId) cancelAnimationFrame(rafId); };
  }, [slides, layout, assetRevision, fontState, showBestMarkers, radarScaleMode, radarScale, radarAxisScale, ratingVersion, showRatingWatermark, fontScale, playing, previewTimeRef]);
  useEffect(() => {
    if (playing) return;
    drawRef.current?.();
  }, [timeMs, playing]);
  function pointerPercent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100,
    };
  }
  function currentSlide() { return slides[showcaseSegment(slides, timeMs).index]; }
  function currentTransform(target: Target) {
    if (target === "radar") return { x: layout.radarX, y: layout.radarY, scale: layout.radarScale };
    if (target === "swing") {
      const cw = canvasRef.current?.width ?? 1;
      const ch = canvasRef.current?.height ?? 1;
      const radarSize = (Math.min(cw * 0.48, ch * 0.78) * layout.radarScale) / 100;
      return { x: layout.swingX ?? layout.radarX, y: layout.swingY ?? (layout.radarY + radarSize / 2 / ch * 100 + 8), scale: layout.swingScale ?? 100 };
    }
    if (target === "title") return { x: layout.titleX ?? layout.nameX, y: layout.titleY ?? layout.nameY, scale: layout.titleScale ?? layout.nameScale };
    if (target === "subtitle") return { x: layout.subtitleX ?? layout.nameX, y: layout.subtitleY ?? layout.nameY + 4.5, scale: layout.subtitleScale ?? layout.nameScale };
    return currentSlide()?.imageTransform ?? { x: layout.imageX, y: layout.imageY, scale: layout.imageScale };
  }
  function patchTransform(target: Target, transform: { x: number; y: number; scale: number }) {
    if (target === "image") return onImageTransformChange(transform);
    const keys = target === "radar" ? ["radarX","radarY","radarScale"] : target === "swing" ? ["swingX","swingY","swingScale"] : target === "title" ? ["titleX","titleY","titleScale"] : ["subtitleX","subtitleY","subtitleScale"];
    onLayoutChange({ ...layout, [keys[0]]: transform.x, [keys[1]]: transform.y, [keys[2]]: transform.scale });
  }
  function hitTarget(point: { x: number; y: number }): Target | null {
    const available: Target[] = [];
    const baseLayers = layout.layers ?? ["radar","image","name"];
    const layers = ratingVersion === "rating_3" && !baseLayers.includes("swing")
      ? [...baseLayers, "swing"]
      : baseLayers;
    for (const layer of layers) layer === "name" ? available.push("subtitle","title") : available.push(layer as Target);
    const canvasWidth = canvasRef.current?.width ?? 1;
    const canvasHeight = canvasRef.current?.height ?? 1;
    const swingIndex = available.indexOf("swing");
    const swingSlide = currentSlide();
    if (
      swingIndex >= 0 &&
      swingSlide &&
      selectRatingProfile(swingSlide.radar, ratingVersion).radar.round_swing !=
        null
    ) {
      const swing = currentTransform("swing");
      const bounds = selectionBounds("swing", swing, canvasWidth, canvasHeight, layout);
      if (point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom) return "swing";
    }
    return available.find((target) => {
      if (target === "swing") return false;
      if (target === "image" && !currentSlide()?.imageUrl) return false;
      const bounds = selectionBounds(target, currentTransform(target), canvasWidth, canvasHeight, layout);
      return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
    }) ?? null;
  }
  return (
    <div
      className={`showcase-canvas ${drag.current ? "dragging-element" : ""}`}
      ref={containerRef}
    >
      <canvas
        ref={canvasRef}
        role="img"
        tabIndex={0}
        aria-label="轮播实时预览；可选择、移动并等比缩放雷达、Round Swing、主标题、副标题和人物图"
        onPointerDown={(event) => {
          const point = pointerPercent(event);
          if (selectedTarget) {
            const transform = currentTransform(selectedTarget);
            const bounds = selectionBounds(selectedTarget, transform, event.currentTarget.width, event.currentTarget.height, layout);
            if (nearestCornerDistance(point, bounds) <= 3) {
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { pointerId: event.pointerId, target: selectedTarget, mode: "resize", offsetX: 0, offsetY: 0, initialScale: transform.scale, initialDistance: Math.max(1, Math.hypot(point.x-transform.x, point.y-transform.y)), initialTransform: transform, pendingTransform: null };
              return;
            }
          }
          const target = hitTarget(point);
          setSelectedTargetRef(target);
          drawRef.current?.();
          if (!target) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const transform = currentTransform(target);
          drag.current = { pointerId: event.pointerId, target, mode: "move", offsetX: transform.x-point.x, offsetY: transform.y-point.y, initialScale: transform.scale, initialDistance: 1, initialTransform: transform, pendingTransform: null };
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state || state.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const point = pointerPercent(event);
          const rounded = (value: number) => Math.round(value * 10) / 10;
          const current = state.initialTransform;
          let next: ShowcaseTransform;
          if (state.mode === "resize") {
            const distance = Math.hypot(point.x-current.x, point.y-current.y);
            next = clampShowcaseTransform(state.target, { ...current, scale: rounded(Math.max(35, Math.min(220, state.initialScale*distance/state.initialDistance))) });
          } else {
            next = clampShowcaseTransform(state.target, { ...current, x: rounded(point.x+state.offsetX), y: rounded(point.y+state.offsetY) });
          }
          state.pendingTransform = next;
          dragNeedsRedraw.current = true;
          drawRef.current?.();
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          const state = drag.current;
          if (state?.pendingTransform) {
            patchTransform(state.target, state.pendingTransform);
          }
          drag.current = null;
          dragNeedsRedraw.current = false;
          drawRef.current?.();
        }}
        onPointerCancel={() => { drag.current = null; dragNeedsRedraw.current = false; drawRef.current?.(); }}
        onKeyDown={(event) => {
          if (!selectedTarget) return;
          const delta = event.shiftKey ? 2 : .5;
          const transform = currentTransform(selectedTarget);
          if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) { event.preventDefault(); patchTransform(selectedTarget, clampShowcaseTransform(selectedTarget, { ...transform, x: transform.x+(event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0), y: transform.y+(event.key === "ArrowDown" ? delta : event.key === "ArrowUp" ? -delta : 0) })); }
          if (event.key === "+" || event.key === "=") { event.preventDefault(); patchTransform(selectedTarget, clampShowcaseTransform(selectedTarget, { ...transform, scale: Math.min(220, transform.scale+5) })); }
          if (event.key === "-") { event.preventDefault(); patchTransform(selectedTarget, clampShowcaseTransform(selectedTarget, { ...transform, scale: Math.max(35, transform.scale-5) })); }
        }}
      />
      {fontState !== "ready" && <span className={`showcase-font-status ${fontState}`} role="status">{fontState === "loading" ? "正在载入离线字体…" : "离线字体加载失败，已暂停预览与导出"}</span>}
    </div>
  );
}

export type ShowcaseTarget = "radar" | "title" | "subtitle" | "image" | "swing";
type ShowcaseTransform = { x: number; y: number; scale: number };
function targetBaseBounds(target: ShowcaseTarget) { return target === "radar" ? { x: 18, y: 32 } : target === "image" ? { x: 10, y: 18 } : target === "title" ? { x: 15, y: 5 } : target === "subtitle" ? { x: 13, y: 3.5 } : { x: 17, y: 17 }; }
function targetBounds(target: ShowcaseTarget, transform: ShowcaseTransform) {
  const base = targetBaseBounds(target);
  const halfX = base.x*transform.scale/100, halfY = base.y*transform.scale/100;
  return { left: transform.x-halfX, right: transform.x+halfX, top: transform.y-halfY, bottom: transform.y+halfY };
}
function selectionBounds(target: ShowcaseTarget, transform: ShowcaseTransform, width: number, height: number, layout: ShowcaseLayoutDraft) {
  if (target !== "swing") return targetBounds(target, transform);
  const radarSize = (Math.min(width * 0.48, height * 0.78) * layout.radarScale) / 100;
  const swingScale = transform.scale / 100;
  const swingCanvasH = radarSize * 0.19 * swingScale;
  const trackCenterY = transform.y + ((0.28 * swingCanvasH) / height) * 100;
  const trackHalfX = Math.max(14, ((0.27 * radarSize * swingScale) / width) * 100);
  return { left: transform.x-trackHalfX, right: transform.x+trackHalfX, top: trackCenterY-6, bottom: trackCenterY+6 };
}
function nearestCornerDistance(point: {x:number;y:number}, bounds: ReturnType<typeof targetBounds>) { return Math.min(...[[bounds.left,bounds.top],[bounds.right,bounds.top],[bounds.left,bounds.bottom],[bounds.right,bounds.bottom]].map(([x,y]) => Math.hypot(point.x-x,point.y-y))); }
export function clampShowcaseTransform(target: ShowcaseTarget, transform: ShowcaseTransform) { const base=targetBaseBounds(target); const scale=Math.max(35,Math.min(220,50/base.x*100,50/base.y*100,transform.scale)); const bounds = targetBounds(target, { ...transform, x:0, y:0, scale }); const halfX=(bounds.right-bounds.left)/2, halfY=(bounds.bottom-bounds.top)/2; return { ...transform, scale, x:Math.max(halfX,Math.min(100-halfX,transform.x)), y:Math.max(halfY,Math.min(100-halfY,transform.y)) }; }
function drawShowcaseSelection(canvas: HTMLCanvasElement, target: ShowcaseTarget, transform: ShowcaseTransform, bounds: ReturnType<typeof targetBounds>) {
  const ctx=canvas.getContext("2d"); if(!ctx)return; const sx=canvas.width/100, sy=canvas.height/100; ctx.save(); ctx.strokeStyle="#f3f5f7"; ctx.lineWidth=Math.max(1,canvas.width/1200); ctx.setLineDash([6,5]); ctx.strokeRect(bounds.left*sx,bounds.top*sy,(bounds.right-bounds.left)*sx,(bounds.bottom-bounds.top)*sy); ctx.setLineDash([]); ctx.fillStyle="#f3f5f7"; ctx.strokeStyle="#111418"; const size=Math.max(5,canvas.width/240); for(const [x,y] of [[bounds.left,bounds.top],[bounds.right,bounds.top],[bounds.left,bounds.bottom],[bounds.right,bounds.bottom]]) { ctx.fillRect(x*sx-size/2,y*sy-size/2,size,size); ctx.strokeRect(x*sx-size/2,y*sy-size/2,size,size); } ctx.font=`600 ${Math.max(9,canvas.width/140)}px "Noto Sans SC",system-ui`; ctx.fillStyle="#f3f5f7"; ctx.fillText(({radar:"雷达",title:"主标题",subtitle:"副标题",image:"人物图",swing:"Round Swing"} as Record<string,string>)[target],bounds.left*sx,bounds.top*sy-size); ctx.restore(); void transform;
}

export function showcaseDuration(slides: ShowcaseSlide[]) {
  return slides.reduce((sum, slide) => sum + slide.duration * 1000, 0);
}
export function resizedShowcaseDuration(
  initialDuration: number,
  deltaX: number,
  trackWidth: number,
  timelineDurationMs: number,
  edge: "start" | "end",
) {
  const secondsPerPixel = timelineDurationMs / 1000 / Math.max(1, trackWidth);
  const signedDelta = deltaX * secondsPerPixel * (edge === "end" ? 1 : -1);
  return Math.round(Math.max(0.5, Math.min(60, initialDuration + signedDelta)) * 10) / 10;
}
export function rating3Available(radar: RadarResponse) {
  return Boolean(radar.profiles?.rating_3 || radar.rating_3_status?.available);
}
export function audioOffsetFromDrag(
  initialOffsetMs: number,
  deltaX: number,
  trackWidth: number,
  timelineDurationMs: number,
  minimumMs: number,
  maximumMs: number,
) {
  const millisecondsPerPixel = timelineDurationMs / Math.max(1, trackWidth);
  const next = initialOffsetMs + deltaX * millisecondsPerPixel;
  return Math.round(Math.max(minimumMs, Math.min(maximumMs, next)));
}
export function timelineTickStep(durationMs: number, pixelsPerSecond: number) {
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const minimumSeconds = Math.max(1, 72 / Math.max(1, pixelsPerSecond));
  const densitySeconds = Math.max(minimumSeconds, durationMs / 1000 / 800);
  return (candidates.find((value) => value >= densitySeconds) ?? 3600) * 1000;
}
export function audioOffsetLabel(offsetMs: number) {
  if (Math.abs(offsetMs) < 50) return "从素材 0.0s 播放";
  if (offsetMs < 0) return `从素材 ${(-offsetMs / 1000).toFixed(1)}s 播放`;
  return `延后 ${(offsetMs / 1000).toFixed(1)}s 播放`;
}
export function showcaseSlideStart(slides: ShowcaseSlide[], index: number) {
  return slides
    .slice(0, index)
    .reduce((sum, slide) => sum + slide.duration * 1000, 0);
}
export function showcaseSegment(slides: ShowcaseSlide[], timeMs: number) {
  let elapsed = 0;
  for (let index = 0; index < slides.length; index += 1) {
    const duration = slides[index].duration * 1000;
    if (timeMs < elapsed + duration || index === slides.length - 1)
      return { index, offsetMs: Math.max(0, timeMs - elapsed) };
    elapsed += duration;
  }
  return { index: 0, offsetMs: 0 };
}
export function settledShowcasePreviewTime(
  slides: ShowcaseSlide[],
  timeMs: number,
) {
  if (!slides.length) return 0;
  const segment = showcaseSegment(slides, timeMs);
  const start = showcaseSlideStart(slides, segment.index);
  return Math.min(showcaseDuration(slides), Math.max(timeMs, start + 1000));
}
export const SHOWCASE_TRANSITION_MS = 1000;
export function showcaseTransitionProgress(
  slides: ShowcaseSlide[],
  timeMs: number,
) {
  const segment = showcaseSegment(slides, timeMs);
  if (segment.index === 0) return 1;
  return easeInOut(
    Math.min(1, segment.offsetMs / SHOWCASE_TRANSITION_MS),
  );
}
export function interpolateRadarResponse(
  previous: RadarResponse,
  next: RadarResponse,
  progress: number,
): RadarResponse {
  const amount = Math.max(0, Math.min(1, progress));
  const values = next.radar.dimensions.map((dimension, index) => {
    const previousIndex = previous.radar.dimensions.indexOf(dimension);
    const from =
      previousIndex >= 0 ? previous.radar.values[previousIndex] : null;
    const to = next.radar.values[index];
    if (from == null) return to;
    if (to == null) return from;
    return from + (to - from) * amount;
  });
  const prevSwing = previous.radar.round_swing;
  const nextSwing = next.radar.round_swing;
  const roundSwing = prevSwing != null && nextSwing != null
    ? prevSwing + (nextSwing - prevSwing) * amount
    : (nextSwing ?? prevSwing);
  return {
    ...next,
    radar: {
      ...next.radar,
      values,
      round_swing: roundSwing,
      metrics: next.radar.metrics.map((metric, index) => ({
        ...metric,
        value: values[index] ?? null,
      })),
    },
  };
}
export function stripRatingProfiles(
  response: RadarResponse,
): RadarResponse {
  const { profiles, ...rest } = response;
  void profiles;
  return rest;
}
export function bestMetricIndexesForSlide(
  slides: ShowcaseSlide[],
  slideIndex: number,
) {
  if (slides.length < 2 || !slides[slideIndex]) return [];
  const current = slides[slideIndex];
  return current.radar.radar.dimensions.flatMap((dimension, index) => {
    const value = current.radar.radar.values[index];
    if (value == null || !Number.isFinite(value)) return [];
    const others = slides
      .filter((_, candidateIndex) => candidateIndex !== slideIndex)
      .map((slide) => {
        const candidateIndex = slide.radar.radar.dimensions.indexOf(dimension);
        return candidateIndex >= 0
          ? slide.radar.radar.values[candidateIndex]
          : null;
      })
      .filter((candidate): candidate is number =>
        candidate == null ? false : Number.isFinite(candidate),
      );
    return others.length && others.every((candidate) => value > candidate)
      ? [index]
      : [];
  });
}
export function showcaseCanvasTextAlign(
  alignment: "left" | "center" | "right" | undefined,
) {
  if (alignment === "left") return "right" as const;
  if (alignment === "right") return "left" as const;
  return "center" as const;
}
function formatDuration(timeMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function averageRadar(entries: OverlayEntry[]): RadarResponse | null {
  if (entries.length < 2) return null;
  const first = entries[0].radar;
  const averagePayload = (payloads: RadarResponse["radar"][]) => {
    const source = payloads[0];
    const values = source.values.map((_, i) => {
      const usable = payloads
      .map((payload) => payload.values[i])
      .filter((value): value is number => value != null);
      return usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : null;
    });
    const swings = payloads.map((payload) => payload.round_swing).filter((value): value is number => value != null);
    return { ...source, values, round_swing: swings.length ? swings.reduce((a, b) => a + b, 0) / swings.length : undefined, metrics: source.metrics.map((metric, i) => ({ ...metric, value: values[i] })) };
  };
  const rating2 = averagePayload(entries.map((entry) => entry.radar.profiles?.rating_2 ?? entry.radar.radar));
  const rating3Payloads = entries.map((entry) => entry.radar.profiles?.rating_3).filter((payload): payload is RadarResponse["radar"] => Boolean(payload));
  const rating3 = rating3Payloads.length === entries.length ? averagePayload(rating3Payloads) : undefined;
  return {
    ...first,
    player: { name: "队列平均", steam_id: "average" },
    match_count: entries.length,
    radar: rating2,
    profiles: { rating_2: rating2, ...(rating3 ? { rating_3: rating3 } : {}) },
    rating_3_status: { available: Boolean(rating3), reason: rating3 ? undefined : "队列中的部分数据不支持 Rating 3.0。" },
  };
}
export { appendOverlayEntry } from "./draftMutations";
export function showcasePaintOrder(layers: string[]) {
  return [...layers].reverse();
}
const showcaseImageCache = new Map<string, HTMLImageElement>();
function loadImage(url: string) {
  const cached = showcaseImageCache.get(url);
  if (cached?.complete) return Promise.resolve(cached);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = cached ?? new Image();
    showcaseImageCache.set(url, image);
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("人物图片加载失败，请检查外部 URL 或重新上传"));
    if (!cached) image.src = url;
  });
}
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const scale = Math.max(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const w = image.naturalWidth * scale,
    h = image.naturalHeight * scale;
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
function easeInOut(progress: number) {
  const value = Math.max(0, Math.min(1, progress));
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
function wrap(value: number, size: number) {
  return ((value % size) + size) % size;
}
const particleSpriteCache = new Map<string, HTMLCanvasElement>();
function particleGlowSprite(color: string, bloom: number): HTMLCanvasElement {
  const key = `${color}|${bloom}`;
  const cached = particleSpriteCache.get(key);
  if (cached) return cached;
  const size = Math.ceil(bloom * 2) + 2;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d")!;
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
function renderShowcaseFrame(
  slides: ShowcaseSlide[],
  layout: ShowcaseLayoutDraft,
  width: number,
  height: number,
  timeMs: number,
  targetCanvas?: HTMLCanvasElement,
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
  const canvas = targetCanvas ?? document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
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
  const radar = document.createElement("canvas");
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
        ? Math.max(boxW / image.naturalWidth, boxH / image.naturalHeight)
        : Math.min(boxW / image.naturalWidth, boxH / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
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
async function ensureShowcaseFonts() {
  if (!document.fonts) throw new Error("当前运行环境不支持字体加载检测。");
  const [radarFont, bestFont] = await Promise.all([document.fonts.load('700 32px "Noto Sans SC"'), document.fonts.load('400 24px "Bangers"')]);
  if (!radarFont.length || !bestFont.length || !document.fonts.check('700 32px "Noto Sans SC"') || !document.fonts.check('400 24px "Bangers"')) throw new Error("离线字体加载失败，已取消渲染以避免系统字体回退。");
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Range({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="range-field">
      <span>
        {label}
        <strong>{Math.round(value * 10) / 10}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function SaveStatus({
  state,
  onRetry,
}: {
  state: SaveState;
  onRetry: () => void;
}) {
  return (
    <span className={`save-state ${state}`} aria-live="polite">
      <Save size={14} />
      {state === "saving"
        ? "保存中"
        : state === "error"
          ? "保存失败"
          : state === "saved"
            ? "已保存"
            : "自动保存"}
      {state === "error" && <button onClick={onRetry}>重试</button>}
    </span>
  );
}
function SizePreset({
  value,
  onChange,
}: {
  value: { w: number; h: number };
  onChange: (w: number, h: number) => void;
}) {
  const presets = [
    [1920, 1080, "1080p"],
    [2560, 1440, "1440p"],
    [3840, 2160, "4K"],
    [1080, 1920, "竖屏"],
  ] as const;
  return (
    <>
      <Field label="导出尺寸">
        <select
          value={`${value.w}x${value.h}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split("x").map(Number);
            onChange(w, h);
          }}
        >
          {presets.map(([w, h, label]) => (
            <option value={`${w}x${h}`} key={label}>
              {label} · {w}×{h}
            </option>
          ))}
          <option value={`${value.w}x${value.h}`}>
            自定义 · {value.w}×{value.h}
          </option>
        </select>
      </Field>
      <div className="two-fields">
        <Field label="宽度">
          <input
            type="number"
            min="1"
            max="8192"
            value={value.w}
            onChange={(e) => onChange(Number(e.target.value), value.h)}
          />
        </Field>
        <Field label="高度">
          <input
            type="number"
            min="1"
            max="8192"
            value={value.h}
            onChange={(e) => onChange(value.w, Number(e.target.value))}
          />
        </Field>
      </div>
    </>
  );
}
