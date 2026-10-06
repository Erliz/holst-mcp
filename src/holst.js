// Holst-specific helpers: pick the right tab, run /gapi/* with bearer, dump yDoc, etc.

import { openHolstSession, listTabs, isBoardUrl, isHolstUrl, getCdpJSON } from './cdp.js';
import { ensureCdp } from './autostart.js';
import {
  assertBoardId,
  assertObjectId,
  assertText,
  assertArrowEndpoint,
  num,
  safeToken,
} from './validate.js';
import { assertBoardAllowed, assertNotReadOnly, limitDump } from './policy.js';

const COORD = { min: -1e7, max: 1e7 };
const SIZE = { min: 1, max: 1e6 };

/**
 * Native document write through the app's own Slate editor pipeline
 * (singleDocumentStore.replaceFromJSON). Raw Y.Text inserts are NOT
 * rendered by Holst ≥ 2026-10 builds — the editor layer (toDelta) is
 * the rendering source of truth. Returns null when the native API is
 * unavailable (older builds) → caller falls back to raw Yjs.
 */
const NATIVE_WRITE_HELPER = `
  function __nativeWrite(objectId, docId, plainText) {
    try {
      const ds = window.ds;
      const sds = ds && ds.store && ds.store.objectBuilder && ds.store.objectBuilder.singleDocumentStore;
      if (!sds || typeof sds.getEditor !== 'function' || typeof sds.createFromString !== 'function') return null;
      const yDoc = ds.yPersistence.yDoc;
      const yDocs = yDoc.getMap('documents');
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = String(plainText).split('\\n').map((l) => '<p>' + esc(l) + '</p>').join('');
      const dt = new DataTransfer();
      dt.setData('text/plain', String(plainText));
      dt.setData('text/html', html);

      // Preferred: paste through the MOUNTED object's editor → renders live.
      const dom = ds.store.objects.get(objectId);
      const ed = dom && dom.editor;
      if (ed && typeof ed.insertData === 'function') {
        // select all text nodes (wrapper → paragraph → text), then replace
        const walk = (nodes, path, acc) => {
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const p = path.concat(i);
            if (n && n.text != null && typeof n.text === 'string') {
              acc.push({ path: p, len: n.text.length });
            } else if (n && Array.isArray(n.children)) {
              walk(n.children, p, acc);
            }
          }
          return acc;
        };
        const texts = walk(ed.children || [], [], []);
        if (texts.length) {
          const first = texts[0];
          const last = texts[texts.length - 1];
          try { ed.selection = { anchor: { path: first.path, offset: 0 }, focus: { path: last.path, offset: last.len } }; } catch (e) {}
          try { if (typeof ed.deleteFragment === 'function') ed.deleteFragment(); } catch (e) {}
        }
        ed.insertData(dt);
        try { if (typeof ed.deselect === 'function') ed.deselect(); } catch (e) {}
        try { if (typeof ed.flushLocalChanges === 'function') ed.flushLocalChanges(); } catch (e) {}
      } else {
        // Not mounted: replace the doc entry cleanly (fresh Y.Text + fresh editor +
        // native paste). Raw edits on a live Y.Text desync the Slate binding.
        yDoc.transact(() => { yDocs.set(docId, new window.Yjs.Text()); });
        if (typeof sds.removeEditor === 'function') sds.removeEditor(docId);
        sds.createFromString(docId, html);
      }

      const t = yDocs.get(docId);
      const got = t && typeof t.toDelta === 'function' ? t.toDelta().map((d) => d.insert || '').join('') : '';
      return { native: true, content: got };
    } catch (e) {
      return { native: true, error: String(e) };
    }
  }
  function __docText(yDoc, docId) {
    const v = yDoc.getMap('documents').get(docId);
    if (!v) return '';
    if (typeof v.toDelta === 'function') return v.toDelta().map((d) => d.insert || '').join('');
    return String(v);
  }
`;

/**
 * Resolve object → docId in page context. Returns { docId, nativeAvailable }.
 */
async function resolveDoc(session, objectId) {
  return await session.evaluate(
    `(() => {
      try {
        const yDoc = window.ds.yPersistence.yDoc;
        const yObjects = yDoc.getMap('objects');
        const obj = yObjects.get(${JSON.stringify(objectId)});
        if (!obj) return { __error: 'object not found: ' + ${JSON.stringify(objectId)} };
        const docId = obj.get ? obj.get('documentId') : obj.documentId;
        if (!docId) return { __error: 'object has no documentId' };
        const sds = window.ds && window.ds.store && window.ds.store.objectBuilder
          && window.ds.store.objectBuilder.singleDocumentStore;
        return { docId, nativeAvailable: !!(sds && sds.getEditor && sds.createFromString) };
      } catch (e) { return { __error: String(e) }; }
    })()`
  );
}

/**
 * Native Slate write with retries. The app's editor binding mounts a few
 * seconds after object creation and syncs its (empty) view-model INTO the
 * doc, wiping early writes — so we retry until content sticks.
 * Returns true/false on success; null if native API unavailable.
 */
async function nativeWriteWithRetry(session, objectId, docId, text, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const r = await session.evaluate(
      `(() => {
        try {
          ${NATIVE_WRITE_HELPER}
          const w = __nativeWrite(${JSON.stringify(objectId)}, ${JSON.stringify(docId)}, ${JSON.stringify(text)});
          return w;
        } catch (e) { return { native: true, error: String(e) }; }
      })()`
    );
    if (r === null) return null; // native API unavailable
    if (!r.error && r.content === text) return true;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return false;
}

/**
 * After add_*: verify the app's domain store actually mounted the new object.
 * Holst occasionally drops objects created via rapid CDP writes (they stay in
 * yDoc but never render). A page reload re-mounts everything from yDoc.
 */
async function ensureMounted(session, objectId) {
  for (let i = 0; i < 3; i++) {
    const mounted = await session.evaluate(
      `(() => { try { return !!(window.ds && window.ds.store && window.ds.store.objects.has(${JSON.stringify(objectId)})); } catch (e) { return false; } })()`
    );
    if (mounted) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Self-heal: reload mounts all yDoc objects
  try {
    await session.send('Page.enable', {});
    await session.send('Page.reload', { ignoreCache: true });
    await new Promise((r) => setTimeout(r, 7000));
    const remounted = await session.evaluate(
      `(() => { try { return !!(window.ds && window.ds.store && window.ds.store.objects.has(${JSON.stringify(objectId)})); } catch (e) { return false; } })()`
    );
    return remounted;
  } catch {
    return false;
  }
}

/**
 * Eval inside the page: extract auth token from localStorage and run an authenticated fetch
 * against an /gapi/* endpoint. Returns parsed JSON or text.
 */
async function gapiInPage(session, url) {
  const expr = `(async () => {
    const auth = JSON.parse(localStorage.getItem('social-auth-store') || '{}');
    const token = auth.token;
    if (!token) return { __error: 'no auth token in localStorage[social-auth-store]' };
    const headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' };
    const r = await fetch(${JSON.stringify(url)}, { credentials: 'include', headers });
    const ct = r.headers.get('content-type') || '';
    let body = ct.includes('json') ? await r.json() : await r.text();
    return { __status: r.status, __body: body };
  })()`;
  const v = await session.evaluate(expr, { awaitPromise: true });
  if (v && v.__error) throw new Error(v.__error);
  if (v && v.__status >= 400) throw new Error(`Holst API ${v.__status}: ${typeof v.__body === 'string' ? v.__body.slice(0, 200) : JSON.stringify(v.__body).slice(0, 300)}`);
  return v?.__body;
}

/**
 * Try to find a tab already showing the requested boardId. Falls back to any holst tab,
 * then navigates to the board URL.
 */
async function getBoardSession(boardId) {
  const tabs = await listTabs();
  const boardTab = tabs.find(
    (t) => t.type === 'page' && isBoardUrl(t.url, boardId)
  );
  if (boardTab) {
    const { session } = await openHolstSession({
      tabPredicate: (t) => isBoardUrl(t.url, boardId),
    });
    return session;
  }
  // Take any holst tab and navigate it to the board.
  const { session } = await openHolstSession();
  await session.send('Page.navigate', { url: `https://app.holst.so/board/${boardId}` });
  // Wait for page to load (best-effort).
  await new Promise((r) => setTimeout(r, 4000));
  // Wait for ds.yPersistence.yDoc to appear.
  for (let i = 0; i < 30; i++) {
    const ready = await session.evaluate(
      `(() => { try { return !!window.ds?.yPersistence?.yDoc?.share; } catch (e) { return false; } })()`
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return session;
}

/**
 * List boards the logged-in user can access.
 * Combines /gapi/recent/channels with /gapi/workspace/{id}/tree per workspace.
 */
export async function listBoards() {
  const { session } = await openHolstSession();
  try {
    const me = await gapiInPage(session, '/gapi/current_user');
    const workspaces = me?.workspaces || [];
    const recent = await gapiInPage(session, '/gapi/recent/channels').catch(() => []);
    const trees = [];
    for (const ws of workspaces) {
      try {
        const tree = await gapiInPage(session, `/gapi/workspace/${ws.id}/tree`);
        trees.push({ workspace: { id: ws.id, name: ws.name }, tree });
      } catch (e) {
        trees.push({ workspace: { id: ws.id, name: ws.name }, error: String(e) });
      }
    }
    return {
      user: { id: me?.id, name: me?.name, email: me?.email },
      recent,
      workspaces: trees,
    };
  } finally {
    session.close();
  }
}

/**
 * Get full board content as the underlying Yjs JSON dump:
 * { documents: { docId: text }, objects: { oid: { type, position, documentId, ... } }, ... }
 */
export async function getBoardContent(boardId) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  const session = await getBoardSession(boardId);
  try {
    const meta = await gapiInPage(session, `/gapi/channel/${boardId}`).catch(() => null);
    const yjson = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const dump = yDoc.toJSON();
          ${NATIVE_WRITE_HELPER}
          // Rendering layer (Slate editors) is the source of truth for text:
          // raw Y.Text content is empty for docs written via the native pipeline.
          const documents = {};
          for (const [k, v] of yDoc.getMap('documents').entries()) {
            documents[k] = v && typeof v.toDelta === 'function'
              ? v.toDelta().map((d) => d.insert || '').join('')
              : (v == null ? '' : String(v));
          }
          dump.documents = documents;
          return dump;
        } catch (e) { return { __error: String(e) }; }
      })()`
    );
    if (yjson?.__error) throw new Error(yjson.__error);
    return { meta, content: limitDump(yjson) };
  } finally {
    session.close();
  }
}

/**
 * Build a structured markdown summary by grouping stickers under their nearest section header
 * (heuristic: section above sticker, within 800px vertical and 600px horizontal).
 */
export async function getBoardSummary(boardId) {
  const { meta, content } = await getBoardContent(boardId);
  const docs = content.documents || {};
  const objs = content.objects || {};
  const stripTags = (s) => (s ? String(s).replace(/<[^>]+>/g, '').trim() : '');
  const text = (did) => stripTags(docs[did]);
  const items = [];
  for (const [oid, obj] of Object.entries(objs)) {
    items.push({
      id: oid,
      type: obj.type,
      x: obj.position?.x ?? 0,
      y: obj.position?.y ?? 0,
      w: obj.width ?? 0,
      h: obj.height ?? 0,
      text: text(obj.documentId),
      shapeType: obj.shapeType,
    });
  }
  const sections = items.filter((it) => it.type === 'shape' && it.text);
  const stickers = items.filter((it) => (it.type === 'sticker' || it.type === 'simple-text') && it.text);
  function nearestSection(it) {
    let best = null,
      bestD = Infinity;
    for (const sec of sections) {
      const dx = Math.abs(sec.x - it.x);
      const dy = it.y - sec.y;
      if (dy < -50 || dy > 800 || dx > 600) continue;
      const d = Math.hypot(dx, Math.max(dy - 50, 0) * 0.6);
      if (d < bestD) {
        bestD = d;
        best = sec;
      }
    }
    return best;
  }
  const groups = new Map();
  const orphans = [];
  for (const st of stickers) {
    const sec = nearestSection(st);
    if (sec) {
      if (!groups.has(sec.id)) groups.set(sec.id, []);
      groups.get(sec.id).push(st);
    } else {
      orphans.push(st);
    }
  }
  sections.sort((a, b) => Math.round(a.y / 200) - Math.round(b.y / 200) || a.x - b.x);
  const out = [];
  out.push(`# Доска «${meta?.name ?? boardId}»`);
  out.push('');
  out.push(
    `**Объектов:** ${items.length} (стикеров: ${stickers.filter((s) => s.type === 'sticker').length}, секций: ${sections.length}, текстовых меток: ${stickers.filter((s) => s.type === 'simple-text').length}, стрелок: ${items.filter((i) => i.type === 'arrow').length})`
  );
  out.push('');
  for (const sec of sections) {
    out.push(`## ${sec.text}`);
    out.push(`_x=${Math.round(sec.x)}, y=${Math.round(sec.y)}_`);
    out.push('');
    const children = groups.get(sec.id) || [];
    children.sort(
      (a, b) => Math.round(a.y / 100) - Math.round(b.y / 100) || a.x - b.x
    );
    if (!children.length) out.push('_(нет вложенных стикеров)_');
    for (const c of children) {
      out.push(`- **[${c.type}]** ${c.text}`);
    }
    out.push('');
  }
  if (orphans.length) {
    out.push('## ⚠ Не отнесённые к секциям');
    for (const c of orphans) out.push(`- **[${c.type}]** _x=${Math.round(c.x)},y=${Math.round(c.y)}_  ${c.text}`);
    out.push('');
  }
  return { meta, summary: out.join('\n') };
}

/**
 * Plain-text search across all sticker / shape / simple-text documents on the board.
 * Returns array of matches with object id, type, text snippet, position.
 */
export async function searchBoardText(boardId, query) {
  query = assertText(query, 'query', { maxLen: 1000 });
  const { content } = await getBoardContent(boardId);
  const q = String(query).toLowerCase();
  const docs = content.documents || {};
  const objs = content.objects || {};
  const matches = [];
  for (const [oid, obj] of Object.entries(objs)) {
    const text = String(docs[obj.documentId] || '').replace(/<[^>]+>/g, '');
    if (text.toLowerCase().includes(q)) {
      matches.push({
        id: oid,
        type: obj.type,
        x: obj.position?.x ?? 0,
        y: obj.position?.y ?? 0,
        text: text.length > 300 ? text.slice(0, 300) + '...' : text,
      });
    }
  }
  return matches;
}

/**
 * Add a sticker to a board. Returns the new object id.
 * The sticker text content is stored in a separate "document" (Y.Map keyed by docId).
 * Coordinates are absolute board coords; default size 192x192.
 */
export async function addSticker(boardId, { text, x, y, width = 192, height = 192, color = 'yellow' }) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  assertNotReadOnly();
  text = assertText(text, 'text');
  x = num(x, 'x', COORD);
  y = num(y, 'y', COORD);
  width = num(width, 'width', SIZE);
  height = num(height, 'height', SIZE);
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const Yjs = window.Yjs;
          const yObjects = yDoc.getMap('objects');
          const yDocs = yDoc.getMap('documents');
          const newId = (window.crypto || crypto).randomUUID();
          const newDocId = (window.crypto || crypto).randomUUID();
          // figure out next zIndex (look at toJSON of each Y.Map)
          let maxZ = 0;
          for (const [, v] of yObjects.entries()) {
            const z = v && v.get ? v.get('zIndex') : (v && v.zIndex);
            if (typeof z === 'number' && z > maxZ) maxZ = z;
          }
          const yStickerMap = new Yjs.Map();
          const fields = {
            type: 'sticker',
            documentId: newDocId,
            position: { x: ${Number(x)}, y: ${Number(y)} },
            width: ${Number(width)},
            height: ${Number(height)},
            textScale: 0.7346875,
            zIndex: maxZ + 1,
            created: { a: 0, t: Date.now() },
            updated: null,
            id: newId,
            parentId: null,
          };
          for (const k of Object.keys(fields)) yStickerMap.set(k, fields[k]);
          const yText = new Yjs.Text();
          yDoc.transact(() => {
            yDocs.set(newDocId, yText);
            yObjects.set(newId, yStickerMap);
          });
          return { ok: true, id: newId, documentId: newDocId };
        } catch (e) { return { __error: String(e) }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    result.mounted = await ensureMounted(session, result.id);
    // Text must land AFTER the editor binding settles: on mount the app syncs
    // its empty view-model into the doc, wiping writes made in the first ~1-3s.
    await new Promise((r) => setTimeout(r, 2000));
    result.native = await nativeWriteWithRetry(session, result.id, result.documentId, text);
    return result;
  } finally {
    session.close();
  }
}

/**
 * Update text on an existing sticker / shape / simple-text object.
 * Looks up the object's documentId and rewrites that document.
 */
export async function updateText(boardId, objectId, text) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  assertNotReadOnly();
  assertObjectId(objectId);
  text = assertText(text, 'text');
  const session = await getBoardSession(boardId);
  try {
    const doc = await resolveDoc(session, objectId);
    if (doc?.__error) throw new Error(doc.__error);

    // Preferred: native Slate pipeline (renders correctly).
    if (doc.nativeAvailable) {
      const ok = await nativeWriteWithRetry(session, objectId, doc.docId, text);
      if (ok) {
        await session.evaluate(
          `(() => { try { const o = window.ds.yPersistence.yDoc.getMap('objects').get(${JSON.stringify(objectId)}); if (o && o.set) o.set('updated', { a: 0, t: Date.now() }); return true; } catch (e) { return false; } })()`
        );
        return { ok: true, native: true, id: objectId, documentId: doc.docId };
      }
      throw new Error('native write did not stick after retries (editor binding race?)');
    }

    // Fallback: raw Yjs write (older builds).
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const Yjs = window.Yjs;
          const yDocs = yDoc.getMap('documents');
          let writeError = null;
          try {
            yDoc.transact(() => {
              const yText = yDocs.get(${JSON.stringify(doc.docId)});
              if (yText && typeof yText.delete === 'function' && typeof yText.insert === 'function') {
                if (yText.length > 0) yText.delete(0, yText.length);
                yText.insert(0, ${JSON.stringify(text)});
              } else {
                const fresh = new Yjs.Text();
                fresh.insert(0, ${JSON.stringify(text)});
                yDocs.set(${JSON.stringify(doc.docId)}, fresh);
              }
            });
          } catch (e) { writeError = String(e); }
          ${NATIVE_WRITE_HELPER}
          const storedStr = __docText(yDoc, ${JSON.stringify(doc.docId)}).replace(/<[^>]+>/g, '');
          if (storedStr !== ${JSON.stringify(text)}) {
            return { __error: writeError ? writeError + ' (and content did not land)' : 'content mismatch after update' };
          }
          return { ok: true, native: false, id: ${JSON.stringify(objectId)}, documentId: ${JSON.stringify(doc.docId)}, warning: writeError || null };
        } catch (e) { return { __error: String(e) }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    return result;
  } finally {
    session.close();
  }
}

/**
 * Delete an object from the board. Also clears its document if exclusive.
 */
export async function deleteObject(boardId, objectId) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  assertNotReadOnly();
  assertObjectId(objectId);
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const yObjects = yDoc.getMap('objects');
          const yDocs = yDoc.getMap('documents');
          const obj = yObjects.get(${JSON.stringify(objectId)});
          if (!obj) return { __error: 'object not found' };
          const docId = obj.get ? obj.get('documentId') : obj.documentId;
          yDoc.transact(() => {
            yObjects.delete(${JSON.stringify(objectId)});
            if (docId) yDocs.delete(docId);
          });
          return { ok: true, removed: ${JSON.stringify(objectId)}, removedDocument: docId || null };
        } catch (e) { return { __error: String(e), stack: e.stack }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    return result;
  } finally {
    session.close();
  }
}

/**
 * Add a section header — a shape (square by default) with a text label inside.
 * shapeType: 'square' | 'circle' | 'round-rect' | 'rhombus' | 'triangle' (Holst supports more)
 */
export async function addShape(boardId, {
  text = '',
  x,
  y,
  width = 240,
  height = 48,
  shapeType = 'square',
  fillColor = 'white6',
  strokeColor = 'gray12',
  strokeWidth = 2,
  fixedSize = true,
}) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  assertNotReadOnly();
  text = assertText(text, 'text', { default: '' });
  x = num(x, 'x', COORD);
  y = num(y, 'y', COORD);
  width = num(width, 'width', SIZE);
  height = num(height, 'height', SIZE);
  shapeType = safeToken(shapeType, 'shapeType', { default: 'square' });
  fillColor = safeToken(fillColor, 'fillColor', { default: 'white6' });
  strokeColor = safeToken(strokeColor, 'strokeColor', { default: 'gray12' });
  strokeWidth = num(strokeWidth, 'strokeWidth', { min: 0, max: 100 });
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const Yjs = window.Yjs;
          const yObjects = yDoc.getMap('objects');
          const yDocs = yDoc.getMap('documents');
          const newId = (window.crypto || crypto).randomUUID();
          const newDocId = (window.crypto || crypto).randomUUID();
          let maxZ = 0;
          for (const [, v] of yObjects.entries()) {
            const z = v && v.get ? v.get('zIndex') : (v && v.zIndex);
            if (typeof z === 'number' && z > maxZ) maxZ = z;
          }
          const map = new Yjs.Map();
          const fields = {
            type: 'shape',
            shapeType: ${JSON.stringify(shapeType)},
            documentId: newDocId,
            width: ${Number(width)},
            height: ${Number(height)},
            fixedSize: ${Boolean(fixedSize)},
            fillColor: { color: ${JSON.stringify(fillColor)}, opacity: 1 },
            strokeColor: { color: ${JSON.stringify(strokeColor)}, opacity: 1 },
            strokeWidth: ${Number(strokeWidth)},
            position: { x: ${Number(x)}, y: ${Number(y)} },
            zIndex: maxZ + 1,
            created: { a: 0, t: Date.now() },
            updated: null,
            id: newId,
            parentId: null,
          };
          for (const k of Object.keys(fields)) map.set(k, fields[k]);
          const yText = new Yjs.Text();
          yDoc.transact(() => {
            yDocs.set(newDocId, yText);
            yObjects.set(newId, map);
          });
          return { ok: true, id: newId, documentId: newDocId };
        } catch (e) { return { __error: String(e) }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    result.mounted = await ensureMounted(session, result.id);
    // Text must land AFTER the editor binding settles: on mount the app syncs
    // its empty view-model into the doc, wiping writes made in the first ~1-3s.
    await new Promise((r) => setTimeout(r, 2000));
    result.native = await nativeWriteWithRetry(session, result.id, result.documentId, text);
    return result;
  } finally {
    session.close();
  }
}

/**
 * Add a simple-text label (typed via T in UI). Sized automatically by content.
 */
export async function addSimpleText(boardId, { text, x, y }) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  assertNotReadOnly();
  text = assertText(text, 'text');
  x = num(x, 'x', COORD);
  y = num(y, 'y', COORD);
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const Yjs = window.Yjs;
          const yObjects = yDoc.getMap('objects');
          const yDocs = yDoc.getMap('documents');
          const newId = (window.crypto || crypto).randomUUID();
          const newDocId = (window.crypto || crypto).randomUUID();
          let maxZ = 0;
          for (const [, v] of yObjects.entries()) {
            const z = v && v.get ? v.get('zIndex') : (v && v.zIndex);
            if (typeof z === 'number' && z > maxZ) maxZ = z;
          }
          const map = new Yjs.Map();
          const fields = {
            type: 'simple-text',
            position: { x: ${Number(x)}, y: ${Number(y)} },
            documentId: newDocId,
            zIndex: maxZ + 1,
            created: { a: 0, t: Date.now() },
            updated: null,
            id: newId,
            parentId: null,
          };
          for (const k of Object.keys(fields)) map.set(k, fields[k]);
          const yText = new Yjs.Text();
          yDoc.transact(() => {
            yDocs.set(newDocId, yText);
            yObjects.set(newId, map);
          });
          return { ok: true, id: newId, documentId: newDocId };
        } catch (e) { return { __error: String(e) }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    result.mounted = await ensureMounted(session, result.id);
    // Text must land AFTER the editor binding settles: on mount the app syncs
    // its empty view-model into the doc, wiping writes made in the first ~1-3s.
    await new Promise((r) => setTimeout(r, 2000));
    result.native = await nativeWriteWithRetry(session, result.id, result.documentId, text);
    return result;
  } finally {
    session.close();
  }
}

/**
 * Add an arrow connecting two points. Each endpoint can either be a free point {x, y}
 * or attached to an object: { objectId, relativePoint: {x, y} } where relativePoint
 * is normalized 0..1 within the object's bounds.
 */
export async function addArrow(boardId, {
  start,           // { x, y } | { objectId, relativePoint: {x, y} }
  end,
  arrowType = 'elbow',  // 'elbow' | 'straight' | 'curved'
  strokeColor = 'gray10',
}) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  assertNotReadOnly();
  assertArrowEndpoint(start, 'start');
  assertArrowEndpoint(end, 'end');
  arrowType = safeToken(arrowType, 'arrowType', { default: 'elbow' });
  strokeColor = safeToken(strokeColor, 'strokeColor', { default: 'gray10' });
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const Yjs = window.Yjs;
          const yObjects = yDoc.getMap('objects');
          const newId = (window.crypto || crypto).randomUUID();
          let maxZ = 0;
          for (const [, v] of yObjects.entries()) {
            const z = v && v.get ? v.get('zIndex') : (v && v.zIndex);
            if (typeof z === 'number' && z > maxZ) maxZ = z;
          }
          const map = new Yjs.Map();
          const start = ${JSON.stringify(start)};
          const end = ${JSON.stringify(end)};
          // Normalize endpoints to Holst format
          function normalize(ep) {
            if (ep.objectId) {
              return {
                objectId: ep.objectId,
                point: ep.point || { x: 0, y: 0 },
                relativePoint: ep.relativePoint || { x: 0.5, y: 0.5 },
                control: ep.control ?? null,
              };
            }
            return {
              point: { x: ep.x, y: ep.y },
              relativePoint: { x: 0, y: 0 },
              control: null,
            };
          }
          const fields = {
            type: 'arrow',
            arrowType: ${JSON.stringify(arrowType)},
            strokeColor: { color: ${JSON.stringify(strokeColor)} },
            position: { x: 0, y: 0 },
            start: normalize(start),
            end: normalize(end),
            zIndex: maxZ + 1,
            created: { a: 0, t: Date.now() },
            updated: null,
            id: newId,
            parentId: null,
          };
          for (const k of Object.keys(fields)) map.set(k, fields[k]);
          yDoc.transact(() => {
            yObjects.set(newId, map);
          });
          return { ok: true, id: newId };
        } catch (e) { return { __error: String(e), stack: e.stack }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    result.mounted = await ensureMounted(session, result.id);
    return result;
  } finally {
    session.close();
  }
}

/**
 * Move an existing object to new coordinates.
 */
export async function moveObject(boardId, objectId, { x, y }) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  assertNotReadOnly();
  assertObjectId(objectId);
  x = num(x, 'x', COORD);
  y = num(y, 'y', COORD);
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const yObjects = yDoc.getMap('objects');
          const obj = yObjects.get(${JSON.stringify(objectId)});
          if (!obj || !obj.set) return { __error: 'object not found or not mutable' };
          yDoc.transact(() => {
            obj.set('position', { x: ${Number(x)}, y: ${Number(y)} });
            obj.set('updated', { a: 0, t: Date.now() });
          });
          return { ok: true, id: ${JSON.stringify(objectId)}, position: { x: ${Number(x)}, y: ${Number(y)} } };
        } catch (e) { return { __error: String(e), stack: e.stack }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    return result;
  } finally {
    session.close();
  }
}

/**
 * Set fill / stroke color on an object that supports it (shape, sticker, arrow).
 */
export async function setColor(boardId, objectId, { fillColor, strokeColor }) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  assertNotReadOnly();
  assertObjectId(objectId);
  fillColor = safeToken(fillColor, 'fillColor');
  strokeColor = safeToken(strokeColor, 'strokeColor');
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const yObjects = yDoc.getMap('objects');
          const obj = yObjects.get(${JSON.stringify(objectId)});
          if (!obj || !obj.set) return { __error: 'object not found' };
          yDoc.transact(() => {
            ${fillColor ? `obj.set('fillColor', { color: ${JSON.stringify(fillColor)}, opacity: 1 });` : ''}
            ${strokeColor ? `obj.set('strokeColor', { color: ${JSON.stringify(strokeColor)}, opacity: 1 });` : ''}
            obj.set('updated', { a: 0, t: Date.now() });
          });
          return { ok: true, id: ${JSON.stringify(objectId)} };
        } catch (e) { return { __error: String(e), stack: e.stack }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    return result;
  } finally {
    session.close();
  }
}

/**
 * Add a frame — a large container with a labelText (NOT a Y.Text document, just a field).
 * Frames are typically used to group content visually.
 */
export async function addFrame(boardId, {
  labelText = 'Frame',
  x,
  y,
  width = 800,
  height = 600,
  fillColor = 'white3',
}) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  assertNotReadOnly();
  labelText = assertText(labelText, 'labelText', { default: 'Frame' });
  x = num(x, 'x', COORD);
  y = num(y, 'y', COORD);
  width = num(width, 'width', SIZE);
  height = num(height, 'height', SIZE);
  fillColor = safeToken(fillColor, 'fillColor', { default: 'white3' });
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const Yjs = window.Yjs;
          const yObjects = yDoc.getMap('objects');
          const newId = (window.crypto || crypto).randomUUID();
          let minZ = 0;
          for (const [, v] of yObjects.entries()) {
            const z = v && v.get ? v.get('zIndex') : (v && v.zIndex);
            if (typeof z === 'number' && z < minZ) minZ = z;
          }
          // Frames sit BELOW everything (negative zIndex) so they don't cover content.
          const map = new Yjs.Map();
          const fields = {
            type: 'frame',
            width: ${Number(width)},
            height: ${Number(height)},
            labelText: ${JSON.stringify(labelText)},
            fillColor: { color: ${JSON.stringify(fillColor)} },
            position: { x: ${Number(x)}, y: ${Number(y)} },
            zIndex: minZ - 1,
            created: { a: 0, t: Date.now() },
            updated: null,
            id: newId,
            parentId: null,
          };
          for (const k of Object.keys(fields)) map.set(k, fields[k]);
          yDoc.transact(() => {
            yObjects.set(newId, map);
          });
          return { ok: true, id: newId };
        } catch (e) { return { __error: String(e), stack: e.stack }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    result.mounted = await ensureMounted(session, result.id);
    return result;
  } finally {
    session.close();
  }
}

/**
 * Add a stamp (emoji or text-stamp). Default size 60×60.
 * For emoji pass any emoji char in `text` (e.g., '❤️', '🐈', '🔥').
 */
export async function addStamp(boardId, {
  text,
  x,
  y,
  width = 60,
  height = 60,
  stampType = 'textStamp',
}) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  assertNotReadOnly();
  text = assertText(text, 'text', { maxLen: 1000 });
  x = num(x, 'x', COORD);
  y = num(y, 'y', COORD);
  width = num(width, 'width', SIZE);
  height = num(height, 'height', SIZE);
  stampType = safeToken(stampType, 'stampType', { default: 'textStamp' });
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const Yjs = window.Yjs;
          const yObjects = yDoc.getMap('objects');
          const newId = (window.crypto || crypto).randomUUID();
          let maxZ = 0;
          for (const [, v] of yObjects.entries()) {
            const z = v && v.get ? v.get('zIndex') : (v && v.zIndex);
            if (typeof z === 'number' && z > maxZ) maxZ = z;
          }
          const map = new Yjs.Map();
          const fields = {
            type: 'stamp',
            data: { type: ${JSON.stringify(stampType)}, text: ${JSON.stringify(text)} },
            width: ${Number(width)},
            height: ${Number(height)},
            position: { x: ${Number(x)}, y: ${Number(y)} },
            zIndex: maxZ + 1,
            created: { a: 0, t: Date.now() },
            updated: null,
            id: newId,
            parentId: null,
          };
          for (const k of Object.keys(fields)) map.set(k, fields[k]);
          yDoc.transact(() => {
            yObjects.set(newId, map);
          });
          return { ok: true, id: newId };
        } catch (e) { return { __error: String(e), stack: e.stack }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    result.mounted = await ensureMounted(session, result.id);
    return result;
  } finally {
    session.close();
  }
}

/**
 * Resize an object (shape / sticker).
 */
export async function resizeObject(boardId, objectId, { width, height }) {
  assertBoardId(boardId);
  assertBoardAllowed(boardId);
  assertNotReadOnly();
  assertObjectId(objectId);
  if (width !== undefined) width = num(width, 'width', SIZE);
  if (height !== undefined) height = num(height, 'height', SIZE);
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const yObjects = yDoc.getMap('objects');
          const obj = yObjects.get(${JSON.stringify(objectId)});
          if (!obj || !obj.set) return { __error: 'object not found' };
          yDoc.transact(() => {
            ${width ? `obj.set('width', ${Number(width)});` : ''}
            ${height ? `obj.set('height', ${Number(height)});` : ''}
            obj.set('updated', { a: 0, t: Date.now() });
          });
          return { ok: true, id: ${JSON.stringify(objectId)} };
        } catch (e) { return { __error: String(e), stack: e.stack }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    return result;
  } finally {
    session.close();
  }
}

export async function whoAmI() {
  const { session } = await openHolstSession();
  try {
    return await gapiInPage(session, '/gapi/current_user');
  } finally {
    session.close();
  }
}

/**
 * Full self-diagnosis for agents: CDP endpoint, app version, tabs, auth,
 * editor readiness, latency, effective config. Never throws — every check
 * is reported as ok/error so the caller gets a complete picture.
 */
export async function doctor() {
  const report = {
    timestamp: new Date().toISOString(),
    checks: {},
  };

  // 1. CDP endpoint + app version (with auto-start recovery)
  try {
    let version;
    try {
      version = await getCdpJSON('/json/version');
    } catch {
      await ensureCdp();
      version = await getCdpJSON('/json/version');
    }
    report.checks.cdp = {
      ok: true,
      browser: version?.Browser,
      userAgent: version?.UserAgent?.slice(0, 120),
    };
  } catch (e) {
    report.checks.cdp = { ok: false, error: String(e.message).slice(0, 200) };
    report.verdict = 'CDP endpoint is unreachable and auto-start failed — ask the user to launch Holst and log in';
    report.config = doctorConfig();
    return report;
  }

  // 2. Holst tabs
  try {
    const tabs = await listTabs();
    const holstTabs = tabs.filter((t) => t.type === 'page' && isHolstUrl(t.url));
    report.checks.tabs = {
      ok: holstTabs.length > 0,
      holstTabCount: holstTabs.length,
      urls: holstTabs.map((t) => t.url).slice(0, 5),
    };
  } catch (e) {
    report.checks.tabs = { ok: false, error: String(e.message).slice(0, 200) };
  }

  // 3. Auth + editor readiness + latency (needs a holst tab).
  // Right after auto-start the page may still be warming up — retry auth once.
  if (report.checks.tabs?.ok) {
    let lastAuthError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const t0 = Date.now();
        const me = await whoAmI();
        report.checks.auth = {
          ok: true,
          latencyMs: Date.now() - t0,
          user: { id: me?.id, name: me?.name, email: me?.email },
        };
        lastAuthError = null;
        break;
      } catch (e) {
        lastAuthError = String(e.message).slice(0, 200);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 4000));
      }
    }
    if (lastAuthError) report.checks.auth = { ok: false, error: lastAuthError };
  }

  // 4. Editor readiness (Yjs globals, evaluate latency)
  if (report.checks.tabs?.ok) {
    try {
      const { session } = await openHolstSession();
      try {
        const yReady = await session.evaluate(
          `(() => { try { return !!window.ds?.yPersistence?.yDoc?.getMap; } catch (e) { return false; } })()`
        );
        const boardReady = await session.evaluate(
          `(() => { try { return !!window.ds?.yPersistence?.yDoc?.getMap('objects'); } catch (e) { return false; } })()`
        );
        const t0 = Date.now();
        await session.evaluate('1+1');
        report.checks.editor = {
          ok: true, // evaluate roundtrip works; yjs fields are informational
          yjsGlobals: yReady, // present on board pages only
          onBoard: boardReady,
          evaluateLatencyMs: Date.now() - t0,
        };
      } finally {
        session.close();
      }
    } catch (e) {
      report.checks.editor = { ok: false, error: String(e.message).slice(0, 200) };
    }
  }

  report.config = doctorConfig();

  const c = report.checks;
  if (c.cdp?.ok && c.tabs?.ok && c.auth?.ok && c.editor?.ok) {
    report.verdict = c.editor.onBoard
      ? 'healthy: CDP up, logged in, board Yjs doc loaded'
      : 'healthy: CDP up, logged in; open a board (or call any board tool — it will navigate a tab)';
  } else if (c.cdp?.ok && c.tabs && !c.tabs.ok) {
    report.verdict = 'CDP up but no app.holst.so tab — the user is probably not logged in. Ask them to log in to Holst desktop.';
  } else if (c.cdp?.ok && c.auth && !c.auth.ok) {
    report.verdict = 'Logged out or token expired — ask the user to log in to Holst desktop, then retry.';
  } else {
    report.verdict = 'degraded — see checks above';
  }
  return report;
}

function doctorConfig() {
  return {
    port: Number(process.env.HOLST_DEBUG_PORT) || 9222,
    autoStart: (process.env.HOLST_AUTO_START ?? '1').trim().toLowerCase() !== '0',
    readOnly: ['1', 'true', 'yes'].includes((process.env.HOLST_READ_ONLY || '').trim().toLowerCase()),
    allowedBoardIdsCount: (process.env.HOLST_ALLOWED_BOARD_IDS || '').split(/[\s,]+/).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).length,
    maxDumpBytes: Number(process.env.HOLST_MAX_DUMP_BYTES) || 2000000,
  };
}
