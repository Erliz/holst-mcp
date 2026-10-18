import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { plainDocText, expectedDocText, docTextMatches } from '../src/text-match.js';

describe('plainDocText (normalize what the board returned)', () => {
  test('plain text passes through', () => {
    assert.equal(plainDocText('hello'), 'hello');
  });

  test('mark tags are stripped', () => {
    assert.equal(plainDocText('<bold>bold text</bold>'), 'bold text');
    assert.equal(plainDocText('<bold><italic><underline>x</underline></italic></bold>'), 'x');
    assert.equal(plainDocText('<color 0="s" 1="k">colored</color>tail'), 'coloredtail');
  });

  test('newlines removed (paragraph boundaries carry no \\n in deltas)', () => {
    assert.equal(plainDocText('line1\nline2'), 'line1line2');
  });
});

describe('expectedDocText (normalize what the caller sent)', () => {
  test('drops newlines, keeps everything else', () => {
    assert.equal(expectedDocText('Name\nsublabel'), 'Namesublabel');
    assert.equal(expectedDocText('a\n\nb'), 'ab');
    assert.equal(expectedDocText('plain'), 'plain');
  });
});

describe('docTextMatches', () => {
  test('multiline write vs paragraph-joined read (the P0-4 bug)', () => {
    // board returns two paragraph inserts joined: 'Name' + 'sublabel'
    assert.equal(docTextMatches('Name\nsublabel', 'Namesublabel'), true);
  });

  test('styled write vs marked read', () => {
    assert.equal(docTextMatches('bold text', '<bold>bold text</bold>'), true);
  });

  test('multiline + styled', () => {
    assert.equal(docTextMatches('A\nB', '<bold>A</bold>B'), true);
  });

  test('mismatch detected', () => {
    assert.equal(docTextMatches('A\nB', 'AX'), false);
    assert.equal(docTextMatches('abc', '<bold>abd</bold>'), false);
  });

  test('empty lines survive round-trip', () => {
    // 'a\n\nb' → paragraphs 'a','','b' → joined 'ab'
    assert.equal(docTextMatches('a\n\nb', 'ab'), true);
  });
});
