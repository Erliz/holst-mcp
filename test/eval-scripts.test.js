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
  buildKindExpr,
  buildTouchUpdatedExpr,
  buildAddSimpleTextExpr,
} from '../src/eval-scripts.js';

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
