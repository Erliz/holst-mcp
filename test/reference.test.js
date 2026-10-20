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

  test('documents counting rules: summary vs raw dump (issue #11)', () => {
    assert.ok(ref.countingRules, 'countingRules section missing');
    // live-object counts come from the flat objects map only
    assert.match(ref.countingRules.liveObjects, /content\.objects/);
    // the raw dump carries the delete audit with full snapshots of deleted objects
    assert.match(ref.countingRules.rawDump, /delete-events-metaStore/);
    assert.match(ref.countingRules.rawDump, /deleted/i);
    // documents may outlive their objects
    assert.match(ref.countingRules.documents, /orphan/i);
    // summary sub-counts filter by non-empty text
    assert.match(ref.countingRules.summary, /non-empty text/i);
  });

  test('documents the trimmed dump default + audit flag (issue #34)', () => {
    assert.match(ref.countingRules.rawDump, /includeDeleteEvents/);
    // the cap applies to the trimmed content, not the raw history
    assert.match(ref.limits.HOLST_MAX_DUMP_BYTES, /trim/i);
  });

  test('documents the get_board_content response contract (issue #44)', () => {
    assert.ok(ref.getBoardContent, 'getBoardContent section missing');
    const gbc = ref.getBoardContent;
    // envelope first: two conveyor runs crashed on Object.entries(dump.objects)
    // — objects live at res.content.objects, meta is NOT the board content
    assert.match(gbc.envelope, /\{ meta, content \}/);
    assert.match(gbc.envelope, /content\.objects/);
    assert.match(gbc.envelope, /null/);
    // objects: flat live-object map; arrows carry no position/width/height
    assert.match(gbc.objects, /\[objectId\]/);
    assert.match(gbc.objects, /start\/end/);
    // documents: docId → plain text, linked via documentId; arrow labels are not docs
    assert.match(gbc.documents, /\[docId\]/);
    assert.match(gbc.documents, /documentId/);
    assert.match(gbc.documents, /texts\[\]/);
    // other top-level keys: aux stores passthrough + the delete audit default
    assert.match(gbc.otherKeys, /delete-events-metaStore/);
    assert.match(gbc.otherKeys, /includeDeleteEvents/);
    // shaping: bbox filter + the positionsOnly projection shape
    assert.match(gbc.shaping, /bbox/);
    assert.match(gbc.shaping, /positionsOnly/);
    assert.match(gbc.shaping, /\{ objects: /);
    assert.match(gbc.shaping, /\{type,x,y,w,h\}/);
  });

  test('documents measure_text — rendered metrics before creating objects (issue #58)', () => {
    assert.ok(ref.measureText, 'measureText section missing');
    const mt = ref.measureText;
    // return shape mirrors the tool schema verbatim
    assert.match(mt.returns, /holst_measure_text/);
    assert.match(mt.returns, /widthPx, heightPx, lineHeightPx/);
    assert.match(mt.returns, /lines: \[\{ text, widthPx \}\]/);
    assert.match(mt.returns, /widest line/);
    // pure read: read-only boards OK
    assert.match(mt.pureRead, /read-only/);
    // rendered metrics, not nominal mono widths
    assert.match(mt.gotcha, /0\.72em/);
    assert.match(mt.gotcha, /NOT the nominal 0\.6/);
    assert.match(mt.gotcha, /0\.9em/);
    // sizing pattern: measure first, pad after
    assert.match(mt.pattern, /width ≥ widthPx \+ padding/);
    // fontFamily is the required token param, resolved against loaded fonts
    assert.match(mt.params, /fontFamily REQUIRED/);
  });

  test('documents renderer dash derivation — no custom dasharray (issue #40)', async () => {
    // values stay the enum (same source of truth as validators)
    const { STROKE_STYLES } = await import('../src/validate.js');
    assert.deepEqual(ref.arrowStrokeStyles.values, STROKE_STYLES);
    // the renderer derives the dash from style + strokeWidth — no passthrough exists
    assert.match(ref.arrowStrokeStyles.dashPatterns, /max\(10,\s*2w\)/);
    assert.match(ref.arrowStrokeStyles.dashPatterns, /\+w/);
    assert.match(ref.arrowStrokeStyles.dashPatterns, /0\.5w,\s*2w/);
    assert.match(ref.arrowStrokeStyles.dashPatterns, /no custom dasharray/i);
    // silent-fallback warning: alien values render solid
    assert.match(ref.arrowStrokeStyles.dashPatterns, /solid/i);
    // build pin so future runs can re-verify
    assert.match(ref.arrowStrokeStyles.dashPatterns, /26a4e8fd/);
  });
});
