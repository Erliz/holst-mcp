import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as holst from '../src/holst.js';
import { buildAddSimpleTextExpr, buildNativeStyleUpdateExpr } from '../src/eval-scripts.js';
import { runExpr } from './helpers/fake-holst.js';

// Issue #9: after-creation width control for simple-text. resizeObject grows
// a kind-aware core (resizeObjectWithSession): simple-text width is the wrap
// boundary — width + fixedWidth through the app's own objectsService.update
// (issue #2: raw style writes leave the mounted view stale until reload),
// raw fallback for older builds; height is auto for simple-text → rejected.
// Other kinds keep the legacy raw width/height path unchanged.

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

describe('resizeObjectWithSession (issue #9: simple-text width)', () => {
  test('simple-text width routes through the native service path', async () => {
    const s = scriptedSession([
      'simple-text',
      { ok: true, native: true, styled: ['width', 'fixedWidth'], converged: true },
    ]);
    const res = await holst.resizeObjectWithSession(s, 't1', { width: 160 });
    assert.equal(res.ok, true);
    assert.equal(res.native, true);
    assert.equal(s.calls.length, 2);
    assert.match(s.calls[1], /svc\.update/, 'width must go through objectsService.update');
    assert.match(s.calls[1], /"width":160/, 'width travels JSON-embedded');
    assert.match(s.calls[1], /"fixedWidth":true/, 'fixedWidth:true rides the same patch');
  });

  test('older build (native missing) falls back to the raw width + fixedWidth write', async () => {
    const s = scriptedSession([
      'simple-text',
      { native: false },
      { ok: true, styled: ['width', 'fixedWidth'] },
    ]);
    const res = await holst.resizeObjectWithSession(s, 't1', { width: 200 });
    assert.equal(res.ok, true);
    assert.equal(res.native, false);
    assert.equal(s.calls.length, 3);
    assert.match(s.calls[2], /"width":200/, 'fallback writes the same fields raw');
    assert.match(s.calls[2], /"fixedWidth":true/);
  });

  test('height is rejected for simple-text before any write', async () => {
    const s = scriptedSession(['simple-text']);
    await assert.rejects(
      () => holst.resizeObjectWithSession(s, 't1', { width: 160, height: 40 }),
      /height is not supported for simple-text/
    );
    assert.equal(s.calls.length, 1, 'no write may happen after the rejection');
  });

  test('width is required for simple-text', async () => {
    const s = scriptedSession(['simple-text']);
    await assert.rejects(
      () => holst.resizeObjectWithSession(s, 't1', {}),
      /width is required for simple-text/
    );
    assert.equal(s.calls.length, 1);
  });

  test('non-numeric width is rejected by validation', async () => {
    const s = scriptedSession(['simple-text']);
    await assert.rejects(
      () => holst.resizeObjectWithSession(s, 't1', { width: 'abc' }),
      /width/
    );
    assert.equal(s.calls.length, 1);
  });

  test('shape keeps the legacy raw width/height path (no native call)', async () => {
    const s = scriptedSession(['shape', { ok: true, id: 's1' }]);
    const res = await holst.resizeObjectWithSession(s, 's1', { width: 300, height: 120 });
    assert.deepEqual(res, { ok: true, id: 's1' });
    assert.equal(s.calls.length, 2);
    assert.match(s.calls[1], /obj\.set\('width', 300\)/);
    assert.match(s.calls[1], /obj\.set\('height', 120\)/);
  });

  test('legacy validation still applies to non-simple-text kinds', async () => {
    const s = scriptedSession(['shape']);
    await assert.rejects(
      () => holst.resizeObjectWithSession(s, 's1', { height: NaN }),
      /height/
    );
    assert.equal(s.calls.length, 1);
  });
});

describe('L2: native simple-text resize expr against fake ds', () => {
  test('the composed native expr lands width + fixedWidth via objectsService.update', async () => {
    const state = await runExpr(buildAddSimpleTextExpr({ x: 0, y: 0 }));
    const obj = state.objectsList()[0];
    assert.equal(obj.fields.type, 'simple-text');
    assert.equal(obj.fields.fixedWidth, undefined, 'auto-width object starts without fixedWidth');

    const st2 = await runExpr(
      buildNativeStyleUpdateExpr(obj.id, { width: 160, fixedWidth: true }),
      state
    );
    assert.deepEqual(
      st2.svcCalls.at(-1).patch,
      { width: 160, fixedWidth: true },
      'svc.update receives the width + fixedWidth patch'
    );
    const f = st2.objectsList()[0].fields;
    assert.equal(f.width, 160);
    assert.equal(f.fixedWidth, true);
    assert.equal(st2.result.native, true);
    assert.equal(st2.result.converged, true, 'debounced yDoc persistence converged');
  });
});
