import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getReference } from '../src/reference.js';

describe('getReference', () => {
  const ref = getReference();

  test('suggests hex colors; palette names are gone from the interface', () => {
    assert.ok(ref.suggestedColors.ink === '#202020');
    assert.ok(ref.suggestedColors.accents.red === '#e54d2e');
    assert.ok(/#RRGGBB hex only/.test(ref.colorFormat));
    assert.ok(!('paletteColors' in ref));
    assert.deepEqual(ref.backgroundStyles.values, ['fill', 'fill-border', 'border-only']);
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
    for (const v of ['HOLST_AUTO_START', 'HOLST_RW_BOARD_IDS', 'HOLST_RO_BOARD_IDS', 'HOLST_READ_ONLY', 'HOLST_MAX_DUMP_BYTES', 'HOLST_DEBUG_PORT']) {
      assert.ok(ref.envVars[v], v);
    }
    assert.ok(!ref.envVars.HOLST_ALLOWED_BOARD_IDS, 'legacy var must be gone');
  });

  test('documents input limits matching validators', () => {
    assert.equal(ref.limits.textMaxLen, 100000);
    assert.equal(ref.limits.coordAbsMax, 1e7);
  });
});
