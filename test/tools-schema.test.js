import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, DISPATCH } from '../src/tools-schema.js';

// Guards the class of the v0.5 regression: the dispatch read args.bbox while
// the schema did not declare it — a python no-op edit silently split the two.
// Invariant: every tool the dispatch serves has a schema, and every args.X
// the dispatch reads is declared in that schema.

const byName = new Map(TOOLS.map((t) => [t.name, t]));
const READS_ARG = /args\.([A-Za-z_$][\w$]*)/g;

describe('schema/dispatch consistency (v0.5 regression guard)', () => {
  test('every dispatch entry has a declared tool', () => {
    for (const name of Object.keys(DISPATCH)) {
      assert.ok(byName.has(name), `DISPATCH serves unknown tool: ${name}`);
    }
  });

  test('every declared tool has a dispatch handler', () => {
    for (const t of TOOLS) {
      assert.ok(typeof DISPATCH[t.name] === 'function', `tool without handler: ${t.name}`);
    }
  });

  test('every args.X read by a handler is declared in its schema', () => {
    const problems = [];
    for (const [name, fn] of Object.entries(DISPATCH)) {
      const props = byName.get(name).inputSchema.properties || {};
      const reads = new Set();
      for (const m of fn.toString().matchAll(READS_ARG)) reads.add(m[1]);
      for (const arg of reads) {
        if (!(arg in props)) problems.push(`${name}: dispatch reads args.${arg} — not in schema`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test('get_board_content exposes bbox and positionsOnly (the regression)', () => {
    const props = byName.get('holst_get_board_content').inputSchema.properties;
    assert.ok('bbox' in props, 'bbox missing');
    assert.ok('positionsOnly' in props, 'positionsOnly missing');
  });

  test('delete_objects documents the ids naming (objectId alias wording)', () => {
    const t = byName.get('holst_delete_objects');
    assert.match(t.description, /object ids/i);
    assert.ok('ids' in t.inputSchema.properties);
  });

  test('enum-backed descriptions are GENERATED from validate.js data (no stale tokens)', async () => {
    const { SHAPE_TYPES, ARROW_TYPES, ARROWHEADS, STROKE_STYLES } = await import('../src/validate.js');
    const shape = byName.get('holst_add_shape');
    const shapeTypesDesc = shape.inputSchema.properties.shapeType.description;
    // every real token listed…
    for (const t of SHAPE_TYPES) assert.ok(shapeTypesDesc.includes(t), `missing token ${t}`);
    // …and no rejected token advertised (the rhombus regression)
    assert.ok(!shapeTypesDesc.includes('rhombus') || shapeTypesDesc.includes('does NOT exist'), 'stale rhombus hint');
    const arrow = byName.get('holst_add_arrow');
    for (const h of ARROWHEADS) assert.ok(arrow.description.includes(h) || arrow.inputSchema.properties.arrowheadEnd.description.includes(h), `arrowhead ${h} not documented`);
    assert.ok(arrow.inputSchema.properties.strokeStyle.description.includes(STROKE_STYLES.filter((s) => s !== 'solid')[0] || 'dashed'));
    assert.ok(ARROW_TYPES.every((t) => arrow.inputSchema.properties.arrowType.description.includes(t)));
  });

  test('reference enum lists come from the same source of truth', async () => {
    const { SHAPE_TYPES, ARROW_TYPES } = await import('../src/validate.js');
    const { getReference } = await import('../src/reference.js');
    const r = getReference();
    assert.deepEqual(r.shapeTypes.verified, SHAPE_TYPES);
    assert.deepEqual(r.arrowTypes, ARROW_TYPES);
  });
});
