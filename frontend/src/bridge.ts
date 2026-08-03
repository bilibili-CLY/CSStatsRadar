import type {
  AppConfig,
  BootstrapState,
  EditorDraft,
  ImportSource,
  ImportSummary,
  MatchRecord,
  Player,
  PlayerMedia,
  RadarResponse,
  SavedPlayer,
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
      WindowFullscreen?: () => void;
      WindowUnfullscreen?: () => void;
      WindowIsFullscreen?: () => Promise<boolean>;
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
  followAndBackfill: (jobId: string, players: Player[]) =>
    call<ImportSummary>("FollowAndBackfill", jobId, players),
  listPlayers: () => call<SavedPlayer[]>("ListPlayers"),
  getMatches: (steamId: string) =>
    call<MatchRecord[]>("GetPlayerMatches", steamId),
  setFollowed: (player: Player, followed: boolean) =>
    call<void>("SetPlayerFollowed", player, followed),
  updateMatch: (id: string, time: string, tags: string[]) =>
    call<void>("UpdateMatchMetadata", id, time, tags),
  deletePlayerData: (steamId: string) =>
    call<void>("DeletePlayerData", steamId),
  deletePlayerMatches: (steamId: string, ids: string[]) =>
    call<void>("DeletePlayerMatches", steamId, ids),
  clearAllData: () => call<void>("ClearAllData"),
  chooseDatabase: () => call<AppConfig>("ChooseDatabase"),
  buildRadar: (steamId: string, ids: string[]) =>
    call<RadarResponse>("BuildRadar", steamId, ids),
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
    audioOffsetMs: number,
  ) =>
    call<AppConfig>(
      "SavePreferences",
      width,
      height,
      fps,
      ffmpeg,
      reduced,
      showBestMarkers,
      audioOffsetMs,
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
  chooseShowcaseMusic: () => call<string>("ChooseShowcaseMusic"),
  getShowcaseMusic: () => call<string>("GetShowcaseMusic"),
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
  finishVideoExport: (id: string) => call<string>("FinishVideoExport", id),
  cancelVideoExport: (id: string) => call<void>("CancelVideoExport", id),
  async toggleFullscreen() {
    const isFullscreen = await (window.runtime?.WindowIsFullscreen?.() ??
      false);
    if (isFullscreen) window.runtime?.WindowUnfullscreen?.();
    else window.runtime?.WindowFullscreen?.();
    return !isFullscreen;
  },
  onImportProgress(callback: (summary: ImportSummary) => void) {
    return (
      window.runtime?.EventsOn?.("import:progress", (payload) =>
        callback(payload as ImportSummary),
      ) ?? (() => undefined)
    );
  },
};
