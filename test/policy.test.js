import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError,
  assertBoardReadable,
  assertBoardWritable,
  assertNotReadOnly,
  limitDump,
  sanitizeError,
} from '../src/policy.js';

const SAVED = {};

beforeEach(() => {
  SAVED.HOLST_ALLOWED_BOARD_IDS = process.env.HOLST_ALLOWED_BOARD_IDS;
  SAVED.HOLST_RW_BOARD_IDS = process.env.HOLST_RW_BOARD_IDS;
  SAVED.HOLST_RO_BOARD_IDS = process.env.HOLST_RO_BOARD_IDS;
  SAVED.HOLST_READ_ONLY = process.env.HOLST_READ_ONLY;
  SAVED.HOLST_MAX_DUMP_BYTES = process.env.HOLST_MAX_DUMP_BYTES;
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const A = '123e4567-e89b-42d3-a456-426614174000';
const B = '04a54183-ab12-cd34-ef56-000000000000';
const C = '11111111-2222-3333-4444-555555555555';

describe('board access lists (HOLST_RW_BOARD_IDS / HOLST_RO_BOARD_IDS)', () => {
  test('both lists unset → any board readable and writable', () => {
    delete process.env.HOLST_RW_BOARD_IDS;
    delete process.env.HOLST_RO_BOARD_IDS;
    assert.doesNotThrow(() => assertBoardReadable(A));
    assert.doesNotThrow(() => assertBoardWritable(A));
  });

  test('blank values count as unset', () => {
    process.env.HOLST_RW_BOARD_IDS = '  ';
    process.env.HOLST_RO_BOARD_IDS = ' ';
    assert.doesNotThrow(() => assertBoardWritable(A));
  });

  test('RW board: readable and writable (case-insensitive, comma/space separated)', () => {
    process.env.HOLST_RW_BOARD_IDS = A.toUpperCase() + ', ' + B;
    delete process.env.HOLST_RO_BOARD_IDS;
    assert.doesNotThrow(() => assertBoardReadable(A));
    assert.doesNotThrow(() => assertBoardWritable(A));
    assert.doesNotThrow(() => assertBoardWritable(B));
  });

  test('RO board: readable, NOT writable', () => {
    delete process.env.HOLST_RW_BOARD_IDS;
    process.env.HOLST_RO_BOARD_IDS = A;
    assert.doesNotThrow(() => assertBoardReadable(A));
    assert.throws(() => assertBoardWritable(A), ValidationError);
  });

  test('board in neither list → refused for read and write', () => {
    process.env.HOLST_RW_BOARD_IDS = A;
    process.env.HOLST_RO_BOARD_IDS = B;
    assert.throws(() => assertBoardReadable(C), ValidationError);
    assert.throws(() => assertBoardWritable(C), ValidationError);
  });

  test('board in RO-only while RW list set → readable, not writable', () => {
    process.env.HOLST_RW_BOARD_IDS = A;
    process.env.HOLST_RO_BOARD_IDS = B;
    assert.doesNotThrow(() => assertBoardReadable(B));
    assert.throws(() => assertBoardWritable(B), ValidationError);
  });

  test('fail-closed: id in BOTH lists → read-only wins', () => {
    process.env.HOLST_RW_BOARD_IDS = A + ',' + B;
    process.env.HOLST_RO_BOARD_IDS = B;
    assert.doesNotThrow(() => assertBoardReadable(B));
    assert.throws(() => assertBoardWritable(B), ValidationError);
  });

  test('legacy HOLST_ALLOWED_BOARD_IDS is fully removed — no effect', () => {
    delete process.env.HOLST_RW_BOARD_IDS;
    delete process.env.HOLST_RO_BOARD_IDS;
    process.env.HOLST_ALLOWED_BOARD_IDS = A;
    // lists unset → unrestricted, legacy var must not restrict anything
    assert.doesNotThrow(() => assertBoardWritable(C));
  });

  test('malformed entries are ignored in both lists', () => {
    process.env.HOLST_RW_BOARD_IDS = 'not-a-uuid, ' + A;
    process.env.HOLST_RO_BOARD_IDS = '"" , xxx';
    assert.doesNotThrow(() => assertBoardWritable(A));
    assert.throws(() => assertBoardReadable(B), ValidationError);
  });

  test('write error message names the RO list (actionable)', () => {
    process.env.HOLST_RO_BOARD_IDS = A;
    delete process.env.HOLST_RW_BOARD_IDS;
    assert.throws(() => assertBoardWritable(A), /HOLST_RO_BOARD_IDS/);
  });
});

describe('assertNotReadOnly (HOLST_READ_ONLY)', () => {
  test('unset / 0 / false allow writes', () => {
    delete process.env.HOLST_READ_ONLY;
    assert.doesNotThrow(assertNotReadOnly);
    process.env.HOLST_READ_ONLY = '0';
    assert.doesNotThrow(assertNotReadOnly);
    process.env.HOLST_READ_ONLY = 'false';
    assert.doesNotThrow(assertNotReadOnly);
  });

  test('1 / true block writes', () => {
    process.env.HOLST_READ_ONLY = '1';
    assert.throws(assertNotReadOnly, ValidationError);
    process.env.HOLST_READ_ONLY = 'true';
    assert.throws(assertNotReadOnly, ValidationError);
  });
});

describe('limitDump (HOLST_MAX_DUMP_BYTES)', () => {
  test('small dump passes through unchanged', () => {
    delete process.env.HOLST_MAX_DUMP_BYTES;
    const content = { documents: { a: 'ЦЕННОСТИ' } };
    assert.equal(limitDump(content), content);
  });

  test('oversized dump throws with size hint', () => {
    process.env.HOLST_MAX_DUMP_BYTES = '100';
    const big = { blob: 'x'.repeat(1000) };
    assert.throws(() => limitDump(big), /HOLST_MAX_DUMP_BYTES/);
  });

  test('custom env limit respected', () => {
    process.env.HOLST_MAX_DUMP_BYTES = '1000';
    const ok = { blob: 'x'.repeat(100) };
    assert.equal(limitDump(ok), ok);
    assert.throws(() => limitDump({ blob: 'x'.repeat(1000) }), ValidationError);
  });

  test('multi-byte content measured in bytes, not chars', () => {
    process.env.HOLST_MAX_DUMP_BYTES = '10';
    // 6 chars but 12 bytes in UTF-8
    assert.throws(() => limitDump({ t: 'ЁЁЁЁЁЁ' }), ValidationError);
  });
});

describe('sanitizeError', () => {
  test('keeps first line, drops stack continuation', () => {
    const e = new Error('Holst API 401: unauthorized\n    at fetch (page.js:1:1)\n    at gapi (holst.js:1:1)');
    assert.equal(sanitizeError(e), 'Holst API 401: unauthorized');
  });

  test('message without newline is preserved', () => {
    assert.equal(sanitizeError(new Error('object not found')), 'object not found');
  });

  test('non-error input becomes short string', () => {
    assert.equal(sanitizeError('boom'), 'boom');
    assert.equal(sanitizeError(undefined), 'undefined');
  });

  test('caps extremely long messages', () => {
    assert.ok(sanitizeError(new Error('y'.repeat(5000))).length <= 1001);
  });
});
