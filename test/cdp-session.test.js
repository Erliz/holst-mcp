import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import net from 'node:net';
import { CDPSession } from '../src/cdp.js';

let wss;
let port;
const openSessions = [];

beforeEach(async () => {
  wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((res) => wss.on('listening', res));
  port = wss.address().port;
});

afterEach(async () => {
  for (const s of openSessions.splice(0)) {
    try { s.close(); } catch {}
  }
  for (const c of wss.clients) c.terminate();
  await new Promise((res) => wss.close(() => res()));
});

function makeSession(url, opts) {
  const s = new CDPSession(url, opts);
  openSessions.push(s);
  return s;
}

function wsUrl() {
  return `ws://127.0.0.1:${port}/devtools/page/1`;
}

describe('CDPSession timeouts', () => {
  test('send resolves when server replies with matching id', { timeout: 3000 }, async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        ws.send(JSON.stringify({ id: msg.id, result: { value: 'ok' } }));
      });
    });
    const s = makeSession(wsUrl());
    await s.connect();
    const r = await s.send('Runtime.evaluate', { expression: '1' });
    assert.deepEqual(r, { value: 'ok' });
    s.close();
  });

  test('send rejects on timeout when server never replies', { timeout: 3000 }, async () => {
    wss.on('connection', () => {
      /* silence — no replies */
    });
    const s = makeSession(wsUrl());
    await s.connect();
    await assert.rejects(
      () => s.send('Runtime.evaluate', { expression: '1' }, { timeoutMs: 100 }),
      /timeout/i
    );
    s.close();
  });

  test('evaluate surfaces timeout as an error', { timeout: 3000 }, async () => {
    wss.on('connection', () => {});
    const s = makeSession(wsUrl());
    await s.connect();
    await assert.rejects(
      () => s.evaluate('while(true){}', { timeoutMs: 100 }),
      /timeout/i
    );
    s.close();
  });

  test('pending send rejects when connection drops', { timeout: 3000 }, async () => {
    wss.on('connection', (ws) => {
      ws.on('message', () => {
        // Server dies instead of answering.
        ws.close();
      });
    });
    const s = makeSession(wsUrl());
    await s.connect();
    await assert.rejects(
      () => s.send('Runtime.evaluate', { expression: '1' }, { timeoutMs: 5000 }),
      /closed/i
    );
  });

  test('connect rejects on timeout against silent TCP server', { timeout: 5000 }, async () => {
    const sockets = [];
    const srv = net.createServer((sock) => sockets.push(sock));
    await new Promise((res) => srv.listen(0, '127.0.0.1', res));
    const silentPort = srv.address().port;
    const s = makeSession(`ws://127.0.0.1:${silentPort}/devtools/page/1`);
    await assert.rejects(
      () => s.connect({ timeoutMs: 200 }),
      /timeout/i
    );
    for (const sock of sockets) sock.destroy();
    await new Promise((res) => srv.close(() => res()));
  });
});
