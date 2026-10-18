import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildArrowTexts } from '../src/arrow-text.js';
import { ValidationError } from '../src/validate.js';


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('buildArrowTexts', () => {
  test('single line: one label entry with plain-JSON Slate structure', () => {
    const texts = buildArrowTexts('request', 0.5);
    assert.equal(texts.length, 1);
    const t = texts[0];
    assert.equal(t.position, 0.5);
    assert.equal(t.text, 'request');
    assert.match(t.id, UUID_RE);
    // editor mirrors the app's format: wrapper -> paragraph -> {text}
    assert.equal(t.editor.length, 1);
    assert.equal(t.editor[0].type, 'wrapper');
    assert.match(t.editor[0].key, UUID_RE);
    const para = t.editor[0].children[0];
    assert.equal(para.type, 'paragraph');
    assert.match(para.key, UUID_RE);
    assert.deepEqual(para.children, [{ text: 'request' }]);
    // whole payload is JSON-serializable plain data (goes into yDoc as plain array)
    assert.deepEqual(JSON.parse(JSON.stringify(texts)), texts);
  });

  test('multiline: one wrapper per \\n, empty line = empty paragraph', () => {
    const texts = buildArrowTexts('a\n\nb', 0.3);
    assert.equal(texts[0].text, 'a\n\nb');
    assert.equal(texts[0].editor.length, 3);
    assert.deepEqual(
      texts[0].editor.map((w) => w.children[0].children[0].text),
      ['a', '', 'b']
    );
  });

  test('default position is 0.5', () => {
    assert.equal(buildArrowTexts('x')[0].position, 0.5);
  });

  test('every wrapper/paragraph gets a distinct uuid key', () => {
    const texts = buildArrowTexts('one\ntwo');
    const keys = texts[0].editor.flatMap((w) => [w.key, w.children[0].key]);
    assert.equal(new Set(keys).size, keys.length);
    for (const k of keys) assert.match(k, UUID_RE);
  });

  test('rejects non-string text', () => {
    assert.throws(() => buildArrowTexts(42), ValidationError);
    assert.throws(() => buildArrowTexts(null), ValidationError);
  });

  test('rejects position outside 0..1', () => {
    assert.throws(() => buildArrowTexts('x', 1.5), ValidationError);
    assert.throws(() => buildArrowTexts('x', -0.1), ValidationError);
    assert.throws(() => buildArrowTexts('x', 'mid'), ValidationError);
  });
});
