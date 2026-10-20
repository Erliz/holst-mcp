import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as holst from '../src/holst.js';
import { buildSetZOrderExpr, buildAddSimpleTextExpr } from '../src/eval-scripts.js';
import { runExpr } from './helpers/fake-holst.js';

// Issue #10: z-order control after creation. zIndex is a plain object field
// (creation writes maxZ+1, frames minZ-1); the tool updates it on EXISTING
// objects through the app's own objectsService.update (issue #2 lesson: raw
// style writes leave the mounted view stale until reload) with an in-page raw
// fallback for older builds. placement front/back computes the value in-page
// from the z landscape EXCLUDING the target (bring-to-front of an already
// top object is value-stable; no unbounded drift on repeats).

/** Scripted session: evaluate(expr) pops the next scripted reply (records exprs). */
function scriptedSession(replies) {
  const calls = [];
  return {
    calls,
    evaluate: async (expr) => {
      calls.push(expr);
      const r = replies.length ? replies.shift() : { __error: 'no scripted reply' };
      return r;
    },
  };
}

describe('setZOrderWithSession (issue #10: after-creation z control)', () => {
  test('zIndex or placement — exactly one is required', async () => {
    for (const bad of [{}, { zIndex: 5, placement: 'front' }]) {
      const s = scriptedSession([]);
      await assert.rejects(
        () => holst.setZOrderWithSession(s, 't1', bad),
        /exactly one of zIndex/
      );
      assert.equal(s.calls.length, 0, 'validation must fail before any evaluate');
    }
  });

  test('placement must be front or back', async () => {
    const s = scriptedSession([]);
    await assert.rejects(
      () => holst.setZOrderWithSession(s, 't1', { placement: 'middle' }),
      /placement/
    );
    assert.equal(s.calls.length, 0);
  });

  test('zIndex keeps the batch range -1e7..1e7', async () => {
    for (const bad of [2e7, -2e7]) {
      const s = scriptedSession([]);
      await assert.rejects(
        () => holst.setZOrderWithSession(s, 't1', { zIndex: bad }),
        /zIndex/
      );
      assert.equal(s.calls.length, 0);
    }
  });

  test('non-numeric zIndex is rejected', async () => {
    const s = scriptedSession([]);
    await assert.rejects(
      () => holst.setZOrderWithSession(s, 't1', { zIndex: 'top' }),
      /zIndex/
    );
    assert.equal(s.calls.length, 0);
  });

  test('absolute zIndex: one page pass, literal embedded, native result returned', async () => {
    const s = scriptedSession([
      'shape',
      { ok: true, native: true, zIndex: 42, converged: true },
    ]);
    const res = await holst.setZOrderWithSession(s, 't1', { zIndex: 42 });
    assert.deepEqual(res, { ok: true, native: true, zIndex: 42, converged: true });
    assert.equal(s.calls.length, 2, 'kind probe + one combined z expr');
    assert.match(s.calls[1], /svc\.update/, 'write goes through objectsService.update');
    assert.match(s.calls[1], /"zIndex":42/, 'absolute value travels JSON-embedded');
  });

  test('placement front rides the same single expr', async () => {
    const s = scriptedSession([
      'shape',
      { ok: true, native: true, zIndex: 11, converged: true },
    ]);
    const res = await holst.setZOrderWithSession(s, 't1', { placement: 'front' });
    assert.equal(res.zIndex, 11);
    assert.equal(s.calls.length, 2);
    assert.match(s.calls[1], /"placement":"front"/, 'placement travels in the spec');
  });

  test('older build (native missing) still returns the raw-write result', async () => {
    const s = scriptedSession([
      'shape',
      { ok: true, native: false, zIndex: -4 },
    ]);
    const res = await holst.setZOrderWithSession(s, 't1', { placement: 'back' });
    assert.equal(res.ok, true);
    assert.equal(res.native, false);
    assert.equal(res.zIndex, -4);
    assert.equal(s.calls.length, 2, 'fallback lives INSIDE the page expr — no extra evals');
  });

  test('object not found surfaces from the kind probe', async () => {
    const s = scriptedSession([
      { __error: 'object not found: t1 (yDoc stayed empty for probes)' },
    ]);
    await assert.rejects(
      () => holst.setZOrderWithSession(s, 't1', { zIndex: 1 }),
      /object not found: t1/
    );
    assert.equal(s.calls.length, 1, 'no write may happen after the probe failed');
  });

  test('expr errors propagate', async () => {
    const s = scriptedSession(['shape', { __error: 'boom' }]);
    await assert.rejects(
      () => holst.setZOrderWithSession(s, 't1', { placement: 'front' }),
      /boom/
    );
  });
});

describe('L2: buildSetZOrderExpr against fake ds', () => {
  test('absolute zIndex lands via objectsService.update and converges', async () => {
    const st = await runExpr(buildAddSimpleTextExpr({ x: 0, y: 0 }));
    const obj = st.objectsList()[0];
    const st2 = await runExpr(buildSetZOrderExpr(obj.id, { zIndex: 42 }), st);
    assert.deepEqual(st2.svcCalls.at(-1).patch, { zIndex: 42 });
    assert.equal(st2.objectsList()[0].fields.zIndex, 42);
    assert.equal(st2.result.ok, true);
    assert.equal(st2.result.native, true);
    assert.equal(st2.result.converged, true);
  });

  test('front = max z of OTHERS + 1 (target excluded from the scan)', async () => {
    const st0 = await runExpr(buildAddSimpleTextExpr({ x: 0, y: 0 }));
    const st1 = await runExpr(buildAddSimpleTextExpr({ x: 10, y: 0 }), st0);
    const st2 = await runExpr(buildAddSimpleTextExpr({ x: 20, y: 0 }), st1);
    const [a, b, c] = st2.objectsList();
    // creation stack: a=1, b=2, c=3
    const st3 = await runExpr(buildSetZOrderExpr(a.id, { placement: 'front' }), st2);
    assert.equal(st3.result.zIndex, 4, 'others are b(2), c(3) → front = othersMax+1 = 4');
    assert.equal(st3.objectsList()[0].fields.zIndex, 4);
  });

  test('back = min z of OTHERS - 1 (below everything)', async () => {
    const st0 = await runExpr(buildAddSimpleTextExpr({ x: 0, y: 0 }));
    const st1 = await runExpr(buildAddSimpleTextExpr({ x: 10, y: 0 }), st0);
    const st2 = await runExpr(buildAddSimpleTextExpr({ x: 20, y: 0 }), st1);
    const [a, b, c] = st2.objectsList();
    const st3 = await runExpr(buildSetZOrderExpr(c.id, { placement: 'back' }), st2);
    assert.equal(st3.result.zIndex, 0, 'othersMin(1) - 1 = 0');
    assert.equal(st3.objectsList()[2].fields.zIndex, 0);
  });

  test('raw fallback when objectsService is missing (older build)', async () => {
    const st = await runExpr(buildAddSimpleTextExpr({ x: 0, y: 0 }));
    const obj = st.objectsList()[0];
    const svcBefore = st.svcCalls.length;
    st.window.ds.store.objectBuilder.getApp = () => null;
    const st2 = await runExpr(buildSetZOrderExpr(obj.id, { zIndex: -7 }), st);
    assert.equal(st2.result.ok, true);
    assert.equal(st2.result.native, false);
    assert.equal(st2.svcCalls.length, svcBefore, 'no service call may be recorded');
    assert.equal(st2.objectsList()[0].fields.zIndex, -7, 'raw write landed');
  });

  test('generated expr compiles as page JS (no unresolved placeholders)', async () => {
    for (const opts of [{ zIndex: 5 }, { placement: 'front' }, { placement: 'back' }]) {
      const src = buildSetZOrderExpr('t1', opts);
      assert.equal(src.includes('${'), false, 'unresolved placeholder left in expr');
      assert.doesNotThrow(() => new Function(src), `expr must parse: ${opts}`);
    }
  });
});
