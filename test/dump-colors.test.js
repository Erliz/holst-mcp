import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDumpColors, colorIntToHex } from '../src/dump-colors.js';

describe('colorIntToHex', () => {
  test('int → #rrggbb, lowercase, padded', () => {
    assert.equal(colorIntToHex(0x21cce0), '#21cce0');
    assert.equal(colorIntToHex(0), '#000000');
    assert.equal(colorIntToHex(0xffffff), '#ffffff');
  });
});

describe('normalizeDumpColors (read path: MCP ints → hex, UI tokens stay)', () => {
  test('object-level color fields: int color → hex string, token color untouched', () => {
    const content = {
      objects: {
        a: {
          type: 'shape',
          fillColor: { color: 15027502, opacity: 1 },
          strokeColor: { color: 0x202020, opacity: 1 },
          textColor: { color: 0xffffff, opacity: 1 },
          textBackgroundColor: { color: 0xfff0ee },
        },
        b: { type: 'frame', fillColor: { color: 'violet5', opacity: 1 }, backgroundStyle: 2 },
      },
      documents: {},
    };
    normalizeDumpColors(content);
    assert.equal(content.objects.a.fillColor.color, '#e54d2e');
    assert.equal(content.objects.a.strokeColor.color, '#202020');
    assert.equal(content.objects.a.textColor.color, '#ffffff');
    assert.equal(content.objects.a.textBackgroundColor.color, '#fff0ee');
    assert.equal(content.objects.b.fillColor.color, 'violet5'); // UI-created: name stays (docs/palette.md decodes)
    assert.equal(content.objects.b.backgroundStyle, 2); // non-color ints untouched
  });

  test('opacity rides along; non-color numeric fields untouched; no color fields = no-op', () => {
    const content = {
      objects: {
        a: { type: 'simple-text', width: 260, height: 56, position: { x: 1, y: 2 } },
        b: { type: 'arrow', strokeColor: { color: 0x05a2c2, opacity: 1 }, strokeWidth: 3 },
      },
    };
    normalizeDumpColors(content);
    assert.deepEqual(content.objects.a, { type: 'simple-text', width: 260, height: 56, position: { x: 1, y: 2 } });
    assert.equal(content.objects.b.strokeColor.color, '#05a2c2');
    assert.equal(content.objects.b.strokeWidth, 3);
  });

  test('tolerates missing objects / malformed color values', () => {
    const content = { documents: {} };
    normalizeDumpColors(content);
    assert.deepEqual(content, { documents: {} });
    const weird = { objects: { a: { fillColor: null, strokeColor: { color: 'tomato8' } } } };
    normalizeDumpColors(weird);
    assert.equal(weird.objects.a.fillColor, null);
    assert.equal(weird.objects.a.strokeColor.color, 'tomato8');
  });
});
