// Minimal CDP client over raw WebSocket (no chrome-remote-interface dep).
// One target = one CDP session. Methods: connect, send, evaluate, close.

import WebSocket from 'ws';
import http from 'node:http';
import { ensureCdp } from './autostart.js';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = Number(process.env.HOLST_DEBUG_PORT) || 9222;

const HOLST_ORIGIN = 'app.holst.so';

/**
 * Strict origin check: parse the URL and compare the hostname.
 * Substring matching (`url.includes('app.holst.so')`) would also match
 * attacker URLs like https://evil.com/?app.holst.so.
 */
export function isHolstUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl === '') return false;
  try {
    const u = new URL(rawUrl);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname === HOLST_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * True when the tab URL is an app.holst.so page showing exactly this board
 * (path segment /board/{boardId}, possibly nested, possibly with query params).
 */
export function isBoardUrl(rawUrl, boardId) {
  if (!isHolstUrl(rawUrl)) return false;
  try {
    const u = new URL(rawUrl);
    const want = `/board/${boardId}`;
    const path = u.pathname;
    return path === want || path.endsWith(want);
  } catch {
    return false;
  }
}

export function getCdpJSON(path = '/json/list', host = DEFAULT_HOST, port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    http.get(`http://${host}:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

export async function listTabs() {
  try {
    return await getCdpJSON('/json/list');
  } catch (e) {
    // CDP endpoint down → auto-launch Holst with the debug port, then retry once.
    await ensureCdp();
    return await getCdpJSON('/json/list');
  }
}

export async function findHolstTab({ predicate } = {}) {
  const tabs = await listTabs();
  return tabs.find((t) => t.type === 'page' && isHolstUrl(t.url) && (!predicate || predicate(t)));
}

export class CDPSession {
  constructor(webSocketDebuggerUrl, { timeoutMs = 15000 } = {}) {
    this.url = webSocketDebuggerUrl;
    this.timeoutMs = timeoutMs;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map(); // method -> [handlers]
  }

  async connect({ timeoutMs = 10000 } = {}) {
    this.ws = new WebSocket(this.url);
    this.ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message || JSON.stringify(msg.error))) : resolve(msg.result);
        return;
      }
      if (msg.method && this.listeners.has(msg.method)) {
        for (const fn of this.listeners.get(msg.method)) {
          try { fn(msg.params); } catch {}
        }
      }
    });
    // Fail all in-flight requests when the connection dies —
    // otherwise their promises hang forever.
    this.ws.on('close', () => this.#failPending('CDP connection closed'));
    this.ws.on('error', (err) => this.#failPending(`CDP connection error: ${err.message}`));
    await new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.ws?.terminate();
        rej(new Error(`CDP connect timeout after ${timeoutMs}ms: ${this.url}`));
      }, timeoutMs);
      this.ws.once('open', () => { clearTimeout(timer); res(); });
      this.ws.once('error', (err) => { clearTimeout(timer); rej(err); });
    });
    return this;
  }

  #failPending(message) {
    for (const { reject } of this.pending.values()) {
      try { reject(new Error(message)); } catch {}
    }
    this.pending.clear();
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}, { timeoutMs = this.timeoutMs } = {}) {
    this.id++;
    const id = this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout (${timeoutMs}ms) waiting for response to ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Run JS expression in page context. Returns the value.
   * If expression is async, set { awaitPromise: true }.
   */
  async evaluate(expression, { awaitPromise = false, returnByValue = true, timeoutMs } = {}) {
    const r = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise, returnByValue },
      timeoutMs != null ? { timeoutMs } : {}
    );
    if (r.exceptionDetails) {
      const text = r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails);
      throw new Error('JS exception: ' + text);
    }
    return r.result?.value;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

/**
 * Open a CDP session against the first holst tab matching predicate (default: workspace or board).
 * Caller must call session.close() after use.
 */

// ---- Session pool -------------------------------------------------------
// Reusing one CDP WebSocket per board removes ~0.5-1s of setup from every
// tool call. Entries are keyed (e.g. 'board:<uuid>'); released sessions stay
// alive for an idle TTL, dead sockets are evicted on sight, and concurrent
// acquires share a single creation (single-flight).

const POOL_TTL_MS = 60_000;
const pool = new Map(); // key -> { session, timer?, creating? }

function pooledEntry(key, factory) {
  let entry = pool.get(key);
  if (entry?.creating) return entry.creating;
  if (entry && !entry.creating && entry.session.ws?.readyState === WebSocket.OPEN) {
    if (entry.timer) { clearTimeout(entry.timer); delete entry.timer; }
    return Promise.resolve(entry.session);
  }
  if (entry && entry.timer) clearTimeout(entry.timer);
  pool.delete(key);
  const creating = factory().then((session) => {
    const cur = pool.get(key);
    if (cur?.creating === creating) {
      delete cur.creating;
      cur.session = session;
    } else if (!pool.has(key)) {
      pool.set(key, { session });
    }
    return session;
  }).catch((e) => {
    if (pool.get(key)?.creating === creating) pool.delete(key);
    throw e;
  });
  pool.set(key, { creating });
  return creating;
}

export async function acquirePooledSession(key, factory) {
  return pooledEntry(key, factory);
}

export function releaseSession(session) {
  for (const [key, entry] of pool.entries()) {
    if (entry.session === session) {
      entry.timer = setTimeout(() => {
        try { session.close(); } catch {}
        pool.delete(key);
      }, POOL_TTL_MS);
      entry.timer.unref?.();
      return key;
    }
  }
  // not pooled — close for real
  try { session.close(); } catch {}
  return null;
}

export function __clearPoolForTests() {
  for (const [, entry] of pool.entries()) {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.session) { try { entry.session.close(); } catch {} }
  }
  pool.clear();
}
// -------------------------------------------------------------------------

export async function openHolstSession({ tabPredicate } = {}) {
  const tab = await findHolstTab({ predicate: tabPredicate });
  if (!tab) {
    throw new Error(
      'No app.holst.so tab found in the Holst desktop app. ' +
      'Make sure the user is logged in to Holst (the app must show a workspace/board, not a login screen), ' +
      'then retry. CDP endpoint itself is reachable — run holst_doctor for a full diagnosis.'
    );
  }
  const session = new CDPSession(tab.webSocketDebuggerUrl);
  await session.connect();
  return { session, tab };
}
