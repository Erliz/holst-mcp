import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_WRITE_HELPER } from '../src/eval-scripts.js';

// The v0.4 regression: NATIVE_WRITE_HELPER contained a literal
// ${SLATE_NODES_PLACEHOLDER} that only one call site substituted — raw
// embeddings (getBoardContent — the MAIN READ PATH) shipped it to the page,
// where V8 parsed "$" as an identifier and "{" as a syntax error. Unit tests
// passed because nothing compiled the generated eval scripts.
//
// These guards catch that bug class without a running Holst: the helper is
// page-JS source, so it must (a) carry no unresolved placeholders and
// (b) compile under the same parser that Runtime.evaluate uses.

describe('page-eval scripts compile (v0.4 placeholder regression guards)', () => {
  test('NATIVE_WRITE_HELPER contains no template placeholders', () => {
    // Values must arrive via function arguments, never via string
    // substitution into the helper body.
    assert.equal(
      NATIVE_WRITE_HELPER.includes('${'),
      false,
      'unresolved placeholder in helper: ' + NATIVE_WRITE_HELPER.match(/\$\{[^}]*\}/g)
    );
  });

  test('NATIVE_WRITE_HELPER compiles as page JS', () => {
    assert.doesNotThrow(() => {
      // new Function parses without executing — same failure mode the page
      // hit ("SyntaxError: Unexpected token '{'"), zero side effects.
      new Function(NATIVE_WRITE_HELPER + '\nreturn typeof __nativeWrite;');
    });
  });

  test('helper defines the __docText reader used by read paths', () => {
    // getBoardContent embeds the helper and calls __docText — its absence
    // would break every read the same way.
    const kind = new Function(NATIVE_WRITE_HELPER + '\nreturn typeof __docText;')();
    assert.equal(kind, 'function');
  });
});
