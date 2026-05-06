// Minimal CDP client over raw WebSocket (no chrome-remote-interface dep).
// One target = one CDP session. Methods: connect, send, evaluate, close.

import WebSocket from 'ws';
import http from 'node:http';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 9222;

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
  return await getCdpJSON('/json/list');
}

export async function findHolstTab({ predicate } = {}) {
  const tabs = await listTabs();
  return tabs.find((t) => t.type === 'page' && t.url && t.url.includes('app.holst.so') && (!predicate || predicate(t)));
}

export class CDPSession {
  constructor(webSocketDebuggerUrl) {
    this.url = webSocketDebuggerUrl;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map(); // method -> [handlers]
  }

  async connect() {
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
    await new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
    return this;
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}) {
    this.id++;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Run JS expression in page context. Returns the value.
   * If expression is async, set { awaitPromise: true }.
   */
  async evaluate(expression, { awaitPromise = false, returnByValue = true } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression: expression,
      awaitPromise,
      returnByValue,
    });
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
export async function openHolstSession({ tabPredicate } = {}) {
  const tab = await findHolstTab({ predicate: tabPredicate });
  if (!tab) {
    throw new Error(
      'No app.holst.so tab found in Holst desktop. Make sure Holst is launched with --remote-debugging-port=9222 and you are logged in.'
    );
  }
  const session = new CDPSession(tab.webSocketDebuggerUrl);
  await session.connect();
  return { session, tab };
}
