// MCP resource holst://docs/usage — the full agent-facing manual.
// This is the only long-form documentation channel that travels with the
// server to any MCP client.

export const USAGE_DOC = `# Holst MCP — Agent Usage Guide

Read/write access to Holst.so whiteboards through the local Holst desktop app.
Everything below is operational knowledge you need — no external files required.

## Prerequisites
- Holst desktop app installed, user logged in (session persists across restarts).
- If the app is not running, the server auto-launches it with the CDP debug port
  (\`HOLST_AUTO_START=1\` by default). First launch after logout requires a human to log in.

## Recommended workflow
1. \`holst_whoami\` — verify the connection (returns the logged-in user).
2. \`holst_list_boards\` — find the target board id (strict UUID).
3. \`holst_get_board_summary\` — read structure before editing.
4. Size text before creating: \`holst_measure_text\` (text, fontSize, fontFamily REQUIRED)
   returns \`{ widthPx, heightPx, lineHeightPx }\` from the app's own loaded fonts —
   mono SourceCodePro renders ~0.72em/char (not the nominal 0.6), bold caps ~0.9em.
   Create with width ≥ widthPx + padding. Pure read — works on read-only boards.
   Details: \`holst_reference\` → measureText.
5. Create objects. For 3+ objects ALWAYS use \`holst_batch_create\` (one call, whole diagram,
   ~10x faster): array of entries with optional \`ref\` names + arrows linking refs.
   Individual \`holst_add_*\` tools are fine for single objects.
6. Verify with \`holst_get_board_summary\` — every block must show its text.
   Missing text → retry once via \`holst_update_text\` (idempotent).
7. \`holst_screenshot\` — visual check for humans/multimodal models: pass bbox around
   the created area; the camera returns to its place afterwards. NOT for pixel-exact
   color checks (slight P3 shift).

## Conventions
- Coordinates: top-left origin, y grows downward. Boxes 260×56 with ≥180px vertical
  gaps read well; x 300–1800 / y 80–1600 fits one screen.
- Colors: #RRGGBB hex. Suggested set —
  ink #202020, muted #8d8d8d, washes #e4defc/#cee7fe/#c6ecdb/#fff8c6, accents #e54d2e/#6e56cf/#05a2c2/#ffc53d.
  Call \`holst_reference\` for the full list.
- Arrows attach to objects: \`{ objectId, relativePoint: { x, y } }\`, relativePoint in 0..1
  of the object bounds (0.5/0.5 = center, 0.5/1 = bottom edge center).
- Arrow labels: pass \`text\` (+ optional \`textPosition\` 0..1) to \`holst_add_arrow\` or a batch
  arrow entry; rewrite later with \`holst_update_text\` on the arrow id. \`labelSide\`:
  on (default, masked on the line) | left | right — beside the segment with a fixed 7px
  gap (right = +x side; below for horizontal segments); \`textRotated: true\` turns the
  label along the arrow. No background color exists on arrow labels. Stroke styles:
  \`strokeStyle\` solid (default) / dashed / dotted on add_arrow and holst_set_color.
- Arrowheads: \`arrowheadStart\`/\`arrowheadEnd\` = none | miro | arc | figma. Headless axes/dividers:
  \`arrowheadEnd: "none"\`. \`strokeWidth\` sets line thickness.
- Run-level colors: \`runs: [{ text, color, bold }…]\` — several colors/emphasis inside ONE text
  (capsule shapes: \`shapeType: "round-rect"\` + \`borderRadius\` = height/2).
- Typography: \`fontSize\` (px), \`textColor\`/\`textBackgroundColor\` (#RRGGBB),
  \`horizontalAlign\`, \`bold\`/\`italic\`/\`underline\`/\`strikethrough\` on text objects.
  Markdown (**/*/_) is NOT rendered — it is rejected; use the style params.
- Translucency: \`holst_set_color\` \`fillOpacity\`/\`strokeOpacity\` 0..1 (zones/washes).
- Batch layering: \`options: { arrowsBehind: true }\` puts connectors behind nodes.
- Text is plain text; \`\\n\` produces paragraphs. HTML is escaped, not rendered.

## Timings — do not panic
- add_* tools: 3–8 s per object (editor settle + retries). SLOW IS NORMAL — never retry
  a call just because it is slow.
- Occasional ~8 s pause: the server reloads the page to mount objects (self-healing).
- First access to a board: up to 35 s (tab navigation + Yjs doc load).

## Result fields
- \`mounted\`: false = object exists in the document but did not render; the server already
  tried a reload to fix it. Verify via \`holst_get_board_content\`; tell the user if still missing.
- \`native\`: false = text written via legacy raw-Yjs path (older Holst build) — fine unless
  the user reports invisible text.
- \`warning\`: non-fatal post-write exception; content was verified to land.

## Errors → actions
| Error | Action |
|---|---|
| No app.holst.so tab found | User is not logged in. Ask them to open Holst and log in. |
| Holst API 401 | Session expired. Ask the user to log in again. |
| Port held by a non-Holst process | Possible CDP spoofing; ask the user to free the port. |
| not in HOLST_RW_BOARD_IDS or HOLST_RO_BOARD_IDS | Board is outside the configured allowlists — config issue, not retryable. |
| in HOLST_RO_BOARD_IDS (read-only) | This board is read-only by config; do not retry writes. |
| HOLST_READ_ONLY is enabled | Write tools are disabled globally by config. |
| Board dump exceeds HOLST_MAX_DUMP_BYTES | Use \`holst_search_text\` instead of a full dump. |
| Anything else | Run \`holst_doctor\` and act on its verdict. |

## Never do
- Do not synthesize keyboard/mouse/zoom input via CDP — it has crashed the app in testing.
- Do not retry add_* on slowness (see Timings).
- Do not assume a failed read means data loss — run \`holst_doctor\` first.

## Environment variables
| Var | Default | Meaning |
|---|---|---|
| HOLST_AUTO_START | 1 | Auto-launch Holst.app with the CDP port when it is down. |
| HOLST_RW_BOARD_IDS | unset | UUIDs with full read+write access. When either list is set, boards outside both are refused. |
| HOLST_RO_BOARD_IDS | unset | UUIDs readable but not writable. RO wins if an id is in both lists (fail-closed). |
| HOLST_READ_ONLY | off | Global master switch: blocks ALL mutating tools on ALL boards. |
| HOLST_MAX_DUMP_BYTES | 2000000 | Cap for holst_get_board_content, measured on the trimmed dump (delete audit + orphan docs + empty stores are cut first). |
| HOLST_DEBUG_PORT | 9222 | CDP port. |
`;
