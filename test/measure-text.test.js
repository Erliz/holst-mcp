import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMeasureTextExpr } from '../src/eval-scripts.js';

// L1: the measure script is composed as a pure builder — compile and
// injection guards mirror eval-scripts.test.js (new Function parses with
// the same parser the page does; hostile payloads must stay JSON-escaped).

const compiles = (expr) => {
  assert.doesNotThrow(() => new Function(expr), `script must compile:\n${expr.slice(0, 200)}`);
};

describe('buildMeasureTextExpr (L1)', () => {
  test('compiles; hostile text stays escaped, family token travels JSON-escaped', () => {
    const hostile = '"); evil(); ("';
    const expr = buildMeasureTextExpr({ text: hostile, fontSize: 17, fontFamily: 'SourceCodePro', bold: true });
    compiles(expr);
    assert.ok(expr.includes(JSON.stringify(hostile)), 'text must be embedded JSON-escaped');
    assert.ok(expr.includes(JSON.stringify('SourceCodePro')), 'fontFamily must be embedded JSON-escaped');
  });

  test('async IIFE: returns a Promise — document.fonts.load must be awaited', () => {
    const expr = buildMeasureTextExpr({ text: 'hi', fontSize: 14, fontFamily: 'Inter' });
    assert.match(expr, /^\(async \(\) =>/, 'script must be an async IIFE');
  });

  test('non-finite fontSize / letterSpacing rejected by the builder itself', () => {
    assert.throws(() => buildMeasureTextExpr({ text: 'x', fontSize: NaN, fontFamily: 'Inter' }), /fontSize/);
    assert.throws(() => buildMeasureTextExpr({ text: 'x', fontSize: 14, fontFamily: 'Inter', letterSpacing: Infinity }), /letterSpacing/);
  });
});

// L2: run the REAL expr against a fake page surface (document.fonts +
// canvas 2d stub) — the same fidelity boundary as fake-holst.js: minimal
// model, drift caught by the mandatory live cycle.

const MONO_EM = 0.72; // issue #8 evidence: SourceCodePro ~0.72em/char at 17px

function fakePage({ families = ['Source Code Pro', 'Inter'], supportLetterSpacing = true, faceLoads = true } = {}) {
  const calls = { fontSpecs: [], letterSpacing: [], loads: [] };
  const ctx = {
    measureText(s) {
      return { width: s.length * 17 * MONO_EM, fontBoundingBoxAscent: 13.6, fontBoundingBoxDescent: 3.4 };
    },
  };
  if (supportLetterSpacing) ctx.letterSpacing = '0px';
  Object.defineProperty(ctx, 'font', {
    get() { return this._font || ''; },
    set(v) { this._font = v; calls.fontSpecs.push(v); },
  });
  Object.defineProperty(ctx, 'letterSpacing', {
    get() { return this._ls || '0px'; },
    set(v) { this._ls = v; calls.letterSpacing.push(v); },
    configurable: true,
  });
  if (!supportLetterSpacing) delete ctx.letterSpacing;
  const fonts = new Set(families.map((family) => ({ family })));
  fonts.load = async (spec, sample) => { calls.loads.push({ spec, sample }); };
  fonts.check = () => faceLoads;
  const document = {
    fonts,
    createElement: (tag) => (tag === 'canvas' ? { getContext: () => ctx } : null),
  };
  return { window: { document }, calls };
}

async function evalInPage(expr, page) {
  const fn = new Function('window', `"use strict";\nreturn (${expr});`);
  const r = fn(page.window);
  return r && typeof r.then === 'function' ? await r : r;
}

describe('buildMeasureTextExpr (L2 fake page)', () => {
  test('happy path: token resolves to the real CSS family; per-line widths; height = lines × lineHeight', async () => {
    const page = fakePage();
    const r = await evalInPage(buildMeasureTextExpr({ text: 'deploy\nto prod', fontSize: 17, fontFamily: 'SourceCodePro', bold: true }), page);
    assert.equal(r.ok, true);
    assert.equal(r.fontFamily, 'Source Code Pro'); // real CSS name, not the token
    assert.equal(r.fontSize, 17);
    assert.equal(r.bold, true);
    assert.deepEqual(r.lines, [
      { text: 'deploy', widthPx: 6 * 17 * MONO_EM },
      { text: 'to prod', widthPx: 7 * 17 * MONO_EM },
    ]);
    assert.equal(r.widthPx, 7 * 17 * MONO_EM); // max line
    assert.equal(r.lineHeightPx, 13.6 + 3.4);
    assert.equal(r.heightPx, (13.6 + 3.4) * 2);
    assert.equal(r.method, 'canvas-measure');
    // font spec uses the RESOLVED family, the requested weight and size
    assert.deepEqual(page.calls.fontSpecs, ['normal 700 17px "Source Code Pro"']);
  });

  test('unknown token: error lists the available families (no silent fallback)', async () => {
    const page = fakePage();
    const r = await evalInPage(buildMeasureTextExpr({ text: 'x', fontSize: 14, fontFamily: 'ComicSans' }), page);
    assert.equal(r.ok, undefined);
    assert.match(r.__error, /unknown fontFamily "ComicSans"/);
    assert.match(r.__error, /Inter/);
    assert.match(r.__error, /Source Code Pro/);
  });

  test('matched family that fails to load: refuses instead of measuring a substitute font', async () => {
    const page = fakePage({ faceLoads: false });
    const r = await evalInPage(buildMeasureTextExpr({ text: 'x', fontSize: 14, fontFamily: 'Inter' }), page);
    assert.match(r.__error, /failed to load/);
  });

  test('letterSpacing applied when the ctx supports it; explicit error when it does not', async () => {
    const ok = fakePage();
    const r1 = await evalInPage(buildMeasureTextExpr({ text: 'ab', fontSize: 14, fontFamily: 'Inter', letterSpacing: 2 }), ok);
    assert.equal(r1.ok, true);
    assert.deepEqual(ok.calls.letterSpacing, ['2px']);
    const old = fakePage({ supportLetterSpacing: false });
    const r2 = await evalInPage(buildMeasureTextExpr({ text: 'ab', fontSize: 14, fontFamily: 'Inter', letterSpacing: 2 }), old);
    assert.match(r2.__error, /letterSpacing/);
  });
});
