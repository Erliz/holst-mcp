// Issue #34: trim dead weight (delete audit, orphaned documents, empty
// stores) from board dumps BEFORE the HOLST_MAX_DUMP_BYTES cap — the cap
// must measure what is actually returned to the client, not the delete
// history. Before this, boards hit the 2MB cap because of history, not
// live content (~3.3x inflation, 56% of bytes = delete audit).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeBoardDump } from '../src/holst.js';

const SAVED_MAX = process.env.HOLST_MAX_DUMP_BYTES;

// Raw dump shaped like a real board after long use (issue #34 evidence):
// the delete audit dominates the bytes, documents carry orphans of
// deleted objects, aux stores sit empty.
const rawDump = () => ({
  objects: {
    '00000000-0000-4000-8000-000000000001': {
      type: 'shape',
      position: { x: 1, y: 1 },
      width: 50,
      height: 50,
      documentId: 'd-live',
    },
  },
  documents: {
    'd-live': 'live text',
    'd-orphan': 'o'.repeat(1500),
  },
  'delete-events-metaStore': {
    ev1: { deletedAt: 1, s: [{ type: 'sticker', position: { x: 9, y: 9 }, snapshot: 'y'.repeat(3000) }] },
  },
  reactions: {},
});

describe('finalizeBoardDump: cap measures the trimmed dump (issue #34)', () => {
  beforeEach(() => {
    // Between the trimmed size (~200 bytes) and the raw size (~5000 bytes):
    // the old order (cap BEFORE trim) rejected this board.
    process.env.HOLST_MAX_DUMP_BYTES = '3000';
  });

  afterEach(() => {
    if (SAVED_MAX === undefined) delete process.env.HOLST_MAX_DUMP_BYTES;
    else process.env.HOLST_MAX_DUMP_BYTES = SAVED_MAX;
  });

  test('board whose history exceeds the cap but live content fits → passes, trimmed', () => {
    const out = finalizeBoardDump(rawDump());
    assert.ok(!('delete-events-metaStore' in out), 'delete audit must be trimmed');
    assert.ok(!('reactions' in out), 'empty stores must be trimmed');
    assert.deepEqual(Object.keys(out.documents), ['d-live']);
    assert.equal(out.objects['00000000-0000-4000-8000-000000000001'].documentId, 'd-live');
  });

  test('cap still refuses when the trimmed content itself is too big', () => {
    const dump = rawDump();
    dump.objects['00000000-0000-4000-8000-000000000001'].fill = 'z'.repeat(5000);
    assert.throws(() => finalizeBoardDump(dump), /HOLST_MAX_DUMP_BYTES/);
  });

  test('includeDeleteEvents keeps the full raw dump → cap sees the history too', () => {
    assert.throws(
      () => finalizeBoardDump(rawDump(), { includeDeleteEvents: true }),
      /HOLST_MAX_DUMP_BYTES/
    );
  });

  test('bbox shaping runs on the trimmed content', () => {
    const out = finalizeBoardDump(rawDump(), { bbox: { x1: 900, y1: 900, x2: 1000, y2: 1000 } });
    assert.deepEqual(Object.keys(out.objects), [], 'out-of-bbox object filtered');
    assert.ok(!('delete-events-metaStore' in out), 'no delete audit in bbox mode either');
    assert.deepEqual(out.documents, { 'd-live': 'live text' });
  });

  test('positionsOnly still yields the compact { objects } projection', () => {
    const out = finalizeBoardDump(rawDump(), { positionsOnly: true });
    assert.deepEqual(Object.keys(out), ['objects']);
    assert.deepEqual(out.objects['00000000-0000-4000-8000-000000000001'], {
      type: 'shape',
      x: 1,
      y: 1,
      w: 50,
      h: 50,
    });
  });
});
