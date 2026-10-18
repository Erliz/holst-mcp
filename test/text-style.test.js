import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildStyleExtras, pxToTextScale, segmentsToHtml, segmentsToSlateNodes } from '../src/text-style.js';
import { ValidationError } from '../src/validate.js';

describe('pxToTextScale', () => {
  test('converts px to textScale with base 14 (simple-text)', () => {
    assert.equal(pxToTextScale(24), 24 / 14);
    assert.equal(pxToTextScale(14), 1);
  });

  test('rejects non-positive / non-finite px', () => {
    assert.throws(() => pxToTextScale(0), ValidationError);
    assert.throws(() => pxToTextScale(-4), ValidationError);
    assert.throws(() => pxToTextScale(NaN), ValidationError);
  });
});

describe('buildStyleExtras', () => {
  test('empty options → empty object (back-compat: no fields written)', () => {
    assert.deepEqual(buildStyleExtras({}), {});
  });

  test('undefined options are skipped entirely', () => {
    assert.deepEqual(buildStyleExtras({ fontSize: undefined, textColor: undefined }), {});
  });

  test('fontSize passes through as int', () => {
    assert.deepEqual(buildStyleExtras({ fontSize: 36 }), { fontSize: 36 });
  });

  test('textScale passes through as float', () => {
    assert.deepEqual(buildStyleExtras({ textScale: 1.714 }), { textScale: 1.714 });
  });

  test('palette textColor names are rejected (v0.6.0)', () => {
    assert.throws(() => buildStyleExtras({ textColor: 'sky10' }), /#RRGGBB/);
  });

  test('hex textColor → {color: int, opacity: 1}', () => {
    assert.deepEqual(buildStyleExtras({ textColor: '#782baf' }), { textColor: { color: 7875503, opacity: 1 } });
  });

  test('textBackgroundColor same color contract', () => {
    assert.deepEqual(buildStyleExtras({ textBackgroundColor: '#fff0ee' }), { textBackgroundColor: { color: 0xfff0ee, opacity: 1 } });
  });

  test('horizontalAlign: left omitted (default), others kept', () => {
    assert.deepEqual(buildStyleExtras({ horizontalAlign: 'left' }), {});
    assert.deepEqual(buildStyleExtras({ horizontalAlign: 'center' }), { horizontalAlign: 'center' });
  });

  test('lineHeight number → percent string', () => {
    assert.deepEqual(buildStyleExtras({ lineHeight: 250 }), { lineHeight: '250%' });
  });

  test('fontFamily token passes through', () => {
    assert.deepEqual(buildStyleExtras({ fontFamily: 'ShantellSans' }), { fontFamily: 'ShantellSans' });
  });

  test('textRotated bool passes through', () => {
    assert.deepEqual(buildStyleExtras({ textRotated: true }), { textRotated: true });
  });

  test('combined extras', () => {
    const extras = buildStyleExtras({ fontSize: 24, textColor: '#f20606', horizontalAlign: 'center', bold: true });
    assert.deepEqual(extras, {
      fontSize: 24,
      textColor: { color: 15861254, opacity: 1 },
      horizontalAlign: 'center',
    }); // bold is NOT an object field — it lives in the document marks
  });

  test('rejects bad color before building', () => {
    assert.throws(() => buildStyleExtras({ textColor: "red'};evil()" }), ValidationError);
    assert.throws(() => buildStyleExtras({ textColor: '#12g567' }), ValidationError);
  });

  test('textOpacity adjusts textColor opacity (requires textColor)', () => {
    assert.deepEqual(buildStyleExtras({ textColor: '#bf4520', textOpacity: 0.06 }), {
      textColor: { color: 0xbf4520, opacity: 0.06 },
    });
    assert.deepEqual(buildStyleExtras({ textColor: '#e54d2e', textOpacity: 1 }), {
      textColor: { color: 0xe54d2e, opacity: 1 },
    });
  });

  test('textOpacity without textColor rejected (no known default ink token)', () => {
    assert.throws(() => buildStyleExtras({ textOpacity: 0.1 }), ValidationError);
  });

  test('textOpacity out of 0..1 rejected', () => {
    assert.throws(() => buildStyleExtras({ textColor: '#202020', textOpacity: 1.5 }), ValidationError);
  });

  test('verticalAlign passes through as field', () => {
    assert.deepEqual(buildStyleExtras({ verticalAlign: 'top' }), { verticalAlign: 'top' });
    assert.deepEqual(buildStyleExtras({ verticalAlign: 'bottom' }), { verticalAlign: 'bottom' });
    assert.deepEqual(buildStyleExtras({ verticalAlign: 'center' }), { verticalAlign: 'center' });
  });

  test('verticalAlign rejects unknown values', () => {
    assert.throws(() => buildStyleExtras({ verticalAlign: 'middle' }), ValidationError);
  });

  test('letterSpacing passes through as float field', () => {
    assert.deepEqual(buildStyleExtras({ letterSpacing: 1.5 }), { letterSpacing: 1.5 });
    assert.deepEqual(buildStyleExtras({ letterSpacing: -0.5 }), { letterSpacing: -0.5 });
  });

  test('letterSpacing out of sane range rejected', () => {
    assert.throws(() => buildStyleExtras({ letterSpacing: 500 }), ValidationError);
  });
});

describe('segmentsToHtml (runs pipeline)', () => {
  test('plain segment escapes HTML', () => {
    assert.equal(segmentsToHtml([{ text: 'a<b>&c' }]), '<p>a&lt;b&gt;&amp;c</p>');
  });

  test('emphasis wraps outside the color span (matches app mark order)', () => {
    assert.equal(
      segmentsToHtml([{ text: 'Name', marks: { bold: true }, color: '#bf4520' }]),
      '<p><strong><span style="color:#bf4520;">Name</span></strong></p>'
    );
  });

  test('multiple runs concatenate in order', () => {
    assert.equal(
      segmentsToHtml([
        { text: 'Name', marks: { bold: true }, color: 0xe54d2e },
        { text: ' · sub', marks: { italic: true }, color: 0x202020 },
      ]),
      '<p><strong><span style="color:#e54d2e;">Name</span></strong><em><span style="color:#202020;"> · sub</span></em></p>'
    );
  });

  test('multiline splits into paragraphs per line', () => {
    assert.equal(
      segmentsToHtml([{ text: 'a\nb' }]),
      '<p>a</p><p>b</p>'
    );
  });
});

describe('segmentsToSlateNodes (runs → createFromJSON payload)', () => {
  const uuid = () => 'key-1';

  test('builds wrapper → paragraph → text with mark props', () => {
    const nodes = segmentsToSlateNodes([{ text: 'Name', color: 'red10', marks: { bold: true } }], uuid);
    assert.deepEqual(nodes, [{
      type: 'wrapper', key: 'key-1',
      children: [{
        type: 'paragraph', key: 'key-1',
        children: [{ text: 'Name', color: 'red10', bold: true }],
      }],
    }]);
  });

  test('hex color passes through as int (assertRuns normalizes upstream)', () => {
    const nodes = segmentsToSlateNodes([{ text: 'x', color: 0xbf4520 }], uuid);
    assert.equal(nodes[0].children[0].children[0].color, 0xbf4520);
  });

  test('plain segments yield bare text nodes (no mark props)', () => {
    const nodes = segmentsToSlateNodes([{ text: 'plain' }], uuid);
    assert.deepEqual(nodes[0].children[0].children, [{ text: 'plain' }]);
  });

  test('segments on one line share a wrapper; \\n starts a new wrapper', () => {
    const nodes = segmentsToSlateNodes([
      { text: 'a' }, { text: 'b', marks: { italic: true } }, { text: '\nc' },
    ], uuid);
    assert.equal(nodes.length, 2);
    assert.deepEqual(nodes[0].children[0].children, [{ text: 'a' }, { text: 'b', italic: true }]);
    assert.deepEqual(nodes[1].children[0].children, [{ text: 'c' }]);
  });

  test('all four emphasis marks map to props', () => {
    const nodes = segmentsToSlateNodes([{ text: 'x', marks: { bold: true, italic: true, underline: true, strikethrough: true } }], uuid);
    const t = nodes[0].children[0].children[0];
    assert.deepEqual({ bold: t.bold, italic: t.italic, underline: t.underline, strikethrough: t.strikethrough },
      { bold: true, italic: true, underline: true, strikethrough: true });
  });
});
