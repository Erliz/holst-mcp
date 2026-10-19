// On-demand reference for MCP consumers: conventions, verified values,
// timings, result semantics, env vars, limits. Call holst_reference
// instead of guessing — costs no context until requested.

import { SHAPE_TYPES, ARROW_TYPES, STROKE_STYLES, BACKGROUND_STYLES } from './validate.js';

export function getReference() {
  return {
    coordinateSystem: {
      origin: 'top-left',
      yDirection: 'down',
      typicalLayout: 'x 300–1800, y 80–1600 fits one screen; boxes 260×56 with ≥180px vertical gaps work well',
      notes: 'position is the top-left corner of the object; arrows attach via relativePoint {x,y} in 0..1 of the object bounds (0.5/0.5 = center)',
    },
    suggestedColors: {
      background: '#ffffff',
      ink: '#202020',
      muted: '#8d8d8d', line: '#808080',
      paleWashes: { violet: '#e4defc', blue: '#cee7fe', green: '#c6ecdb', yellow: '#fff8c6' },
      accents: { red: '#e54d2e', violet: '#6e56cf', cyan: '#05a2c2', green: '#29a383', amber: '#ffc53d' },
    },
    colorRendering: 'Colors are #RRGGBB everywhere: every color param accepts hex, get_board_content returns hex. Holst renders saturated hues harmonized (hue kept, saturation/lights trimmed toward ~57–62% lightness) — identically for every input, so the color you set is the color the UI shows. Pale/dark/gray hexes render exactly.',
    fontFamilies: {
      verified: ['ShantellSans'],
      fromBundle: ['SourceCodePro (mono)', 'Inter', 'Roboto', 'Montserrat', 'MontserratAlternates', 'OpenSans', 'Arimo', 'Oswald', 'RobotoCondensed', 'EBGaramond', 'Merriweather', 'NotoSerif', 'TimesNewRoman', 'Bitter', 'Georgia', 'Caveat', 'Pacifico', 'Bangers', 'AbrilFatface', 'FredokaOne', 'Graduate', 'LemonTuesday', 'Comic'],
      note: 'tokens are PascalCase family names; mono = SourceCodePro, serif = EBGaramond/Merriweather/NotoSerif/TimesNewRoman',
    },
    colorFormat: '#RRGGBB hex only (palette names are NOT accepted since v0.6.0)',
    typography: {
      fontSize: 'px int on shape/arrow (field fontSize); simple-text converts px → textScale (base 14); sticker uses raw textScale',
      textColor: 'text color field (#RRGGBB); textBackgroundColor = highlight',
      textOpacity: '0..1 opacity inside textColor — pass WITH textColor (faded numerals: textColor + textOpacity 0.06-0.10)',
      runs: 'run-level styled text (alternative to plain text): [{ text, color?, bold?, italic?, underline?, strikethrough? }] — name+sublabel with different colors in ONE object; colors ride as Slate mark props via createFromJSON',
      emphasis: 'bold / italic / underline / strikethrough params → document marks (HTML <strong>/<em>/<u>/<s> through the native paste pipeline)',
      horizontalAlign: 'left (default/absent), center, right, justify',
      verticalAlign: 'top / center / bottom — text position inside shapes',
      letterSpacing: 'px float (-10..100)',
      fontFamily: 'PascalCase family token — see fontFamilies; mono = SourceCodePro',
      lineHeight: 'percent (e.g. 250)',
      borderRadius: 'shape corner rounding px — borderRadius = height/2 → capsule/pill shape',
      multiline: '\\n = new paragraph — works in add_* and batch (textOk reflects it)',
    },
    shapeTypes: {
      verified: SHAPE_TYPES,
      note: 'whitelist-validated; "rhombus" does NOT exist (silently rendered as rectangle before v0.5) — the rhombus token is diamond',
    },
    arrowTypes: ARROW_TYPES,
    arrowStrokeStyles: STROKE_STYLES,
    arrowheads: {
      values: ['none', 'miro', 'arc', 'figma'],
      defaults: 'absent fields = no start head, standard end head; arrowheadEnd: "none" disables the end head (axes, dividers); arrowheadStart adds a head at the start',
      strokeWidth: 'line thickness 0..100 (UI examples: 2 thin, 5 medium, 17 fat)',
    },
    opacity: 'fillOpacity / strokeOpacity 0..1 in set_color (adjusts the opacity inside the color object, keeps the color); translucent washes e.g. fillOpacity 0.03',
    backgroundStyles: { values: BACKGROUND_STYLES, note: 'frames only: fill (background without border), fill-border (both), border-only (outline, fill ignored); absent field = app default look' },
    zOrder: 'zIndex field; batch options.arrowsBehind: true places connectors BELOW the created nodes (design-system layering)',
    arrowLabels: {
      how: 'add_arrow / batch arrow entry: text + textPosition (0..1 along the path, default 0.5 middle); update later via holst_update_text on the arrow id',
      storage: 'plain texts field on the arrow object (no documentId) — visible in get_board_content as texts[]',
    },
    stampType: 'textStamp',
    screenshots: {
      tool: 'holst_screenshot — captures the board canvas as MCP image content, NO disk writes',
      params: 'bbox {x1,y1,x2,y2} fits a world region (camera restored after); omit = current viewport untouched. format jpeg (default, compact) | png; quality 1..100 (default 85); scale css (default, smaller) | device (full retina)',
      withBase64: 'adds base64 to the text meta — ONLY for agents that must save the file themselves; costs ~2x base64 tokens in context',
      usage: 'viewing and layout verification (humans + multimodal models). NOT for pixel-exact actions — use holst_get_board_content for data. Slight color shift on P3 displays is normal',
      timings: '~1s current viewport; ~2s with bbox (camera fit + settle + restore)',
    },
    timings: {
      batchCreate: 'whole diagram in ONE call: ~10-20s for 30 objects — preferred for 3+ objects',
      addToolsMs: '3000–8000 per object (editor settle + retries) — NORMAL, do not retry on slowness; prefer holst_batch_create for 3+ objects',
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
      HOLST_RW_BOARD_IDS: 'comma/space-separated UUIDs with full read+write access; when set (together with RO or alone), boards outside both lists are refused',
      HOLST_RO_BOARD_IDS: 'comma/space-separated UUIDs, read-only: readable but every mutating tool is refused; RO wins if an id is in both lists (fail-closed)',
      HOLST_READ_ONLY: '1|true — global master switch, blocks every mutating tool on ALL boards',
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
