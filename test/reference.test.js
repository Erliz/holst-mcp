import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getReference } from '../src/reference.js';

describe('getReference', () => {
  const ref = getReference();

  test('exposes palette with verified colors', () => {
    for (const c of ['yellow6', 'blue6', 'green6', 'red6', 'orange8', 'gray10', 'gray12', 'white3', 'white6']) {
      assert.ok(ref.paletteColors.includes(c), c);
    }
  });

  test('exposes verified shape and arrow types', () => {
    assert.ok(ref.shapeTypes.verified.includes('round-rect'));
    assert.ok(ref.arrowTypes.includes('straight'));
    assert.ok(ref.arrowTypes.includes('elbow'));
    assert.ok(ref.arrowTypes.includes('curved'));
  });

  test('documents coordinate system and timings', () => {
    assert.equal(ref.coordinateSystem.origin, 'top-left');
    assert.equal(ref.coordinateSystem.yDirection, 'down');
    assert.ok(ref.timings.addToolsMs);
    assert.ok(ref.resultFields.mounted);
    assert.ok(ref.resultFields.native);
  });

  test('documents env vars including auto-start', () => {
    for (const v of ['HOLST_AUTO_START', 'HOLST_ALLOWED_BOARD_IDS', 'HOLST_READ_ONLY', 'HOLST_MAX_DUMP_BYTES', 'HOLST_DEBUG_PORT']) {
      assert.ok(ref.envVars[v], v);
    }
  });

  test('documents input limits matching validators', () => {
    assert.equal(ref.limits.textMaxLen, 100000);
    assert.equal(ref.limits.coordAbsMax, 1e7);
  });
});
