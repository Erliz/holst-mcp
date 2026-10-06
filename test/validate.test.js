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
} from '../src/validate.js';

describe('assertBoardId', () => {
  test('accepts a valid UUID', () => {
    assert.doesNotThrow(() =>
      assertBoardId('372ea1bf-8bac-481b-94f2-ddd9088461ca')
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
      () => assertBoardId('372ea1bf-8bac-481b-94f2-ddd9088461c'),
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
  test('accepts palette names and shape types', () => {
    assert.equal(safeToken('yellow6', 'fillColor'), 'yellow6');
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
