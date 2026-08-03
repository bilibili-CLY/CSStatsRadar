# CSPlayerStatsRadar Design System

> Desktop-only local content studio. Page overrides in `pages/` take precedence.

## Product character

- Professional esports production tool: quiet shell, dense data, expressive output canvas.
- Dark theme only. The application chrome is neutral graphite; cyan belongs to the logo and default radar artwork, not generic controls.
- Information architecture is always Library → Import → Studio → Settings.

## Tokens

| Role | Value |
|---|---|
| Background | `#0C0D0F` |
| Sidebar | `#101215` |
| Surface | `#15181C` |
| Elevated surface | `#1A1E23` |
| Border | `#2A3037` |
| Strong border | `#3A424C` |
| Primary text | `#F3F5F7` |
| Muted text | `#949DA8` |
| Dim text | `#6F7883` |
| Default radar | `#22D3EE` |
| Success | `#47B881` |
| Warning | `#D6A04D` |
| Destructive | `#E26666` |
| Focus | `#75A7FF` |

- Use system UI sans (`Inter`, `Segoe UI`, system fallback); use `ui-monospace` only for IDs and numeric metrics. No network font requests.
- Spacing scale: 4, 8, 12, 16, 24, 32px. Radius: 7–10px. Minimum interactive height: 36px, 44px for primary empty-state actions.
- Motion: 150–250ms for feedback; page entry may use a 3px fade/translate. Respect both the application reduce-motion setting and `prefers-reduced-motion`.

## Layout and components

- Minimum viewport: 1180×720. Default window: 1440×900. Mobile is out of scope.
- Fixed 216px navigation rail; pages own the remaining scroll area.
- Library uses player rail + match table; editors use queue + canvas + inspector.
- Cards are bordered surfaces with minimal shadow. Do not lift or scale cards on hover.
- Primary actions use a light neutral fill. Status colors communicate status only.
- Use Lucide SVG icons. Icon-only controls require an accessible name.
- Inputs always have visible labels. Errors appear beside the relevant workflow and never only in a global banner.
- Tables support sticky headers, row selection beyond color alone, bulk action bars, and keyboard focus.

## Canvas rules

- Preview and export share the same deterministic renderer.
- Artwork can use user-selected colors, particles and stronger contrast without changing application chrome.
- Overlay average is calculated from the full queue, including hidden players, and must be labelled accordingly.
- Warn after six overlay players without blocking export.

## Accessibility and delivery checklist

- Text contrast ≥ 4.5:1; visible `:focus-visible` ring on every control.
- Never rely on hover or color alone; preserve tab order and native button semantics.
- No emoji icons, hidden focus rings, placeholder-only labels, autoplay, or decorative looping motion.
- Verify 1180, 1280 and 1440px widths; import, save, export and destructive actions require explicit feedback.
