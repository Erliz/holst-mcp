// Tool schemas + dispatch handlers (extracted from server.js so tests can
// import them — server.js starts a stdio transport on import).
// Invariant under test: every args.X a handler reads is declared in its
// tool's inputSchema (test/tools-schema.test.js).

import {
  whoAmI, doctor, listBoards, batchCreate, getBoardContent, getBoardSummary,
  searchBoardText, addSticker, updateText, deleteObject, deleteObjects,
  addShape, addSimpleText, addArrow, moveObject, resizeObject, setColor,
  addFrame, addStamp, screenshot, measureText, setZOrder } from './holst.js';
import { getReference } from './reference.js';
import { SHAPE_TYPES, STROKE_STYLES } from './validate.js';

export // Descriptions GENERATED from validate.js enums — single source of truth.
// Editing a token list in validate.js updates these automatically; the
// tools-schema test asserts descriptions match the enum data.
const SHAPE_TYPES_DESC = SHAPE_TYPES.join(', ') + ' (whitelist; \"rhombus\" does NOT exist — use diamond)';
const STROKE_STYLES_DESC = STROKE_STYLES.filter((s) => s !== 'solid').join(', ') + ' (default solid)';

const ADD_NOTE =
  'NOTE: takes 3-8s (editor settle) — slow is normal, never retry on slowness. ' +
  'Result: { ok, id, documentId, mounted, native }; mounted=false = not rendered yet (server self-heals via reload) — verify with holst_get_board_summary. ' +
  'Coordinates: top-left origin, y grows down.';

const RUNS_PROP = {
  runs: {
    type: 'array',
    description: 'Run-level styled text (alternative to text): [{ text, color?, bold?, italic?, underline?, strikethrough? }] — e.g. name in coral bold + sublabel in gray italic inside ONE object',
    items: { type: 'object' },
  },
};

// Shared typography properties for text-bearing objects.
const TEXT_STYLE_PROPS = {
  ...RUNS_PROP,
  fontSize: { type: 'number', description: 'Font size in px (shape) — for simple-text converts to internal scale' },
  textScale: { type: 'number', description: 'Raw font scale multiplier (sticker/simple-text alternative to fontSize)' },
  textColor: { type: 'string', description: 'Text color: #RRGGBB (e.g. #202020 ink, #e54d2e vivid red)' },
  textOpacity: { type: 'number', description: 'Text opacity 0..1 — requires textColor; big faded numerals: textColor #bf4520 + textOpacity 0.06' },
  textBackgroundColor: { type: 'string', description: 'Text highlight color: #RRGGBB' },
  horizontalAlign: { type: 'string', description: 'left (default), center, right, justify' },
  verticalAlign: { type: 'string', description: 'top, center, bottom (text position inside shape)' },
  letterSpacing: { type: 'number', description: 'Letter spacing in px (float, -10..100)' },
  fontFamily: { type: 'string', description: 'Font token: SourceCodePro (mono), Inter, Roboto, Montserrat, EBGaramond, Merriweather, TimesNewRoman, Caveat, ShantellSans…' },
  lineHeight: { type: 'number', description: 'Line height in percent (e.g. 250 = 250%)' },
  bold: { type: 'boolean', description: 'Bold the whole text' },
  italic: { type: 'boolean', description: 'Italicize the whole text' },
  underline: { type: 'boolean', description: 'Underline the whole text' },
  strikethrough: { type: 'boolean', description: 'Strikethrough the whole text' },
};

export const TOOLS = [
  {
    name: 'holst_whoami',
    description:
      'Check the Holst connection: returns the logged-in user. Run this first if anything fails. Never auto-launches anything by itself.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'holst_doctor',
    description:
      'Full self-diagnosis: CDP endpoint, Holst app, tabs, auth, editor readiness, latency, effective config. Never throws — returns a report with a human-readable verdict and suggested action. Run this before troubleshooting anything.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'holst_reference',
    description:
      'On-demand reference: suggested hex colors, verified shape/arrow types, coordinate conventions, timings, result-field semantics, limits, env vars, do-not list. Cheaper than guessing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'holst_list_boards',
    description:
      'List all boards and folders across the user\'s workspaces. Returns the user, recent boards, and per-workspace trees. boardId for other tools is a strict UUID from here (or from a board URL).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'holst_get_board_content',
    description:
      'Dump of LIVE board content: all objects (with coordinates) + their document texts + non-empty metadata stores. Dead weight is trimmed by default: the delete audit (delete-events-metaStore) and documents of deleted objects are excluded — includeDeleteEvents:true returns the full raw dump (audit view). Size-capped by HOLST_MAX_DUMP_BYTES (default 2MB, applied to the trimmed content) — for big boards use holst_search_text or holst_get_board_summary instead. ' +
      'Token savers: bbox {x1,y1,x2,y2} returns only overlapping objects; positionsOnly:true returns compact {type,x,y,w,h} without texts. Arrows are included in both: their box is derived from start/end endpoints (attached endpoints resolve to the referenced object; curved arrows are approximated by their endpoint box). ' +
      'Counting: live objects = Object.keys(content.objects) ONLY — never scan the dump for "type" fields (the includeDeleteEvents audit view carries full snapshots of DELETED objects with ordinary type fields). See holst_reference countingRules.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string', description: 'UUID board id' },
        bbox: { type: 'object', description: '{ x1, y1, x2, y2 } board coords — only overlapping objects returned' },
        positionsOnly: { type: 'boolean', description: 'Compact {type,x,y,w,h} per object, no document texts' },
        includeDeleteEvents: { type: 'boolean', description: 'Audit view: return the full raw dump — delete-events-metaStore (delete audit with full snapshots of deleted objects) + all documents incl. orphans. Default false (live content only)' },
      },
      required: ['boardId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_get_board_summary',
    description:
      'Structured markdown of a board: stickers grouped under nearest section headers. The preferred way to read a board and to VERIFY your own changes (every block must show its text). ' +
      'Counts live objects from content.objects only; sub-counts (stickers/sections/text labels) exclude empty-text objects — exact rules: holst_reference countingRules.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
      },
      required: ['boardId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_search_text',
    description:
      'Case-insensitive substring search across all texts on a board. Returns matches with object id, type, position, snippet. Use for big boards instead of full dumps.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        query: { type: 'string', description: 'Substring to search (case-insensitive)' },
      },
      required: ['boardId', 'query'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_measure_text',
    description:
      'Measure how text will RENDER before creating objects — real metrics from the board app\'s own loaded fonts (SourceCodePro ~0.72em/char, NOT the nominal 0.6; bold caps ~0.9em). ' +
      'Returns { widthPx, heightPx, lineHeightPx, lines: [{ text, widthPx }] }; multiline \\n measured per line, widthPx = widest line. ' +
      'Pure read — nothing is created, works on read-only boards. Use it to size shapes/chips/labels in one pass: measure first, then create with width ≥ widthPx + padding.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string', description: 'UUID board id — the page whose loaded fonts are used' },
        text: { type: 'string', description: 'Text to measure (\\n = new line)' },
        fontSize: { type: 'number', description: 'Font size in px (same unit as add_* typography)' },
        fontFamily: { type: 'string', description: 'REQUIRED. Font token resolved against the app\'s loaded fonts: SourceCodePro (mono), Inter, Roboto, Montserrat, EBGaramond, Merriweather, TimesNewRoman, Caveat, ShantellSans… Unknown token → error listing available families' },
        bold: { type: 'boolean', description: 'Measure the 700 weight' },
        italic: { type: 'boolean', description: 'Measure the italic style' },
        letterSpacing: { type: 'number', description: 'Letter spacing in px (float, -10..100)' },
      },
      required: ['boardId', 'text', 'fontSize', 'fontFamily'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_batch_create',
    description:
      'Create a whole diagram in ONE call — 10-15x faster than sequential add_* tools (30 objects in ~15s instead of minutes). ' +
      'objects: array of { kind: "shape"|"sticker"|"simple-text"|"frame"|"stamp", ref?: "name", text?, x, y, ...options } plus ' +
      '{ kind: "arrow", from: { ref, relativePoint? }|{ x, y }, to: ..., text?, textPosition?, strokeStyle?, arrowheadStart?, arrowheadEnd?, strokeWidth?, midwayControls?: [{x, y}, ...], elbowMidwayControls?: [{x: V, y: null}|{x: null, y: H}, ...] } — ' +
      'arrows support on-arrow labels, dashed/dotted styles, headless variants (arrowhead*: "none") and geometry shaping (midwayControls = free points on curved, elbowMidwayControls = corridor lines on elbow). ' +
      'Text objects support typography: fontSize, textColor (#RRGGBB ok), horizontalAlign, bold/italic/underline/strikethrough. ' +
      'options.arrowsBehind: true places arrows BELOW the nodes (design-system layering). ' +
      'ref is a local name (letters/digits/dash/_); arrows link refs instead of UUIDs; refs auto-generate when omitted. ' +
      'Result maps each ref to { id, documentId, mounted, textOk } (arrows: textOk = on-arrow label verified in the render layer; null = no label) — verify with holst_get_board_summary afterwards. ' +
      'textFailedRefs lists refs (objects AND arrows) whose text did not land — ok:false until you follow up with holst_update_text. ' +
      'Same fields/validation as the individual add_* tools; colors are #RRGGBB hex; frames accept backgroundStyle (fill / fill-border / border-only); top-left coords, batch limit 200.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objects: {
          type: 'array',
          description: 'Diagram entries; creations first, arrows reference refs',
          items: { type: 'object' },
        },
        options: {
          type: 'object',
          description: 'Diagram-level options',
          properties: {
            arrowsBehind: { type: 'boolean', description: 'Place arrows below the created nodes (connectors behind boxes)' },
          },
          additionalProperties: false,
        },
      },
      required: ['boardId', 'objects'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_sticker',
    description:
      'Add a sticky note with text (default 192x192, yellow). ' + ADD_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        text: { type: 'string', description: 'Sticker text (plain, \\n = new paragraph)' },
        x: { type: 'number', description: 'Top-left X on canvas' },
        y: { type: 'number', description: 'Top-left Y on canvas' },
        width: { type: 'number', default: 192 },
        height: { type: 'number', default: 192 },
      },
      required: ['boardId', 'text', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_update_text',
    description:
      'Replace the text of an existing object (sticker / shape / simple-text / arrow label). Pass plain `text` OR run-level `runs` (not both). Optional style params: fontSize, textScale, textColor, horizontalAlign, bold/italic/underline/strikethrough. Arrows: rewrites the on-arrow label, keeping its position. Multiline: \\n = new paragraph. Idempotent — safe to retry once. Internally settles through the post-reload page-sync window, so freshly created objects stay addressable; a genuine object not found surfaces only after a ~6s budget. Takes 2-6s.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string', description: 'From get_board_content / creation result' },
        text: { type: 'string', description: 'Plain text (omit when using runs)' },
        ...RUNS_PROP,
        fontSize: { type: 'number' },
        textScale: { type: 'number' },
        textColor: { type: 'string' },
        textOpacity: { type: 'number' },
        textBackgroundColor: { type: 'string' },
        horizontalAlign: { type: 'string' },
        verticalAlign: { type: 'string' },
        letterSpacing: { type: 'number' },
        fontFamily: { type: 'string' },
        lineHeight: { type: 'number' },
        bold: { type: 'boolean' },
        italic: { type: 'boolean' },
        underline: { type: 'boolean' },
        strikethrough: { type: 'boolean' },
      },
      required: ['boardId', 'objectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_delete_object',
    description:
      'Delete an object AND its linked text document. Irreversible — confirm intent for bulk deletions.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string' },
      },
      required: ['boardId', 'objectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_delete_objects',
    description:
      'Delete MANY objects in ONE call (`ids` = object ids — the same ids called objectId in other tools; from get_board_content / creation results). ' +
      'Cascade note: deleting a node removes its attached arrows too — those ids report {ok: true, alreadyGone: true}, not an error. ' +
      'Deletes in chunks of 10 with a per-chunk scaled CDP timeout (no 15s timeouts on big batches). Result: { ok, deleted, alreadyGone, failed, report: {id: {ok|alreadyGone|error}} } — deleted counts real removals only. Limit 200 per call. Irreversible — confirm intent.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Object ids from get_board_content / creation results' },
      },
      required: ['boardId', 'ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_shape',
    description:
      'Add a shape with a text label (section headers, flow blocks). Types: ' + SHAPE_TYPES.join(', ') + '. Typography: fontSize, textColor (#RRGGBB ok), horizontalAlign, bold/italic/underline/strikethrough. ' + ADD_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        text: { type: 'string', description: 'Label inside the shape' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', default: 240 },
        height: { type: 'number', default: 48 },
        shapeType: { type: 'string', default: 'square', description: SHAPE_TYPES_DESC },
        borderRadius: { type: 'number', description: 'Corner rounding px — borderRadius = height/2 gives a capsule/pill' },
        fillColor: { type: 'string', default: '#ffffff', description: '#RRGGBB hex' },
        strokeColor: { type: 'string', default: '#202020', description: '#RRGGBB hex' },
        strokeWidth: { type: 'number', default: 2 },
        fixedSize: { type: 'boolean', default: true },
        ...TEXT_STYLE_PROPS,
      },
      required: ['boardId', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_simple_text',
    description:
      'Add a plain text label (no background), auto-sized by content. Typography: fontSize in px (converts to internal scale), textColor, horizontalAlign, bold/italic. ' + ADD_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        text: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', description: 'Fixed width (enables horizontalAlign centering under nodes)' },
        ...TEXT_STYLE_PROPS,
      },
      required: ['boardId', 'text', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_arrow',
    description:
      'Connect two points or objects. Endpoint = { x, y } for a free point, or { objectId, relativePoint: { x, y } } to attach (0..1 of object bounds; 0.5/1 = bottom center). Create endpoint objects FIRST — you need their ids. ' +
      'Optional text = on-arrow label; textPosition 0..1 places it along the path (default middle). ' +
      'midwayControls: [{x, y}, ...] absolute points the arrow routes through — bend the geometry freely (verified on curved arrows); elbowMidwayControls: corridor lines for elbow arrows — both visible in get_board_content. ' +
      'arrowheadStart/arrowheadEnd: none | miro | arc | figma (absent = default: no start head, standard end head; "none" disables). ' +
      'strokeStyle: solid (default), dashed, dotted. strokeWidth: line thickness. fontSize/textColor style the label; colors are #RRGGBB hex.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        start: {
          type: 'object',
          description: '{ x, y } or { objectId, relativePoint: {x, y} }',
        },
        end: {
          type: 'object',
          description: '{ x, y } or { objectId, relativePoint: {x, y} }',
        },
        arrowType: { type: 'string', default: 'elbow', description: 'elbow, straight, curved' },
        strokeColor: { type: 'string', default: '#808080', description: '#RRGGBB hex' },
        strokeStyle: { type: 'string', default: 'solid', description: STROKE_STYLES_DESC },
        strokeWidth: { type: 'number', description: 'Line thickness (e.g. 2 thin, 5 medium, 17 fat)' },
        arrowheadStart: { type: 'string', description: 'none, miro, arc, figma' },
        arrowheadEnd: { type: 'string', description: 'none (disables default head), miro, arc, figma' },
        text: { type: 'string', description: 'On-arrow label (\\n = new line)' },
        textPosition: { type: 'number', default: 0.5, description: 'Label position along the arrow, 0..1 (0.5 = middle)' },
        midwayControls: {
          type: 'array',
          description: 'Geometry shaping: absolute [{ x, y }] board points the arrow routes through. CURVED arrows only — the elbow renderer ignores them (live-verified). Compose crossing hops/bumps yourself as point sequences — there is no built-in hop primitive. Max 100 points.',
        },
        elbowMidwayControls: {
          type: 'array',
          description: 'ELBOW arrows only (curved renderer ignores them): corridor constraints applied in order — {x: V, y: null} = route passes the vertical line x=V, {x: null, y: H} = passes the horizontal line y=H. Rectangular hop over a crossing at (X, Y) with height r: [{x: X−r, y: null}, {x: null, y: Y−r}, {x: X+r, y: null}]. Max 100 corridors.',
        },
        fontSize: { type: 'number', description: 'Label font size in px' },
        textColor: { type: 'string', description: 'Label color: #RRGGBB' },
      },
      required: ['boardId', 'start', 'end'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_move_object',
    description: 'Move an object to new coordinates (top-left corner). Takes 1-3s.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['boardId', 'objectId', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_resize_object',
    description:
      'Change width and/or height of a shape or sticker. For simple-text: width sets the fixed wrap boundary (text re-wraps; height is auto — height is not supported for simple-text).',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['boardId', 'objectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_set_z_order',
    description:
      'Change the layer order of an existing object — fix wrong layering WITHOUT delete + recreate (e.g. a label under a zone). Pass EXACTLY ONE of: placement ("front" = above everything, "back" = below everything, frames included) or zIndex (absolute value, same vocabulary as batch entries; read current values via holst_get_board_content). Result returns the effective zIndex. Works for every object kind (shapes, stickers, simple-texts, frames, stamps, arrows).',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string', description: 'From get_board_content / creation result' },
        placement: { type: 'string', enum: ['front', 'back'], description: 'front = above everything; back = below everything (below frames too)' },
        zIndex: { type: 'number', description: 'Absolute z value -10000000..10000000 (omit when using placement)' },
      },
      required: ['boardId', 'objectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_frame',
    description:
      'Add a large labeled container that sits BELOW content (groups a diagram). labelText is a plain field, no separate document. backgroundStyle: fill / fill-border / border-only. ' + ADD_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        labelText: { type: 'string', default: 'Frame', description: 'Frame title' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', default: 800 },
        height: { type: 'number', default: 600 },
        fillColor: { type: 'string', default: '#ffffff', description: '#RRGGBB hex' },
        backgroundStyle: { type: 'string', enum: ['fill', 'fill-border', 'border-only'], description: 'Frame look: fill (no border), fill-border (default-ish both), border-only (no fill)' },
      },
      required: ['boardId', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_stamp',
    description:
      'Add an emoji / text stamp (e.g. "❤️", "🔥"). text = the emoji itself. ' + ADD_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        text: { type: 'string', description: 'Emoji or short text' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', default: 60 },
        height: { type: 'number', default: 60 },
        stampType: { type: 'string', default: 'textStamp' },
      },
      required: ['boardId', 'text', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_screenshot',
    description:
      'Capture the board canvas as an image (MCP image content — no disk writes). ' +
      'For VIEWING and layout verification by humans/multimodal models; NOT for pixel-exact actions — use holst_get_board_content for data. ' +
      'Slight color shift on P3 displays is normal. The board must contain at least one object (the camera service is reached through it). Default captures the current viewport without moving the camera; bbox {x1,y1,x2,y2} fits that world region instead (camera is restored after). ' +
      'jpeg default (compact); scale css = CSS pixels (4x smaller than device). withBase64 adds the base64 to the text meta for agents that must save the file themselves (~2x base64 tokens — only when needed).',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string', description: 'UUID board id' },
        bbox: { type: 'object', description: '{ x1, y1, x2, y2 } world coords — fit this region (camera restored afterwards); omit to capture the current viewport' },
        format: { type: 'string', enum: ['jpeg', 'png'], description: 'jpeg (default, compact) or png (lossless)' },
        quality: { type: 'number', description: 'jpeg quality 1..100 (default 85)' },
        scale: { type: 'string', enum: ['css', 'device'], description: 'css = CSS pixels (default, smaller); device = full devicePixelRatio resolution' },
        withBase64: { type: 'boolean', description: 'Also embed base64 in the text meta (for non-multimodal agents saving the file; costs ~2x base64 tokens)' },
      },
      required: ['boardId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_set_color',
    description:
      'Set fillColor and/or strokeColor (#RRGGBB hex), strokeStyle (solid, dashed, dotted), strokeWidth, fillOpacity / strokeOpacity (0..1 — translucent washes), and backgroundStyle on frames. Suggested colors: holst_reference.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string' },
        fillColor: { type: 'string', description: '#RRGGBB hex' },
        strokeColor: { type: 'string', description: '#RRGGBB hex' },
        strokeStyle: { type: 'string', description: 'solid, dashed, dotted' },
        strokeWidth: { type: 'number', description: 'Line thickness 0..100' },
        fillOpacity: { type: 'number', description: 'Fill opacity 0..1 (keeps current color)' },
        strokeOpacity: { type: 'number', description: 'Stroke opacity 0..1 (keeps current color)' },
        backgroundStyle: { type: 'string', enum: ['fill', 'fill-border', 'border-only'], description: 'Frames only: fill / fill-border / border-only look' },
      },
      required: ['boardId', 'objectId'],
      additionalProperties: false,
    },
  },
];

export const DISPATCH = {
  holst_whoami: (args) => whoAmI(),
  holst_doctor: (args) => doctor(),
  holst_reference: (args) => getReference(),
  holst_list_boards: (args) => listBoards(),
  holst_batch_create: (args) => batchCreate(args.boardId, args.objects, args.options || {}),
  holst_get_board_content: (args) => getBoardContent(args.boardId, { bbox: args.bbox, positionsOnly: args.positionsOnly, includeDeleteEvents: args.includeDeleteEvents }),
  holst_get_board_summary: (args) => getBoardSummary(args.boardId),
  holst_search_text: (args) => searchBoardText(args.boardId, args.query),
  holst_measure_text: (args) => measureText(args.boardId, args),
  holst_add_sticker: (args) => addSticker(args.boardId, args),
  holst_update_text: (args) => updateText(args.boardId, args.objectId, args.text, args),
  holst_delete_object: (args) => deleteObject(args.boardId, args.objectId),
  holst_delete_objects: (args) => deleteObjects(args.boardId, args.ids),
  holst_add_shape: (args) => addShape(args.boardId, args),
  holst_add_simple_text: (args) => addSimpleText(args.boardId, args),
  holst_add_arrow: (args) => addArrow(args.boardId, args),
  holst_move_object: (args) => moveObject(args.boardId, args.objectId, { x: args.x, y: args.y }),
  holst_resize_object: (args) => resizeObject(args.boardId, args.objectId, { width: args.width, height: args.height }),
  holst_set_z_order: (args) => setZOrder(args.boardId, args.objectId, { zIndex: args.zIndex, placement: args.placement }),
  holst_set_color: (args) => setColor(args.boardId, args.objectId, {
    fillColor: args.fillColor, strokeColor: args.strokeColor, strokeStyle: args.strokeStyle,
    strokeWidth: args.strokeWidth, fillOpacity: args.fillOpacity, strokeOpacity: args.strokeOpacity,
  }),
  holst_add_frame: (args) => addFrame(args.boardId, args),
  holst_screenshot: (args) => screenshot(args.boardId, { bbox: args.bbox, format: args.format, quality: args.quality, scale: args.scale, withBase64: args.withBase64 }),
  holst_add_stamp: (args) => addStamp(args.boardId, args),
};
