import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Issue #42: labelSide screen-side semantics and the anchor it maps to.
// Screen-side contract (owner-approved, fixture-verified on the live board):
//   'right' = the label offsets toward +x (east) of the segment;
//   for horizontal segments (offset purely ±y) 'right' = below (+y),
//   'left' = above (−y). The app model stores the side as `anchor`:
//   0 = on the line (hole-masked), +1 = renderer-normal side, −1 = opposite.
// Renderer normal of travel direction (x,y) is (y,−x) — verified from
// computeTextCenterByAnchorNotRotated + the owner's test-frame fixtures:
// a down-going vertical (0,1) with anchor 1 renders at +x ("ritght").

import { labelSideToAnchor, buildArrowTexts } from '../src/arrow-text.js';
import { assertLabelSide, ValidationError } from '../src/validate.js';
import { buildBatchPlan } from '../src/batch.js';
import { runExpr } from './helpers/fake-holst.js';
import {
  buildBatchCreationExpr, buildBatchArrowsExpr, buildNativeArrowTextExpr,
  buildArrowLabelAnchorsExpr, buildSetArrowTextAnchorExpr,
} from '../src/eval-scripts.js';
import { updateArrowText } from '../src/holst.js';

describe('labelSideToAnchor (screen-side → model anchor)', () => {
  test('down-going vertical: right → +1, left → −1 (owner fixture parity)', () => {
    assert.equal(labelSideToAnchor(0, 1, 'right'), 1);
    assert.equal(labelSideToAnchor(0, 1, 'left'), -1);
  });

  test('up-going vertical: right still renders at +x → −1, left → +1', () => {
    assert.equal(labelSideToAnchor(0, -1, 'right'), -1);
    assert.equal(labelSideToAnchor(0, -1, 'left'), 1);
  });

  test('horizontal segment: right = below, left = above — both travel directions', () => {
    // d=(1,0): normal (0,−1) = up → below is the −1 side
    assert.equal(labelSideToAnchor(1, 0, 'right'), -1);
    assert.equal(labelSideToAnchor(1, 0, 'left'), 1);
    // d=(−1,0): normal (0,1) = below → below is the +1 side (sign flips, side doesn't)
    assert.equal(labelSideToAnchor(-1, 0, 'right'), 1);
    assert.equal(labelSideToAnchor(-1, 0, 'left'), -1);
  });

  test('diagonal: side with the greater x-offset wins lexicographically', () => {
    // d=(1,1)/√2 → anchor +1 offsets toward (0.707, −0.707) = +x side → right
    assert.equal(labelSideToAnchor(1, 1, 'right'), 1);
    assert.equal(labelSideToAnchor(1, 1, 'left'), -1);
  });

  test("'on' and undefined map to 0 (no anchor key written)", () => {
    assert.equal(labelSideToAnchor(0, 1, 'on'), 0);
    assert.equal(labelSideToAnchor(3, -4, undefined), 0);
  });

  test('vectors need not be normalized', () => {
    assert.equal(labelSideToAnchor(0, 87.3, 'right'), 1);
    assert.equal(labelSideToAnchor(0.02, 0.9998, 'right'), 1);
  });

  test('degenerate zero direction behaves like left-to-right horizontal', () => {
    assert.equal(labelSideToAnchor(0, 0, 'right'), -1);
    assert.equal(labelSideToAnchor(0, 0, 'left'), 1);
  });

  test('unknown side throws', () => {
    assert.throws(() => labelSideToAnchor(0, 1, 'top'), ValidationError);
    assert.throws(() => labelSideToAnchor(0, 1, 'RIGHT'), ValidationError);
  });
});

describe('assertLabelSide (tool input validation)', () => {
  test('accepts on | left | right, defaults to on', () => {
    assert.equal(assertLabelSide('on', 'labelSide'), 'on');
    assert.equal(assertLabelSide('left', 'labelSide'), 'left');
    assert.equal(assertLabelSide('right', 'labelSide'), 'right');
    assert.equal(assertLabelSide(undefined, 'labelSide', { default: 'on' }), 'on');
  });

  test('rejects anything else', () => {
    assert.throws(() => assertLabelSide('top', 'labelSide'), ValidationError);
    assert.throws(() => assertLabelSide(1, 'labelSide'), ValidationError);
    assert.throws(() => assertLabelSide(null, 'labelSide'), ValidationError);
  });

  test('required without default', () => {
    assert.throws(() => assertLabelSide(undefined, 'labelSide'), ValidationError);
  });
});

describe('buildBatchPlan: arrow labelSide / textRotated', () => {
  const base = { kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 0, y: 100 } };

  test('defaults: labelSide on, no textRotated field', () => {
    const plan = buildBatchPlan([{ ...base, text: 'x' }]);
    assert.equal(plan.arrows[0].labelSide, 'on');
    assert.equal(plan.arrows[0].textRotated, undefined);
  });

  test('labelSide and textRotated pass through validated', () => {
    const plan = buildBatchPlan([{ ...base, text: 'x', labelSide: 'right', textRotated: true }]);
    assert.equal(plan.arrows[0].labelSide, 'right');
    assert.equal(plan.arrows[0].textRotated, true);
  });

  test('bad labelSide rejected', () => {
    assert.throws(() => buildBatchPlan([{ ...base, text: 'x', labelSide: 'top' }]), ValidationError);
  });

  test('textRotated coerces to boolean (repo convention for flags)', () => {
    const plan = buildBatchPlan([{ ...base, text: 'x', textRotated: 'yes' }]);
    assert.equal(plan.arrows[0].textRotated, true);
    const plan2 = buildBatchPlan([{ ...base, text: 'x', textRotated: 0 }]);
    assert.equal(plan2.arrows[0].textRotated, false);
  });
});

// ---- L2: real exprs against the fake ds (same pattern as fake-ds.test.js) --

const makeLabeledArrow = async ({ textPosition = 0.25 } = {}) => {
  let state = await runExpr(buildBatchCreationExpr([{
    kind: 'shape', ref: 'n1', x: 0, y: 0, width: 50, height: 50, shapeType: 'square',
    fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 },
    strokeWidth: 2, fixedSize: true, hasDocument: false,
  }]));
  const byIndex = state.byIndex();
  state = await runExpr(buildBatchArrowsExpr(byIndex, [{
    arrowType: 'straight', strokeColor: 0x2e5aa8, strokeStyle: 'solid',
    text: 'link', textPosition,
    from: { refIndex: 0 }, to: { point: { x: 100, y: 100 } },
  }], false), state);
  const arrow = state.objectsList().find((o) => o.fields.type === 'arrow');
  return { state, arrowId: arrow.id, arrow };
};

/** Session adapter: executes exprs through the fake ds, like CDP would. */
const fakeSession = (state) => ({
  evaluate: async (expr, opts) => {
    const s = await runExpr(expr, state);
    return s.result;
  },
});

describe('L2: buildArrowLabelAnchorsExpr (read fulcrum + stored anchor)', () => {
  test('returns renderer fulcrumVector and yDoc anchor for the first label', async () => {
    const { state, arrowId, arrow } = await makeLabeledArrow();
    arrow.fields.texts[0].anchor = 1;
    state.window.ds.store.objects.get(arrowId).textsOnArrow = [
      { fulcrumVector: { x: 0.015, y: 0.999 } },
    ];
    const st = await runExpr(buildArrowLabelAnchorsExpr([arrowId]), state);
    assert.deepEqual(st.result[arrowId], { fv: { x: 0.015, y: 0.999 }, storedAnchor: 1, noLabel: false });
  });

  test('storedAnchor null when the entry carries no anchor key', async () => {
    const { state, arrowId } = await makeLabeledArrow();
    state.window.ds.store.objects.get(arrowId).textsOnArrow = [
      { fulcrumVector: { x: 0, y: -1 } },
    ];
    const st = await runExpr(buildArrowLabelAnchorsExpr([arrowId]), state);
    assert.equal(st.result[arrowId].storedAnchor, null);
  });

  test('missing arrow → { missing: true }', async () => {
    const { state } = await makeLabeledArrow();
    const st = await runExpr(buildArrowLabelAnchorsExpr(['no-such-id']), state);
    assert.deepEqual(st.result['no-such-id'], { missing: true });
  });

  test('arrow without label → { noLabel: true }', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'shape', ref: 'n1', x: 0, y: 0, width: 50, height: 50, shapeType: 'square',
      fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 },
      strokeWidth: 2, fixedSize: true, hasDocument: false,
    }]));
    state = await runExpr(buildBatchArrowsExpr(state.byIndex(), [{
      arrowType: 'straight', strokeColor: 0x2e5aa8, strokeStyle: 'solid',
      from: { refIndex: 0 }, to: { point: { x: 100, y: 100 } },
    }], false), state);
    const arrow = state.objectsList().find((o) => o.fields.type === 'arrow');
    const st = await runExpr(buildArrowLabelAnchorsExpr([arrow.id]), state);
    assert.equal(st.result[arrow.id].noLabel, true);
    assert.equal(st.result[arrow.id].fv, null);
  });
});

describe('L2: buildSetArrowTextAnchorExpr (anchor write)', () => {
  test('native path: sets anchor on the first entry, preserves id/text/position/editor + rest', async () => {
    const { state, arrowId, arrow } = await makeLabeledArrow();
    const before = JSON.parse(JSON.stringify(arrow.fields.texts[0]));
    arrow.fields.texts.push({ position: 0.8, id: 'second-id', text: 'second', editor: [] });
    state.svcCalls.length = 0;
    const st = await runExpr(buildSetArrowTextAnchorExpr(arrowId, -1, { persistDeadlineMs: 50 }), state);
    assert.equal(st.result.ok, true);
    assert.equal(st.result.converged, true);
    assert.equal(state.svcCalls.length, 1);
    const texts = state.svcCalls[0].patch.texts;
    assert.equal(texts.length, 2);
    assert.equal(texts[0].anchor, -1);
    assert.equal(texts[0].id, before.id);
    assert.equal(texts[0].text, before.text);
    assert.equal(texts[0].position, before.position);
    assert.deepEqual(texts[0].editor, before.editor);
    assert.equal(texts[1].id, 'second-id');
    // yDoc view converged too
    assert.equal(state.objectsList().find((o) => o.id === arrowId).fields.texts[0].anchor, -1);
  });

  test('raw fallback when the service is missing: anchor still lands', async () => {
    const { state, arrowId } = await makeLabeledArrow();
    const realGetApp = state.window.ds.store.objectBuilder.getApp;
    state.window.ds.store.objectBuilder.getApp = () => ({});
    try {
      const st = await runExpr(buildSetArrowTextAnchorExpr(arrowId, 1, { persistDeadlineMs: 50 }), state);
      assert.equal(st.result.ok, true);
      assert.equal(st.result.converged, true);
      assert.equal(state.objectsList().find((o) => o.id === arrowId).fields.texts[0].anchor, 1);
    } finally {
      state.window.ds.store.objectBuilder.getApp = realGetApp;
    }
  });

  test('no label → __error', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'shape', ref: 'n1', x: 0, y: 0, width: 50, height: 50, shapeType: 'square',
      fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 },
      strokeWidth: 2, fixedSize: true, hasDocument: false,
    }]));
    state = await runExpr(buildBatchArrowsExpr(state.byIndex(), [{
      arrowType: 'straight', strokeColor: 0x2e5aa8, strokeStyle: 'solid',
      from: { refIndex: 0 }, to: { point: { x: 100, y: 100 } },
    }], false), state);
    const arrow = state.objectsList().find((o) => o.fields.type === 'arrow');
    const st = await runExpr(buildSetArrowTextAnchorExpr(arrow.id, 1), state);
    assert.ok(String(st.result.__error).includes('no label'));
  });
});

describe('L2: batch arrows carry textRotated (issue #42)', () => {
  test('textRotated rides the arrow object fields', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'shape', ref: 'n1', x: 0, y: 0, width: 50, height: 50, shapeType: 'square',
      fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 },
      strokeWidth: 2, fixedSize: true, hasDocument: false,
    }]));
    state = await runExpr(buildBatchArrowsExpr(state.byIndex(), [{
      arrowType: 'straight', strokeColor: 0x2e5aa8, strokeStyle: 'solid',
      text: 'link', textPosition: 0.5, textRotated: true,
      from: { refIndex: 0 }, to: { point: { x: 100, y: 100 } },
    }], false), state);
    const arrow = state.objectsList().find((o) => o.fields.type === 'arrow');
    assert.equal(arrow.fields.textRotated, true);
  });
});

describe('L2: updateArrowText preserves anchor from the previous entry', () => {
  test('native path keeps anchor −1 and position across the rewrite', async () => {
    const { state, arrowId, arrow } = await makeLabeledArrow({ textPosition: 0.25 });
    arrow.fields.texts[0].anchor = -1;
    const st = await runExpr(buildNativeArrowTextExpr(arrowId, buildArrowTexts('renamed', 0.5)[0], { persistDeadlineMs: 50 }), state);
    assert.equal(st.result.ok, true);
    const stored = state.objectsList().find((o) => o.id === arrowId).fields.texts[0];
    assert.equal(stored.text, 'renamed');
    assert.equal(stored.position, 0.25, 'position re-derived from previous label');
    assert.equal(stored.anchor, -1, 'anchor preserved from previous label');
  });

  test('raw fallback keeps anchor across the rewrite', async () => {
    const { state, arrowId, arrow } = await makeLabeledArrow({ textPosition: 0.25 });
    arrow.fields.texts[0].anchor = 1;
    const realGetApp = state.window.ds.store.objectBuilder.getApp;
    state.window.ds.store.objectBuilder.getApp = () => ({});
    try {
      const res = await updateArrowText(fakeSession(state), arrowId, 'renamed');
      assert.equal(res.ok, true);
      const stored = state.objectsList().find((o) => o.id === arrowId).fields.texts[0];
      assert.equal(stored.text, 'renamed');
      assert.equal(stored.position, 0.25);
      assert.equal(stored.anchor, 1, 'raw fallback preserves anchor too');
    } finally {
      state.window.ds.store.objectBuilder.getApp = realGetApp;
    }
  });
});

// ---- orchestration: applyArrowLabelSides (stub session, issue #3 pattern) ---

import { applyArrowLabelSides } from '../src/holst.js';

function scriptedSession(replies) {
  const calls = [];
  return {
    calls,
    evaluate: async (expr) => {
      calls.push(expr);
      const r = replies.length ? replies.shift() : { __error: 'no scripted reply' };
      if (r === 'THROW') throw new Error('cdp gone');
      return r;
    },
  };
}
const isAnchorsExpr = (e) => e.includes('fulcrumVector');
const isSetAnchorExpr = (e) => e.includes('has no label') && e.includes('anchor');

describe('applyArrowLabelSides (orchestration)', () => {
  test('stored anchor already matches the resolved side: ok, no write', async () => {
    const s = scriptedSession([
      { a1: { fv: { x: 0, y: 1 }, storedAnchor: 1, noLabel: false } }, // down + right → +1
    ]);
    const res = await applyArrowLabelSides(s, [{ id: 'a1', labelSide: 'right' }], { settleMs: 0 });
    assert.deepEqual(res, { a1: 'ok' });
    assert.equal(s.calls.filter(isSetAnchorExpr).length, 0);
    assert.equal(s.calls.filter(isAnchorsExpr).length, 1);
  });

  test('flip needed: writes the resolved anchor via the setter expr', async () => {
    const s = scriptedSession([
      { a1: { fv: { x: 0, y: 1 }, storedAnchor: null, noLabel: false } },
      { ok: true, arrow: true, id: 'a1', anchor: 1, labels: 1, converged: true },
    ]);
    const res = await applyArrowLabelSides(s, [{ id: 'a1', labelSide: 'right' }], { settleMs: 0 });
    assert.deepEqual(res, { a1: 'ok' });
    assert.equal(s.calls.filter(isSetAnchorExpr).length, 1);
    assert.ok(s.calls.find(isSetAnchorExpr).includes('anchor: 1'), 'writes the computed anchor');
  });

  test('mount lag: fulcrum missing at first, settles on retry', async () => {
    const s = scriptedSession([
      { a1: { fv: null, storedAnchor: null, noLabel: false } },  // label not mounted yet
      { a1: { fv: { x: 0, y: -1 }, storedAnchor: null, noLabel: false } }, // settled (up → right = −1)
      { ok: true, arrow: true, id: 'a1', anchor: -1, labels: 1, converged: true },
    ]);
    const res = await applyArrowLabelSides(s, [{ id: 'a1', labelSide: 'right' }], { settleMs: 0 });
    assert.deepEqual(res, { a1: 'ok' });
    assert.equal(s.calls.filter(isAnchorsExpr).length, 2);
    assert.ok(s.calls.find(isSetAnchorExpr).includes('anchor: -1'));
  });

  test('fulcrum never appears: unknown after bounded retries, no write', async () => {
    const s = scriptedSession([
      { a1: { fv: null, storedAnchor: null, noLabel: false } },
      { a1: { fv: null, storedAnchor: null, noLabel: false } },
      { a1: { fv: null, storedAnchor: null, noLabel: false } },
    ]);
    const res = await applyArrowLabelSides(s, [{ id: 'a1', labelSide: 'left' }], { settleMs: 0 });
    assert.deepEqual(res, { a1: 'unknown' });
    assert.equal(s.calls.filter(isSetAnchorExpr).length, 0);
    assert.equal(s.calls.filter(isAnchorsExpr).length, 3, 'bounded retry');
  });

  test('no label at all: unknown', async () => {
    const s = scriptedSession([
      { a1: { fv: null, storedAnchor: null, noLabel: true } },
      { a1: { fv: null, storedAnchor: null, noLabel: true } },
      { a1: { fv: null, storedAnchor: null, noLabel: true } },
    ]);
    const res = await applyArrowLabelSides(s, [{ id: 'a1', labelSide: 'right' }], { settleMs: 0 });
    assert.deepEqual(res, { a1: 'unknown' });
  });

  test('setter expr fails: fail', async () => {
    const s = scriptedSession([
      { a1: { fv: { x: 1, y: 0 }, storedAnchor: 0, noLabel: false } },
      { __error: 'object not found' },
    ]);
    const res = await applyArrowLabelSides(s, [{ id: 'a1', labelSide: 'right' }], { settleMs: 0 });
    assert.deepEqual(res, { a1: 'fail' });
  });

  test('missing arrow id: unknown after retries, no write', async () => {
    const s = scriptedSession([
      { a1: { missing: true } },
      { a1: { missing: true } },
      { a1: { missing: true } },
    ]);
    const res = await applyArrowLabelSides(s, [{ id: 'a1', labelSide: 'right' }], { settleMs: 0 });
    assert.deepEqual(res, { a1: 'unknown' });
  });

  test('anchors expr itself errors: unknown for all jobs', async () => {
    const s = scriptedSession([{ __error: 'boom' }]);
    const res = await applyArrowLabelSides(s, [{ id: 'a1', labelSide: 'right' }], { settleMs: 0 });
    assert.deepEqual(res, { a1: 'unknown' });
  });

  test('empty jobs: no session traffic', async () => {
    const s = scriptedSession([]);
    const res = await applyArrowLabelSides(s, []);
    assert.deepEqual(res, {});
    assert.equal(s.calls.length, 0);
  });
});
