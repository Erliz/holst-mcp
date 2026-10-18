import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError,
  assertBoardId,
  assertObjectId,
  num,
  safeToken,
  assertText,
  assertArrowEndpoint,
  assertStrokeStyle,
  parseColor,
  assertArrowhead,
  assertOpacity,
  assertHorizontalAlign,
  assertNoMarkdown,
  assertRuns,
  assertBorderRadius,
  assertShapeType,
  assertArrowType,
} from '../src/validate.js';

describe('assertBoardId', () => {
  test('accepts a valid UUID', () => {
    assert.doesNotThrow(() =>
      assertBoardId('123e4567-e89b-42d3-a456-426614174000')
    );
  });

  test('accepts uppercase UUID', () => {
    assert.doesNotThrow(() =>
      assertBoardId('372EA1BF-8BAC-481B-94F2-DDD9088461CA')
    );
  });

  test('rejects path traversal payload', () => {
    assert.throws(() => assertBoardId('../../evil.com'), ValidationError);
  });

  test('rejects full-url payload', () => {
    assert.throws(
      () => assertBoardId('x?next=https://evil.com/board/1'),
      ValidationError
    );
  });

  test('rejects non-string', () => {
    assert.throws(() => assertBoardId(12345), ValidationError);
    assert.throws(() => assertBoardId(null), ValidationError);
    assert.throws(() => assertBoardId(undefined), ValidationError);
  });

  test('rejects almost-UUID', () => {
    assert.throws(
      () => assertBoardId('123e4567-e89b-42d3-a456-42661417400'),
      ValidationError
    );
    assert.throws(() => assertBoardId(''), ValidationError);
  });
});

describe('assertObjectId', () => {
  test('accepts UUID-like object id', () => {
    assert.doesNotThrow(() => assertObjectId('04a54183-ab12-cd34-ef56-000000000000'));
  });

  test('rejects quotes and code payload', () => {
    assert.throws(() => assertObjectId("a'}; fetch('https://evil.com')"), ValidationError);
  });

  test('rejects empty and non-string', () => {
    assert.throws(() => assertObjectId(''), ValidationError);
    assert.throws(() => assertObjectId({}), ValidationError);
  });
});

describe('num', () => {
  test('passes through finite numbers', () => {
    assert.equal(num(100, 'x'), 100);
    assert.equal(num(-42.5, 'y'), -42.5);
  });

  test('returns default when value is undefined', () => {
    assert.equal(num(undefined, 'width', { default: 192 }), 192);
  });

  test('rejects NaN and Infinity', () => {
    assert.throws(() => num(NaN, 'x'), ValidationError);
    assert.throws(() => num(Infinity, 'x'), ValidationError);
    assert.throws(() => num(-Infinity, 'y'), ValidationError);
  });

  test('rejects non-number types', () => {
    assert.throws(() => num('100', 'x'), ValidationError);
    assert.throws(() => num('abc', 'x'), ValidationError);
    assert.throws(() => num(null, 'x'), ValidationError);
  });

  test('rejects out-of-bounds values', () => {
    assert.throws(() => num(1e9, 'x', { max: 1e7 }), ValidationError);
    assert.throws(() => num(0, 'width', { min: 1 }), ValidationError);
  });

  test('enforces max on default too', () => {
    assert.equal(num(undefined, 'width', { default: 50, max: 100 }), 50);
    assert.throws(() => num(101, 'width', { max: 100 }), ValidationError);
  });
});

describe('safeToken', () => {
  test('accepts shape/arrow/stamp tokens (NOT colors since v0.6.0)', () => {
    assert.equal(safeToken('round-rect', 'shapeType'), 'round-rect');
    assert.equal(safeToken('elbow', 'arrowType'), 'elbow');
    assert.equal(safeToken('textStamp', 'stampType'), 'textStamp');
  });

  test('returns default for undefined', () => {
    assert.equal(safeToken(undefined, 'shapeType', { default: 'square' }), 'square');
  });

  test('rejects injection payloads', () => {
    assert.throws(() => safeToken("white'};evil()", 'fillColor'), ValidationError);
    assert.throws(() => safeToken('red"><script>', 'fillColor'), ValidationError);
  });

  test('rejects non-string and empty', () => {
    assert.throws(() => safeToken(123, 'fillColor'), ValidationError);
    assert.throws(() => safeToken('', 'fillColor'), ValidationError);
  });

  test('rejects overlong tokens', () => {
    assert.throws(() => safeToken('a'.repeat(64), 'fillColor'), ValidationError);
  });
});

describe('assertText', () => {
  test('accepts plain text', () => {
    assert.equal(assertText('ЦЕННОСТИ', 'text'), 'ЦЕННОСТИ');
    assert.equal(assertText('with "quotes" and \\\nlines', 'text'), 'with "quotes" and \\\nlines');
  });

  test('returns default for undefined', () => {
    assert.equal(assertText(undefined, 'text', { default: '' }), '');
  });

  test('rejects non-string', () => {
    assert.throws(() => assertText({ html: 1 }, 'text'), ValidationError);
    assert.throws(() => assertText(42, 'text'), ValidationError);
  });

  test('rejects overlong text', () => {
    assert.throws(() => assertText('x'.repeat(100001), 'text'), ValidationError);
  });
});

describe('assertStrokeStyle', () => {
  test('accepts solid, dashed, dotted', () => {
    assert.equal(assertStrokeStyle('solid', 'strokeStyle'), 'solid');
    assert.equal(assertStrokeStyle('dashed', 'strokeStyle'), 'dashed');
    assert.equal(assertStrokeStyle('dotted', 'strokeStyle'), 'dotted');
  });

  test('undefined falls back to default', () => {
    assert.equal(assertStrokeStyle(undefined, 'strokeStyle', { default: 'solid' }), 'solid');
    assert.equal(assertStrokeStyle(undefined, 'strokeStyle', { default: 'dotted' }), 'dotted');
  });

  test('rejects unknown, injection and non-string values', () => {
    assert.throws(() => assertStrokeStyle('wavy', 'strokeStyle'), ValidationError);
    assert.throws(() => assertStrokeStyle("solid'};evil()", 'strokeStyle'), ValidationError);
    assert.throws(() => assertStrokeStyle(42, 'strokeStyle'), ValidationError);
    assert.throws(() => assertStrokeStyle(null, 'strokeStyle'), ValidationError);
  });
});

describe('parseColor (#RRGGBB only since v0.6.0)', () => {
  test('palette names are rejected with a hint', () => {
    assert.throws(() => parseColor('gray12', 'fillColor'), /#RRGGBB/);
    assert.throws(() => parseColor('sky10', 'textColor'), ValidationError);
  });

  test('hex converts to int', () => {
    assert.equal(parseColor('#782baf', 'textColor'), 7875503);
    assert.equal(parseColor('#F20606', 'strokeColor'), 15861254);
    assert.equal(parseColor('#000000', 'fillColor'), 0);
    assert.equal(parseColor('#ffffff', 'fillColor'), 0xffffff);
  });

  test('rejects malformed hex, injection and non-strings', () => {
    assert.throws(() => parseColor('#12g567', 'fillColor'), ValidationError);
    assert.throws(() => parseColor('#12345', 'fillColor'), ValidationError);
    assert.throws(() => parseColor("red'};evil()", 'fillColor'), ValidationError);
    assert.throws(() => parseColor(42, 'fillColor'), ValidationError);
  });
});

describe('assertArrowhead', () => {
  test('accepts verified shapes', () => {
    assert.equal(assertArrowhead('none', 'arrowheadEnd'), 'none');
    assert.equal(assertArrowhead('miro', 'arrowheadStart'), 'miro');
    assert.equal(assertArrowhead('arc', 'arrowheadEnd'), 'arc');
    assert.equal(assertArrowhead('figma', 'arrowheadEnd'), 'figma');
  });

  test('undefined stays undefined (field omitted = Holst default)', () => {
    assert.equal(assertArrowhead(undefined, 'arrowheadEnd'), undefined);
  });

  test('rejects unknown and injection values', () => {
    assert.throws(() => assertArrowhead('triangle!!', 'x'), ValidationError);
    assert.throws(() => assertArrowhead("miro'};evil()", 'x'), ValidationError);
    assert.throws(() => assertArrowhead(42, 'x'), ValidationError);
  });
});

describe('assertOpacity', () => {
  test('accepts 0..1', () => {
    assert.equal(assertOpacity(0.03, 'fillOpacity'), 0.03);
    assert.equal(assertOpacity(1, 'fillOpacity'), 1);
    assert.equal(assertOpacity(0, 'fillOpacity'), 0);
  });

  test('rejects out-of-range and non-numbers', () => {
    assert.throws(() => assertOpacity(1.5, 'x'), ValidationError);
    assert.throws(() => assertOpacity(-0.1, 'x'), ValidationError);
    assert.throws(() => assertOpacity('half', 'x'), ValidationError);
  });
});

describe('assertHorizontalAlign', () => {
  test('accepts left/center/right/justify', () => {
    for (const v of ['left', 'center', 'right', 'justify']) {
      assert.equal(assertHorizontalAlign(v, 'horizontalAlign'), v);
    }
  });

  test('undefined → undefined', () => {
    assert.equal(assertHorizontalAlign(undefined, 'horizontalAlign'), undefined);
  });

  test('rejects others', () => {
    assert.throws(() => assertHorizontalAlign('middle', 'x'), ValidationError);
  });
});

describe('assertNoMarkdown', () => {
  test('plain text and legit asterisks/underscores pass', () => {
    assert.doesNotThrow(() => assertNoMarkdown('plain text'));
    assert.doesNotThrow(() => assertNoMarkdown('3 * 4 * 5 = 60'));
    assert.doesNotThrow(() => assertNoMarkdown('snake_case_name'));
  });

  test('bold/italic markdown rejected with a helpful error', () => {
    assert.throws(() => assertNoMarkdown('**важно**'), /bold/);
    assert.throws(() => assertNoMarkdown('*курсив*'), /italic/);
    assert.throws(() => assertNoMarkdown('_курсив_'), /italic/);
  });
});

describe('assertRuns (run-level styled text)', () => {
  test('valid runs pass and normalize', () => {
    const runs = assertRuns([
      { text: 'Name', color: '#bf4520', bold: true },
      { text: 'Sublabel', color: '#202020', italic: true },
    ], 'runs');
    assert.deepEqual(runs, [
      { text: 'Name', color: 0xbf4520, marks: { bold: true } },
      { text: 'Sublabel', color: 0x202020, marks: { italic: true } },
    ]);
  });

  test('pre-normalized int colors pass, out-of-range ints rejected', () => {
    assert.equal(assertRuns([{ text: 'x', color: 0xe54d2e }], 'runs')[0].color, 0xe54d2e);
    assert.throws(() => assertRuns([{ text: 'x', color: -1 }], 'runs'), ValidationError);
    assert.throws(() => assertRuns([{ text: 'x', color: 0x1000000 }], 'runs'), ValidationError);
    assert.throws(() => assertRuns([{ text: 'x', color: 1.5 }], 'runs'), ValidationError);
  });

  test('run without style collapses to plain segment', () => {
    assert.deepEqual(assertRuns([{ text: 'plain' }], 'runs'), [{ text: 'plain' }]);
  });

  test('rejects non-array, empty runs, non-string text, bad color', () => {
    assert.throws(() => assertRuns('nope', 'runs'), ValidationError);
    assert.throws(() => assertRuns([], 'runs'), ValidationError);
    assert.throws(() => assertRuns([{ text: 42 }], 'runs'), ValidationError);
    assert.throws(() => assertRuns([{ text: 'x', color: 'not a color!' }], 'runs'), ValidationError);
  });

  test('markdown inside run text rejected', () => {
    assert.throws(() => assertRuns([{ text: '**bold**' }], 'runs'), /bold/);
  });

  test('idempotent: normalizing already-normalized runs is a no-op', () => {
    const once = assertRuns([{ text: 'x', color: '#bf4520', bold: true }], 'runs');
    const twice = assertRuns(once, 'runs');
    assert.deepEqual(twice, once);
  });
});

describe('assertBorderRadius', () => {
  test('accepts 0..500 numbers', () => {
    assert.equal(assertBorderRadius(20, 'borderRadius'), 20);
    assert.equal(assertBorderRadius(40, 'borderRadius'), 40);
    assert.equal(assertBorderRadius(0, 'borderRadius'), 0);
  });

  test('rejects out-of-range and non-numbers', () => {
    assert.throws(() => assertBorderRadius(501, 'x'), ValidationError);
    assert.throws(() => assertBorderRadius(-1, 'x'), ValidationError);
    assert.throws(() => assertBorderRadius('round', 'x'), ValidationError);
  });
});

describe('assertShapeType (whitelist — silent-fallback guard)', () => {
  test('accepts the five verified shape tokens', () => {
    for (const t of ['square', 'round-rect', 'diamond', 'triangle', 'ellipse']) {
      assert.equal(assertShapeType(t, 'shapeType'), t);
    }
  });

  test('rhombus rejected with the valid list (it silently rendered as rectangle)', () => {
    assert.throws(() => assertShapeType('rhombus', 'shapeType'), /square, round-rect, diamond, triangle, ellipse/);
    assert.throws(() => assertShapeType('hexagon', 'shapeType'), ValidationError);
  });

  test('undefined falls back to square', () => {
    assert.equal(assertShapeType(undefined, 'shapeType', { default: 'square' }), 'square');
  });
});

describe('assertArrowType (whitelist)', () => {
  test('accepts straight/elbow/curved', () => {
    for (const t of ['straight', 'elbow', 'curved']) {
      assert.equal(assertArrowType(t, 'arrowType'), t);
    }
  });

  test('rejects unknown with the valid list', () => {
    assert.throws(() => assertArrowType('zigzag', 'arrowType'), /straight, elbow, curved/);
  });

  test('undefined defaults to elbow', () => {
    assert.equal(assertArrowType(undefined, 'arrowType', { default: 'elbow' }), 'elbow');
  });
});

describe('assertArrowEndpoint', () => {
  test('accepts free point {x,y}', () => {
    assert.doesNotThrow(() => assertArrowEndpoint({ x: 10, y: -5 }, 'start'));
  });

  test('accepts attached endpoint with relativePoint', () => {
    assert.doesNotThrow(() =>
      assertArrowEndpoint(
        { objectId: '04a54183-ab12-cd34-ef56-000000000000', relativePoint: { x: 0.5, y: 0.5 } },
        'end'
      )
    );
  });

  test('rejects missing coordinates', () => {
    assert.throws(() => assertArrowEndpoint({ x: 10 }, 'start'), ValidationError);
  });

  test('rejects NaN coordinates', () => {
    assert.throws(() => assertArrowEndpoint({ x: NaN, y: 1 }, 'start'), ValidationError);
  });

  test('rejects object endpoint without objectId', () => {
    assert.throws(() => assertArrowEndpoint({ relativePoint: { x: 0, y: 0 } }, 'end'), ValidationError);
  });

  test('rejects non-object', () => {
    assert.throws(() => assertArrowEndpoint('10,10', 'start'), ValidationError);
    assert.throws(() => assertArrowEndpoint(null, 'start'), ValidationError);
  });

  test('rejects NaN relativePoint', () => {
    assert.throws(
      () =>
        assertArrowEndpoint(
          { objectId: '04a54183-ab12-cd34-ef56-000000000000', relativePoint: { x: 'a', y: 0 } },
          'end'
        ),
      ValidationError
    );
  });
});
