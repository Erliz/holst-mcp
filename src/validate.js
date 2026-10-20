// Input validation for MCP tool arguments.
// Everything that gets interpolated into page JS or CDP params must pass through here.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
// Type tokens (shapeType, arrowType, stampType): letters, digits, dashes (round-rect, textStamp).
const TOKEN_RE = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;

// Board-space coordinate range, shared by every coordinate path (single
// source of truth; batch.js and holst.js import this — issue #62).
export const COORD = { min: -1e7, max: 1e7 };

// Unit-space attachment range for arrow relativePoint (issue #68). The docs
// promised 0..1 all along; live probe (111 attached endpoints) confirmed the
// app's own values sit inside [0, 1] inclusive — 0 and 1 are its side anchors.
export const RELATIVE_POINT = { min: 0, max: 1 };

function fail(message) {
  throw new ValidationError(message);
}

/**
 * boardId must be a strict UUID. Prevents URL/path payloads from reaching
 * Page.navigate and gapi URLs.
 */
export function assertBoardId(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    fail(`boardId must be a UUID, got: ${typeof id === 'string' ? JSON.stringify(id.slice(0, 64)) : typeof id}`);
  }
}

/**
 * objectId/documentId: unknown provenance, so allow a conservative charset
 * instead of strict UUID, but block anything that could break out of a JS string.
 */
export function assertObjectId(id) {
  if (typeof id !== 'string' || !OBJECT_ID_RE.test(id)) {
    fail(`objectId must match ${OBJECT_ID_RE}, got: ${typeof id === 'string' ? JSON.stringify(id.slice(0, 64)) : typeof id}`);
  }
}

/**
 * Finite number gate. Returns the value, or `opts.default` when undefined.
 * Rejects NaN/Infinity (they corrupt Yjs data) and non-number types.
 */
export function num(value, name, opts = {}) {
  const { default: def, min = -Infinity, max = Infinity } = opts;
  if (value === undefined) {
    if (def === undefined) fail(`${name} is required`);
    value = def;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${name} must be a finite number, got: ${value === null ? 'null' : typeof value}`);
  }
  if (value < min || value > max) {
    fail(`${name} must be between ${min} and ${max}, got: ${value}`);
  }
  return value;
}

/**
 * Type token (shapeType, arrowType, stampType). Colors do NOT route here —
 * they go through parseColor (#RRGGBB only since v0.6.0).
 * Charset whitelist keeps interpolated values inside a JS string literal.
 */
export function safeToken(value, name, opts = {}) {
  const { default: def } = opts;
  if (value === undefined) {
    if (def === undefined) fail(`${name} is required`);
    return def;
  }
  if (typeof value !== 'string' || !TOKEN_RE.test(value)) {
    fail(`${name} must match ${TOKEN_RE}, got: ${typeof value === 'string' ? JSON.stringify(value.slice(0, 64)) : typeof value}`);
  }
  return value;
}

/**
 * Text content for stickers/labels/documents. Strings only, capped length.
 */
export function assertText(value, name, opts = {}) {
  const { default: def, maxLen = 100_000 } = opts;
  if (value === undefined) {
    if (def === undefined) fail(`${name} is required`);
    return def;
  }
  if (typeof value !== 'string') {
    fail(`${name} must be a string, got: ${typeof value}`);
  }
  if (value.length > maxLen) {
    fail(`${name} exceeds max length ${maxLen} (${value.length})`);
  }
  return value;
}

/**
 * Arrow stroke style. The app stores dashed/dotted as a string field and
 * solid as an ABSENT field — callers translate 'solid' accordingly.
 */
export const STROKE_STYLES = ['solid', 'dashed', 'dotted'];

export function assertStrokeStyle(value, name, opts = {}) {
  const { default: def } = opts;
  if (value === undefined) {
    if (def === undefined) fail(`${name} is required`);
    value = def;
  }
  if (typeof value !== 'string' || !STROKE_STYLES.includes(value)) {
    fail(`${name} must be one of ${STROKE_STYLES.join(', ')}, got: ${typeof value === 'string' ? JSON.stringify(value.slice(0, 64)) : typeof value}`);
  }
  return value;
}

/**
 * On-arrow label side (issue #42): 'on' = on the line (default, renderer
 * masks the stroke behind the label), 'left'/'right' = beside the segment
 * with the app's fixed 7px gap. Screen-side semantics: right = +x offset
 * (below for horizontal segments).
 */
export const LABEL_SIDES = ['on', 'left', 'right'];

export function assertLabelSide(value, name, opts = {}) {
  const { default: def } = opts;
  if (value === undefined) {
    if (def === undefined) fail(`${name} is required`);
    return def;
  }
  if (typeof value !== 'string' || !LABEL_SIDES.includes(value)) {
    fail(`${name} must be one of ${LABEL_SIDES.join(', ')}, got: ${typeof value === 'string' ? JSON.stringify(value.slice(0, 64)) : typeof value}`);
  }
  return value;
}

/**
 * Cross-field rule (issue #61): labelSide ≠ 'on' only takes effect on an
 * arrow that HAS a label — without text the side was silently dropped
 * (arrow created, no error, no sideOk). Fail fast instead: the caller
 * learns the mistake at the call, not by inspecting the board. 'on' (the
 * default) and an absent side stay valid without text — documented no-op.
 */
export function assertLabelSideHasText(labelSide, text, name = 'labelSide') {
  if (labelSide !== undefined && labelSide !== 'on'
    && (text === undefined || String(text) === '')) {
    fail(`${name} ${JSON.stringify(labelSide)} requires label text ('on' without text is the documented no-op)`);
  }
}

/**
 * Color value: #RRGGBB hex ONLY (v0.6.0). Hex converts to the integer form
 * the app stores (verified: UI '#782baf' → {color: 7875503}). Internal
 * palette token names are no longer accepted — tokens and their hex values
 * render identically (verified pixel-wise), the full map lives in
 * docs/palette.md; UI-created objects may still READ back as tokens.
 */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function parseColor(value, name, opts = {}) {
  const { default: def } = opts;
  if (value === undefined) {
    if (def === undefined) fail(`${name} is required`);
    value = def;
  }
  if (typeof value !== 'string' || !HEX_RE.test(value)) {
    fail(`${name} must be #RRGGBB hex (e.g. #e54d2e; palette names are not accepted — see holst_reference for suggested colors), got: ${typeof value === 'string' ? JSON.stringify(value.slice(0, 64)) : typeof value}`);
  }
  return parseInt(value.slice(1), 16);
}

/**
 * Frame background style (decoded from UI samples 2026-10-18):
 * 1 = fill without border, 2 = fill with border, 3 = border without fill.
 * Absent field = app default look.
 */
const BACKGROUND_STYLES = ['fill', 'fill-border', 'border-only'];
const BACKGROUND_STYLE_IDS = { fill: 1, 'fill-border': 2, 'border-only': 3 };
export { BACKGROUND_STYLES };

export function assertBackgroundStyle(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !BACKGROUND_STYLES.includes(value)) {
    fail(`${name} must be one of ${BACKGROUND_STYLES.join(', ')} (frames only), got: ${typeof value === 'string' ? JSON.stringify(value.slice(0, 64)) : typeof value}`);
  }
  return BACKGROUND_STYLE_IDS[value];
}

/**
 * Z-order placement for set_z_order (issue #10): relative to the current
 * landscape — front = above everything, back = below everything (frames
 * included; frames themselves sit at the bottom by convention).
 */
const Z_PLACEMENTS = ['front', 'back'];
export { Z_PLACEMENTS };

export function assertZPlacement(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Z_PLACEMENTS.includes(value)) {
    fail(`${name} must be one of ${Z_PLACEMENTS.join(', ')}, got: ${typeof value === 'string' ? JSON.stringify(value.slice(0, 64)) : typeof value}`);
  }
  return value;
}

/**
 * Arrowhead shape. Verified values from the app UI: none, miro, arc, figma.
 * undefined = Holst default (no start head, standard end head).
 */
const ARROWHEADS = ['none', 'miro', 'arc', 'figma'];
export { ARROWHEADS };

export function assertArrowhead(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ARROWHEADS.includes(value)) {
    fail(`${name} must be one of ${ARROWHEADS.join(', ')}, got: ${typeof value === 'string' ? JSON.stringify(value.slice(0, 64)) : typeof value}`);
  }
  return value;
}

/** Opacity 0..1 (fill/stroke opacity inside Holst color objects). */
export function assertOpacity(value, name) {
  return num(value, name, { min: 0, max: 1 });
}

/** Text alignment. 'left' is the app default (stored as absent field). */
const ALIGNS = ['left', 'center', 'right', 'justify'];

export function assertHorizontalAlign(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ALIGNS.includes(value)) {
    fail(`${name} must be one of ${ALIGNS.join(', ')}`);
  }
  return value;
}

/** Vertical text alignment inside shapes (top / center / bottom). */
const VALIGNS = ['top', 'center', 'bottom'];

export function assertVerticalAlign(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !VALIGNS.includes(value)) {
    fail(`${name} must be one of ${VALIGNS.join(', ')}`);
  }
  return value;
}

/**
 * Reject markdown emphasis the app would store as literal asterisks.
 * Bold/italic are explicit params (bold: true / italic: true), not markdown.
 */
export function assertNoMarkdown(text) {
  const s = String(text);
  if (/\*\*[^*]+\*\*/.test(s)) {
    fail('text contains markdown **bold** — markdown is not rendered; pass bold: true instead');
  }
  if (/(^|\W)\*[^*\s][^*]*\*(?=\W|$)/.test(s) || /(^|\W)_[^_\s][^_]*_(?=\W|$)/.test(s)) {
    fail('text contains markdown *italic* / _italic_ — markdown is not rendered; pass italic: true instead');
  }
  return text;
}

/**
 * Run-level styled text: [{ text, color?, bold?, italic?, underline?,
 * strikethrough? }]. Returns segments [{ text, color? (token|int),
 * marks? {bold…} }] for the HTML paste pipeline (color is an int).
 */
export function assertRuns(runs, name) {
  if (!Array.isArray(runs) || runs.length === 0) {
    fail(`${name} must be a non-empty array of { text, color?, bold?, italic? } runs`);
  }
  return runs.map((r, i) => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      fail(`${name}[${i}] must be an object`);
    }
    const text = assertNoMarkdown(assertText(r.text, `${name}[${i}].text`));
    const out = { text };
    // Idempotent: batch.js pre-normalizes runs, buildSegments validates again —
    // an already-converted int color passes through untouched (range-gated:
    // callers must not smuggle arbitrary ints past the hex-only contract).
    if (r.color !== undefined) {
      if (typeof r.color === 'number') {
        if (!Number.isInteger(r.color) || r.color < 0 || r.color > 0xffffff) {
          fail(`${name}[${i}].color must be #RRGGBB hex, got: ${r.color}`);
        }
        out.color = r.color;
      } else {
        out.color = parseColor(r.color, `${name}[${i}].color`);
      }
    }
    const marks = {};
    for (const k of ['bold', 'italic', 'underline', 'strikethrough']) {
      if (r[k] !== undefined) marks[k] = Boolean(r[k]);
      else if (r.marks && r.marks[k] !== undefined) marks[k] = Boolean(r.marks[k]);
    }
    if (Object.keys(marks).length) out.marks = marks;
    return out;
  });
}

/** Shape corner rounding (px). borderRadius = height/2 → capsule. */
export function assertBorderRadius(value, name) {
  return num(value, name, { min: 0, max: 500 });
}

/**
 * Shape type. WHITELIST, not charset: an unknown token renders silently as
 * a rectangle in Holst (rhombus never existed — the real token is diamond).
 * Verified on the live board: square, round-rect (MCP), diamond, triangle,
 * ellipse (UI samples). Extend the list only with live-verified tokens.
 */
const SHAPE_TYPES = ['square', 'round-rect', 'diamond', 'triangle', 'ellipse'];
export { SHAPE_TYPES };

export function assertShapeType(value, name, opts = {}) {
  const { default: def } = opts;
  if (value === undefined) {
    if (def === undefined) fail(`${name} is required`);
    return def;
  }
  if (typeof value !== 'string' || !SHAPE_TYPES.includes(value)) {
    fail(`${name} must be one of ${SHAPE_TYPES.join(', ')} (verified tokens; "rhombus" does not exist — use diamond), got: ${typeof value === 'string' ? JSON.stringify(value.slice(0, 64)) : typeof value}`);
  }
  return value;
}

/** Arrow routing type (same silent-fallback class as shapeType). */
const ARROW_TYPES = ['straight', 'elbow', 'curved'];
export { ARROW_TYPES };

export function assertArrowType(value, name, opts = {}) {
  const { default: def } = opts;
  if (value === undefined) {
    if (def === undefined) fail(`${name} is required`);
    return def;
  }
  if (typeof value !== 'string' || !ARROW_TYPES.includes(value)) {
    fail(`${name} must be one of ${ARROW_TYPES.join(', ')}, got: ${typeof value === 'string' ? JSON.stringify(value.slice(0, 64)) : typeof value}`);
  }
  return value;
}

/**
 * Arrow endpoint: either a free point { x, y } or an attachment
 * { objectId, relativePoint?: { x, y } }. All coordinates must be finite;
 * free points are board-space with the ±1e7 COORD cap (issue #69);
 * relativePoint is unit-space 0..1 inclusive (issue #68, live-verified).
 * Returns the endpoint normalized for the write path; control (issue #41:
 * port sides, object-endpoint-only — a free point has no box edge to pin)
 * is mapped from its side name to the app's numeric code.
 */
export function assertArrowEndpoint(ep, name) {
  if (ep === null || typeof ep !== 'object' || Array.isArray(ep)) {
    fail(`${name} must be an object { x, y } or { objectId, relativePoint }`);
  }
  if (ep.objectId !== undefined) {
    assertObjectId(ep.objectId);
    const out = { objectId: ep.objectId };
    if (ep.relativePoint !== undefined) {
      if (ep.relativePoint === null || typeof ep.relativePoint !== 'object') {
        fail(`${name}.relativePoint must be an object { x, y }`);
      }
      out.relativePoint = {
        x: num(ep.relativePoint.x, `${name}.relativePoint.x`, RELATIVE_POINT),
        y: num(ep.relativePoint.y, `${name}.relativePoint.y`, RELATIVE_POINT),
      };
    }
    const control = assertEndpointControl(ep.control, `${name}.control`);
    if (control !== undefined) out.control = control;
    return out;
  }
  if (ep.control !== undefined) {
    fail(`${name}.control is only valid on object endpoints ({ objectId } attachments), not free points { x, y }`);
  }
  return {
    x: num(ep.x, `${name}.x`, COORD),
    y: num(ep.y, `${name}.y`, COORD),
  };
}

/**
 * Port control (issue #41): pins the side an attached arrow leaves from.
 * The app stores numeric side codes on each endpoint (verified live,
 * evidence in the type-switch comment on #39): 1=top, 2=right, 3=bottom,
 * 4=left. The MCP API names the sides; this maps a name to the stored code.
 */
export function assertEndpointControl(value, name) {
  if (value === undefined) return undefined;
  const SIDES = { top: 1, right: 2, bottom: 3, left: 4 };
  if (typeof value !== 'string' || !(value in SIDES)) {
    fail(`${name} must be one of top, right, bottom, left, got: ${typeof value === 'string' ? JSON.stringify(value.slice(0, 64)) : typeof value}`);
  }
  return SIDES[value];
}

/**
 * Arrow geometry shaping (issue #39): midwayControls — arbitrary absolute
 * points [{ x, y }, ...] the app routes the arrow through (its own UI exposes
 * them as draggable "elbows" on curved arrows). Pure passthrough: composing
 * shapes like crossing hops from points is client-level geometry. Mirrors the
 * app field verbatim; UI freehand examples use ~9 points, cap keeps dumps sane.
 * Coordinates are board-space: same ±1e7 COORD cap as x/y everywhere (issue #62).
 */
export function assertMidwayControls(value, name) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${name} must be a non-empty array of { x, y } points`);
  }
  if (value.length > 100) {
    fail(`${name} accepts at most 100 points, got ${value.length}`);
  }
  return value.map((p, i) => {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) {
      fail(`${name}[${i}] must be an object { x, y }`);
    }
    num(p.x, `${name}[${i}].x`, COORD);
    num(p.y, `${name}[${i}].y`, COORD);
    return { x: p.x, y: p.y };
  });
}

/**
 * Elbow corridor constraints (issue #39, elbow half): the app routes elbow
 * arrows through corridor LINES — {x: V, y: null} = pass the vertical line
 * x=V, {x: null, y: H} = pass the horizontal line y=H, applied in order.
 * Exactly one of x/y must be a finite number; the other is normalized to the
 * app's canonical null. Corridor coordinates share the ±1e7 COORD cap (issue #62).
 * Shape captured from a UI-drawn zigzag (live round-trip).
 */
export function assertElbowMidwayControls(value, name) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${name} must be a non-empty array of corridor objects {x, y} (exactly one coordinate a number)`);
  }
  if (value.length > 100) {
    fail(`${name} accepts at most 100 corridors, got ${value.length}`);
  }
  return value.map((c, i) => {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) {
      fail(`${name}[${i}] must be a corridor object { x, y }`);
    }
    const xNum = c.x !== null && c.x !== undefined;
    const yNum = c.y !== null && c.y !== undefined;
    if (xNum === yNum) {
      fail(`${name}[${i}]: exactly one of x/y must be a number (the other null) — {x: V, y: null} vertical corridor, {x: null, y: H} horizontal`);
    }
    if (xNum) num(c.x, `${name}[${i}].x`, COORD);
    if (yNum) num(c.y, `${name}[${i}].y`, COORD);
    return { x: xNum ? c.x : null, y: yNum ? c.y : null };
  });
}
