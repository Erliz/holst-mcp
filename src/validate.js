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
// Palette names / type tokens: letters, digits, dashes (yellow6, round-rect, textStamp).
const TOKEN_RE = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;

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
 * Palette/type token (fillColor, shapeType, arrowType, stampType).
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
 * Color value: a palette token (gray12, sky10…) OR a #RRGGBB hex string.
 * Tokens pass through as strings; hex converts to the integer form the app
 * stores (verified: UI '#782baf' → {color: 7875503}).
 */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function parseColor(value, name, opts = {}) {
  const { default: def } = opts;
  if (value === undefined) {
    if (def === undefined) fail(`${name} is required`);
    value = def;
  }
  if (typeof value !== 'string') {
    fail(`${name} must be a palette token or #RRGGBB hex, got: ${typeof value}`);
  }
  if (HEX_RE.test(value)) return parseInt(value.slice(1), 16);
  if (TOKEN_RE.test(value)) return value;
  fail(`${name} must be a palette token (letters/digits/dash) or #RRGGBB hex, got: ${JSON.stringify(value.slice(0, 64))}`);
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
 * marks? {bold…} }] for the HTML paste pipeline.
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
    // an already-converted int color passes through untouched.
    if (r.color !== undefined) {
      out.color = typeof r.color === 'number' ? r.color : parseColor(r.color, `${name}[${i}].color`);
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
 * { objectId, relativePoint?: { x, y } }. All coordinates must be finite.
 */
export function assertArrowEndpoint(ep, name) {
  if (ep === null || typeof ep !== 'object' || Array.isArray(ep)) {
    fail(`${name} must be an object { x, y } or { objectId, relativePoint }`);
  }
  if (ep.objectId !== undefined) {
    assertObjectId(ep.objectId);
    if (ep.relativePoint !== undefined) {
      if (ep.relativePoint === null || typeof ep.relativePoint !== 'object') {
        fail(`${name}.relativePoint must be an object { x, y }`);
      }
      num(ep.relativePoint.x, `${name}.relativePoint.x`);
      num(ep.relativePoint.y, `${name}.relativePoint.y`);
    }
    return;
  }
  num(ep.x, `${name}.x`);
  num(ep.y, `${name}.y`);
}
