import type {
  AppConfig,
  BootstrapState,
  EditorDraft,
  DemoAnalysis,
  DemoRecord,
  ImportSource,
  ImportSummary,
  MatchGroup,
  MatchRecord,
  Player,
  PlayerAvatar,
  PlayerMedia,
  RadarResponse,
  RatingMethodology,
  SavedPlayer,
  ShowcaseMusicInfo,
  TeamPrefixCleanResult,
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
    // Tauri 壳或调试启动时注入的后端基地址，例如 http://127.0.0.1:19871。
    __CSRADAR_BASE_URL?: string;
  }
}

// 后端基地址解析优先级：
// 1. window.__CSRADAR_BASE_URL（Tauri 壳注入，端口由 sidecar 动态发现）；
// 2. ?baseUrl= 查询参数（浏览器调试）；
// 3. VITE_CS_RADAR_URL（vite dev / 打包配置，例如 npm run dev 时指向本机 sidecar）；
// 4. 空字符串 = 同源相对路径（旧浏览器模式：页面由后端直接托管）。
function resolveBaseUrl(): string {
  if (typeof window !== "undefined" && window.__CSRADAR_BASE_URL)
    return window.__CSRADAR_BASE_URL.replace(/\/+$/, "");
  try {
    const param = new URLSearchParams(window.location.search).get("baseUrl");
    if (param) return param.replace(/\/+$/, "");
  } catch {
    /* ignore */
  }
  const env = import.meta.env.VITE_CS_RADAR_URL as string | undefined;
  if (env) return env.replace(/\/+$/, "");
  return "";
}

export const serverBaseUrl = resolveBaseUrl();

// 把后端返回的相对 URL（如 /video-download?token=）解析为可导航地址。
// 同源模式原样返回；Tauri/跨源模式补全基地址。
export function resolveServerUrl(url: string): string {
  if (!serverBaseUrl) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return `${serverBaseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function directCall<T>(name: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(`${serverBaseUrl}/__bridge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: name, args }),
  });
  const payload = (await response.json()) as {
    result: T;
    error?: { code: string; message: string };
  };
  if (payload.error) {
    const error = new Error(payload.error.message || "bridge error") as Error & {
      code?: string;
    };
    error.code = payload.error.code;
    throw error;
  }
  return payload.result;
}

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const method =
    window.go?.radar?.DesktopApp?.[name] ?? window.__studioBridge?.[name];
  if (method) return method(...args) as Promise<T>;
  return directCall<T>(name, ...args);
}

export const bridge = {
  serverBaseUrl,
  resolveServerUrl,
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
  refreshPlayerAvatars: (steamIds: string[]) => call<PlayerAvatar[]>("RefreshPlayerAvatars", steamIds),
  followDemoPlayers: (demoId: string, steamIds: string[]) => call<void>("FollowDemoPlayers", demoId, steamIds),
  listPlayers: () => call<SavedPlayer[]>("ListPlayers"),
  getMatches: (steamId: string) =>
    call<MatchRecord[]>("GetPlayerMatches", steamId),
  matchGroups: (steamId: string) =>
    call<MatchGroup[]>("ListMatchGroups", steamId),
  createMatchGroup: (steamId: string, name: string) =>
    call<MatchGroup>("CreateMatchGroup", steamId, name),
  renameMatchGroup: (groupId: number, name: string) =>
    call<void>("RenameMatchGroup", groupId, name),
  deleteMatchGroup: (groupId: number) =>
    call<void>("DeleteMatchGroup", groupId),
  assignMatchGroup: (
    steamId: string,
    demoId: string,
    groupId: number | null,
  ) => call<void>("AssignMatchGroup", steamId, demoId, groupId),
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
    radarFloor: Record<string, number>,
    teamTags: string,
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
      radarFloor,
      teamTags,
    ),
  renamePlayer: (steamId: string, name: string) =>
    call<void>("RenamePlayer", steamId, name),
  cleanTeamPrefixNames: () =>
    call<TeamPrefixCleanResult[]>("CleanTeamPrefixNames"),
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
      `${serverBaseUrl}/__bridge-bin?exportId=${encodeURIComponent(id)}`,
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
