import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { probeKindWithSettle } from '../src/holst.js';

// Unit tests for the issue #6 settle probe: after any page reload (self-heal
// in ensureMounted / batch mount-check) the page serves an empty yDoc for a
// boot/sync window, so the kind probe must RETRY transient "absent object"
// and boot TypeErrors before declaring 'object not found'.
// Same scripted-session pattern as arrow-label-verify.test.js.

/** Scripted session: evaluate(expr) pops the next scripted reply. */
function scriptedSession(replies) {
  const calls = [];
  const session = {
    calls,
    evaluate: async (expr) => {
      calls.push(expr);
      const r = replies.length ? replies.shift() : { __error: 'no scripted reply' };
      if (r === 'THROW') throw new Error('cdp gone');
      return r;
    },
  };
  return session;
}

const BOOT_TYPEERROR = {
  __error: "TypeError: Cannot read properties of undefined (reading 'yPersistence')",
};

describe('probeKindWithSettle (issue #6: post-reload boot/sync window)', () => {
  test('object addressable immediately: single probe, no retries', async () => {
    const s = scriptedSession(['arrow']);
    const kind = await probeKindWithSettle(s, 'a1', { attempts: 6, delayMs: 0 });
    assert.equal(kind, 'arrow');
    assert.equal(s.calls.length, 1);
  });

  test('empty yDoc (null kind) is retried until the object syncs in', async () => {
    const s = scriptedSession([null, null, 'arrow']);
    const kind = await probeKindWithSettle(s, 'a1', { attempts: 6, delayMs: 0 });
    assert.equal(kind, 'arrow');
    assert.equal(s.calls.length, 3);
  });

  test('boot TypeError (ds/yPersistence absent) is retried, not thrown', async () => {
    const s = scriptedSession([BOOT_TYPEERROR, null, 'sticker']);
    const kind = await probeKindWithSettle(s, 'a1', { attempts: 6, delayMs: 0 });
    assert.equal(kind, 'sticker');
    assert.equal(s.calls.length, 3);
  });

  test('non-transient probe error fails fast: no retries, error surfaced', async () => {
    const s = scriptedSession([{ __error: 'SyntaxError: unexpected token' }]);
    await assert.rejects(
      () => probeKindWithSettle(s, 'a1', { attempts: 6, delayMs: 0 }),
      /SyntaxError: unexpected token/
    );
    assert.equal(s.calls.length, 1);
  });

  test('object never appears: accurate "object not found" after the settle budget', async () => {
    const s = scriptedSession([null, null, null]);
    await assert.rejects(
      () => probeKindWithSettle(s, 'deadbeef-0000', { attempts: 2, delayMs: 0 }),
      (e) => {
        assert.match(e.message, /object not found: deadbeef-0000/);
        assert.match(e.message, /empty|sync/i); // says WHY: page showed empty yDoc
        return true;
      }
    );
    assert.equal(s.calls.length, 3); // attempts + 1 probes total
  });

  test('page never boots (persistent TypeError): last boot error surfaced, not "not found"', async () => {
    const s = scriptedSession([BOOT_TYPEERROR, BOOT_TYPEERROR, BOOT_TYPEERROR]);
    await assert.rejects(
      () => probeKindWithSettle(s, 'a1', { attempts: 2, delayMs: 0 }),
      /yPersistence/
    );
    assert.equal(s.calls.length, 3);
  });
});
