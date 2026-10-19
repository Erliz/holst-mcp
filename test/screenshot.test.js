import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { screenshotWithSession } from '../src/holst.js';
import { toToolResult } from '../src/tool-result.js';
import { buildCameraFitExpr } from '../src/eval-scripts.js';

// L1 orchestration tests with a stub CDP session (no live board): the stub
// answers the same exprs the real session would, letting us pin the meta
// honesty rules found in review (actual bitmap dims, restore on capture
// failure, cameraRestored semantics).

const CANVAS = { x: 0, y: 40, width: 1512, height: 824 };
const DPR = 2;
const VIEWPORT = { x: 100, y: 100, width: 1620, height: 885 };
const B64 = Buffer.from('fakeimage').toString('base64');

function makeSession({ captureError } = {}) {
  const calls = { evaluate: [], send: [] };
  const session = {
    async evaluate(expr) {
      calls.evaluate.push(expr.slice(0, 40));
      if (expr.includes('canvasRect')) {
        return { canvasRect: CANVAS, dpr: DPR, viewport: VIEWPORT, zoom: 0.9 };
      }
      if (expr.includes('setViewportCenter')) {
        if (expr.includes('setZoomManual(0.9)')) return { ok: true, zoom: 0.9 }; // restore call (literal embedded zoom)
        return { applied: { center: { x: 1, y: 2 }, zoom: 1.2 } }; // fit call
      }
      return { __error: 'unrecognized expr' };
    },
    async send(method, params) {
      calls.send.push({ method, params });
      if (captureError) throw captureError;
      return { data: B64 };
    },
  };
  return { session, calls };
}

describe('screenshotWithSession (stub session)', () => {
  test('no bbox: no camera calls; meta dims = canvasRect × 1 (css) — actual bitmap', async () => {
    const { session, calls } = makeSession();
    const r = await screenshotWithSession(session, {});
    assert.equal(r.ok, true);
    assert.equal(r.cameraMoved, false);    // never moved
    assert.equal(r.cameraRestored, true);  // camera is at its pre-call position (vacuously)
    assert.equal(r.widthPx, 1512);  // NOT 756: CDP emits clip×scale×dpr, css mode = CSS size
    assert.equal(r.heightPx, 824);
    assert.equal(r.format, 'jpeg');
    assert.equal(r.__image.mimeType, 'image/jpeg');
    assert.equal(calls.evaluate.length, 1); // state only
    assert.ok(calls.send[0].params.clip.scale - 0.5 < 1e-9); // css → 1/dpr
  });

  test('device scale: dims = canvasRect × dpr', async () => {
    const { session } = makeSession();
    const r = await screenshotWithSession(session, { scale: 'device' });
    assert.equal(r.widthPx, 3024);
    assert.equal(r.heightPx, 1648);
    assert.equal(r.__image.data, B64);
  });

  test('bbox: fit + restore both run; fitApplied reported; cameraRestored true', async () => {
    const { session, calls } = makeSession();
    const r = await screenshotWithSession(session, { bbox: { x1: 0, y1: 0, x2: 100, y2: 50 } });
    assert.equal(r.fitApplied.zoom, 1.2);
    assert.equal(r.cameraRestored, true);
    assert.equal(r.cameraRestoreError, undefined);
    assert.equal(calls.evaluate.length, 3); // state, fit, restore
    assert.deepEqual(r.worldRect, { x1: 0, y1: 0, x2: 100, y2: 50 });
  });

  test('capture failure after fit: restore STILL runs, error propagates', async () => {
    const { session, calls } = makeSession({ captureError: new Error('CDP timeout') });
    await assert.rejects(
      () => screenshotWithSession(session, { bbox: { x1: 0, y1: 0, x2: 10, y2: 10 } }),
      /CDP timeout/,
    );
    assert.equal(calls.evaluate.length, 3); // state, fit, restore — restore despite failure
  });

  test('restore failure: cameraRestored false + cameraRestoreError, capture still returns', async () => {
    const { session } = makeSession();
    session.evaluate = async (expr) => {
      if (expr.includes('canvasRect')) return { canvasRect: CANVAS, dpr: DPR, viewport: VIEWPORT, zoom: 0.9 };
      if (expr.includes('setZoomManual(0.9)')) return { __error: 'restore failed in-page' }; // restore fails (literal zoom = restore expr)
      if (expr.includes('setViewportCenter')) return { applied: { center: { x: 1, y: 2 }, zoom: 1.2 } }; // fit (dynamic zoom, no literal)
      return { __error: 'unrecognized expr' };
    };
    const r = await screenshotWithSession(session, { bbox: { x1: 0, y1: 0, x2: 10, y2: 10 } });
    assert.equal(r.ok, true);
    assert.equal(r.cameraRestored, false);
    assert.match(r.cameraRestoreError, /restore failed/);
  });

  test('decoded dims win over math when bytes are parseable (real 1x1 PNG)', async () => {
    const { session } = makeSession();
    const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    session.send = async () => ({ data: png1x1 });
    const r = await screenshotWithSession(session, { format: 'png' });
    assert.equal(r.widthPx, 1);   // decoded from IHDR — not the canvasRect math (1512)
    assert.equal(r.heightPx, 1);
  });

  test('withBase64 embeds base64 into meta', async () => {
    const { session } = makeSession();
    const r = await screenshotWithSession(session, { withBase64: true });
    assert.equal(r.base64, B64);
    assert.ok(!('base64' in makeSession() && false));
  });
});

describe('toToolResult', () => {
  test('__image envelope → [text meta, image block]', () => {
    const r = toToolResult({ __image: { data: 'AAA', mimeType: 'image/png' }, ok: true, widthPx: 10 }, 'holst_screenshot');
    assert.equal(r.content.length, 2);
    assert.equal(r.content[0].type, 'text');
    assert.ok(!r.content[0].text.includes('__image'));
    assert.equal(r.content[1].type, 'image');
    assert.equal(r.content[1].mimeType, 'image/png');
  });

  test('summary special-case intact; default JSON wrap intact', () => {
    assert.equal(toToolResult({ summary: '# md' }, 'holst_get_board_summary').content[0].text, '# md');
    const d = toToolResult({ ok: true }, 'holst_whoami');
    assert.equal(d.content[0].type, 'text');
    assert.equal(JSON.parse(d.content[0].text).ok, true);
  });

  test('empty-board limitation: state expr error surfaces as message', async () => {
    const { session } = makeSession();
    session.evaluate = async () => ({ __error: 'board has no objects to reach the navigation service' });
    await assert.rejects(() => screenshotWithSession(session, {}), /no objects/);
  });
});
