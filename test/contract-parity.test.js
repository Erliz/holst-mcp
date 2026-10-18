import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../src/tools-schema.js';
import { buildBatchPlan, ValidationError } from '../src/batch.js';

// Relation-invariant (the class behind the v0.5 regressions): batch promises
// "Same fields/validation as the individual add_* tools" — nothing checked it,
// and `width` drifted (add_simple_text accepted it, batch silently dropped).
//
// Mechanism: for every add_* schema property, feed batch a sentinel that MUST
// fail validation IF (and only if) the field is actually read. A missing
// throw = the field is ignored = parity break.

const KIND_TOOL = {
  shape: 'holst_add_shape',
  sticker: 'holst_add_sticker',
  'simple-text': 'holst_add_simple_text',
  frame: 'holst_add_frame',
  stamp: 'holst_add_stamp',
};
const MINIMAL = {
  shape: { x: 1, y: 1 },
  sticker: { x: 1, y: 1, text: 't' },
  'simple-text': { x: 1, y: 1, text: 't' },
  frame: { x: 1, y: 1 },
  stamp: { x: 1, y: 1, text: 't' },
  arrow: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
};
// Core/structural fields every kind handles by construction; booleans are
// consumed by the shared marks block — they cannot fail a sentinel.
// Free-text props (text, labelText) accept any string — nothing to fail.
const SKIP = new Set(['boardId', 'kind', 'ref', 'x', 'y', 'options', 'text', 'labelText', 'start', 'end', 'from', 'to', 'fixedSize', 'bold', 'italic', 'underline', 'strikethrough']);

const byName = new Map(TOOLS.map((t) => [t.name, t]));
const sentinel = (prop) => (prop.type === 'number' ? NaN : '‽invalid‽');

describe('contract parity: add_* fields are all read by batch (per kind)', () => {
  for (const [kind, tool] of Object.entries(KIND_TOOL)) {
    test(`${kind}: every ${tool} field reaches the batch plan`, () => {
      const props = byName.get(tool).inputSchema.properties;
      const ignored = [];
      for (const [name, prop] of Object.entries(props)) {
        if (SKIP.has(name)) continue;
        if (prop.type !== 'number' && prop.type !== 'string') continue;
        try {
          buildBatchPlan([{ kind, ...MINIMAL[kind], [name]: sentinel(prop) }]);
          ignored.push(name); // no throw → batch never read the field
        } catch (e) {
          if (!(e instanceof ValidationError)) throw e;
        }
      }
      assert.deepEqual(ignored, [], `batch ignores fields accepted by ${tool}`);
    });
  }

  test('arrow: every holst_add_arrow field reaches the batch arrow plan', () => {
    const props = byName.get('holst_add_arrow').inputSchema.properties;
    const ignored = [];
    for (const [name, prop] of Object.entries(props)) {
      if (SKIP.has(name)) continue;
      if (prop.type !== 'number' && prop.type !== 'string') continue;
      try {
        buildBatchPlan([{ kind: 'arrow', ...MINIMAL.arrow, [name]: sentinel(prop) }]);
        ignored.push(name);
      } catch (e) {
        if (!(e instanceof ValidationError)) throw e;
      }
    }
    assert.deepEqual(ignored, [], 'batch ignores fields accepted by holst_add_arrow');
  });
});
