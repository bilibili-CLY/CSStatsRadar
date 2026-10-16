export type Page = "library" | "import" | "analysis" | "studio" | "settings";
export type StudioKind = "radar" | "overlay" | "showcase";
export type RatingVersion = "rating_2" | "rating_3";

export interface Player {
  name: string;
  steam_id: string;
}
export interface SavedPlayer extends Player {
  match_count: number;
  latest_match_time: string;
  latest_imported_at: string;
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
  rating_version: RatingVersion;
  show_rating_watermark: boolean;
  showcase: {
    ffmpeg_path?: string;
    default_duration_ms: number;
    show_best_markers: boolean;
    show_intro_animation: boolean;
    show_best_entrance_animation: boolean;
    audio_offset_ms: number;
    radar_scale_mode: "global" | "axis";
    radar_scale: number;
    radar_axis_scale?: Record<string, number>;
    radar_floor?: Record<string, number>;
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
  round_swing?: number;
  algorithm_version?: string;
}
export interface RadarResponse {
  player: Player;
  match_count: number;
  radar: RadarPayload;
  profiles?: {
    rating_2: RadarPayload;
    rating_3?: RadarPayload;
  };
  rating_3_status?: { available: boolean; reason?: string };
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
export interface MatchGroup {
  id: number;
  steam_id: string;
  name: string;
  demo_ids: string[];
}
export interface DemoRecord {
  demo_record_id: string;
  file_name: string;
  match_time: string;
  match_time_source: "demo" | "file_mtime" | "legacy_import_time" | string;
  imported_at: string;
  map_name: string;
  source_path?: string;
  note?: string;
  analysis_version?: string;
  participants?: Player[];
  player_stat_steam_ids?: string[];
  rounds: number;
  score_a: number;
  score_b: number;
  analysis_ready: boolean;
}
export interface DemoTeam {
  id: "A" | "B";
  name: string;
  score: number;
  players: Player[];
}
export interface SwingEventContribution { kind: string; value: number }
export interface SwingEvent {
  id: string; round_number: number; tick: number; type: string; label: string;
  actor?: string; target?: string; weapon?: string; contribution: number;
  breakdown?: SwingEventContribution[];
}
export interface PlayerRoundMetric {
  round_number: number; won: boolean; score_a: number; score_b: number;
  kills: number; deaths: number; assists: number; damage: number; kast: boolean;
  cumulative_rating?: number; round_swing: number; events: SwingEvent[];
}
export interface DemoPlayerAnalysis { player: Player; team_id: "A" | "B"; rounds: PlayerRoundMetric[] }
export interface DemoAnalysis {
  demo_id: string; version: string; map_name: string; rounds: number;
  teams: DemoTeam[]; players: DemoPlayerAnalysis[]; generated_at: string;
}
export interface ImportItem {
  path: string;
  file_name: string;
  status: string;
  message?: string;
  demo_id?: string;
  map_name?: string;
  rounds?: number;
  players?: Player[];
  player_details?: ImportPlayerDetail[];
  saved_count: number;
}
export interface ImportPlayerDetail extends Player {
  team: "A" | "B";
  kills: number;
  deaths: number;
  assists: number;
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

export interface ShowcaseSlide {
  id: string;
  radar: RadarResponse;
  title: string;
  subtitle: string;
  duration: number;
  color: string;
  imageUrl?: string;
  avatarUrl?: string;
  backgroundUrl?: string;
  imageTransform?: { x: number; y: number; scale?: number };
}

export interface ShowcaseLayoutDraft {
  radarX: number;
  radarY: number;
  radarScale: number;
  nameX: number;
  nameY: number;
  nameScale: number;
  titleX: number;
  titleY: number;
  titleScale: number;
  subtitleX: number;
  subtitleY: number;
  subtitleScale: number;
  imageX: number;
  imageY: number;
  imageScale: number;
  metricLabelFontSize: number;
  swingX: number;
  swingY: number;
  swingScale: number;
  opacity: number;
  layers: string[];
  nameAlign: "left" | "center" | "right";
  imageFit: "contain" | "cover";
}

export interface PlayerAvatar {
  steam_id: string;
  data_url?: string;
  status: "ready" | "fallback" | string;
  updated_at?: string;
}

export interface ShowcaseMusicInfo {
  url: string;
  duration_ms: number;
}

export interface WeaponMethodology {
  id: string;
  label: string;
  strength: number;
  weapons: string[];
}
export interface RatingMethodology {
  algorithm_version: string;
  rating_2_formula: string;
  impact_formula: string;
  rating_3_formula: string;
  rating_3_base_formula: string;
  multi_kpr_formula: string;
  multi_impact_formula: string;
  swing_rating_formula: string;
  swing_formula: string;
  win_probability_formula: string;
  weapon_weight_formula: string;
  sniper_damage_formula: string;
  weapon_categories: WeaponMethodology[];
  contribution_weights: Record<string, number>;
  constants: Record<string, number>;
  limitations: string[];
}

export const defaultConfig: AppConfig = {
  export_width: 1920,
  export_height: 1080,
  database_path: "",
  video_fps: 60,
  reduce_motion: false,
  rating_version: "rating_2",
  show_rating_watermark: true,
  showcase: {
    default_duration_ms: 4000,
    show_best_markers: true,
    show_intro_animation: true,
    show_best_entrance_animation: true,
    audio_offset_ms: 0,
    radar_scale_mode: "global",
    radar_scale: 1,
    radar_axis_scale: {},
    radar_floor: {},
  },
  import_sources: [],
};
