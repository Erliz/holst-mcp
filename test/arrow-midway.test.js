import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Issue #39: expose the app's native arrow geometry shaping — midwayControls,
// arbitrary [{x, y}] points the arrow routes through (verified on curved
// arrows in the live UI: "curved with 1 elbow" / "many elbows" examples).
// The MCP only passes points through verbatim: composing a hop/bridge bump is
// client-level geometry; a first-class hop primitive belongs to the app.

import { assertMidwayControls } from '../src/validate.js';
import { buildAddArrowExpr, buildBatchArrowsExpr } from '../src/eval-scripts.js';
import { buildBatchPlan, ValidationError } from '../src/batch.js';
import { runExpr } from './helpers/fake-holst.js';
import { TOOLS } from '../src/tools-schema.js';

const POINTS = [
  { x: 100.5, y: 200 },
  { x: 150, y: 220.25 },
  { x: 200, y: 240 },
];

describe('assertMidwayControls (issue #39: arrow geometry points)', () => {
  test('valid points pass through as a normalized shallow copy', () => {
    const out = assertMidwayControls(POINTS, 'midwayControls');
    assert.deepEqual(out, POINTS);
    assert.notEqual(out, POINTS, 'must return a copy, not the caller array');
  });

  test('undefined stays undefined (param is optional)', () => {
    assert.equal(assertMidwayControls(undefined, 'midwayControls'), undefined);
  });

  test('non-array is rejected', () => {
    assert.throws(() => assertMidwayControls('nope', 'midwayControls'), ValidationError);
    assert.throws(() => assertMidwayControls({ x: 1, y: 2 }, 'midwayControls'), ValidationError);
  });

  test('empty array is rejected (absent means no field)', () => {
    assert.throws(() => assertMidwayControls([], 'midwayControls'), /non-empty/);
  });

  test('over 100 points is rejected', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ x: i, y: i }));
    assert.throws(() => assertMidwayControls(many, 'midwayControls'), /at most 100/);
  });

  test('a point missing a coordinate is rejected with its index in the path', () => {
    assert.throws(
      () => assertMidwayControls([{ x: 1, y: 2 }, { x: 3 }], 'midwayControls'),
      /midwayControls\[1\]\.y/
    );
  });

  test('non-finite coordinates are rejected', () => {
    assert.throws(
      () => assertMidwayControls([{ x: NaN, y: 2 }], 'midwayControls'),
      ValidationError
    );
    assert.throws(
      () => assertMidwayControls([{ x: 1, y: 'five' }], 'midwayControls'),
      ValidationError
    );
  });
});

describe('buildAddArrowExpr: midwayControls reach the yDoc write', () => {
  const base = {
    start: { x: 0, y: 0 },
    end: { x: 300, y: 100 },
    arrowType: 'curved',
    strokeColor: '#808080',
    strokeStyle: 'solid',
    strokeWidth: undefined,
    arrowheadStart: undefined,
    arrowheadEnd: undefined,
    texts: null,
    styleExtras: {},
  };

  test('points land on the arrow object verbatim', async () => {
    const state = await runExpr(buildAddArrowExpr({ ...base, midwayControls: POINTS }));
    const arrows = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal(arrows.length, 1);
    assert.deepEqual(arrows[0].fields.midwayControls, POINTS);
  });

  test('absent param writes no midwayControls field (default arrows unchanged)', async () => {
    const state = await runExpr(buildAddArrowExpr(base));
    const [arrow] = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal('midwayControls' in arrow.fields, false);
  });
});

describe('batch: midwayControls on arrow entries (parity with holst_add_arrow)', () => {
  const entry = {
    kind: 'arrow',
    from: { x: 0, y: 0 },
    to: { x: 300, y: 100 },
    midwayControls: POINTS,
  };

  test('buildBatchPlan keeps the points on the arrow plan', () => {
    const plan = buildBatchPlan([entry]);
    assert.deepEqual(plan.arrows[0].midwayControls, POINTS);
  });

  test('invalid points are rejected by the batch validator', () => {
    assert.throws(
      () => buildBatchPlan([{ ...entry, midwayControls: [{ x: 1 }] }]),
      ValidationError
    );
  });

  test('buildBatchArrowsExpr writes the field into the yDoc', async () => {
    const plan = buildBatchPlan([entry]);
    const byIndex = [];
    const expr = buildBatchArrowsExpr(byIndex, plan.arrows, false);
    const state = await runExpr(expr);
    const arrows = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal(arrows.length, 1);
    assert.deepEqual(arrows[0].fields.midwayControls, POINTS);
  });

  test('batch arrow without the field stays field-free', async () => {
    const plan = buildBatchPlan([{ kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }]);
    const expr = buildBatchArrowsExpr([], plan.arrows, false);
    const state = await runExpr(expr);
    const [arrow] = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal('midwayControls' in arrow.fields, false);
  });
});

describe('tool schema: holst_add_arrow exposes midwayControls', () => {
  test('the param is declared with point items and a geometry description', () => {
    const tool = TOOLS.find((t) => t.name === 'holst_add_arrow');
    const prop = tool.inputSchema.properties.midwayControls;
    assert.ok(prop, 'midwayControls must be declared');
    assert.equal(prop.type, 'array');
    assert.match(prop.description, /point/i);
    assert.match(prop.description, /hop|crossing|route/i);
  });

  test('add_arrow and batch descriptions mention the geometry points', () => {
    const tool = TOOLS.find((t) => t.name === 'holst_add_arrow');
    assert.match(tool.description, /midwayControls/);
    const batch = TOOLS.find((t) => t.name === 'holst_batch_create');
    assert.match(batch.description, /midwayControls/);
  });
});

describe('reference: arrow geometry points are documented', () => {
  test('getReference explains midwayControls and the hop stance', async () => {
    const { getReference } = await import('../src/reference.js');
    const ref = getReference();
    const geo = ref.arrowGeometry;
    assert.ok(geo, 'arrowGeometry key must exist');
    assert.match(geo.how, /midwayControls/);
    assert.match(geo.hop, /client|yourself/i);
  });
});
