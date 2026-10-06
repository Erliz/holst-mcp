import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError,
  assertBoardAllowed,
  assertNotReadOnly,
  limitDump,
  sanitizeError,
} from '../src/policy.js';

const SAVED = {};

beforeEach(() => {
  SAVED.HOLST_ALLOWED_BOARD_IDS = process.env.HOLST_ALLOWED_BOARD_IDS;
  SAVED.HOLST_READ_ONLY = process.env.HOLST_READ_ONLY;
  SAVED.HOLST_MAX_DUMP_BYTES = process.env.HOLST_MAX_DUMP_BYTES;
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('assertBoardAllowed (HOLST_ALLOWED_BOARD_IDS)', () => {
  test('unset allowlist permits any board', () => {
    delete process.env.HOLST_ALLOWED_BOARD_IDS;
    assert.doesNotThrow(() => assertBoardAllowed('372ea1bf-8bac-481b-94f2-ddd9088461ca'));
  });

  test('empty allowlist value permits any board', () => {
    process.env.HOLST_ALLOWED_BOARD_IDS = '  ';
    assert.doesNotThrow(() => assertBoardAllowed('372ea1bf-8bac-481b-94f2-ddd9088461ca'));
  });

  test('listed board ids pass (case-insensitive, comma/space separated)', () => {
    process.env.HOLST_ALLOWED_BOARD_IDS =
      '372EA1BF-8BAC-481B-94F2-DDD9088461CA, 04a54183-ab12-cd34-ef56-000000000000';
    assert.doesNotThrow(() => assertBoardAllowed('372ea1bf-8bac-481b-94f2-ddd9088461ca'));
    assert.doesNotThrow(() => assertBoardAllowed('04a54183-ab12-cd34-ef56-000000000000'));
  });

  test('board outside allowlist throws ValidationError', () => {
    process.env.HOLST_ALLOWED_BOARD_IDS = '372ea1bf-8bac-481b-94f2-ddd9088461ca';
    assert.throws(
      () => assertBoardAllowed('04a54183-ab12-cd34-ef56-000000000000'),
      ValidationError
    );
  });

  test('malformed allowlist entries are ignored', () => {
    process.env.HOLST_ALLOWED_BOARD_IDS =
      'not-a-uuid, 372ea1bf-8bac-481b-94f2-ddd9088461ca, ""';
    assert.doesNotThrow(() => assertBoardAllowed('372ea1bf-8bac-481b-94f2-ddd9088461ca'));
    assert.throws(() => assertBoardAllowed('04a54183-ab12-cd34-ef56-000000000000'), ValidationError);
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
