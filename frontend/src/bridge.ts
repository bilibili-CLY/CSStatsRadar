import type {
  AppConfig,
  BootstrapState,
  EditorDraft,
  DemoAnalysis,
  DemoRecord,
  ImportSource,
  ImportSummary,
  MatchRecord,
  Player,
  PlayerAvatar,
  PlayerMedia,
  RadarResponse,
  RatingMethodology,
  SavedPlayer,
  ShowcaseMusicInfo,
} from "./types";

type Method = (...args: unknown[]) => Promise<unknown>;

declare global {
  interface Window {
    go?: { radar?: { DesktopApp?: Record<string, Method> } };
    runtime?: {
      EventsOn?: (
        name: string,
        callback: (payload: unknown) => void,
      ) => () => void;
    };
    __studioBridge?: Record<string, Method>;
  }
}

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const method =
    window.go?.radar?.DesktopApp?.[name] ?? window.__studioBridge?.[name];
  if (!method) throw new Error(`桌面服务未连接：${name}`);
  return method(...args) as Promise<T>;
}

export const bridge = {
  bootstrap: () => call<BootstrapState>("Bootstrap"),
  chooseDirectory: () => call<string>("ChooseImportDirectory"),
  chooseFiles: () => call<string[]>("ChooseImportFiles"),
  addSource: (path: string) => call<ImportSource[]>("AddImportSource", path),
  removeSource: (id: string) => call<ImportSource[]>("RemoveImportSource", id),
  scanSources: (ids: string[]) => call<string>("StartSourceScan", ids),
  importFiles: (paths: string[]) => call<string>("StartFileImport", paths),
  importSummary: (jobId: string) => call<ImportSummary>("ImportSummary", jobId),
  cancelImport: (jobId: string) => call<void>("CancelImport", jobId),
  followAndBackfill: (jobId: string, path: string, players: Player[]) =>
    call<ImportSummary>("FollowAndBackfill", jobId, path, players),
  listDemos: async () => (await call<DemoRecord[] | null>("ListDemos")) ?? [],
  updateDemoNote: (demoId: string, note: string) => call<void>("UpdateDemoNote", demoId, note),
  deleteDemos: (demoIds: string[]) => call<void>("DeleteDemos", demoIds),
  getDemoAnalysis: (demoId: string) => call<DemoAnalysis>("GetDemoAnalysis", demoId),
  reparseDemoAnalysis: (demoId: string) => call<DemoAnalysis>("ReparseDemoAnalysis", demoId),
  chooseReplacementDemo: (demoId: string) => call<DemoAnalysis>("ChooseReplacementDemo", demoId),
  getPlayerAvatars: (steamIds: string[]) => call<PlayerAvatar[]>("GetPlayerAvatars", steamIds),
  followDemoPlayers: (demoId: string, steamIds: string[]) => call<void>("FollowDemoPlayers", demoId, steamIds),
  listPlayers: () => call<SavedPlayer[]>("ListPlayers"),
  getMatches: (steamId: string) =>
    call<MatchRecord[]>("GetPlayerMatches", steamId),
  setFollowed: (player: Player, followed: boolean) =>
    call<void>("SetPlayerFollowed", player, followed),
  deletePlayerData: (steamId: string) =>
    call<void>("DeletePlayerData", steamId),
  deletePlayerMatches: (steamId: string, ids: string[]) =>
    call<void>("DeletePlayerMatches", steamId, ids),
  clearAllData: () => call<void>("ClearAllData"),
  chooseDatabase: () => call<AppConfig>("ChooseDatabase"),
  buildRadar: (steamId: string, ids: string[]) =>
    call<RadarResponse>("BuildRadar", steamId, ids),
  getRatingMethodology: () =>
    call<RatingMethodology>("GetRatingMethodology"),
  loadDraft: (kind: string) => call<EditorDraft | null>("LoadDraft", kind),
  saveDraft: (kind: string, payload: string) =>
    call<void>("SaveDraft", kind, payload),
  savePreferences: (
    width: number,
    height: number,
    fps: number,
    ffmpeg: string,
    reduced: boolean,
    showBestMarkers: boolean,
    showIntroAnimation: boolean,
    showBestEntranceAnimation: boolean,
    audioOffsetMs: number,
    radarScaleMode: string,
    radarScale: number,
    radarAxisScale: Record<string, number>,
    ratingVersion: string,
    showRatingWatermark: boolean,
  ) =>
    call<AppConfig>(
      "SavePreferences",
      width,
      height,
      fps,
      ffmpeg,
      reduced,
      showBestMarkers,
      showIntroAnimation,
      showBestEntranceAnimation,
      audioOffsetMs,
      radarScaleMode,
      radarScale,
      radarAxisScale,
      ratingVersion,
      showRatingWatermark,
    ),
  chooseFFmpeg: () => call<string>("ChooseFFmpeg"),
  exportPNG: (dataURL: string, name: string) =>
    call<string>("ExportPNG", dataURL, name),
  getPlayerMedia: (steamId: string) =>
    call<PlayerMedia>("GetPlayerMedia", steamId),
  choosePlayerMedia: (steamId: string, kind: "image" | "background") =>
    call<PlayerMedia>("ChoosePlayerMedia", steamId, kind),
  setPlayerImageURL: (steamId: string, url: string) =>
    call<PlayerMedia>("SetPlayerImageURL", steamId, url),
  clearPlayerMedia: (steamId: string, kind: "image" | "background") =>
    call<PlayerMedia>("ClearPlayerMedia", steamId, kind),
  chooseShowcaseMusic: () => call<ShowcaseMusicInfo>("ChooseShowcaseMusic"),
  getShowcaseMusic: () => call<string>("GetShowcaseMusic"),
  getShowcaseMusicInfo: () => call<ShowcaseMusicInfo>("GetShowcaseMusicInfo"),
  clearShowcaseMusic: () => call<void>("ClearShowcaseMusic"),
  beginVideoExport: (
    width: number,
    height: number,
    fps: number,
    durationMs: number,
    audioOffsetMs: number,
    name: string,
  ) =>
    call<string>(
      "BeginVideoExport",
      width,
      height,
      fps,
      durationMs,
      audioOffsetMs,
      name,
    ),
  appendVideoFrames: (id: string, start: number, frames: string[]) =>
    call<void>("AppendVideoFrames", id, start, frames),
  appendVideoFramesBinary: async (id: string, start: number, frames: Blob[]) => {
    const chunks: BlobPart[] = [];
    const header = new ArrayBuffer(8);
    const view = new DataView(header);
    view.setInt32(0, frames.length, false);
    view.setInt32(4, start, false);
    chunks.push(header);
    for (const frame of frames) {
      const lengthHeader = new ArrayBuffer(4);
      new DataView(lengthHeader).setInt32(0, frame.size, false);
      chunks.push(lengthHeader, frame);
    }
    const response = await fetch(
      `/__bridge-bin?exportId=${encodeURIComponent(id)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Blob(chunks),
      },
    );
    const payload = (await response.json()) as {
      result: unknown;
      error?: { code: string; message: string };
    };
    if (payload.error) throw new Error(payload.error.message || "bridge error");
  },
  finishVideoExport: (id: string) =>
    call<{ url: string; name: string }>("FinishVideoExport", id),
  cancelVideoExport: (id: string) => call<void>("CancelVideoExport", id),
  onImportProgress(callback: (summary: ImportSummary) => void) {
    return (
      window.runtime?.EventsOn?.("import:progress", (payload) =>
        callback(payload as ImportSummary),
      ) ?? (() => undefined)
    );
  },
};
