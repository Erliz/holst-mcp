import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isHolstUrl, isBoardUrl } from '../src/cdp.js';

describe('isHolstUrl', () => {
  test('accepts app.holst.so board url', () => {
    assert.equal(isHolstUrl('https://app.holst.so/board/372ea1bf-8bac-481b-94f2-ddd9088461ca'), true);
  });

  test('accepts app.holst.so root', () => {
    assert.equal(isHolstUrl('https://app.holst.so/'), true);
  });

  test('rejects query-string substring trick', () => {
    assert.equal(isHolstUrl('https://evil.com/?app.holst.so'), false);
  });

  test('rejects path substring trick', () => {
    assert.equal(isHolstUrl('https://evil.com/app.holst.so'), false);
  });

  test('rejects lookalike domain', () => {
    assert.equal(isHolstUrl('https://app.holst.so.evil.com/'), false);
    assert.equal(isHolstUrl('https://app-holst-so.evil.com/'), false);
  });

  test('rejects non-http and garbage', () => {
    assert.equal(isHolstUrl('about:blank'), false);
    assert.equal(isHolstUrl('chrome-error://chromewebdata/'), false);
    assert.equal(isHolstUrl(''), false);
    assert.equal(isHolstUrl(null), false);
    assert.equal(isHolstUrl(undefined), false);
  });
});

describe('isBoardUrl', () => {
  const UUID = '372ea1bf-8bac-481b-94f2-ddd9088461ca';

  test('accepts exact board url', () => {
    assert.equal(isBoardUrl(`https://app.holst.so/board/${UUID}`, UUID), true);
  });

  test('accepts nested workspace board url', () => {
    assert.equal(isBoardUrl(`https://app.holst.so/ws/abc/board/${UUID}`, UUID), true);
  });

  test('accepts url with query params', () => {
    assert.equal(isBoardUrl(`https://app.holst.so/board/${UUID}?x=1`, UUID), true);
  });

  test('rejects different board id', () => {
    assert.equal(isBoardUrl('https://app.holst.so/board/other-id', UUID), false);
  });

  test('rejects board id as substring of another id', () => {
    assert.equal(isBoardUrl(`https://app.holst.so/board/${UUID}extra`, UUID), false);
  });

  test('rejects non-holst origin', () => {
    assert.equal(isBoardUrl(`https://evil.com/board/${UUID}`, UUID), false);
  });
});
