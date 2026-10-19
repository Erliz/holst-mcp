import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runExpr } from './helpers/fake-holst.js';
import { buildDeleteObjectsExpr, buildBatchCreationExpr } from '../src/eval-scripts.js';
import {
  deleteObjectsWithSession,
  DELETE_CHUNK_SIZE,
  DELETE_CHUNK_BASE_TIMEOUT_MS,
  DELETE_CHUNK_PER_ID_MS,
} from '../src/holst.js';

describe('L2: batch delete semantics', () => {
  test('already-gone id reports ok:true + alreadyGone (cascade deletes are not failures)', async () => {
    const state = await runExpr(buildDeleteObjectsExpr(['gone-with-the-wind']));
    const res = state.result;
    assert.equal(res.ok, true);
    assert.deepEqual(res.report['gone-with-the-wind'], { ok: true, alreadyGone: true });
    // Counts (deleted/alreadyGone/failed) are computed by the orchestration
    // layer from the merged report — the expr returns per-id facts only.
    assert.equal(res.deleted, undefined);
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
    assert.deepEqual(res.report[id], { ok: true, alreadyGone: false });
    assert.equal(state.objectsList().length, 0);
  });
});

// L1 orchestration (issue #5): chunked evaluates with a scaled per-chunk CDP
// timeout, counts merged across chunks. Stub session answers delete exprs
// the way the real page would (per-chunk { ok, report }).
function makeDeleteSession({ alreadyGone = [], failIds = [], errorOnCall } = {}) {
  const calls = [];
  const session = {
    async evaluate(expr, options = {}) {
      const ids = JSON.parse(expr.match(/const ids = (\[[\s\S]*?\]);/)[1]);
      calls.push({ ids, options });
      if (errorOnCall === calls.length) return { __error: 'in-page blowup' };
      const report = {};
      for (const id of ids) {
        if (failIds.includes(id)) report[id] = { ok: false, error: 'still present after remove' };
        else report[id] = { ok: true, alreadyGone: alreadyGone.includes(id) };
      }
      return { ok: Object.values(report).every((r) => r.ok), report };
    },
  };
  return { session, calls };
}

describe('L1: chunked delete orchestration (issue #5)', () => {
  const uuid = (i) => `0000000a-0000-4000-8000-0000000${String(10000 + i)}`;
  const ids = (n) => Array.from({ length: n }, (_, i) => uuid(i));

  test(`batches larger than ${DELETE_CHUNK_SIZE} ids split into chunks, each evaluate gets a scaled timeout`, async () => {
    const all = ids(DELETE_CHUNK_SIZE * 2 + 5);
    const { session, calls } = makeDeleteSession();
    const r = await deleteObjectsWithSession(session, all);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((c) => c.ids.length), [DELETE_CHUNK_SIZE, DELETE_CHUNK_SIZE, 5]);
    for (const c of calls) {
      assert.equal(c.options.awaitPromise, true);
      assert.equal(c.options.timeoutMs, DELETE_CHUNK_BASE_TIMEOUT_MS + DELETE_CHUNK_PER_ID_MS * c.ids.length);
    }
    // no id lost or duplicated across chunks
    assert.deepEqual(calls.flatMap((c) => c.ids), all);
    assert.equal(r.ok, true);
    assert.equal(r.deleted, all.length);
    assert.equal(r.alreadyGone, 0);
    assert.equal(r.failed, 0);
    assert.equal(Object.keys(r.report).length, all.length);
  });

  test(`batch of up to ${DELETE_CHUNK_SIZE} ids is a single evaluate`, async () => {
    const all = ids(DELETE_CHUNK_SIZE);
    const { session, calls } = makeDeleteSession();
    const r = await deleteObjectsWithSession(session, all);
    assert.equal(calls.length, 1);
    assert.equal(r.deleted, DELETE_CHUNK_SIZE);
  });

  test('stale ids count as alreadyGone, not deleted (misleading "deleted: 12/12" fix)', async () => {
    const all = ids(12);
    const stale = all.slice(0, 5);
    const { session } = makeDeleteSession({ alreadyGone: stale });
    const r = await deleteObjectsWithSession(session, all);
    assert.equal(r.ok, true);
    assert.equal(r.deleted, 7);
    assert.equal(r.alreadyGone, 5);
    assert.equal(r.failed, 0);
  });

  test('per-id failures aggregate: ok:false, failed counted, error kept in report', async () => {
    const all = ids(DELETE_CHUNK_SIZE + 2);
    const bad = [all[3], all[DELETE_CHUNK_SIZE + 1]];
    const { session } = makeDeleteSession({ failIds: bad });
    const r = await deleteObjectsWithSession(session, all);
    assert.equal(r.ok, false);
    assert.equal(r.deleted, all.length - 2);
    assert.equal(r.failed, 2);
    assert.deepEqual(r.report[all[3]], { ok: false, error: 'still present after remove' });
  });

  test('a chunk-level __error still throws (no silent swallowing)', async () => {
    const { session } = makeDeleteSession({ errorOnCall: 2 });
    await assert.rejects(
      () => deleteObjectsWithSession(session, ids(DELETE_CHUNK_SIZE * 2)),
      /in-page blowup/
    );
  });
});
