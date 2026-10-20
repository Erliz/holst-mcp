import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Issue #39: expose the app's native arrow geometry shaping — midwayControls,
// arbitrary [{x, y}] points the arrow routes through (verified on curved
// arrows in the live UI: "curved with 1 elbow" / "many elbows" examples).
// The MCP only passes points through verbatim: composing a hop/bridge bump is
// client-level geometry; a first-class hop primitive belongs to the app.

import { assertMidwayControls, assertElbowMidwayControls } from '../src/validate.js';
import { buildAddArrowExpr, buildBatchArrowsExpr } from '../src/eval-scripts.js';
import { buildBatchPlan, ValidationError } from '../src/batch.js';
import { runExpr } from './helpers/fake-holst.js';
import { TOOLS } from '../src/tools-schema.js';

const POINTS = [
  { x: 100.5, y: 200 },
  { x: 150, y: 220.25 },
  { x: 200, y: 240 },
];

// Corridor constraints (elbow arrows): exactly one of x/y is a number, the
// other is null — {x: V, y: null} = pass the vertical line x=V,
// {x: null, y: H} = pass the horizontal line y=H. Shape captured from a
// UI-drawn zigzag arrow (11 corridors, live round-trip).
const CORRIDORS = [
  { x: 6972, y: null },
  { x: null, y: 1409.91 },
  { x: 7033.66, y: null },
  { x: null, y: 1622.51 },
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

  // Issue #62: every other coordinate path is capped at ±1e7 (COORD in
  // batch.js / holst.js) — huge-but-finite values must not reach the yDoc.
  test('out-of-range coordinates are rejected with the point index in the path', () => {
    assert.throws(
      () => assertMidwayControls([{ x: 1e7 + 1, y: 0 }], 'midwayControls'),
      /midwayControls\[0\]\.x must be between -10000000 and 10000000/
    );
    assert.throws(
      () => assertMidwayControls([{ x: 0, y: -1e7 - 1 }], 'midwayControls'),
      /midwayControls\[0\]\.y must be between/
    );
  });

  test('boundary coordinates ±1e7 are accepted', () => {
    const out = assertMidwayControls([{ x: 1e7, y: -1e7 }], 'midwayControls');
    assert.deepEqual(out, [{ x: 1e7, y: -1e7 }]);
  });
});

describe('buildAddArrowExpr: midwayControls reach the yDoc write', () => {  const base = {
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
    assert.match(geo.how, /elbow.*(ignor|inert)/i, 'must warn: the elbow renderer ignores these points');
  });
});

describe('assertElbowMidwayControls (issue #39: elbow corridors)', () => {
  test('valid corridors pass through as a normalized copy (missing side → null)', () => {
    const out = assertElbowMidwayControls(CORRIDORS, 'elbowMidwayControls');
    assert.deepEqual(out, CORRIDORS);
    assert.notEqual(out, CORRIDORS, 'must return a copy, not the caller array');
    const lenient = assertElbowMidwayControls([{ x: 5 }, { y: 7 }], 'elbowMidwayControls');
    assert.deepEqual(lenient, [{ x: 5, y: null }, { x: null, y: 7 }]);
  });

  test('undefined stays undefined (param is optional)', () => {
    assert.equal(assertElbowMidwayControls(undefined, 'elbowMidwayControls'), undefined);
  });

  test('non-array and empty array are rejected', () => {
    assert.throws(() => assertElbowMidwayControls('nope', 'elbowMidwayControls'), ValidationError);
    assert.throws(() => assertElbowMidwayControls([], 'elbowMidwayControls'), /non-empty/);
  });

  test('over 100 corridors is rejected', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ x: i, y: null }));
    assert.throws(() => assertElbowMidwayControls(many, 'elbowMidwayControls'), /at most 100/);
  });

  test('both coordinates numbers is rejected with the index in the path', () => {
    assert.throws(
      () => assertElbowMidwayControls([{ x: 1, y: null }, { x: 2, y: 3 }], 'elbowMidwayControls'),
      /elbowMidwayControls\[1\].*exactly one/
    );
  });

  test('neither coordinate a number is rejected', () => {
    assert.throws(
      () => assertElbowMidwayControls([{ x: null, y: null }], 'elbowMidwayControls'),
      ValidationError
    );
  });

  test('non-finite corridor coordinate is rejected', () => {
    assert.throws(
      () => assertElbowMidwayControls([{ x: Infinity, y: null }], 'elbowMidwayControls'),
      ValidationError
    );
  });

  // Issue #62: ±1e7 parity with every other coordinate path.
  test('out-of-range corridor coordinate is rejected with its index in the path', () => {
    assert.throws(
      () => assertElbowMidwayControls([{ x: 1e8, y: null }], 'elbowMidwayControls'),
      /elbowMidwayControls\[0\]\.x must be between -10000000 and 10000000/
    );
    assert.throws(
      () => assertElbowMidwayControls([{ x: null, y: -1e8 }], 'elbowMidwayControls'),
      /elbowMidwayControls\[0\]\.y must be between/
    );
  });

  test('boundary corridor coordinates ±1e7 are accepted', () => {
    const out = assertElbowMidwayControls([{ x: 1e7, y: null }, { x: null, y: -1e7 }], 'elbowMidwayControls');
    assert.deepEqual(out, [{ x: 1e7, y: null }, { x: null, y: -1e7 }]);
  });
});

describe('buildAddArrowExpr: elbowMidwayControls reach the yDoc write', () => {
  const baseElbow = {
    start: { x: 0, y: 0 },
    end: { x: 300, y: 100 },
    arrowType: 'elbow',
    strokeColor: '#808080',
    strokeStyle: 'solid',
    strokeWidth: undefined,
    arrowheadStart: undefined,
    arrowheadEnd: undefined,
    texts: null,
    styleExtras: {},
  };

  test('corridors land on the arrow object verbatim', async () => {
    const state = await runExpr(buildAddArrowExpr({ ...baseElbow, elbowMidwayControls: CORRIDORS }));
    const arrows = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal(arrows.length, 1);
    assert.deepEqual(arrows[0].fields.elbowMidwayControls, CORRIDORS);
  });

  test('absent param writes no elbowMidwayControls field', async () => {
    const state = await runExpr(buildAddArrowExpr(baseElbow));
    const [arrow] = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal('elbowMidwayControls' in arrow.fields, false);
  });

  test('both control fields can ride the same write', async () => {
    const state = await runExpr(
      buildAddArrowExpr({ ...baseElbow, midwayControls: POINTS, elbowMidwayControls: CORRIDORS })
    );
    const [arrow] = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.deepEqual(arrow.fields.midwayControls, POINTS);
    assert.deepEqual(arrow.fields.elbowMidwayControls, CORRIDORS);
  });
});

describe('batch: elbowMidwayControls on arrow entries (parity)', () => {
  const entry = {
    kind: 'arrow',
    from: { x: 0, y: 0 },
    to: { x: 300, y: 100 },
    arrowType: 'elbow',
    elbowMidwayControls: CORRIDORS,
  };

  test('buildBatchPlan keeps the corridors on the arrow plan', () => {
    const plan = buildBatchPlan([entry]);
    assert.deepEqual(plan.arrows[0].elbowMidwayControls, CORRIDORS);
  });

  test('invalid corridors are rejected by the batch validator', () => {
    assert.throws(
      () => buildBatchPlan([{ ...entry, elbowMidwayControls: [{ x: 1, y: 2 }] }]),
      ValidationError
    );
  });

  test('buildBatchArrowsExpr writes the field into the yDoc', async () => {
    const plan = buildBatchPlan([entry]);
    const state = await runExpr(buildBatchArrowsExpr([], plan.arrows, false));
    const arrows = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.deepEqual(arrows[0].fields.elbowMidwayControls, CORRIDORS);
  });

  test('batch arrow without the field stays field-free', async () => {
    const plan = buildBatchPlan([{ kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }]);
    const state = await runExpr(buildBatchArrowsExpr([], plan.arrows, false));
    const [arrow] = state.objectsList().filter((o) => o.fields.type === 'arrow');
    assert.equal('elbowMidwayControls' in arrow.fields, false);
  });
});

describe('tool schema & reference: elbow corridors exposed', () => {
  test('the param is declared and describes corridor semantics', () => {
    const tool = TOOLS.find((t) => t.name === 'holst_add_arrow');
    const prop = tool.inputSchema.properties.elbowMidwayControls;
    assert.ok(prop, 'elbowMidwayControls must be declared');
    assert.equal(prop.type, 'array');
    assert.match(prop.description, /corridor|vertical|horizontal/i);
  });

  test('add_arrow and batch descriptions mention elbow corridors', () => {
    const tool = TOOLS.find((t) => t.name === 'holst_add_arrow');
    assert.match(tool.description, /elbowMidwayControls/);
    const batch = TOOLS.find((t) => t.name === 'holst_batch_create');
    assert.match(batch.description, /elbowMidwayControls/);
  });

  test('reference documents corridor semantics and the elbow hop recipe', async () => {
    const { getReference } = await import('../src/reference.js');
    const geo = getReference().arrowGeometry;
    assert.ok(geo.elbow, 'arrowGeometry.elbow key must exist');
    assert.match(geo.elbow, /elbowMidwayControls/);
    assert.match(geo.elbow, /\{x: V, y: null\}|\{x:null,y:H\}|vertical/i);
    assert.match(geo.elbow, /hop/i);
  });
});
