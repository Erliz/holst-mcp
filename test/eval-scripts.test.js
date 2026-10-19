import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_WRITE_HELPER,
  buildBoardContentExpr,
  buildCheckAllMountedExpr,
  buildBatchCreationExpr,
  buildBatchArrowsExpr,
  buildBatchTextWriteExpr,
  buildStyleFieldsExpr,
  buildNativeStyleUpdateExpr,
  buildKindExpr,
  buildTouchUpdatedExpr,
  buildAddSimpleTextExpr,
  buildArrowLabelsStateExpr,
  buildCanvasStateExpr, buildCameraFitExpr, buildCameraSetExpr,
} from '../src/eval-scripts.js';
import { createState, FakeNavigationService } from './helpers/fake-holst.js';

// L1 guards (plan: docs/plans/2026-10-18-unit-testing-cdp-layer.md):
// every eval script must (a) compile under the page's parser, (b) carry no
// unresolved ${...} placeholders, (c) keep hostile input inside string
// literals. new Function parses without executing — the exact failure mode
// the v0.4 regression hit.

const compiles = (expr) => {
  assert.doesNotThrow(() => new Function(expr), `script must compile:\n${expr.slice(0, 200)}`);
};
const noPlaceholders = (expr) => {
  assert.equal(expr.includes('${'), false, `unresolved placeholder: ${expr.match(/\$\{[^}]*\}/g)}`);
};

describe('L1: read path', () => {
  test('buildBoardContentExpr compiles and has no placeholders', () => {
    const expr = buildBoardContentExpr();
    compiles(expr);
    noPlaceholders(expr);
  });
});

describe('L1: mount checks', () => {
  test('buildCheckAllMountedExpr embeds ids safely', () => {
    const expr = buildCheckAllMountedExpr(["a'", 'b']);
    compiles(expr);
    noPlaceholders(expr);
    assert.ok(expr.includes(JSON.stringify(["a'", 'b'])));
  });
});

describe('L1: batch exprs', () => {
  const chunk = [{
    kind: 'shape', ref: 'a', x: 1, y: 2, width: 10, height: 20, shapeType: 'square',
    fillColor: { color: 0xffffff, opacity: 1 }, strokeColor: { color: 0x202020, opacity: 1 },
    strokeWidth: 2, fixedSize: true, fontSize: 36, hasDocument: true, text: 'hi',
  }];

  test('buildBatchCreationExpr compiles; hostile text stays escaped', () => {
    const hostile = [{ ...chunk[0], text: "'; } evil() { //" }];
    const expr = buildBatchCreationExpr(hostile);
    compiles(expr);
    noPlaceholders(expr);
  });

  test('buildBatchArrowsExpr compiles with texts and behind-mode', () => {
    const arrows = [{
      arrowType: 'straight', strokeColor: 0x2e5aa8, strokeStyle: 'solid', strokeWidth: 2.4,
      arrowheadEnd: 'none', text: 'link', textPosition: 0.5,
      textColor: { color: 0x2e5aa8, opacity: 1 }, fontSize: 14,
      from: { point: { x: 0, y: 0 } }, to: { point: { x: 10, y: 10 } },
    }];
    for (const behind of [false, true]) {
      const expr = buildBatchArrowsExpr([{ id: 'i1' }], arrows, behind);
      compiles(expr);
      noPlaceholders(expr);
    }
  });

  test('buildArrowLabelsStateExpr compiles; hostile ids stay escaped', () => {
    const expr = buildArrowLabelsStateExpr(["a'", 'b"q']);
    compiles(expr);
    noPlaceholders(expr);
    assert.ok(expr.includes(JSON.stringify(["a'", 'b"q'])));
  });

  test('buildBatchTextWriteExpr compiles with segments and slate nodes', () => {
    const jobs = [{ idx: 0, segments: [{ text: 'a', color: 1, marks: { bold: true } }], plainText: 'a' }];
    const expr = buildBatchTextWriteExpr([{ id: 'i1', documentId: 'd1' }], jobs);
    compiles(expr);
    noPlaceholders(expr);
  });
});

describe('L1: update_text path', () => {
  test('buildStyleFieldsExpr embeds objectId escaped', () => {
    const expr = buildStyleFieldsExpr("x'}; evil()", { fontSize: 36 });
    compiles(expr);
    noPlaceholders(expr);
    assert.ok(expr.includes(JSON.stringify("x'}; evil()")));
  });

  test('buildStyleFieldsExpr with deleteFields compiles and embeds the list escaped', () => {
    const expr = buildStyleFieldsExpr("a'", {}, ["font'", 'Size']);
    compiles(expr);
    noPlaceholders(expr);
    assert.ok(expr.includes(JSON.stringify(["font'", 'Size'])));
  });

  test('buildNativeStyleUpdateExpr compiles and embeds ids escaped', () => {
    const expr = buildNativeStyleUpdateExpr("x'}; evil()", { textScale: 1.5 }, ["font'"]);
    compiles(expr);
    noPlaceholders(expr);
    assert.ok(expr.includes(JSON.stringify("x'}; evil()")));
  });

  test('buildKindExpr compiles', () => {
    const expr = buildKindExpr('abc');
    compiles(expr);
    noPlaceholders(expr);
  });

  test('buildTouchUpdatedExpr compiles', () => {
    const expr = buildTouchUpdatedExpr('abc');
    compiles(expr);
    noPlaceholders(expr);
  });
});

describe('L1: add_simple_text', () => {
  test('compiles with and without style extras', () => {
    for (const extras of [{}, { fontSize: 36, textColor: { color: 1, opacity: 1 } }]) {
      const expr = buildAddSimpleTextExpr({ x: 1.5, y: -2, styleExtras: extras });
      compiles(expr);
      noPlaceholders(expr);
    }
  });

  test('non-finite coordinates rejected by the builder itself', () => {
    assert.throws(() => buildAddSimpleTextExpr({ x: NaN, y: 0, styleExtras: {} }), /finite/);
  });
});

describe('NATIVE_WRITE_HELPER ownership moved to eval-scripts', () => {
  test('still the compile-guarded helper', () => {
    assert.equal(typeof NATIVE_WRITE_HELPER, 'string');
    assert.equal(NATIVE_WRITE_HELPER.includes('${'), false);
  });
});

describe('L1: batch delete', () => {
  test('buildDeleteObjectsExpr compiles and embeds ids escaped', async () => {
    const { buildDeleteObjectsExpr } = await import('../src/eval-scripts.js');
    const expr = buildDeleteObjectsExpr(["a'", 'b', 'c']);
    compiles(expr);
    noPlaceholders(expr);
    assert.ok(expr.includes(JSON.stringify(["a'", 'b', 'c'])));
  });
});

describe('L1: screenshot camera builders', () => {
  test('state/fit/restore compile; numbers embedded, not string-interpolated', () => {
    compiles(buildCanvasStateExpr());
    const fit = buildCameraFitExpr({ x1: -12.5, y1: 0, x2: 1e3, y2: 42.7 });
    compiles(fit);
    assert.ok(fit.includes('-12.5') && fit.includes('1000'));
    const set = buildCameraSetExpr({ x: 5, y: -3 }, 0.25);
    compiles(set);
    assert.ok(set.includes('setViewportCenter(5, -3)') && set.includes('setZoomManual(0.25)'));
    // Regression guard (issue #15): a bare `nav.zoom = x` write is a silent
    // no-op on current builds — the zoom must go through the method API,
    // with the bare write allowed only as the last-resort legacy fallback.
    const onlyFallbackZoomWrites = (expr) => [...expr.matchAll(/nav\s*\.\s*zoom\s*=/g)]
      .every((m) => expr.slice(0, m.index).split('\n').pop().trim().startsWith('else'));
    assert.ok(onlyFallbackZoomWrites(set), 'no unconditional nav.zoom writes in camera scripts');
    assert.ok(onlyFallbackZoomWrites(fit), 'no unconditional nav.zoom writes in camera scripts');
  });

  test('non-finite bbox/center rejected before any script is built', () => {
    assert.throws(() => buildCameraFitExpr({ x1: NaN, y1: 0, x2: 1, y2: 1 }), /finite/);
    assert.throws(() => buildCameraSetExpr({ x: 1, y: Infinity }, 1), /finite/);
  });
});

describe('L2: camera builders vs fake navigation service (issue #15)', () => {
  // CDP Runtime.evaluate runs scripts in SLOPPY mode — the live failure mode
  // of issue #15 was a SILENT no-op (getter-only `zoom` + non-strict
  // assignment), not a TypeError. Mirror the page here instead of reusing
  // fake-holst's strict runExpr.
  const evalCamera = (expr, state) => new Function('window', `return (${expr});`)(state.window);
  const attachNav = (state, nav) => {
    state.window.ds.yPersistence.yDoc.getMap('objects')
      .set('camera-probe', { objectBoundsService: { visibilityService: { navigationService: nav } } });
  };

  test('fit applies zoom through the method API, not a bare field write', () => {
    const state = createState();
    const nav = new FakeNavigationService({ zoom: 0.087, viewport: { x: 0, y: 0, width: 1600, height: 900 } });
    attachNav(state, nav);
    const r = evalCamera(buildCameraFitExpr({ x1: 0, y1: 0, x2: 800, y2: 450 }), state);
    assert.equal(r.__error, undefined);
    // pad 0.12: w = 800 × 1.24, view aspect matches → fit = 1600 / 992.
    const want = 1600 / (800 * 1.24);
    assert.ok(Math.abs(nav.zoom - want) < 1e-9, `zoom applied (got ${nav.zoom}, want ${want})`);
    const zoomCall = nav.calls.find((c) => c.method === 'setZoomManual' || c.method === 'setZoom');
    assert.ok(zoomCall, 'zoom went through a method setter');
    assert.ok(Math.abs(zoomCall.args[0] - want) < 1e-9);
    const center = nav.calls.find((c) => c.method === 'setViewportCenter');
    assert.deepEqual(center.args, [400, 225]);
    assert.equal(r.applied.zoom, nav.zoom); // meta reports the readback
  });

  test('restore applies explicit center/zoom and reports the readback', () => {
    const state = createState();
    const nav = new FakeNavigationService({ zoom: 1.9, viewport: { x: 0, y: 0, width: 1600, height: 900 } });
    attachNav(state, nav);
    const r = evalCamera(buildCameraSetExpr({ x: 100, y: -50 }, 0.75), state);
    assert.deepEqual(r, { ok: true, zoom: 0.75 });
    assert.deepEqual(
      nav.calls.filter((c) => c.method !== 'setViewportCenter'),
      [{ method: 'setZoomManual', args: [0.75] }],
    );
    assert.deepEqual(nav.calls.find((c) => c.method === 'setViewportCenter').args, [100, -50]);
  });

  test('legacy nav without method setters: bare assignment fallback still works', () => {
    const state = createState();
    const nav = {
      zoom: 0.5,
      viewportRect: { x: 0, y: 0, width: 1000, height: 500 },
      setViewportCenter(cx, cy) { this.viewportRect.x = cx - 500; this.viewportRect.y = cy - 250; },
    };
    attachNav(state, nav);
    const r = evalCamera(buildCameraFitExpr({ x1: 0, y1: 0, x2: 500, y2: 250 }), state);
    assert.equal(r.__error, undefined);
    const want = 1000 / (500 * 1.24); // ≈ 1.6129
    assert.ok(Math.abs(nav.zoom - want) < 1e-9, `legacy fallback applied (got ${nav.zoom}, want ${want})`);
    assert.ok(Math.abs(r.applied.zoom - want) < 1e-9);
  });
});
