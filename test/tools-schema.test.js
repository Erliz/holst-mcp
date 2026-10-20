import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, DISPATCH } from '../src/tools-schema.js';
import { ValidationError } from '../src/validate.js';

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

  // The INVERSE of the invariant above (issue #57): schema→dispatch direction.
  // A property declared in inputSchema but never forwarded by the dispatch
  // entry is a silent drop — the v0.6 regression where holst_set_color
  // declared backgroundStyle while the dispatch discarded it before the
  // handler ever saw it. Pass-through entries (`addX(args.boardId, args)`)
  // forward everything by construction; enumerating entries must read every
  // declared property explicitly. The arrow parameter `(args) =>` does not
  // count as a pass-through read.
  test('every schema-declared property is forwarded by its dispatch entry (issue #57)', () => {
    const BARE_ARGS = /\bargs\b(?![.\w])/;
    const problems = [];
    for (const t of TOOLS) {
      const fn = DISPATCH[t.name];
      if (typeof fn !== 'function') continue; // covered by the test above
      const src = fn.toString();
      const body = src.replace(/^\s*(?:async\s*)?(?:\(\s*args\s*\)|args)\s*=>/, '');
      const reads = new Set();
      for (const m of src.matchAll(READS_ARG)) reads.add(m[1]);
      const wholeArgs = BARE_ARGS.test(body);
      for (const prop of Object.keys(t.inputSchema.properties || {})) {
        if (!wholeArgs && !reads.has(prop)) {
          problems.push(`${t.name}: schema declares "${prop}" but dispatch never forwards it`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  // Behavioral proof at the dispatch boundary (issue #57): an invalid
  // backgroundStyle must be rejected BY setColor's own validator — proving
  // the value survived the dispatch hop. A dropped field instead surfaces as
  // the misleading "provide at least one of …" error. Validation runs before
  // any CDP session, so a sentinel call never touches the live app.
  test('holst_set_color forwards backgroundStyle to setColor validation (issue #57)', async () => {
    await assert.rejects(
      DISPATCH.holst_set_color({
        boardId: '00000000-0000-4000-8000-000000000000',
        objectId: 'obj-1',
        backgroundStyle: '‽invalid‽',
      }),
      (err) => err instanceof ValidationError && /backgroundStyle must be one of/.test(err.message)
    );
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

  test('resize_object documents simple-text width semantics (issue #9)', () => {
    const t = byName.get('holst_resize_object');
    assert.match(t.description, /simple-text/i);
    assert.match(t.description, /width/i);
    // height must be explicitly called out as unsupported for simple-text
    assert.match(t.description, /height (is )?(not|auto)/i);
  });

  test('set_z_order documents placement/zIndex semantics (issue #10)', () => {
    const t = byName.get('holst_set_z_order');
    assert.ok(t, 'tool not declared');
    assert.match(t.description, /front|back/i);
    assert.match(t.description, /exactly one/i, 'mutual exclusion must be documented');
    const props = t.inputSchema.properties;
    assert.ok('zIndex' in props && 'placement' in props);
    assert.deepEqual(props.placement.enum, ['front', 'back']);
  });

  test('get_board_content documents what counts as a live object (issue #11)', () => {
    const t = byName.get('holst_get_board_content');
    assert.match(t.description, /content\.objects/);
    assert.match(t.description, /delete-events/i);
  });

  test('get_board_content documents the { meta, content } envelope (issue #44)', () => {
    const t = byName.get('holst_get_board_content');
    assert.match(t.description, /\{ meta, content \}/);
  });

  test('get_board_content documents the trimmed default + audit flag (issue #34)', () => {
    const t = byName.get('holst_get_board_content');
    assert.match(t.description, /trim|trimmed|live/i, 'must say the dump is trimmed');
    assert.match(t.description, /includeDeleteEvents/);
    const props = t.inputSchema.properties;
    assert.equal(props.includeDeleteEvents.type, 'boolean');
  });

  test('get_board_summary documents its counting basis (issue #11)', () => {
    const t = byName.get('holst_get_board_summary');
    assert.match(t.description, /content\.objects/);
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

  test('strokeStyle description warns the dash is derived, not custom (issue #40)', () => {
    const arrow = byName.get('holst_add_arrow');
    assert.match(arrow.inputSchema.properties.strokeStyle.description, /no custom dasharray/i);
    assert.match(arrow.inputSchema.properties.strokeStyle.description, /derived/i);
  });
});
