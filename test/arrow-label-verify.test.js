import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { verifyArrowLabelsWithHeal } from '../src/holst.js';

// Unit tests for the issue #3 verify+heal pass: a stub session stands in for
// the CDP session (same pattern as screenshot.test.js). Real expr semantics
// are covered by fake-ds tests; here we test the ORCHESTRATION:
// verify → heal via updateArrowText → re-verify → ok/fail/unknown.

/** Scripted session: evaluate(expr) pops the next scripted reply. */
function scriptedSession(replies) {
  const calls = [];
  const session = {
    calls,
    evaluate: async (expr) => {
      calls.push(expr);
      const r = replies.length ? replies.shift() : { __error: 'no scripted reply' };
      if (r === 'THROW') throw new Error('cdp gone');
      return r;
    },
  };
  return session;
}

// Identify which expr is which by content (same builders the code uses).
const isVerifyExpr = (e) => e.includes('getTextOnArrowString');
const isNativeHealExpr = (e) => e.includes('objectsService');
const isRawHealExpr = (e) => e.includes(".set('texts'");

describe('verifyArrowLabelsWithHeal (issue #3 orchestration)', () => {
  test('all labels mounted: ok, no heal round-trips', async () => {
    const s = scriptedSession([{ 'a1': { str: 'link' } }]);
    const res = await verifyArrowLabelsWithHeal(s, [{ id: 'a1', text: 'link' }], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'ok' });
    assert.equal(s.calls.filter(isVerifyExpr).length, 1);
    assert.equal(s.calls.filter(isRawHealExpr).length, 0);
  });

  test('newline-insensitive match passes (paragraph mirror)', async () => {
    const s = scriptedSession([{ 'a1': { str: 'ab' } }]);
    const res = await verifyArrowLabelsWithHeal(s, [{ id: 'a1', text: 'a\nb' }], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'ok' });
  });

  test('label missing in render layer: heals via rewrite, then trusts yDoc if API gone', async () => {
    // 1st verify: render API present but empty; native path unavailable (older
    // build); heal: raw yDoc write ok; 2nd verify: apiMissing → trust
    const s = scriptedSession([
      { 'a1': { str: '' } },                       // verify #1 → fail
      { native: false },                           // native heal expr → older build
      { ok: true, native: false, arrow: true, id: 'a1', text: 'link', labels: 1 }, // raw write ok
      { 'a1': { apiMissing: true } },              // verify #2 → trust yDoc
    ]);
    const res = await verifyArrowLabelsWithHeal(s, [{ id: 'a1', text: 'link' }], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'ok' });
    assert.equal(s.calls.filter(isNativeHealExpr).length, 1);
    assert.equal(s.calls.filter(isRawHealExpr).length, 1);
  });

  test('heal goes through the app update path when available (issue #7: repaint)', async () => {
    // verify #1: render empty; heal via objectsService.update: converged;
    // verify #2: the mounted render layer now shows the label.
    const s = scriptedSession([
      { 'a1': { str: '' } },                       // verify #1 → fail
      { ok: true, native: true, arrow: true, id: 'a1', text: 'link', labels: 1, converged: true },
      { 'a1': { str: 'link' } },                   // verify #2 → ok
    ]);
    const res = await verifyArrowLabelsWithHeal(s, [{ id: 'a1', text: 'link' }], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'ok' });
    assert.equal(s.calls.filter(isNativeHealExpr).length, 1);
    assert.equal(s.calls.filter(isRawHealExpr).length, 0, 'no raw write when the service path converges');
  });

  test('native path paints but yDoc persist lags: raw write guarantees the data', async () => {
    const s = scriptedSession([
      { 'a1': { str: '' } },                       // verify #1 → fail
      { ok: true, native: true, arrow: true, id: 'a1', text: 'link', labels: 1, converged: false },
      { ok: true, native: false, arrow: true, id: 'a1', text: 'link', labels: 1 }, // raw follow-up
      { 'a1': { str: 'link' } },                   // verify #2 → ok
    ]);
    const res = await verifyArrowLabelsWithHeal(s, [{ id: 'a1', text: 'link' }], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'ok' });
    assert.equal(s.calls.filter(isNativeHealExpr).length, 1);
    assert.equal(s.calls.filter(isRawHealExpr).length, 1);
  });

  test('native expr errors (unmounted arrow): falls back to the raw write', async () => {
    const s = scriptedSession([
      { 'a1': { str: '' } },                       // verify #1 → fail
      { __error: 'service update threw' },         // native heal → error → fallback
      { ok: true, native: false, arrow: true, id: 'a1', text: 'link', labels: 1 }, // raw write ok
      { 'a1': { str: 'link' } },                   // verify #2 → ok
    ]);
    const res = await verifyArrowLabelsWithHeal(s, [{ id: 'a1', text: 'link' }], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'ok' });
    assert.equal(s.calls.filter(isNativeHealExpr).length, 1);
    assert.equal(s.calls.filter(isRawHealExpr).length, 1);
  });

  test('heal write fails: arrow reports fail (the textFailedRefs signal)', async () => {
    const s = scriptedSession([
      { 'a1': { str: '' } },          // verify → fail
      { __error: 'boom' },            // native heal → error
      { __error: 'object not found' }, // raw write → throws
    ]);
    const res = await verifyArrowLabelsWithHeal(s, [{ id: 'a1', text: 'link' }], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'fail' });
  });

  test('heal lands but render API still disagrees: fail', async () => {
    const s = scriptedSession([
      { 'a1': { str: '' } },           // verify #1 → fail
      { native: false },               // older build → raw heal
      { ok: true, native: false, arrow: true, id: 'a1', text: 'link', labels: 1 }, // heal ok
      { 'a1': { str: 'other' } },      // verify #2 → still wrong
    ]);
    const res = await verifyArrowLabelsWithHeal(s, [{ id: 'a1', text: 'link' }], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'fail' });
  });

  test('render API throws: fail (heal attempted)', async () => {
    const s = scriptedSession([
      { 'a1': { error: 'boom' } },     // verify #1 → fail
      { ok: true, native: true, arrow: true, id: 'a1', text: 'link', labels: 1, converged: true },
      { 'a1': { str: 'link' } },       // verify #2 → ok
    ]);
    const res = await verifyArrowLabelsWithHeal(s, [{ id: 'a1', text: 'link' }], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'ok' });
  });

  test('app build without the API: unknown (fail-open), no heal', async () => {
    const s = scriptedSession([{ 'a1': { apiMissing: true } }]);
    const res = await verifyArrowLabelsWithHeal(s, [{ id: 'a1', text: 'link' }], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'unknown' });
    assert.equal(s.calls.length, 1);
  });

  test('domain object missing: unknown (mount-check owns that signal)', async () => {
    const s = scriptedSession([{ 'a1': { missing: true } }]);
    const res = await verifyArrowLabelsWithHeal(s, [{ id: 'a1', text: 'link' }], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'unknown' });
    assert.equal(s.calls.length, 1);
  });

  test('mixed batch: per-arrow states independent', async () => {
    const s = scriptedSession([
      { 'a1': { str: 'one' }, 'a2': { str: '' }, 'a3': { apiMissing: true } },
      { native: false }, // native heal for a2 → older build
      { ok: true, native: false, arrow: true, id: 'a2', text: 'two', labels: 1 }, // raw heal a2
      { 'a2': { str: 'two' } }, // re-verify a2
    ]);
    const res = await verifyArrowLabelsWithHeal(s, [
      { id: 'a1', text: 'one' }, { id: 'a2', text: 'two' }, { id: 'a3', text: 'three' },
    ], { healDelayMs: 0 });
    assert.deepEqual(res, { a1: 'ok', a2: 'ok', a3: 'unknown' });
  });

  test('empty job list: no session traffic', async () => {
    const s = scriptedSession([]);
    const res = await verifyArrowLabelsWithHeal(s, [], { healDelayMs: 0 });
    assert.deepEqual(res, {});
    assert.equal(s.calls.length, 0);
  });
});
