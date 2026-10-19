// Issue #4: bbox and positionsOnly excluded arrows entirely — arrows carry
// no position/width/height in yDoc (geometry lives in start/end endpoints:
// objectId+relativePoint when attached, point when free). These tests pin
// the arrow-aware shaping extracted from getBoardContent into dump-shape.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrowBox, shapeContent } from '../src/dump-shape.js';

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
