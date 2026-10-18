// Blast-radius policy: board allowlist, read-only mode, dump size limit,
// error sanitization. All controlled via env vars so operators can lock down
// the MCP server without code changes.

import { ValidationError } from './validate.js';

export { ValidationError };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseIdList(raw) {
  if (!raw || !raw.trim()) return null;
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => UUID_RE.test(s));
  return ids.length ? ids : null;
}

/**
 * HOLST_RW_BOARD_IDS: comma/space-separated UUIDs with full access.
 * Unset or blank → null (no restriction from this list).
 */
export function rwBoardIds() {
  return parseIdList(process.env.HOLST_RW_BOARD_IDS);
}

/**
 * HOLST_RO_BOARD_IDS: comma/space-separated UUIDs, read-only access.
 * Unset or blank → null (no restriction from this list).
 */
export function roBoardIds() {
  return parseIdList(process.env.HOLST_RO_BOARD_IDS);
}

/**
 * Read access: when either list is configured, the board must appear in
 * RW ∪ RO. Both unset → unrestricted.
 */
export function assertBoardReadable(boardId) {
  const rw = rwBoardIds();
  const ro = roBoardIds();
  if (!rw && !ro) return;
  const id = String(boardId).toLowerCase();
  const allowed = (rw?.includes(id) || false) || (ro?.includes(id) || false);
  if (!allowed) {
    throw new ValidationError(
      `boardId ${boardId} is not in HOLST_RW_BOARD_IDS or HOLST_RO_BOARD_IDS allowlists`
    );
  }
}

/**
 * Write access: when either list is configured, the board must appear in
 * RW and must NOT appear in RO (fail-closed: read-only wins on conflict).
 * Both unset → unrestricted. The global HOLST_READ_ONLY switch is a
 * separate, stronger check (assertNotReadOnly).
 */
export function assertBoardWritable(boardId) {
  const rw = rwBoardIds();
  const ro = roBoardIds();
  if (!rw && !ro) return;
  const id = String(boardId).toLowerCase();
  if (ro?.includes(id)) {
    throw new ValidationError(
      `boardId ${boardId} is in HOLST_RO_BOARD_IDS (read-only): write operations are disabled for this board`
    );
  }
  if (!(rw?.includes(id) || false)) {
    throw new ValidationError(
      `boardId ${boardId} is not in HOLST_RW_BOARD_IDS allowlist`
    );
  }
}

/**
 * HOLST_READ_ONLY=1|true → all mutating tools are refused.
 */
export function isReadOnly() {
  const v = (process.env.HOLST_READ_ONLY || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function assertNotReadOnly() {
  if (isReadOnly()) {
    throw new ValidationError('HOLST_READ_ONLY is enabled: write operations are disabled');
  }
}

/**
 * HOLST_MAX_DUMP_BYTES (default 2 MB): refuse to return board dumps whose
 * serialized size exceeds the limit — protects the LLM context and tokens.
 */
export function maxDumpBytes() {
  const v = Number(process.env.HOLST_MAX_DUMP_BYTES);
  return Number.isFinite(v) && v > 0 ? v : 2_000_000;
}

export function limitDump(content, { maxBytes = maxDumpBytes() } = {}) {
  const size = Buffer.byteLength(JSON.stringify(content) || 'null');
  if (size > maxBytes) {
    throw new ValidationError(
      `Board dump is ${size} bytes, exceeding HOLST_MAX_DUMP_BYTES=${maxBytes}. ` +
        'Use holst_search_text or raise the limit.'
    );
  }
  return content;
}

/**
 * Single-line, length-capped error text for tool responses:
 * page-JS stacks and API internals must not leak into the LLM context.
 */
export function sanitizeError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const firstLine = message.split('\n')[0] || 'unknown error';
  return firstLine.length > 1000 ? firstLine.slice(0, 1000) + '…' : firstLine;
}
