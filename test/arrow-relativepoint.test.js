import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Issue #68: relativePoint is documented as a normalized (unit-space) 0..1
// attachment coordinate (docs.js, addArrow JSDoc, tools-schema, reference),
// but both validation paths accepted any finite number — {x: 1e300, y: 0}
// passed and was written verbatim into the yDoc. Live probe (board
// "LLM MCP Test", 59 arrows / 111 attached endpoints): every real value sits
// inside [0, 1] INCLUSIVE — boundary values are the app's own side anchors
// (0.5/1 = bottom center, 1/0.5 = mid-right...), so the bound matches the
// app's actual tolerance, not just the docs' aspiration.

import { assertArrowEndpoint, ValidationError } from '../src/validate.js';
import { buildAddArrowExpr } from '../src/eval-scripts.js';
import { buildBatchPlan } from '../src/batch.js';
import { runExpr } from './helpers/fake-holst.js';

const OID = '04a54183-ab12-cd34-ef56-000000000000';

describe('assertArrowEndpoint: relativePoint bounds (issue #68)', () => {
  test('out-of-range x is rejected with the endpoint path in the message', () => {
    assert.throws(
      () => assertArrowEndpoint({ objectId: OID, relativePoint: { x: 1.5, y: 0.5 } }, 'start'),
      /start\.relativePoint\.x must be between 0 and 1, got: 1\.5/
    );
  });

  test('out-of-range y is rejected (negative side)', () => {
    assert.throws(
      () => assertArrowEndpoint({ objectId: OID, relativePoint: { x: 0.5, y: -0.001 } }, 'end'),
      /end\.relativePoint\.y must be between 0 and 1, got: -0\.001/
    );
  });

  test('huge-but-finite values no longer reach the yDoc (1e300 class)', () => {
    assert.throws(
      () => assertArrowEndpoint({ objectId: OID, relativePoint: { x: 1e300, y: 0 } }, 'start'),
      ValidationError
    );
  });

  test('boundary values 0 and 1 are accepted on both axes', () => {
    const a = assertArrowEndpoint({ objectId: OID, relativePoint: { x: 0, y: 1 } }, 'start');
    assert.deepEqual(a.relativePoint, { x: 0, y: 1 });
    const b = assertArrowEndpoint({ objectId: OID, relativePoint: { x: 1, y: 0 } }, 'end');
    assert.deepEqual(b.relativePoint, { x: 1, y: 0 });
  });

  test('interior fractions pass through as a shallow copy', () => {
    const rp = { x: 0.25, y: 0.75 };
    const out = assertArrowEndpoint({ objectId: OID, relativePoint: rp }, 'start');
    assert.deepEqual(out.relativePoint, rp);
    assert.notEqual(out.relativePoint, rp, 'must return a copy, not the caller object');
  });
});

describe('batch: relativePoint bounds (parity with holst_add_arrow)', () => {
  const creation = { kind: 'shape', ref: 'a', text: 'A', x: 1, y: 2 };

  test('ref-branch out-of-range is rejected with the entry path', () => {
    assert.throws(
      () => buildBatchPlan([creation, { kind: 'arrow', from: { ref: 'a', relativePoint: { x: 2, y: 0.5 } }, to: { ref: 'a' } }]),
      /objects\[1\]\.from\.relativePoint\.x must be between 0 and 1, got: 2/
    );
  });

  test('objectId-branch out-of-range y is rejected with the entry path', () => {
    assert.throws(
      () => buildBatchPlan([{ kind: 'arrow', from: { objectId: OID, relativePoint: { x: 0.5, y: 1e300 } }, to: { x: 10, y: 10 } }]),
      /objects\[0\]\.from\.relativePoint\.y must be between 0 and 1/
    );
  });

  test('boundary values survive the batch plan', () => {
    const plan = buildBatchPlan([creation, { kind: 'arrow', from: { ref: 'a', relativePoint: { x: 0, y: 1 } }, to: { ref: 'a', relativePoint: { x: 1, y: 0 } } }]);
    assert.deepEqual(plan.arrows[0].from.relativePoint, { x: 0, y: 1 });
    assert.deepEqual(plan.arrows[0].to.relativePoint, { x: 1, y: 0 });
  });
});

describe('buildAddArrowExpr: boundary relativePoint reaches the yDoc write', () => {
  const base = {
    start: { objectId: OID, relativePoint: { x: 0, y: 1 } },
    end: { objectId: OID, relativePoint: { x: 1, y: 0 } },
    arrowType: 'elbow',
    strokeColor: 8421504,
    strokeStyle: 'solid',
    strokeWidth: undefined,
    arrowheadStart: undefined,
    arrowheadEnd: undefined,
    texts: null,
    styleExtras: {},
  };

  test('attached boundary endpoints land on the arrow object verbatim', async () => {
    const state = await runExpr(buildAddArrowExpr(base));
    const arrows = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal(arrows.length, 1);
    assert.deepEqual(arrows[0].fields.start.relativePoint, { x: 0, y: 1 });
    assert.deepEqual(arrows[0].fields.end.relativePoint, { x: 1, y: 0 });
  });
});
