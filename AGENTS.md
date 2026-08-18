# Project interaction invariants

These rules are product requirements. Preserve them in every UI, rendering, and refactor change.

## Radar rendering

- The outer radar ring is a reference scale, not a clipping boundary. Metric values above the configured maximum must visibly extend beyond the outer ring so exceptional player performance remains obvious.
- Never apply a fixed normalized-value cap to radar vertices. Constrain only at the composition's natural safe boundary so the rendered point and its label remain visible.
- Radar polygons, point markers, the six metric names, their values, `BEST` markers, and the Rating 3.0 Swing track must not overlap. Reserve separate label and Swing regions when calculating geometry.
- In showcase exports, `Rating 3.0 本地近似 · 非 HLTV 官方` belongs at the bottom-left of the complete composition, not inside the movable radar sub-canvas.

## Bridge server (desktop app)

- The desktop app runs headless in browser mode: it starts the embedded bridge server and opens `BaseUrl` in the system default browser. Do not reintroduce Photino/WebView2 — the embedded control silently white-screens on machines with a broken WebView2 runtime while the normal browser works.
- The embedded bridge server must bind a loopback `TcpListener` (raw HTTP) and never `HttpListener`/http.sys — the latter requires admin or a URL ACL and hard-crashes on normal Windows accounts.
- Never require elevation or OS-level port permissions. Port fallback (walk up to 50 ports from the preferred one) must stay in place so a busy port degrades gracefully instead of aborting startup.
- The bridge runs inside the user's real browser, so it MUST protect against CSRF/DNS-rebinding: reject `POST /__bridge` unless the `Host` header is `127.0.0.1:port`/`localhost:port` and, when present, the `Origin` header matches `http://127.0.0.1:port`/`http://localhost:port`.
- App lifecycle: the page beacon pings `Ping` every 5s; the host exits when heartbeats stop for 120s (or after 90s if never loaded), or immediately on the `QuitApp` bridge call. Never leave orphaned background processes.
- Startup must surface fatal errors (missing `frontend/dist`, failed bridge bind, browser-open failure) in a visible dialog on Windows, never a silent exit.
- Native file dialogs must work on Windows too (not just macOS osascript): spawn a `powershell.exe -STA` WinForms dialog via a temp `.ps1` script and read the chosen path from stdout. A cancelled dialog returns `null`/empty, never an exception. The published executable must be named `CSStatsRadar.exe` (`<AssemblyName>CSStatsRadar</AssemblyName>` in `Radar.App.csproj`).

## Database schema

- SQLite schema must be forward-compatible with legacy databases: `CREATE TABLE IF NOT EXISTS` never adds columns to an existing table, so `Init()` must run a column migration (`PRAGMA table_info` + `ALTER TABLE ... ADD COLUMN`) for every column that was added after the initial release (`demos.file_sha256/source_path/match_time_source/note/analysis_version`, `player_match_stats.rating_3/round_swing/multi_kill/rating_algorithm/rating_3_metrics_json`). Never drop this migration when refactoring `Init()`.
- Newly added columns must be nullable or carry a `DEFAULT` so `ALTER TABLE ADD COLUMN` works on populated legacy rows.

## Showcase transitions

- Transitions between players are mandatory in preview and exported video.
- The radar itself must never fade in or fade out. Interpolate each of the six radar vertices directly from the previous player's corresponding metric value to the next player's value, preserving continuous polygon motion.
- Player name/subtitle, player image, and background image must crossfade between players while the radar vertices morph.
- Do not replace the transition with a hard cut, a whole-radar opacity fade, or unrelated entrance/exit animation.
- Keep preview and export on the same renderer and transition timing so they cannot diverge.

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

## Auto-capture of user conventions

When the user makes a request that establishes a new convention, rule, constraint, or preference that should persist across sessions (judged by the AI at its own discretion), the AI must automatically append it to this file under the appropriate section or create a new section, and notify the user that it has been recorded. This includes but is not limited to: naming conventions, architectural decisions, coding style preferences, dependency constraints, workflow steps, and UI/UX rules. The AI does not need to ask for permission — it should act on its own judgment and inform the user afterward.
