import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Download, GripVertical, Pause, Play, Plus, SkipBack, SkipForward, SlidersHorizontal, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { bridge } from "../../bridge";
import { Spinner } from "../../components/Busy";
import { PlayerAvatarView } from "../../components/PlayerAvatar";
import { Field, Range, SaveStatus } from "../../components/ui";
import type { AppConfig, PlayerAvatar, PlayerMedia, ShowcaseDataPanelJellyParams, ShowcaseDraft, ShowcaseElement, ShowcaseIntroConfig, ShowcaseLayoutDraft, ShowcaseSlide, StudioKind, StudioSeed } from "../../types";
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
  FIRST_PLAYER_ARRIVAL_TOTAL_MS,
  SHOWCASE_IMAGE_SCALE_MAX,
  SHOWCASE_IMAGE_SCALE_MIN,
  SHOWCASE_LAYER_LABELS,
  SHOWCASE_SUBTITLE_FONT_SIZE,
  SHOWCASE_TEAM_LOGO_SCALE_MIN,
  SHOWCASE_TITLE_FONT_SIZE,
  normalizeShowcaseDimensions,
  normalizeShowcaseLayers,
  resolveImageTransform,
  resolveTeamLogoTransform,
  showcaseAudioGain,
  showcaseBestEntranceDuration,
  showcaseDefaultLayers,
  showcaseDuration,
  showcaseIntroDuration,
  showcaseIntroState,
  DEFAULT_JELLY_PARAMS,
  DEFAULT_SHOWCASE_INTRO_STAGES,
  showcaseSegment,
  showcaseSlideStart,
  timelineTickStep,
  type ShowcaseTarget,
} from "./showcaseMath";
import {
  ensureShowcaseFonts,
  loadImage,
  retainShowcaseImages,
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
  const [draft, setDraft, saveState, retrySave, draftReady] = useDraft<ShowcaseDraft>(
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
        teamLogoX: 68,
        teamLogoY: 50,
        teamLogoScale: 100,
        metricLabelFontSize: 12,
        swingX: 34,
        swingY: 78,
        swingScale: 100,
        opacity: 100,
        layers: showcaseDefaultLayers(config.rating_version),
        nameAlign: "center" as "left" | "center" | "right",
        imageFit: "contain" as "contain" | "cover",
      },
      fps: config.video_fps,
      width: SHOWCASE_EXPORT_WIDTH,
      height: SHOWCASE_EXPORT_HEIGHT,
      audioOffsetMs: config.showcase.audio_offset_ms,
      audioVolume: 100,
      intro: {
        stages: {
          matchInfo: 6.0,
          empty: 2.0,
          reference: 2.0,
          average: 2.0,
          outro: 2.0,
        },
        elements: [
          {
            id: "match-title",
            type: "text",
            content: "MATCH SHOWCASE",
            x: 50,
            y: 42,
            fontSize: 52,
            color: "#f4f6f8",
            align: "center",
            fontWeight: "800",
          },
          {
            id: "match-subtitle",
            type: "text",
            content: "CS2 STATS RADAR · TOURNAMENT RECAP",
            x: 50,
            y: 53,
            fontSize: 22,
            color: "#94a3b8",
            align: "center",
            fontWeight: "normal",
          },
        ] as ShowcaseElement[],
        blackFadeIn: true,
        jellyParams: DEFAULT_JELLY_PARAMS as ShowcaseDataPanelJellyParams,
      } as ShowcaseIntroConfig,
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
  const audioGraph = useRef<{
    context: AudioContext;
    source: MediaElementAudioSourceNode;
    gain: GainNode;
    element: HTMLAudioElement;
  } | null>(null);

  function ensureAudioGraph(audio: HTMLAudioElement) {
    const existing = audioGraph.current;
    if (existing && existing.context.state !== "closed" && existing.element === audio)
      return existing;
    if (existing) {
      existing.source.disconnect();
      existing.gain.disconnect();
      void existing.context.close();
      audioGraph.current = null;
    }
    const AudioContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = new AudioContextClass();
    const source = context.createMediaElementSource(audio);
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);
    audioGraph.current = { context, source, gain, element: audio };
    return audioGraph.current;
  }
  const [selectedIntroElementId, setSelectedIntroElementId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<ShowcaseTarget | null>(null);
  // 拖动中的实时变换：画布用 pending 变换绘制，属性面板也同步显示，
  // 松手后才写回草稿，因此这里不能等 setDraft 生效。
  const [dragPreview, setDragPreview] = useState<{ target: ShowcaseTarget; transform: { x: number; y: number; scale: number } } | null>(null);
  const handleTransformPreview = (target: ShowcaseTarget | null, transform: { x: number; y: number; scale: number } | null) =>
    setDragPreview(target && transform ? { target, transform } : null);
  const introImageInputRef = useRef<HTMLInputElement>(null);
  const targetImageIdToReplace = useRef<string | null>(null);
  const teamLogoInputRef = useRef<HTMLInputElement>(null);
  const handleTeamLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setDraft((current) => {
        if (!current.slides.length) return current;
        const index = Math.max(0, Math.min(current.slides.length - 1, previewIndex));
        const slides = current.slides.map((item, candidate) =>
          candidate === index ? { ...item, teamLogoUrl: dataUrl } : item,
        );
        const layers = normalizeShowcaseLayers(
          current.layout.layers,
          config.rating_version,
        );
        return { ...current, slides, layout: { ...current.layout, layers } };
      });
      if (teamLogoInputRef.current) teamLogoInputRef.current.value = "";
    };
    reader.readAsDataURL(file);
  };

  const patchIntro = (patch: Partial<ShowcaseIntroConfig>) => {
    setDraft((curr) => ({
      ...curr,
      intro: {
        stages: curr.intro?.stages ?? { matchInfo: 6.0, empty: 2.0, reference: 2.0, average: 2.0, outro: 2.0 },
        elements: curr.intro?.elements ?? [],
        blackFadeIn: patch.blackFadeIn ?? curr.intro?.blackFadeIn ?? true,
        jellyParams: patch.jellyParams ?? curr.intro?.jellyParams ?? DEFAULT_JELLY_PARAMS,
        ...patch,
      },
    }));
  };
  const patchIntroStages = (patch: Partial<ShowcaseIntroConfig["stages"]>) => {
    patchIntro({
      stages: {
        ...(draft.intro?.stages ?? { matchInfo: 6.0, empty: 2.0, reference: 2.0, average: 2.0, outro: 2.0 }),
        ...patch,
      },
    });
  };
  const addIntroText = () => {
    const newId = `text-${Date.now()}`;
    const newEl = {
      id: newId,
      type: "text" as const,
      content: "新比赛标题 / 信息",
      x: 50,
      y: 50,
      fontSize: 46,
      color: "#f4f6f8",
      align: "center" as const,
      fontWeight: "bold" as const,
    };
    patchIntro({ elements: [...(draft.intro?.elements ?? []), newEl] });
    setSelectedIntroElementId(newId);
  };
  const handleIntroImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const naturalW = img.naturalWidth || 380;
        const naturalH = img.naturalHeight || 380;
        if (targetImageIdToReplace.current) {
          updateIntroElement(targetImageIdToReplace.current, {
            url: dataUrl,
            width: naturalW,
            height: naturalH,
          });
          targetImageIdToReplace.current = null;
        } else {
          const newId = `img-${Date.now()}`;
          const newEl: ShowcaseElement = {
            id: newId,
            type: "image",
            url: dataUrl,
            x: 50,
            y: 35,
            scale: 100,
            width: naturalW,
            height: naturalH,
          };
          patchIntro({ elements: [...(draft.intro?.elements ?? []), newEl] });
          setSelectedIntroElementId(newId);
        }
        if (introImageInputRef.current) introImageInputRef.current.value = "";
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };
  const deleteIntroElement = (id: string) => {
    patchIntro({
      elements: (draft.intro?.elements ?? []).filter((el) => el.id !== id),
    });
    if (selectedIntroElementId === id) setSelectedIntroElementId(null);
  };
  const updateIntroElement = (id: string, patch: Record<string, any>) => {
    patchIntro({
      elements: (draft.intro?.elements ?? []).map((el) => (el.id === id ? { ...el, ...patch } : el)),
    });
  };

  const animationOptions = useMemo(() => ({
    showIntroAnimation: config.showcase.show_intro_animation,
    showBestEntranceAnimation: config.showcase.show_best_entrance_animation,
    reduceMotion: config.reduce_motion,
    introStages: draft.intro?.stages,
    introElements: draft.intro?.elements,
    blackFadeIn: draft.intro?.blackFadeIn ?? true,
    jellyParams: draft.intro?.jellyParams,
  }), [
    config.reduce_motion,
    config.showcase.show_best_entrance_animation,
    config.showcase.show_intro_animation,
    draft.intro,
  ]);
  const totalDuration = showcaseDuration(draft.slides, animationOptions);
  const introDuration = showcaseIntroDuration(animationOptions, draft.intro?.stages);
  const previewIndex = showcaseSegment(draft.slides, previewTime, animationOptions).index;
  const audioOffsetMs =
    draft.audioOffsetMs ?? config.showcase.audio_offset_ms ?? 0;
  const audioVolume = draft.audioVolume ?? 100;
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
    const audio = audioRef.current;
    if (!audio || !musicURL) return;
    const graph = ensureAudioGraph(audio);
    if (!graph) return;
    graph.gain.gain.setValueAtTime(showcaseAudioGain(audioVolume), graph.context.currentTime);
    if (playing) void graph.context.resume();
  }, [musicURL, audioVolume, playing]);
  useEffect(
    () => () => {
      const graph = audioGraph.current;
      audioGraph.current = null;
      if (!graph) return;
      graph.source.disconnect();
      graph.gain.disconnect();
      void graph.context.close();
    },
    [],
  );
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
                    subtitle: `#${current.slides.length + 1}`,
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
    if (!draft.slides.length) return;
    if (
      previewIndex >= 0 &&
      previewIndex < draft.slides.length &&
      draft.active !== previewIndex
    ) {
      setDraft((current) =>
        current.active === previewIndex
          ? current
          : { ...current, active: previewIndex },
      );
    }
  }, [previewIndex, draft.slides.length, draft.active]);
  const slide = draft.slides[draft.active];
  const draggedImageTransform = dragPreview?.target === "image" ? dragPreview.transform : null;
  const draggedTeamLogoTransform = dragPreview?.target === "teamLogo" ? dragPreview.transform : null;
  function handleTimelineSeek(event: React.MouseEvent<HTMLDivElement>) {
    const track = timelineTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const clickX = Math.max(0, event.clientX - rect.left);
    const targetSeconds = clickX / timelinePixelsPerSecond;
    seekPreview(targetSeconds * 1000);
  }

  function seekPreview(time: number) {
    const clamped = Math.max(0, Math.min(time, totalDuration));
    previewTimeRef.current = clamped;
    setPreviewTime(clamped);
  }

  function handleSelectTarget(target: ShowcaseTarget | null) {
    setSelectedTarget(target);
    if (!target) return;
    // 片头阶段不绘制玩家场景元素，选中后直接跳到首位玩家就位结束，避免「改了却看不见」
    if (showcaseSegment(draft.slides, previewTime, animationOptions).phase !== "intro") return;
    if (!draft.slides.length) return;
    seekPreview(
      showcaseSlideStart(draft.slides, 0, animationOptions) +
        showcaseBestEntranceDuration(draft.slides, 0, animationOptions) +
        FIRST_PLAYER_ARRIVAL_TOTAL_MS,
    );
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
    if (!playing && previewTime >= totalDuration) {
      // 必须同时重置 rAF 时钟的 ref，否则第一拍会把时间钳回结尾导致无法重播。
      previewTimeRef.current = 0;
      setPreviewTime(0);
    }
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
  const layerKeys = normalizeShowcaseLayers(
    draft.layout.layers,
    config.rating_version,
  );
  function moveLayer(from: number, to: number) {
    if (from === to || to < 0 || to >= layerKeys.length) return;
    const layers = [...layerKeys];
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
    // Worker + 二进制帧是唯一主路径（与 AGENTS  invariant 一致）；
    // 仅当 VITE_SHOWCASE_EXPORT_MAIN_THREAD=1 时强制走主线程 base64 回退（调试用）。
    const forceMainThread =
      import.meta.env.VITE_SHOWCASE_EXPORT_MAIN_THREAD === "1";
    if (
      !forceMainThread &&
      typeof Worker !== "undefined" &&
      typeof OffscreenCanvas !== "undefined"
    )
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
            radarFloorValues: config.showcase.radar_floor ?? {},
            animations: animationOptions,
          },
          imageUrls: Array.from(
            new Set(
              draft.slides.flatMap((item) =>
                [showcasePlayerImageUrl(item), item.backgroundUrl, item.teamLogoUrl].filter(
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
        audioVolume,
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
              | { type: "frames"; start: number; blobs: Blob[] }
              | { type: "cancelled" }
              | { type: "error"; message: string };
            worker!.removeEventListener("message", onMessage);
            if (message.type === "frames" && message.start === frame)
              resolve(message.blobs);
            else if (message.type === "frames")
              reject(new Error("视频帧批次顺序异常。"));
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
      window.location.href = bridge.resolveServerUrl(result.url);
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
      const imageUrls = draft.slides.flatMap((item) =>
        [showcasePlayerImageUrl(item), item.backgroundUrl, item.teamLogoUrl].filter(
          (url): url is string => Boolean(url),
        ),
      );
      retainShowcaseImages(imageUrls);
      await Promise.all(imageUrls.map(loadImage));
      exportId = await bridge.beginVideoExport(
        SHOWCASE_EXPORT_WIDTH,
        SHOWCASE_EXPORT_HEIGHT,
        draft.fps,
        durationMs,
        audioOffsetMs,
        "cs2-showcase.mp4",
        audioVolume,
      );
      if (!exportId) {
        setExportState({ running: false, progress: 0, message: "已取消导出" });
        return;
      }
      exportID.current = exportId;
      const batch: string[] = [];
      let batchStart = 0;
      const frameCanvas = document.createElement("canvas");
      for (let frame = 0; frame < frameCount; frame++) {
        if (cancelRequested.current) throw new Error("视频导出已取消");
        const timeMs = (frame / draft.fps) * 1000;
        renderShowcaseFrame(
          draft.slides,
          draft.layout,
          SHOWCASE_EXPORT_WIDTH,
          SHOWCASE_EXPORT_HEIGHT,
          timeMs,
          frameCanvas,
          config.showcase.show_best_markers,
          config.showcase.radar_scale_mode,
          config.showcase.radar_scale,
          config.showcase.radar_axis_scale,
          config.rating_version,
          config.show_rating_watermark,
          1,
          draft.layout.metricLabelFontSize ?? 12,
          animationOptions,
          config.showcase.radar_floor ?? {},
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
      const result = await bridge.finishVideoExport(exportId);
      exportID.current = "";
      window.location.href = bridge.resolveServerUrl(result.url);
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
          radarFloorValues={config.showcase.radar_floor ?? {}}
          selectedIntroElementId={selectedIntroElementId}
          onSelectIntroElement={setSelectedIntroElementId}
          onDeleteIntroElement={deleteIntroElement}
          onUpdateIntroElement={updateIntroElement}
          onSelectTarget={handleSelectTarget}
          onTransformPreview={handleTransformPreview}
          onLayoutChange={(layout) =>
            setDraft((current) => ({ ...current, layout }))
          }
          onImageTransformChange={(imageTransform) =>
            setDraft((current) => ({
              ...current,
              layout: {
                ...current.layout,
                imageX: imageTransform.x,
                imageY: imageTransform.y,
                imageScale: imageTransform.scale,
              },
            }))
          }
          onTeamLogoTransformChange={(teamLogoTransform, slideIndex) =>
            setDraft((current) => {
              const targetIdx = slideIndex ?? previewIndex;
              return {
                ...current,
                layout: {
                  ...current.layout,
                  teamLogoX: teamLogoTransform.x,
                  teamLogoY: teamLogoTransform.y,
                  teamLogoScale: teamLogoTransform.scale,
                },
                slides: current.slides.map((item, index) =>
                  index === targetIdx
                    ? {
                        ...item,
                        teamLogoTransform: {
                          x: teamLogoTransform.x,
                          y: teamLogoTransform.y,
                          scale: teamLogoTransform.scale,
                        },
                      }
                    : item,
                ),
              };
            })
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
            {musicURL && (
              <label className="audio-volume-control">
                <span>音量</span>
                <input
                  aria-label="背景音乐音量"
                  type="number"
                  step="5"
                  value={audioVolume}
                  onChange={(event) => {
                    const next = event.currentTarget.valueAsNumber;
                    if (!Number.isFinite(next)) return;
                    setDraft((current) => ({ ...current, audioVolume: next }));
                  }}
                />
                <span>%</span>
              </label>
            )}
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
                <div
                  className="timeline-time-ruler"
                  aria-hidden="true"
                  onClick={handleTimelineSeek}
                  style={{ cursor: "pointer" }}
                >
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
                      className={`showcase-clip intro-clip ${previewTime < introDuration ? "active" : ""}`}
                      style={{ flex: `0 0 ${(introDuration / 1000) * timelinePixelsPerSecond}px`, cursor: "pointer" }}
                      role="button"
                      tabIndex={0}
                      onClick={() => seekPreview(0)}
                    >
                      <span className="clip-title">开场动画</span>
                      <small>{(introDuration / 1000).toFixed(1)}s</small>
                    </div>
                  )}
                  {draft.slides.map((item, index) => (
                    <div
                      style={{ flex: `0 0 ${(item.duration + showcaseBestEntranceDuration(draft.slides, index, animationOptions) / 1000) * timelinePixelsPerSecond}px` }}
                      className={`showcase-clip ${index === previewIndex ? "active" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${item.title}，${item.duration.toFixed(1)} 秒${index > 0 && !showcaseBestEntranceDuration(draft.slides, index, animationOptions) ? "，开头含 1 秒雷达形变与画面叠化" : ""}${showcaseBestEntranceDuration(draft.slides, index, animationOptions) ? "，含 4 秒 BEST 入场与交接" : ""}`}
                      onClick={() => selectSlide(index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectSlide(index);
                        }
                      }}
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
                      {index > 0 && !showcaseBestEntranceDuration(draft.slides, index, animationOptions) && (
                        <span
                          className="clip-transition"
                          aria-hidden="true"
                          style={{ width: `${(SHOWCASE_TRANSITION_MS / 1000) * timelinePixelsPerSecond}px` }}
                        />
                      )}
                      <span
                        className="clip-resize-handle start"
                        role="separator"
                        tabIndex={0}
                        aria-label={`调整 ${item.title} 起点`}
                        onPointerDown={(event) => startSlideResize(event, index, "start")}
                        onPointerMove={continueSlideResize}
                        onPointerUp={finishSlideResize}
                        onPointerCancel={finishSlideResize}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                          event.preventDefault();
                          event.stopPropagation();
                          const direction = event.key === "ArrowRight" ? 1 : -1;
                          const step = event.shiftKey ? 1 : 0.5;
                          patchSlideAt(index, { duration: Math.max(0.5, Math.min(60, item.duration - direction * step)) });
                        }}
                      />
                      <span className="clip-title">{item.title}</span>
                      <small>{item.duration.toFixed(1)}s{showcaseBestEntranceDuration(draft.slides, index, animationOptions) ? " + BEST 4.0s" : ""}</small>
                      <span
                        className="clip-resize-handle end"
                        role="separator"
                        tabIndex={0}
                        aria-label={`调整 ${item.title} 终点`}
                        onPointerDown={(event) => startSlideResize(event, index, "end")}
                        onPointerMove={continueSlideResize}
                        onPointerUp={finishSlideResize}
                        onPointerCancel={finishSlideResize}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                          event.preventDefault();
                          event.stopPropagation();
                          const direction = event.key === "ArrowRight" ? 1 : -1;
                          const step = event.shiftKey ? 1 : 0.5;
                          patchSlideAt(index, { duration: Math.max(0.5, Math.min(60, item.duration + direction * step)) });
                        }}
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
        {previewTime < introDuration ? (
          (() => {
            const currentIntro = showcaseIntroState(previewTime, draft.intro?.stages);
            const isMatchInfo = currentIntro.stage === "matchInfo";
            const elements = (draft.intro?.elements ?? []) as ShowcaseElement[];
            const selectedEl = isMatchInfo ? elements.find((el) => el.id === selectedIntroElementId) : null;

            if (selectedEl && selectedEl.type === "text") {
              return (
                <div className="inspector-content">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span style={{ fontSize: "12px", color: "var(--cyan)", fontWeight: 700 }}>文本元素属性</span>
                    <button className="quiet" style={{ fontSize: "11px", height: "24px" }} onClick={() => setSelectedIntroElementId(null)}>返回阶段</button>
                  </div>
                  <Field label="文本内容">
                    <textarea
                      rows={2}
                      value={selectedEl.content}
                      onChange={(e) => updateIntroElement(selectedEl.id, { content: e.target.value })}
                    />
                  </Field>
                  <div className="two-fields">
                    <Field label="字号 (px)">
                      <input
                        type="number"
                        min="14"
                        max="140"
                        value={selectedEl.fontSize ?? 42}
                        onChange={(e) => updateIntroElement(selectedEl.id, { fontSize: Number(e.target.value) || 42 })}
                      />
                    </Field>
                    <Field label="字体粗细">
                      <select
                        value={selectedEl.fontWeight ?? "bold"}
                        onChange={(e) => updateIntroElement(selectedEl.id, { fontWeight: e.target.value as any })}
                      >
                        <option value="normal">正常 (Normal)</option>
                        <option value="bold">粗体 (Bold)</option>
                        <option value="800">特粗 (800)</option>
                      </select>
                    </Field>
                  </div>
                  <div className="two-fields">
                    <Field label="文本颜色">
                      <input
                        type="color"
                        value={selectedEl.color ?? "#f4f6f8"}
                        onChange={(e) => updateIntroElement(selectedEl.id, { color: e.target.value })}
                      />
                    </Field>
                    <Field label="对齐方式">
                      <select
                        value={selectedEl.align ?? "center"}
                        onChange={(e) => updateIntroElement(selectedEl.id, { align: e.target.value as any })}
                      >
                        <option value="left">居左</option>
                        <option value="center">居中</option>
                        <option value="right">居右</option>
                      </select>
                    </Field>
                  </div>
                  <div className="two-fields">
                    <Field label="水平位置 X (%)">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={selectedEl.x}
                        onChange={(e) => updateIntroElement(selectedEl.id, { x: Number(e.target.value) || 0 })}
                      />
                    </Field>
                    <Field label="垂直位置 Y (%)">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={selectedEl.y}
                        onChange={(e) => updateIntroElement(selectedEl.id, { y: Number(e.target.value) || 0 })}
                      />
                    </Field>
                  </div>
                  <div style={{ marginTop: "16px" }}>
                    <button
                      className="danger-action full"
                      onClick={() => deleteIntroElement(selectedEl.id)}
                    >
                      <Trash2 size={14} /> 删除此文本
                    </button>
                  </div>
                </div>
              );
            }

            if (selectedEl && selectedEl.type === "image") {
              return (
                <div className="inspector-content">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span style={{ fontSize: "12px", color: "var(--cyan)", fontWeight: 700 }}>图片元素属性</span>
                    <button className="quiet" style={{ fontSize: "11px", height: "24px" }} onClick={() => setSelectedIntroElementId(null)}>返回阶段</button>
                  </div>
                  {selectedEl.url && (
                    <div style={{ textAlign: "center", marginBottom: "12px", background: "rgba(0,0,0,0.2)", borderRadius: "8px", padding: "8px" }}>
                      <img
                        src={selectedEl.url}
                        alt="元素预览"
                        style={{ maxHeight: "100px", maxWidth: "100%", objectFit: "contain", borderRadius: "4px" }}
                      />
                    </div>
                  )}
                  <button
                    className="quiet full"
                    style={{ marginBottom: "12px" }}
                    onClick={() => {
                      targetImageIdToReplace.current = selectedEl.id;
                      introImageInputRef.current?.click();
                    }}
                  >
                    更换本地图片
                  </button>
                  <Range
                    label="缩放比例 (%)"
                    min={20}
                    max={300}
                    step={5}
                    value={selectedEl.scale ?? 100}
                    onChange={(value) => updateIntroElement(selectedEl.id, { scale: value })}
                  />
                  <div className="two-fields">
                    <Field label="水平位置 X (%)">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={selectedEl.x}
                        onChange={(e) => updateIntroElement(selectedEl.id, { x: Number(e.target.value) || 0 })}
                      />
                    </Field>
                    <Field label="垂直位置 Y (%)">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={selectedEl.y}
                        onChange={(e) => updateIntroElement(selectedEl.id, { y: Number(e.target.value) || 0 })}
                      />
                    </Field>
                  </div>
                  <div style={{ marginTop: "16px" }}>
                    <button
                      className="danger-action full"
                      onClick={() => deleteIntroElement(selectedEl.id)}
                    >
                      <Trash2 size={14} /> 删除此图片
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div className="inspector-content">
                <div style={{ marginBottom: "12px" }}>
                  <span style={{ fontSize: "12px", color: "var(--cyan)", fontWeight: 700 }}>
                    {isMatchInfo ? "比赛信息阶段设置" : `开场动画（阶段：${currentIntro.stage}）`}
                  </span>
                </div>
                <Field label="比赛信息展示时长 (秒)">
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="30"
                    value={draft.intro?.stages?.matchInfo ?? 2.5}
                    onChange={(e) => patchIntroStages({ matchInfo: Number(e.target.value) || 2.5 })}
                  />
                </Field>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "10px 0" }}>
                  <input
                    id="intro-black-fade-in"
                    type="checkbox"
                    checked={draft.intro?.blackFadeIn ?? true}
                    onChange={(e) => patchIntro({ blackFadeIn: e.target.checked })}
                    style={{ width: "16px", height: "16px", cursor: "pointer" }}
                  />
                  <label htmlFor="intro-black-fade-in" style={{ fontSize: "12px", cursor: "pointer", color: "var(--text)" }}>
                    开场黑屏渐显入场 (Fade in from black)
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", margin: "10px 0" }}>
                  <button className="primary" onClick={addIntroText} style={{ height: "36px" }}>
                    <Plus size={14} /> 添加文字
                  </button>
                  <button className="quiet" onClick={() => introImageInputRef.current?.click()} style={{ height: "36px" }}>
                    <Plus size={14} /> 添加图片
                  </button>
                </div>
                <input
                  ref={introImageInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleIntroImageUpload}
                />
                <h3 style={{ marginTop: "14px", marginBottom: "8px", fontSize: "12px", color: "var(--text-muted)" }}>
                  已添加元素 (点击编辑 / 画布右上角 X 删除)
                </h3>
                <div className="intro-element-list" style={{ display: "grid", gap: "6px" }}>
                  {elements.map((el, idx) => (
                    <div
                      key={el.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        background: el.id === selectedIntroElementId ? "rgba(34, 211, 238, 0.12)" : "rgba(255,255,255,0.04)",
                        border: el.id === selectedIntroElementId ? "1px solid var(--cyan)" : "1px solid var(--border)",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                      onClick={() => setSelectedIntroElementId(el.id)}
                    >
                      <span style={{ fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "160px" }}>
                        {el.type === "text" ? `📝 ${(el as any).content || "无内容"}` : `🖼️ 图片元素 #${idx + 1}`}
                      </span>
                      <button
                        className="icon-button danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteIntroElement(el.id);
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {!elements.length && (
                    <div style={{ fontSize: "12px", color: "var(--text-dim)", padding: "4px 0" }}>
                      暂无自定义元素，点击上方按钮添加文字或图片
                    </div>
                  )}
                </div>
              </div>
            );
          })()
        ) : slide ? (
          <>
            {selectedTarget === "image" ? (
              <div className="inspector-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <span style={{ fontSize: "12px", color: "var(--cyan)", fontWeight: 700 }}>人物立绘设置</span>
                  <button className="quiet" style={{ fontSize: "11px", height: "24px" }} onClick={() => setSelectedTarget(null)}>显示全部</button>
                </div>
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
                    <button onClick={() => chooseMedia("image")}>更换人物图</button>
                  )}
                </div>
                <div className="two-fields">
                  <Field label="水平偏移 X">
                    <input
                      type="number"
                      step="5"
                      value={Math.round(draggedImageTransform?.x ?? resolveImageTransform(draft.layout).x)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          layout: { ...draft.layout, imageX: Number(e.target.value) || 0 },
                        })
                      }
                    />
                  </Field>
                  <Field label="垂直偏移 Y">
                    <input
                      type="number"
                      step="5"
                      value={Math.round(draggedImageTransform?.y ?? resolveImageTransform(draft.layout).y)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          layout: { ...draft.layout, imageY: Number(e.target.value) || 0 },
                        })
                      }
                    />
                  </Field>
                </div>
                <Range
                  label="人物立绘比例"
                  min={SHOWCASE_IMAGE_SCALE_MIN}
                  max={SHOWCASE_IMAGE_SCALE_MAX}
                  step={1}
                  value={draggedImageTransform?.scale ?? draft.layout.imageScale ?? 100}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      layout: { ...draft.layout, imageScale: value },
                    })
                  }
                />
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
                    <option value="contain">完整显示 (Contain)</option>
                    <option value="cover">填满区域 (Cover)</option>
                  </select>
                </Field>
                <button
                  type="button"
                  className="quiet"
                  style={{ fontSize: "11px", height: "28px", marginTop: "8px" }}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      layout: {
                        ...current.layout,
                        imageX: 73,
                        imageY: 57,
                        imageScale: 100,
                      },
                    }))
                  }
                >
                  重置人物位置与缩放
                </button>
              </div>
            ) : selectedTarget === "teamLogo" ? (
              <div className="inspector-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <span style={{ fontSize: "12px", color: "var(--cyan)", fontWeight: 700 }}>战队 Logo 设置</span>
                  <button className="quiet" style={{ fontSize: "11px", height: "24px" }} onClick={() => setSelectedTarget(null)}>显示全部</button>
                </div>
                <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                  <button className="quiet" onClick={() => teamLogoInputRef.current?.click()} style={{ flex: 1 }}>更换 Logo</button>
                  {slide.teamLogoUrl && (
                    <button className="danger-action" onClick={() => patchSlideAt(previewIndex, { teamLogoUrl: undefined })} style={{ flex: 1 }}>清除 Logo</button>
                  )}
                </div>
                {(() => {
                  const targetSlide = draft.slides[previewIndex] ?? slide;
                  const resolved = resolveTeamLogoTransform(draft.layout, targetSlide);
                  const currentX = Math.round(draggedTeamLogoTransform?.x ?? resolved.x);
                  const currentY = Math.round(draggedTeamLogoTransform?.y ?? resolved.y);
                  const currentScale = Math.round(draggedTeamLogoTransform?.scale ?? resolved.scale);
                  return (
                    <>
                      <div className="two-fields">
                        <Field label="水平偏移 X">
                          <input
                            type="number"
                            step="5"
                            value={currentX}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              setDraft((curr) => {
                                const targetIdx = previewIndex;
                                return {
                                  ...curr,
                                  layout: { ...curr.layout, teamLogoX: val },
                                  slides: curr.slides.map((item, index) =>
                                    index === targetIdx
                                      ? {
                                          ...item,
                                          teamLogoTransform: {
                                            x: val,
                                            y: item.teamLogoTransform?.y ?? curr.layout.teamLogoY ?? 50,
                                            scale: item.teamLogoTransform?.scale ?? curr.layout.teamLogoScale ?? 100,
                                          },
                                        }
                                      : item,
                                  ),
                                };
                              });
                            }}
                          />
                        </Field>
                        <Field label="垂直偏移 Y">
                          <input
                            type="number"
                            step="5"
                            value={currentY}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              setDraft((curr) => {
                                const targetIdx = previewIndex;
                                return {
                                  ...curr,
                                  layout: { ...curr.layout, teamLogoY: val },
                                  slides: curr.slides.map((item, index) =>
                                    index === targetIdx
                                      ? {
                                          ...item,
                                          teamLogoTransform: {
                                            x: item.teamLogoTransform?.x ?? curr.layout.teamLogoX ?? 68,
                                            y: val,
                                            scale: item.teamLogoTransform?.scale ?? curr.layout.teamLogoScale ?? 100,
                                          },
                                        }
                                      : item,
                                  ),
                                };
                              });
                            }}
                          />
                        </Field>
                      </div>
                      <Field label="缩放 %（不设上限）">
                        <input
                          type="number"
                          step="10"
                          min={SHOWCASE_TEAM_LOGO_SCALE_MIN}
                          value={currentScale}
                          onChange={(e) => {
                            const scale = Math.max(
                              SHOWCASE_TEAM_LOGO_SCALE_MIN,
                              Number(e.target.value) || SHOWCASE_TEAM_LOGO_SCALE_MIN,
                            );
                            setDraft((curr) => {
                              const targetIdx = previewIndex;
                              return {
                                ...curr,
                                layout: { ...curr.layout, teamLogoScale: scale },
                                slides: curr.slides.map((item, index) =>
                                  index === targetIdx
                                    ? {
                                        ...item,
                                        teamLogoTransform: {
                                          x: item.teamLogoTransform?.x ?? curr.layout.teamLogoX ?? 68,
                                          y: item.teamLogoTransform?.y ?? curr.layout.teamLogoY ?? 50,
                                          scale,
                                        },
                                      }
                                    : item,
                                ),
                              };
                            });
                          }}
                        />
                      </Field>
                    </>
                  );
                })()}
              </div>
            ) : selectedTarget === "title" || selectedTarget === "subtitle" ? (
              <div className="inspector-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <span style={{ fontSize: "12px", color: "var(--cyan)", fontWeight: 700 }}>
                    {selectedTarget === "title" ? "主标题设置" : "副标题设置"}
                  </span>
                  <button className="quiet" style={{ fontSize: "11px", height: "24px" }} onClick={() => setSelectedTarget(null)}>显示全部</button>
                </div>
                <Field label="主标题">
                  <input
                    value={slide.title}
                    onChange={(e) => patchSlide({ title: e.target.value })}
                  />
                </Field>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <Field label="标题字号 (px)">
                    <input
                      type="number"
                      min="12"
                      max="120"
                      value={Math.round(draft.layout.titleFontSize ?? SHOWCASE_TITLE_FONT_SIZE)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          layout: { ...draft.layout, titleFontSize: Number(e.target.value) || SHOWCASE_TITLE_FONT_SIZE },
                        })
                      }
                    />
                  </Field>
                  <Field label="标题颜色">
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input
                        type="color"
                        value={draft.layout.titleColor ?? "#f4f6f8"}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            layout: { ...draft.layout, titleColor: e.target.value },
                          })
                        }
                        style={{ width: "32px", height: "32px", padding: "0", border: "none", cursor: "pointer", background: "none" }}
                      />
                      <input
                        type="text"
                        value={draft.layout.titleColor ?? "#f4f6f8"}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            layout: { ...draft.layout, titleColor: e.target.value },
                          })
                        }
                        style={{ flex: 1, textTransform: "uppercase" }}
                      />
                    </div>
                  </Field>
                </div>
                <Field label="副标题 (排名)">
                  <input
                    value={slide.subtitle}
                    onChange={(e) => patchSlide({ subtitle: e.target.value })}
                  />
                </Field>
                <div style={{ marginBottom: "10px" }}>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "6px" }}>
                    排名发光颜色预设
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
                    {[
                      { label: "金色", color: "#ffd700", preset: "gold" },
                      { label: "银色", color: "#e2e8f0", preset: "silver" },
                      { label: "铜色", color: "#cd7f32", preset: "bronze" },
                      { label: "白色", color: "#f4f6f8", preset: "white" },
                    ].map((p) => (
                      <button
                        key={p.preset}
                        type="button"
                        className="quiet"
                        style={{
                          height: "28px",
                          fontSize: "11px",
                          fontWeight: 700,
                          color: p.color,
                          borderColor: (draft.layout.subtitlePreset === p.preset || draft.layout.subtitleColor === p.color) ? p.color : "rgba(255,255,255,0.12)",
                          background: (draft.layout.subtitlePreset === p.preset || draft.layout.subtitleColor === p.color) ? "rgba(255,255,255,0.08)" : undefined,
                        }}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            layout: {
                              ...draft.layout,
                              subtitleColor: p.color,
                              subtitlePreset: p.preset as "gold" | "silver" | "bronze" | "white",
                            },
                          })
                        }
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                  <button
                    type="button"
                    className="quiet"
                    style={{
                      flex: 1,
                      height: "28px",
                      fontSize: "11px",
                      fontWeight: 800,
                      color: draft.layout.subtitleBold !== false ? "var(--cyan)" : "var(--text-muted)",
                      borderColor: draft.layout.subtitleBold !== false ? "var(--cyan)" : undefined,
                    }}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        layout: {
                          ...draft.layout,
                          subtitleBold: draft.layout.subtitleBold === false ? true : false,
                        },
                      })
                    }
                  >
                    粗体 (B)
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    style={{
                      flex: 1,
                      height: "28px",
                      fontSize: "11px",
                      fontStyle: "italic",
                      fontWeight: 700,
                      color: draft.layout.subtitleItalic ? "var(--cyan)" : "var(--text-muted)",
                      borderColor: draft.layout.subtitleItalic ? "var(--cyan)" : undefined,
                    }}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        layout: {
                          ...draft.layout,
                          subtitleItalic: !draft.layout.subtitleItalic,
                        },
                      })
                    }
                  >
                    斜体 (I)
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <Field label="副标题字号 (px)">
                    <input
                      type="number"
                      min="10"
                      max="60"
                      value={Math.round(draft.layout.subtitleFontSize ?? SHOWCASE_SUBTITLE_FONT_SIZE)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          layout: { ...draft.layout, subtitleFontSize: Number(e.target.value) || SHOWCASE_SUBTITLE_FONT_SIZE },
                        })
                      }
                    />
                  </Field>
                  <Field label="副标题颜色">
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input
                        type="color"
                        value={draft.layout.subtitleColor ?? "#ffd700"}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            layout: { ...draft.layout, subtitleColor: e.target.value, subtitlePreset: "custom" },
                          })
                        }
                        style={{ width: "32px", height: "32px", padding: "0", border: "none", cursor: "pointer", background: "none" }}
                      />
                      <input
                        type="text"
                        value={draft.layout.subtitleColor ?? "#ffd700"}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            layout: { ...draft.layout, subtitleColor: e.target.value, subtitlePreset: "custom" },
                          })
                        }
                        style={{ flex: 1, textTransform: "uppercase" }}
                      />
                    </div>
                  </Field>
                </div>
                <Field label="文字对齐">
                  <select
                    value={draft.layout.nameAlign ?? "left"}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        layout: {
                          ...draft.layout,
                          nameAlign: event.target.value as "left" | "center" | "right",
                        },
                      })
                    }
                  >
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                </Field>
              </div>
            ) : selectedTarget === "radar" || selectedTarget === "swing" ? (
              <div className="inspector-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <span style={{ fontSize: "12px", color: "var(--cyan)", fontWeight: 700 }}>雷达与 Swing 设置</span>
                  <button className="quiet" style={{ fontSize: "11px", height: "24px" }} onClick={() => setSelectedTarget(null)}>显示全部</button>
                </div>
                <Field label="雷达与 Round Swing 文字字号 (px)">
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
                <Field label="主题色">
                  <input
                    type="color"
                    value={slide.color}
                    onChange={(e) => patchSlide({ color: e.target.value })}
                  />
                </Field>
              </div>
            ) : (
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
                  {slide.teamLogoUrl ? (
                    <button
                      className="danger-action"
                      onClick={() =>
                        patchSlideAt(previewIndex, { teamLogoUrl: undefined })
                      }
                    >
                      清除战队Logo
                    </button>
                  ) : (
                    <button onClick={() => teamLogoInputRef.current?.click()}>
                      战队Logo
                    </button>
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
                <input
                  ref={teamLogoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleTeamLogoUpload}
                />
                <h3>图层顺序（上方优先）</h3>
                <div className="layer-order">
                  {layerKeys.map((layer, index) => (
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
                      {(SHOWCASE_LAYER_LABELS as Record<string, string>)[layer] ?? layer}
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
                          disabled={index === layerKeys.length - 1}
                          onClick={() => moveLayer(index, index + 1)}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="two-fields" style={{ marginTop: "16px" }}>
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
              className="primary-cyan export-action"
              disabled={exportState.running}
              onClick={exportVideo}
            >
              {exportState.running ? <Spinner /> : <Download size={17} />}
              {exportState.running
                ? `导出中 ${Math.round(exportState.progress * 100)}%`
                : "导出 MP4 视频"}
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
