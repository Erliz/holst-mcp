import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Issue #69: #62 capped every board-space coordinate path at the shared
// ±1e7 COORD range, but free-point arrow endpoints ({ x, y } without
// objectId/ref) still passed through num() without bounds — a huge-but-
// finite value (1e300 class) was accepted and written verbatim into the
// yDoc, the exact asymmetry #62 set out to eliminate. Found during the
// #68 investigation (relativePoint bounds), kept separate: one issue per
// branch. Boundary ±1e7 stays accepted, matching every other COORD path.

import { assertArrowEndpoint, ValidationError } from '../src/validate.js';
import { buildAddArrowExpr } from '../src/eval-scripts.js';
import { buildBatchPlan } from '../src/batch.js';
import { runExpr } from './helpers/fake-holst.js';

describe('assertArrowEndpoint: free-point COORD bounds (issue #69)', () => {
  test('out-of-range x is rejected with the endpoint path in the message', () => {
    assert.throws(
      () => assertArrowEndpoint({ x: 1e7 + 1, y: 0 }, 'start'),
      /start\.x must be between -10000000 and 10000000, got: 10000001/
    );
  });

  test('out-of-range y is rejected (negative side)', () => {
    assert.throws(
      () => assertArrowEndpoint({ x: 0, y: -1e7 - 1 }, 'end'),
      /end\.y must be between -10000000 and 10000000, got: -10000001/
    );
  });

  test('huge-but-finite values no longer reach the yDoc (1e300 class)', () => {
    assert.throws(
      () => assertArrowEndpoint({ x: 1e300, y: 0 }, 'start'),
      ValidationError
    );
  });

  test('boundary values ±1e7 are accepted on both axes', () => {
    const a = assertArrowEndpoint({ x: -1e7, y: 1e7 }, 'start');
    assert.deepEqual(a, { x: -1e7, y: 1e7 });
    const b = assertArrowEndpoint({ x: 1e7, y: -1e7 }, 'end');
    assert.deepEqual(b, { x: 1e7, y: -1e7 });
  });
});

describe('batch: free-point COORD bounds (parity with holst_add_arrow)', () => {
  test('out-of-range from.x is rejected with the entry path', () => {
    assert.throws(
      () => buildBatchPlan([{ kind: 'arrow', from: { x: 1e300, y: 0 }, to: { x: 10, y: 10 } }]),
      /objects\[0\]\.from\.x must be between -10000000 and 10000000, got: 1e\+300/
    );
  });

  test('out-of-range to.y is rejected (negative side)', () => {
    assert.throws(
      () => buildBatchPlan([{ kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 10, y: -1e7 - 1 } }]),
      /objects\[0\]\.to\.y must be between -10000000 and 10000000/
    );
  });

  test('boundary values survive the batch plan', () => {
    const plan = buildBatchPlan([{ kind: 'arrow', from: { x: -1e7, y: 1e7 }, to: { x: 1e7, y: -1e7 } }]);
    assert.deepEqual(plan.arrows[0].from, { point: { x: -1e7, y: 1e7 } });
    assert.deepEqual(plan.arrows[0].to, { point: { x: 1e7, y: -1e7 } });
  });
});

describe('buildAddArrowExpr: boundary free-point coordinates reach the yDoc write', () => {
  const base = {
    start: { x: -1e7, y: 1e7 },
    end: { x: 1e7, y: -1e7 },
    arrowType: 'elbow',
    strokeColor: 8421504,
    strokeStyle: 'solid',
    strokeWidth: undefined,
    arrowheadStart: undefined,
    arrowheadEnd: undefined,
    texts: null,
    styleExtras: {},
  };

  test('boundary free-point endpoints land on the arrow object verbatim', async () => {
    const state = await runExpr(buildAddArrowExpr(base));
    const arrows = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal(arrows.length, 1);
    assert.deepEqual(arrows[0].fields.start.point, { x: -1e7, y: 1e7 });
    assert.deepEqual(arrows[0].fields.end.point, { x: 1e7, y: -1e7 });
  });
});
