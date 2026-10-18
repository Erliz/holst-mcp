import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runExpr } from './helpers/fake-holst.js';
import { buildDeleteObjectsExpr, buildBatchCreationExpr } from '../src/eval-scripts.js';

describe('L2: batch delete semantics', () => {
  test('already-gone id reports ok:true + alreadyGone (cascade deletes are not failures)', async () => {
    const state = await runExpr(buildDeleteObjectsExpr(['gone-with-the-wind']));
    const res = state.result;
    assert.equal(res.ok, true);
    assert.equal(res.deleted, 1);
    assert.deepEqual(res.report['gone-with-the-wind'], { ok: true, alreadyGone: true });
  });

  test('existing object is actually removed (raw fallback) and counted', async () => {
    let state = await runExpr(buildBatchCreationExpr([{
      kind: 'stamp', ref: 's', x: 0, y: 0, width: 60, height: 60, stampType: 'textStamp',
      fillColor: { color: 'white3', opacity: 1 }, hasDocument: false, text: 'x',
    }]));
    const id = state.byIndex()[0].id;
    state = await runExpr(buildDeleteObjectsExpr([id]), state);
    const res = state.result;
    assert.equal(res.ok, true);
    assert.equal(res.deleted, 1);
    assert.deepEqual(res.report[id], { ok: true, alreadyGone: false });
    assert.equal(state.objectsList().length, 0);
  });
});
