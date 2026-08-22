# Project interaction invariants

These rules are product requirements. Preserve them in every UI, rendering, and refactor change.

## Radar rendering

- The outer radar ring is a reference scale, not a clipping boundary. Metric values above the configured maximum must visibly extend beyond the outer ring so exceptional player performance remains obvious.
- Never apply a fixed normalized-value cap to radar vertices. Constrain only at the composition's natural safe boundary so the rendered point and its label remain visible.
- Radar label layout must measure the metric name, value, and optional `BEST` marker against per-axis safe regions. Extreme values may use compact notation, but these labels must remain wholly visible and must not overlap vertices or one another.
- By default, radar metric labels sit immediately outside the outer ring. Only the label whose corresponding vertex extends outward may move farther out, and it must stop at its measured safe boundary.
- Radar polygons, point markers, the six metric names, their values, `BEST` markers, and the Rating 3.0 Swing track must not overlap. Reserve separate label and Swing regions when calculating geometry.
- In showcase exports, `Rating 3.0 本地近似 · 非 HLTV 官方` belongs at the bottom-left of the complete composition, not inside the movable radar sub-canvas.
- Rating 3.0 `Multi-Kill` is the multi-kill round probability (rounds with ≥2 kills ÷ total rounds), shown as a percentage with the outer ring = 20%. It is not the multiImpact sub-score; do not reintroduce the old value/max (2) during refactors.

## Bridge server (desktop app)

- The desktop app runs headless in browser mode: it starts the embedded bridge server and opens `BaseUrl` in the system default browser. Do not reintroduce Photino/WebView2 — the embedded control silently white-screens on machines with a broken WebView2 runtime while the normal browser works.
- The embedded bridge server must bind a loopback `TcpListener` (raw HTTP) and never `HttpListener`/http.sys — the latter requires admin or a URL ACL and hard-crashes on normal Windows accounts.
- Never require elevation or OS-level port permissions. Port fallback (walk up to 50 ports from the preferred one) must stay in place so a busy port degrades gracefully instead of aborting startup.
- The bridge runs inside the user's real browser, so it MUST protect against CSRF/DNS-rebinding: reject `POST /__bridge` unless the `Host` header is `127.0.0.1:port`/`localhost:port` and, when present, the `Origin` header matches `http://127.0.0.1:port`/`http://localhost:port`.
- Binary frame uploads go to `POST /__bridge-bin?exportId=...` with length-prefixed framing (`4B frameCount + 4B startIndex + N × (4B length + PNG)`). It must pass the same CSRF/Host check as `/__bridge`. The JSON/base64 `AppendVideoFrames` bridge method remains as a fallback and must not be removed.
- App lifecycle: the page beacon pings `Ping` every 5s; the host exits when heartbeats stop for 120s (or after 90s if never loaded), or immediately on the `QuitApp` bridge call. Never leave orphaned background processes.
- Startup must surface fatal errors (missing `frontend/dist`, failed bridge bind, browser-open failure) in a visible dialog on Windows, never a silent exit.
- Native file dialogs must work on Windows too (not just macOS osascript): spawn a `powershell.exe -STA` WinForms dialog via a temp `.ps1` script and read the chosen path from stdout. A cancelled dialog returns `null`/empty, never an exception. The published executable must be named `CSStatsRadar.exe` (`<AssemblyName>CSStatsRadar</AssemblyName>` in `Radar.App.csproj`).

## Database schema

- SQLite schema must be forward-compatible with legacy databases: `CREATE TABLE IF NOT EXISTS` never adds columns to an existing table, so `Init()` must run a column migration (`PRAGMA table_info` + `ALTER TABLE ... ADD COLUMN`) for every column that was added after the initial release (`demos.file_sha256/source_path/match_time_source/note/analysis_version`, `player_match_stats.rating_3/round_swing/multi_kill/rating_algorithm/rating_3_metrics_json`). Never drop this migration when refactoring `Init()`.
- Newly added columns must be nullable or carry a `DEFAULT` so `ALTER TABLE ADD COLUMN` works on populated legacy rows.

## Showcase transitions

- Showcase preview and MP4 export are always a 1920×1080 (16:9) composition. Preview must letterbox/scale down to its available area rather than stretch; its native fullscreen mode must preserve that ratio.
- In showcase compositions, the Round Swing ±5% reference span must exactly equal the rendered radar's outer-ring diameter, never the radar sub-canvas diameter. Its track height is 225% of the original height. The Swing sub-canvas may be wider only to reserve independent overflow and endpoint-label safe space; values beyond ±5% extend from the fixed outer-ring-aligned endpoints into that overflow region. The fill has a square edge at the center line and may round only at its outer end.
- Transitions between players are mandatory in preview and exported video.
- Outside the explicit BEST entrance flow, the radar itself must never fade in or fade out. Interpolate each of the six radar vertices directly from the previous player's corresponding metric value to the next player's value, preserving continuous polygon motion.
- During normal player transitions, player name/subtitle, player image, and background image must crossfade while the radar vertices morph.
- Do not replace a normal player transition with a hard cut, a whole-radar opacity fade, or unrelated entrance/exit animation.
- Keep preview and export on the same renderer and transition timing so they cannot diverge.
- Showcase queue averages are a red solid, unfilled radar baseline plus a red Round Swing reference line; average values must use the active Rating profile and ignore missing values per metric.
- Showcase metric names, values, `BEST`, and all Round Swing text (label, value, and ±5% endpoints) use one global, explicitly entered pixel font size and bold weight; this setting never changes player title/subtitle or the watermark. Showcase player-image size is a global proportional scale while each slide may retain its own image position.
- The optional eight-second showcase opener has four two-second stages: empty radar/Swing background fade-in (0–2s) → highlighted outer-ring labels and fixed ±5% Swing reference (2–4s) → red average radar and Swing reference line (4–6s) → fade the average values out, then expand the first-player radar from its center and Swing fill from its midpoint (6–8s). The stable first-player scene starts only after the opener finishes; it never morphs from the average. It must never fade the whole radar during normal player-to-player transitions.
- The base outer radar ring is persistent and never fades; only its separate highlight fades in and out. During the opener, metric labels stay at their default locations. Metric names and the Swing track/endpoint labels remain visible once shown; numeric labels count continuously from outer reference to average, fade out at the third-to-fourth boundary, then reappear while counting from zero to player values. Both the red average radar baseline and the red Round Swing reference line remain fixed and visible while the player data expands. Only normal player-to-player transitions interpolate the six radar vertices directly.
- BEST remains strict per-metric first place. When its optional entrance is enabled, every BEST player (including the first) adds a 3-second player-name entrance followed by a 1-second crossfade into the main scene; this timing is part of preview, timeline, and export duration. The entrance uses the entering player's background/theme only, shows no radar, Swing, main-scene title/subtitle, watermark, metric values, or `BEST` marker; a centered player portrait fades in during the entrance and fades out with its layer during the handoff. The left/right vertical names loop six times upward/downward respectively as a gapless repeated name string, and the lower-right name enters from the right using a right-side safe anchor and must remain wholly visible even when long. During the crossfade, all main-scene layers appear together while radar values and Rating 3.0 Swing expand from zero with ease-in-out motion; this BEST path replaces the normal player-to-player radar morph and must never resume the previous player's morph after handoff.

## UI style conventions

These rules govern the application chrome and component aesthetics. They must be preserved in every style change, component addition, or refactor.

### Design tokens
- `--transition-fast` (150ms), `--transition-base` (200ms), `--transition-slow` (300ms) — all use `cubic-bezier(0.4, 0, 0.2, 1)`. Never use raw duration values or other easing functions.
- `--hover-bg: rgba(255,255,255,0.04)` / `--hover-bg-strong: rgba(255,255,255,0.07)` — the only hover background values. Never use hardcoded hover opacity.
- `--shadow-sm: 0 2px 8px rgba(0,0,0,0.2)` / `--shadow-md: 0 8px 30px rgba(0,0,0,0.24)` — shadow elevation scale. The existing `--shadow` is for large modal/canvas use only.
- Keep the existing color palette (`--bg` through `--focus`). Do not add new color tokens without reviewing the full palette.

### Component interaction patterns
- Every interactive element (button, card, list item, input, tab, chip) must have a `transition` that includes at least `background` and `border-color` using `var(--transition-fast)`.
- Buttons: `will-change: transform` set; `:active` must apply `scale(0.98)` for press feedback. Never use `translateY(1px)` as a press effect.
- Cards and bordered panels: hover must brighten the border (`--border-strong` from `--border`). Never lift, scale, or add drop-shadow on card hover.
- Inputs and search boxes: `:focus` must add `box-shadow: 0 0 0 3px rgba(117, 167, 255, 0.12)` with `border-color: var(--focus)`. Input `:hover` must brighten border.
- Segmented controls, tabs, and view-switch buttons: every child button must have `transition` on `background` and `color`. Active state must use a distinct background fill.

### Sidebar navigation
- Active nav item must use `box-shadow: inset 3px 0 0 #838c97` for the left accent bar.
- Each nav button must have a `::before` pseudo-element (2px wide, 18px tall, `#838c97`) that animates from `scaleY(0)` to `scaleY(1)` on active state — this is the animated indicator. Do not use only the `box-shadow` inset bar without the `::before` element.

### Micro-animations
- `@keyframes selection-in`: opacity 0→1, translateY(-2px)→none, 0.2s ease-out — used on `.selection-bar`.
- `@keyframes panel-in`: opacity 0→1, translateY(8px)→none, 0.25s ease-out — used on sticky bottom panels.
- `@keyframes backdrop-in`: opacity 0→1, 0.15s ease-out — used on modal backdrops.
- `@keyframes dialog-in`: opacity 0→1, translateY(5px) scale(0.99)→none, 0.2s ease-out — used on modal dialogs.
- `@keyframes page-in`: opacity 0→1, translateY(4px)→none, 0.2s ease — used on `.page` wrapper.
- Do not remove or replace these keyframes. Add new animations only when a component has no existing animation match.
- `prefers-reduced-motion` and `.reduce-motion` must zero out all animation/transition durations (0.001ms). Every new animation must be covered by these overrides.

### Layout spacing
- Page padding: 27px 30px 30px (responsive: 22px 20px at ≤1280px).
- `.page-header` margin-bottom: 26px. Never shrink this below 22px.
- Minimum viewport: 1180×720. Default: 1440×900. Do not add mobile breakpoints.
- Cards use `--radius: 10px` for outer radius, 7–8px for nested elements. Do not use radius values outside this range.
- Consistent gap scale: 4, 8, 12, 16, 24, 32px. Do not use gap values outside this scale.

### Styling approach
- Keep using CSS custom properties in `:root` as the single source of truth. No Sass/Less variables.
- No CSS modules or CSS-in-JS — the project uses a single `styles.css` with feature-specific overrides in `media.css` and `metadata.css`.
- Hardcoded color values in TSX component files (e.g. RadarCanvas.tsx) are acceptable for canvas-rendered artwork; do not use hardcoded colors in DOM React components — use CSS variables instead.
- Never add emoji icons, decorative looping motion, or hover-only affordances. All interactive elements must have `:focus-visible` outline.

## Frontend architecture

- Routing: React Router. `App.tsx` is a shell with lazy routes and button-based sidebar nav (never `NavLink` — the CSS targets `.sidebar nav button`). View state lives in zustand stores (`stores/appStore.ts`, `stores/studioStore.ts`); views read state from stores instead of props drilling.
- `StudioView` is a shell; editors live in `RadarEditor.tsx`, `OverlayEditor.tsx`, `ShowcaseEditor.tsx`, `ShowcasePreview.tsx`. Shared logic: `useDraft.ts` (save debounce hook), `showcaseMath.ts` (pure/timeline functions — importable from tests), `showcaseRender.ts` (canvas rendering). `SaveState` is defined once in `components/ui/SaveStatus.tsx` and re-exported through the `components/ui/index.ts` barrel.
- Shared components live in `components/` (`demo/DemoCard.tsx` with `variant="catalog" | "analysis"`, `ui/` primitives). Formatting helpers live in `lib/format.ts` (`formatDemoDate`, `formatValue`, `signed`, `errorMessage`) — views must not re-define them.
- Video export rendering runs in a Web Worker (`showcaseExportWorker.ts`) using `OffscreenCanvas` when `Worker` and `OffscreenCanvas` exist; frames upload via `bridge.appendVideoFramesBinary` (see Bridge server section). The main-thread `toDataURL` + `appendVideoFrames` loop stays as the fallback.
- Shared render code must be Worker-safe: create canvases through `createCanvas`, obtain 2D contexts via `canvas2D`, read image dimensions through `imageWidth`/`imageHeight` (works for `HTMLImageElement` and `ImageBitmap`), load fonts in a worker via `FontFace` + `globalThis.fonts` — never call `document.*` directly.
- `RadarCanvas` is wrapped in `React.memo`; `geometry`/`labelBounds` in `RadarCanvas.tsx` are cached by a `compact|showSwing|width|height` key (these are constant across export frames).

## Library page & player avatars

- In the library (`LibraryView`), "制作雷达/加入叠图/加入轮播/全部加入轮播" only save the draft, set the studio seed (`useStudioStore.setSeed`), and show a toast — they must never navigate to the studio route. "全部加入轮播" includes every saved player with match stats in the current player sort order, updates existing slides by SteamID, and reports any individual failures without discarding successful additions.
- Right-clicking a player in the library player list opens a `context-menu` with "取消关注/关注" and "删除资历" (deletes that player's match stats). Keep this affordance; do not remove it during refactors.
- Player avatars come from Steam with no API key: `GetPlayerAvatars` reads the Steam community profile XML (`steamcommunity.com/profiles/{steamid}/?xml=1`, `avatarFull` element) and caches the downloaded image in `~/.csplayerstatsradar/player-avatars/{steamid}.jpg`. Ready caches return a data URL immediately; failed fetches are stored as `status="fallback"` and are not retried within 24h. The showcase slide image defaults to the player avatar (`item.imageUrl ?? item.avatarUrl`); `ShowcaseEditor` backfills `avatarUrl` for any slide missing it on load.

## Auto-capture of user conventions

When the user makes a request that establishes a new convention, rule, constraint, or preference that should persist across sessions (judged by the AI at its own discretion), the AI must automatically append it to this file under the appropriate section or create a new section, and notify the user that it has been recorded. This includes but is not limited to: naming conventions, architectural decisions, coding style preferences, dependency constraints, workflow steps, and UI/UX rules. The AI does not need to ask for permission — it should act on its own judgment and inform the user afterward.
