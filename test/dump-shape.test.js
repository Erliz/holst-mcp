// Issue #4: bbox and positionsOnly excluded arrows entirely — arrows carry
// no position/width/height in yDoc (geometry lives in start/end endpoints:
// objectId+relativePoint when attached, point when free). These tests pin
// the arrow-aware shaping extracted from getBoardContent into dump-shape.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrowBox, shapeContent, trimContent } from '../src/dump-shape.js';

const UUID = (n) => `00000000-0000-4000-8000-00000000000${n}`;

// Board fixture: A (100,100,50,50) → arrow → B (300,300,50,50).
// Attached endpoints anchor at relativePoint fractions of the ref box.
const board = () => ({
  objects: {
    [UUID(1)]: { type: 'shape', position: { x: 100, y: 100 }, width: 50, height: 50 },
    [UUID(2)]: { type: 'shape', position: { x: 300, y: 300 }, width: 50, height: 50 },
    [UUID(3)]: {
      type: 'arrow',
      position: { x: 0, y: 0 }, // constant placeholder — NOT geometry
      start: { objectId: UUID(1), point: { x: 0, y: 0 }, relativePoint: { x: 0.5, y: 1 }, control: null },
      end: { objectId: UUID(2), point: { x: 0, y: 0 }, relativePoint: { x: 0.5, y: 0 }, control: null },
    },
    [UUID(4)]: {
      type: 'arrow',
      position: { x: 0, y: 0 },
      start: { point: { x: 10, y: 10 }, relativePoint: { x: 0, y: 0 }, control: null },
      end: { point: { x: 200, y: 120 }, relativePoint: { x: 0, y: 0 }, control: null },
    },
  },
  documents: { d1: 'hello' },
});

describe('arrowBox', () => {
  test('attached endpoints resolve to ref position + relativePoint × size', () => {
    const b = board();
    // start → A bottom-center (125, 150); end → B top-center (325, 300)
    assert.deepEqual(arrowBox(b.objects[UUID(3)], b.objects), { x: 125, y: 150, w: 200, h: 150 });
  });

  test('free endpoints use their points as-is', () => {
    const b = board();
    assert.deepEqual(arrowBox(b.objects[UUID(4)], b.objects), { x: 10, y: 10, w: 190, h: 110 });
  });

  test('missing relativePoint / missing ref size degrade to the ref position', () => {
    const objs = {
      a: { type: 'shape', position: { x: 40, y: 60 } }, // no width/height
      r: { type: 'arrow', start: { objectId: 'a' }, end: { point: { x: 100, y: 0 } } },
    };
    assert.deepEqual(arrowBox(objs.r, objs), { x: 40, y: 0, w: 60, h: 60 });
  });

  test('dangling objectId refs fall back to the stored (degenerate) box', () => {
    const r = { type: 'arrow', position: { x: 7, y: 8 }, start: { objectId: 'nope' }, end: { objectId: 'gone' } };
    assert.deepEqual(arrowBox(r, {}), { x: 7, y: 8, w: 0, h: 0 });
  });
});

describe('shapeContent: bbox', () => {
  test('arrow whose endpoints overlap the bbox is included', () => {
    const out = shapeContent(board(), { bbox: { x1: 280, y1: 280, x2: 360, y2: 360 } });
    // covers B (and the attached arrow's end anchor), not A
    assert.ok(out.objects[UUID(3)], 'attached arrow missing from bbox result');
    assert.ok(out.objects[UUID(2)], 'shape B missing');
    assert.ok(!out.objects[UUID(1)], 'shape A should be filtered out');
    assert.equal(out.documents.d1, 'hello', 'non-positionsOnly keeps documents');
  });

  test('arrow fully outside the bbox is excluded', () => {
    const out = shapeContent(board(), { bbox: { x1: 1000, y1: 1000, x2: 1100, y2: 1100 } });
    assert.deepEqual(Object.keys(out.objects), []);
  });

  test('free-point arrow included when its segment box overlaps', () => {
    const out = shapeContent(board(), { bbox: { x1: 0, y1: 0, x2: 100, y2: 100 } });
    assert.ok(out.objects[UUID(4)], 'free-point arrow missing');
    assert.ok(!out.objects[UUID(3)], 'attached arrow outside should be filtered out');
  });

  test('bbox containing the origin still keeps degenerate-fallback arrows out of far bboxes', () => {
    const content = { objects: { dang: { type: 'arrow', start: { objectId: 'nope' }, end: { objectId: 'gone' } } } };
    const out = shapeContent(content, { bbox: { x1: 500, y1: 500, x2: 600, y2: 600 } });
    assert.ok(!out.objects.dang, 'dangling arrow must not appear in an unrelated bbox');
  });
});

describe('shapeContent: positionsOnly', () => {
  test('arrow projected with endpoint-derived box, not zeros', () => {
    const out = shapeContent(board(), { positionsOnly: true });
    assert.deepEqual(out.objects[UUID(3)], { type: 'arrow', x: 125, y: 150, w: 200, h: 150 });
    assert.deepEqual(out.objects[UUID(4)], { type: 'arrow', x: 10, y: 10, w: 190, h: 110 });
  });

  test('non-arrow projection unchanged', () => {
    const out = shapeContent(board(), { positionsOnly: true });
    assert.deepEqual(out.objects[UUID(1)], { type: 'shape', x: 100, y: 100, w: 50, h: 50 });
    assert.deepEqual(Object.keys(out), ['objects'], 'documents dropped in positionsOnly');
  });

  test('positionsOnly + bbox: compact arrow box only for in-bbox arrows', () => {
    const out = shapeContent(board(), { bbox: { x1: 280, y1: 280, x2: 360, y2: 360 }, positionsOnly: true });
    assert.deepEqual(out.objects[UUID(3)], { type: 'arrow', x: 125, y: 150, w: 200, h: 150 });
    assert.ok(!out.objects[UUID(4)]);
    assert.ok(!out.objects[UUID(1)]);
  });
});

describe('shapeContent: passthrough', () => {
  test('no bbox, no positionsOnly → same object reference untouched', () => {
    const content = board();
    assert.equal(shapeContent(content, {}), content);
    assert.equal(shapeContent(content), content);
  });
});

// Issue #34: the raw yDoc carries dead weight — the delete audit with FULL
// snapshots of deleted objects (delete-events-metaStore), documents of
// deleted objects (orphans: 846 docs vs 276 live objects on the test
// board) and empty auxiliary stores. trimContent removes it so the dump
// the LLM sees (and the HOLST_MAX_DUMP_BYTES cap measures) is live content.
describe('trimContent: dead weight removal (issue #34)', () => {
  const full = () => ({
    objects: {
      [UUID(1)]: { type: 'shape', position: { x: 1, y: 1 }, documentId: 'd-live' },
      [UUID(2)]: { type: 'sticker', position: { x: 2, y: 2 }, documentId: 'd-live-2' },
      [UUID(3)]: { type: 'frame', position: { x: 3, y: 3 }, labelText: '<p>inline label</p>' }, // no documentId
    },
    documents: {
      'd-live': 'live text',
      'd-live-2': 'second live text',
      'd-orphan': 'text of a deleted object',
      'd-never-attached': 'never referenced by anything',
    },
    'delete-events-metaStore': {
      ev1: { deletedAt: 1, s: [{ type: 'shape', documentId: 'd-orphan', position: { x: 9, y: 9 } }] },
    },
    'kanban-columns': {},
    reactions: {},
    'task-card-assignments': { t1: { cardId: 'c1' } }, // non-empty aux store = live data
  });

  test('drops the delete audit store by default', () => {
    const out = trimContent(full());
    assert.ok(!('delete-events-metaStore' in out), 'delete audit must not be returned');
  });

  test('drops empty top-level stores but never objects/documents', () => {
    const content = full();
    content.documents = {}; // even when empty, the core keys stay
    content.objects = {};
    const out = trimContent(content);
    assert.ok(!('kanban-columns' in out), 'empty aux store must be dropped');
    assert.ok(!('reactions' in out), 'empty aux store must be dropped');
    assert.ok('objects' in out, 'objects is core — never dropped');
    assert.ok('documents' in out, 'documents is core — never dropped');
  });

  test('keeps non-empty aux stores (live kanban/reactions data)', () => {
    const out = trimContent(full());
    assert.deepEqual(out['task-card-assignments'], { t1: { cardId: 'c1' } });
  });

  test('keeps only documents referenced by live objects, drops orphans', () => {
    const out = trimContent(full());
    assert.deepEqual(Object.keys(out.documents).sort(), ['d-live', 'd-live-2']);
    assert.equal(out.documents['d-live'], 'live text');
  });

  test('objects map passes through untouched', () => {
    const out = trimContent(full());
    assert.equal(Object.keys(out.objects).length, 3);
    assert.equal(out.objects[UUID(1)].documentId, 'd-live');
  });

  test('includeDeleteEvents restores the audit view: delete store + orphan documents', () => {
    const out = trimContent(full(), { includeDeleteEvents: true });
    assert.ok('delete-events-metaStore' in out, 'audit view must keep the delete store');
    assert.equal(out.documents['d-orphan'], 'text of a deleted object');
    assert.equal(out.documents['d-never-attached'], 'never referenced by anything');
    assert.ok(!('kanban-columns' in out), 'empty stores are dropped even in audit view');
  });

  test('does not mutate the input dump', () => {
    const content = full();
    trimContent(content);
    assert.ok('delete-events-metaStore' in content);
    assert.equal(content.documents['d-orphan'], 'text of a deleted object');
    assert.ok('reactions' in content);
  });
});
