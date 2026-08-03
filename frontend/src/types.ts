export type Page = "library" | "import" | "studio" | "settings";
export type StudioKind = "radar" | "overlay" | "showcase";

export interface Player {
  name: string;
  steam_id: string;
}
export interface SavedPlayer extends Player {
  match_count: number;
  latest_match_time: string;
  followed: boolean;
}
export interface ImportSource {
  id: string;
  name: string;
  path: string;
  created_at: string;
}
export interface AppConfig {
  export_width: number;
  export_height: number;
  database_path: string;
  import_sources?: ImportSource[];
  video_fps: 30 | 60;
  reduce_motion: boolean;
  showcase: {
    ffmpeg_path?: string;
    default_duration_ms: number;
    show_best_markers: boolean;
    audio_offset_ms: number;
  };
}
export interface BootstrapState {
  config: AppConfig;
  players: SavedPlayer[];
  followed_players: Player[];
  ffmpeg_path?: string;
}
export interface RadarMetric {
  name: string;
  value: number | null;
  display_type: string;
  max_value: number;
  status: string;
  reason?: string;
}
export interface RadarPayload {
  dimensions: string[];
  values: Array<number | null>;
  display_types: string[];
  max_values: number[];
  metrics: RadarMetric[];
  note: string;
}
export interface RadarResponse {
  player: Player;
  match_count: number;
  radar: RadarPayload;
}
export interface MatchRecord {
  demo_record_id: string;
  match_time: string;
  match_time_source: "demo" | "manual" | "unknown";
  imported_at: string;
  map_name: string;
  file_name: string;
  source_path?: string;
  tags?: string[];
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  adr: number | null;
  kast: number | null;
  impact: number | null;
  rating: number | null;
}
export interface ImportItem {
  path: string;
  file_name: string;
  status: string;
  message?: string;
  demo_id?: string;
  players?: Player[];
  saved_count: number;
}
export interface ImportSummary {
  job_id: string;
  status: string;
  total: number;
  processed: number;
  imported: number;
  duplicates: number;
  failed: number;
  items: ImportItem[];
  discovered_players: Player[];
  started_at: string;
  completed_at?: string;
}
export interface EditorDraft {
  kind: StudioKind;
  payload: string;
  updated_at: string;
}
export interface StudioSeed {
  player: SavedPlayer;
  matchIds: string[];
  radar?: RadarResponse;
}
export interface OverlayEntry {
  id: string;
  radar: RadarResponse;
  visible: boolean;
  color: string;
}
export interface PlayerMedia {
  image_url?: string;
  background_url?: string;
}

export const defaultConfig: AppConfig = {
  export_width: 1920,
  export_height: 1080,
  database_path: "",
  video_fps: 60,
  reduce_motion: false,
  showcase: {
    default_duration_ms: 4000,
    show_best_markers: true,
    audio_offset_ms: 0,
  },
  import_sources: [],
};
