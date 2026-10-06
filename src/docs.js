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
4. Create objects (\`holst_add_shape\`, \`holst_add_sticker\`, \`holst_add_simple_text\`,
   \`holst_add_arrow\`, \`holst_add_frame\`, \`holst_add_stamp\`).
5. Verify with \`holst_get_board_summary\` — every block must show its text.
   Missing text → retry once via \`holst_update_text\` (idempotent).

## Conventions
- Coordinates: top-left origin, y grows downward. Boxes 260×56 with ≥180px vertical
  gaps read well; x 300–1800 / y 80–1600 fits one screen.
- Colors: palette names only — yellow6, blue6, green6, red6, orange8, gray10, gray12,
  white3, white6. Call \`holst_reference\` for the full list.
- Arrows attach to objects: \`{ objectId, relativePoint: { x, y } }\`, relativePoint in 0..1
  of the object bounds (0.5/0.5 = center, 0.5/1 = bottom edge center).
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
| not in HOLST_ALLOWED_BOARD_IDS | Board is outside the configured allowlist — config issue, not retryable. |
| HOLST_READ_ONLY is enabled | Write tools are disabled by config. |
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
| HOLST_ALLOWED_BOARD_IDS | unset | UUID allowlist; other boards are refused. |
| HOLST_READ_ONLY | off | Blocks all mutating tools. |
| HOLST_MAX_DUMP_BYTES | 2000000 | Cap for holst_get_board_content. |
| HOLST_DEBUG_PORT | 9222 | CDP port. |
`;
