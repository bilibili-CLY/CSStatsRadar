# Project interaction invariants

These rules are product requirements. Preserve them in every UI, rendering, and refactor change.

## Radar rendering

- The outer radar ring is a reference scale, not a clipping boundary. Metric values above the configured maximum must visibly extend beyond the outer ring so exceptional player performance remains obvious.
- Never apply a fixed normalized-value cap to radar vertices. Constrain only at the composition's natural safe boundary so the rendered point and its label remain visible.
- Radar polygons, point markers, the six metric names, their values, `BEST` markers, and the Rating 3.0 Swing track must not overlap. Reserve separate label and Swing regions when calculating geometry.
- In showcase exports, `Rating 3.0 本地近似 · 非 HLTV 官方` belongs at the bottom-left of the complete composition, not inside the movable radar sub-canvas.

## Showcase transitions

- Transitions between players are mandatory in preview and exported video.
- The radar itself must never fade in or fade out. Interpolate each of the six radar vertices directly from the previous player's corresponding metric value to the next player's value, preserving continuous polygon motion.
- Player name/subtitle, player image, and background image must crossfade between players while the radar vertices morph.
- Do not replace the transition with a hard cut, a whole-radar opacity fade, or unrelated entrance/exit animation.
- Keep preview and export on the same renderer and transition timing so they cannot diverge.
