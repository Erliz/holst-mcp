// On-demand reference for MCP consumers: conventions, verified values,
// timings, result semantics, env vars, limits. Call holst_reference
// instead of guessing — costs no context until requested.

export function getReference() {
  return {
    coordinateSystem: {
      origin: 'top-left',
      yDirection: 'down',
      typicalLayout: 'x 300–1800, y 80–1600 fits one screen; boxes 260×56 with ≥180px vertical gaps work well',
      notes: 'position is the top-left corner of the object; arrows attach via relativePoint {x,y} in 0..1 of the object bounds (0.5/0.5 = center)',
    },
    paletteColors: [
      'yellow6', 'blue6', 'green6', 'red6', 'orange8',
      'gray10', 'gray12', 'white3', 'white6',
    ],
    shapeTypes: {
      verified: ['round-rect', 'square'],
      knownToExist: ['circle', 'rhombus', 'triangle', 'ellipse'],
      note: 'use verified ones; others exist in Holst but are not confirmed through this MCP',
    },
    arrowTypes: ['straight', 'elbow', 'curved'],
    stampType: 'textStamp',
    timings: {
      addToolsMs: '3000–8000 per object (editor settle + retries) — NORMAL, do not retry on slowness',
      occasionalReloadMs: '~8000 — server reloads the page to mount objects; wait, do not panic',
      readToolsMs: '1000–3000',
      firstBoardOpenMs: 'up to 35000 — navigating a tab to the board and waiting for the Yjs doc',
    },
    resultFields: {
      mounted: 'true = object is rendered by the app; false = created in the doc but not rendered (server already tried a page reload to self-heal) — verify with holst_get_board_content and inform the user if still missing',
      native: 'true = text written through the app editor pipeline; false = legacy raw-Yjs fallback (older Holst builds)',
      warning: 'non-fatal post-write exception observed by a legacy build; content was verified to land',
    },
    envVars: {
      HOLST_AUTO_START: 'default 1 — server auto-launches Holst.app with the CDP debug port when it is not running; set 0 to disable',
      HOLST_ALLOWED_BOARD_IDS: 'comma/space-separated UUID allowlist; when set, all other boards are refused',
      HOLST_READ_ONLY: '1|true — blocks every mutating tool',
      HOLST_MAX_DUMP_BYTES: 'default 2000000 — holst_get_board_content refuses bigger dumps; use holst_search_text',
      HOLST_DEBUG_PORT: 'default 9222 — CDP port, must match the app launch flag',
    },
    limits: {
      textMaxLen: 100000,
      searchQueryMaxLen: 1000,
      coordAbsMax: 1e7,
      sizeMin: 1,
      sizeMax: 1e6,
      boardId: 'strict UUID only',
      objectId: 'charset [A-Za-z0-9_-], ≤128 chars',
    },
    verificationPattern: [
      '1. create objects (add_shape / add_sticker / add_simple_text / add_arrow / add_frame)',
      '2. read back with holst_get_board_summary — confirm every block has its text',
      '3. if a text is missing, retry once via holst_update_text (idempotent)',
    ],
    doNot: [
      'do not synthesize keyboard/zoom input via CDP — it has crashed the app in testing',
      'do not retry add_* calls just because they are slow (see timings)',
      'do not assume a failed read means the board is broken — run holst_doctor first',
    ],
  };
}
