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
