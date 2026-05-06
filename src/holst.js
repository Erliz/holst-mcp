// Holst-specific helpers: pick the right tab, run /gapi/* with bearer, dump yDoc, etc.

import { openHolstSession, listTabs } from './cdp.js';

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
    (t) => t.type === 'page' && t.url && t.url.includes(`board/${boardId}`)
  );
  if (boardTab) {
    const { session } = await openHolstSession({
      tabPredicate: (t) => t.url.includes(`board/${boardId}`),
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
  const session = await getBoardSession(boardId);
  try {
    const meta = await gapiInPage(session, `/gapi/channel/${boardId}`).catch(() => null);
    const yjson = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          return yDoc.toJSON();
        } catch (e) { return { __error: String(e) }; }
      })()`
    );
    if (yjson?.__error) throw new Error(yjson.__error);
    return { meta, content: yjson };
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
          yText.insert(0, ${JSON.stringify(text)});
          yDoc.transact(() => {
            yDocs.set(newDocId, yText);
            yObjects.set(newId, yStickerMap);
          });
          return { ok: true, id: newId, documentId: newDocId };
        } catch (e) { return { __error: String(e), stack: e.stack }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error + (result.stack ? '\n' + result.stack : ''));
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
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const Yjs = window.Yjs;
          const yObjects = yDoc.getMap('objects');
          const yDocs = yDoc.getMap('documents');
          const obj = yObjects.get(${JSON.stringify(objectId)});
          if (!obj) return { __error: 'object not found: ' + ${JSON.stringify(objectId)} };
          const docId = obj.get ? obj.get('documentId') : obj.documentId;
          if (!docId) return { __error: 'object has no documentId' };
          yDoc.transact(() => {
            // Replace document text: Y.Text supports delete + insert
            const yText = yDocs.get(docId);
            if (yText && typeof yText.delete === 'function' && typeof yText.insert === 'function') {
              if (yText.length > 0) yText.delete(0, yText.length);
              yText.insert(0, ${JSON.stringify(text)});
            } else {
              // fallback: replace entire entry with fresh Y.Text
              const fresh = new Yjs.Text();
              fresh.insert(0, ${JSON.stringify(text)});
              yDocs.set(docId, fresh);
            }
            // bump updated timestamp on object's Y.Map
            if (obj.set) obj.set('updated', { a: 0, t: Date.now() });
          });
          return { ok: true, id: ${JSON.stringify(objectId)}, documentId: docId };
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
 * Delete an object from the board. Also clears its document if exclusive.
 */
export async function deleteObject(boardId, objectId) {
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
          yText.insert(0, ${JSON.stringify(text)});
          yDoc.transact(() => {
            yDocs.set(newDocId, yText);
            yObjects.set(newId, map);
          });
          return { ok: true, id: newId, documentId: newDocId };
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
 * Add a simple-text label (typed via T in UI). Sized automatically by content.
 */
export async function addSimpleText(boardId, { text, x, y }) {
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
          yText.insert(0, ${JSON.stringify(text)});
          yDoc.transact(() => {
            yDocs.set(newDocId, yText);
            yObjects.set(newId, map);
          });
          return { ok: true, id: newId, documentId: newDocId };
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
    return result;
  } finally {
    session.close();
  }
}

/**
 * Move an existing object to new coordinates.
 */
export async function moveObject(boardId, objectId, { x, y }) {
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
    return result;
  } finally {
    session.close();
  }
}

/**
 * Resize an object (shape / sticker).
 */
export async function resizeObject(boardId, objectId, { width, height }) {
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
