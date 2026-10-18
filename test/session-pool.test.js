import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { CDPSession, acquirePooledSession, releaseSession, __clearPoolForTests } from '../src/cdp.js';

let wss;
let port;

beforeEach(async () => {
  __clearPoolForTests();
  wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((res) => wss.on('listening', res));
  port = wss.address().port;
});

afterEach(async () => {
  __clearPoolForTests();
  for (const c of wss.clients) c.terminate();
  await new Promise((res) => wss.close(() => res()));
});

function factory() {
  const s = new CDPSession(`ws://127.0.0.1:${port}/devtools/page/1`);
  return s.connect().then(() => s);
}

describe('session pool', () => {
  test('same key reuses the same session instance', async () => {
    const a = await acquirePooledSession('board:x', factory);
    const b = await acquirePooledSession('board:x', factory);
    assert.equal(b, a);
  });

  test('release then acquire within TTL reuses the session', async () => {
    const a = await acquirePooledSession('board:x', factory);
    releaseSession(a);
    const b = await acquirePooledSession('board:x', factory);
    assert.equal(b, a);
  });

  test('dead socket evicted — new session created', async () => {
    const a = await acquirePooledSession('board:x', factory);
    releaseSession(a);
    a.ws.terminate(); // connection dies while pooled
    await new Promise((r) => setTimeout(r, 100));
    const b = await acquirePooledSession('board:x', factory);
    assert.notEqual(b, a);
  });

  test('different keys get different sessions', async () => {
    const a = await acquirePooledSession('board:1', factory);
    const b = await acquirePooledSession('board:2', factory);
    assert.notEqual(b, a);
  });

  test('concurrent acquires share one creation (single-flight)', async () => {
    const [a, b, c] = await Promise.all([
      acquirePooledSession('board:y', factory),
      acquirePooledSession('board:y', factory),
      acquirePooledSession('board:y', factory),
    ]);
    assert.equal(b, a);
    assert.equal(c, a);
  });
});
