import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { USAGE_DOC } from '../src/docs.js';

describe('USAGE_DOC (holst://docs/usage)', () => {
  test('workflow teaches measure-first sizing (issue #58)', () => {
    // the sizing tool is named in the recommended workflow
    assert.match(USAGE_DOC, /holst_measure_text/);
    // return contract mirrors the tool schema
    assert.match(USAGE_DOC, /widthPx, heightPx, lineHeightPx/);
    // real mono metrics, not nominal ones
    assert.match(USAGE_DOC, /0\.72em/);
    // sizing pattern: pad after measuring
    assert.match(USAGE_DOC, /width ≥ widthPx \+ padding/);
    // nothing is created — read-only boards are fine
    assert.match(USAGE_DOC, /works on read-only boards/);
    // depth stays in the on-demand reference, the guide points there
    assert.match(USAGE_DOC, /holst_reference` → measureText/);
  });
});
