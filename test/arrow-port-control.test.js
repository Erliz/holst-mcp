import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Issue #41: port control — endpoint `control` pins the side an attached
// arrow leaves from. The app stores numeric side codes on each endpoint
// (verified live, evidence in the type-switch comment on #39):
// 1=top, 2=right, 3=bottom, 4=left. The MCP API names the sides; the write
// path stores the app's codes. Fan-out port math is client-level arithmetic
// (documented in the reference), not a server helper.

import { assertEndpointControl, assertArrowEndpoint } from '../src/validate.js';
import { buildAddArrowExpr, buildBatchArrowsExpr } from '../src/eval-scripts.js';
import { buildBatchPlan, ValidationError } from '../src/batch.js';
import { runExpr } from './helpers/fake-holst.js';
import { TOOLS } from '../src/tools-schema.js';

const SIDES = { top: 1, right: 2, bottom: 3, left: 4 };

describe('assertEndpointControl (issue #41: port sides)', () => {
  test('side names map to the app codes: top=1, right=2, bottom=3, left=4', () => {
    for (const [name, code] of Object.entries(SIDES)) {
      assert.equal(assertEndpointControl(name, 'start.control'), code);
    }
  });

  test('undefined stays undefined (control is optional)', () => {
    assert.equal(assertEndpointControl(undefined, 'start.control'), undefined);
  });

  test('anything but the four side names is rejected', () => {
    assert.throws(() => assertEndpointControl('up', 'start.control'), ValidationError);
    assert.throws(() => assertEndpointControl(5, 'end.control'), ValidationError);
    assert.throws(() => assertEndpointControl('TOP', 'start.control'), ValidationError);
    assert.throws(() => assertEndpointControl(null, 'start.control'), ValidationError);
  });

  test('rejection names the parameter and lists the sides', () => {
    assert.throws(() => assertEndpointControl('north', 'start.control'), /start\.control.*top.*right.*bottom.*left/s);
  });
});

describe('assertArrowEndpoint: control is object-endpoint-only', () => {
  test('attached endpoint with control passes', () => {
    assert.doesNotThrow(() =>
      assertArrowEndpoint({ objectId: 'abc', relativePoint: { x: 0.5, y: 0 }, control: 'top' }, 'start')
    );
  });

  test('free point with control is rejected', () => {
    assert.throws(
      () => assertArrowEndpoint({ x: 10, y: 20, control: 'left' }, 'start'),
      ValidationError
    );
  });

  test('returns a normalized object endpoint with the side name mapped to its code', () => {
    assert.deepEqual(
      assertArrowEndpoint({ objectId: 'abc', relativePoint: { x: 0.5, y: 0 }, control: 'left' }, 'start'),
      { objectId: 'abc', relativePoint: { x: 0.5, y: 0 }, control: 4 }
    );
  });

  test('returns a normalized endpoint without control when none was given', () => {
    assert.deepEqual(
      assertArrowEndpoint({ objectId: 'abc' }, 'end'),
      { objectId: 'abc' }
    );
    assert.deepEqual(assertArrowEndpoint({ x: 10, y: -5 }, 'start'), { x: 10, y: -5 });
  });
});

describe('buildAddArrowExpr: endpoint control reaches the yDoc write', () => {
  const base = {
    start: { objectId: 'box-start', control: 4 },
    end: { objectId: 'box-end', control: 2 },
    arrowType: 'elbow',
    strokeColor: '#808080',
    strokeStyle: 'solid',
    strokeWidth: undefined,
    arrowheadStart: undefined,
    arrowheadEnd: undefined,
    texts: null,
    styleExtras: {},
  };

  test('side codes land on the stored endpoints verbatim', async () => {
    const state = await runExpr(buildAddArrowExpr(base));
    const arrows = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal(arrows.length, 1);
    assert.equal(arrows[0].fields.start.control, 4);
    assert.equal(arrows[0].fields.end.control, 2);
  });

  test('absent control keeps endpoints at control: null (router picks sides)', async () => {
    const state = await runExpr(
      buildAddArrowExpr({ ...base, start: { x: 0, y: 0 }, end: { x: 100, y: 100 } })
    );
    const [arrow] = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal(arrow.fields.start.control, null);
    assert.equal(arrow.fields.end.control, null);
  });
});

describe('batch: control on arrow endpoints (parity with holst_add_arrow)', () => {
  const entry = {
    kind: 'arrow',
    from: { ref: 'a', control: 'left' },
    to: { x: 300, y: 100 },
  };

  test('buildBatchPlan maps side names to codes on ref endpoints', () => {
    const plan = buildBatchPlan([
      { kind: 'shape', shapeType: 'square', x: 0, y: 0, width: 10, height: 10, ref: 'a' },
      entry,
    ]);
    // refIndex is resolved by the plan (feeds buildBatchArrowsExpr); control rides along mapped.
    assert.deepEqual(plan.arrows[0].from, { ref: 'a', control: 4, refIndex: 0 });
  });

  test('objectId endpoints map too', () => {
    const plan = buildBatchPlan([
      { ...entry, from: { objectId: 'live-box', control: 'bottom' } },
    ]);
    assert.deepEqual(plan.arrows[0].from, { objectId: 'live-box', control: 3 });
  });

  test('free point with control is rejected', () => {
    const shape = { kind: 'shape', shapeType: 'square', x: 0, y: 0, width: 10, height: 10, ref: 'a' };
    assert.throws(
      () => buildBatchPlan([shape, { ...entry, to: { x: 1, y: 1, control: 'top' } }]),
      /control/
    );
  });

  test('invalid side is rejected with the entry path in the message', () => {
    assert.throws(
      () => buildBatchPlan([{ ...entry, from: { ref: 'a', control: 'sideways' } }]),
      /objects\[0\]\.from\.control/
    );
  });

  test('buildBatchArrowsExpr writes the code into the yDoc', async () => {
    const plan = buildBatchPlan([
      { kind: 'shape', shapeType: 'square', x: 0, y: 0, width: 10, height: 10, ref: 'a' },
      entry,
    ]);
    const state = await runExpr(buildBatchArrowsExpr([{ id: 'node-a' }], plan.arrows, false));
    const [arrow] = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal(arrow.fields.start.control, 4);
    assert.equal(arrow.fields.end.control, null);
  });

  test('batch endpoint without control keeps control null', async () => {
    const plan = buildBatchPlan([
      { kind: 'shape', shapeType: 'square', x: 0, y: 0, width: 10, height: 10, ref: 'a' },
      { ...entry, from: { ref: 'a' } },
    ]);
    const state = await runExpr(buildBatchArrowsExpr([{ id: 'node-a' }], plan.arrows, false));
    const [arrow] = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal(arrow.fields.start.control, null);
  });
});

describe('tool schema: holst_add_arrow exposes endpoint control', () => {
  test('start/end param descriptions mention control and the four sides', () => {
    const tool = TOOLS.find((t) => t.name === 'holst_add_arrow');
    for (const p of ['start', 'end']) {
      const prop = tool.inputSchema.properties[p];
      assert.ok(prop, `${p} must be declared`);
      assert.match(prop.description, /control/);
      assert.match(prop.description, /top.*right.*bottom.*left/s);
    }
  });

  test('add_arrow and batch descriptions mention port control', () => {
    const tool = TOOLS.find((t) => t.name === 'holst_add_arrow');
    assert.match(tool.description, /control/);
    const batch = TOOLS.find((t) => t.name === 'holst_batch_create');
    assert.match(batch.description, /control/);
  });
});

describe('reference: port control documented', () => {
  test('arrowGeometry documents the side map, fan formula and the arrowType rule', async () => {
    const { getReference } = await import('../src/reference.js');
    const geo = getReference().arrowGeometry;
    assert.ok(geo.port, 'arrowGeometry.port key must exist');
    assert.match(geo.port, /control/);
    assert.match(geo.port, /top.*1|1.*top/);
    assert.match(geo.port, /right.*2|2.*right/);
    assert.match(geo.port, /bottom.*3|3.*bottom/);
    assert.match(geo.port, /left.*4|4.*left/);
    assert.match(geo.port, /\(N\+1\)|N\+1/, 'fan formula k/(N+1) must be documented');
  });
});
