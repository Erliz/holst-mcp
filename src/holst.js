// Holst-specific helpers: pick the right tab, run /gapi/* with bearer, dump yDoc, etc.

import { randomUUID } from 'node:crypto';
import { openHolstSession, listTabs, isBoardUrl, isHolstUrl, getCdpJSON, acquirePooledSession, releaseSession } from './cdp.js';
import { normalizeDumpColors } from './dump-colors.js';
import { buildCanvasStateExpr, buildCameraFitExpr, buildCameraSetExpr } from './eval-scripts.js';
import { ensureCdp } from './autostart.js';
import {
  ValidationError,
  assertBoardId,
  assertObjectId,
  assertText,
  assertNoMarkdown,
  assertArrowEndpoint,
  assertStrokeStyle,
  assertBackgroundStyle,
  assertArrowhead,
  assertShapeType,
  assertArrowType,
  assertOpacity,
  assertBorderRadius,
  parseColor,
  num,
  safeToken,
} from './validate.js';
import { assertBoardReadable, assertBoardWritable, assertNotReadOnly, limitDump } from './policy.js';
import { buildBatchPlan } from './batch.js';
import { buildArrowTexts } from './arrow-text.js';
import { buildStyleExtras, pxToTextScale, buildSegments, segmentsToSlateNodes, resolveUpdateStyleExtras } from './text-style.js';
import { docTextMatches } from './text-match.js';
import {
  NATIVE_WRITE_HELPER,
  buildBoardContentExpr,
  buildCheckAllMountedExpr,
  buildKindExpr,
  buildTouchUpdatedExpr,
  buildStyleFieldsExpr,
  buildNativeStyleUpdateExpr,
  buildAddSimpleTextExpr,
  buildBatchCreationExpr,
  buildBatchArrowsExpr,
  buildBatchTextWriteExpr,
  buildDeleteObjectsExpr,
} from './eval-scripts.js';

const COORD = { min: -1e7, max: 1e7 };
const SIZE = { min: 1, max: 1e6 };

/**
 * Native document write through the app's own Slate editor pipeline
 * (singleDocumentStore.replaceFromJSON). Raw Y.Text inserts are NOT
 * rendered by Holst ≥ 2026-10 builds — the editor layer (toDelta) is
 * the rendering source of truth. Returns null when the native API is
 * unavailable (older builds) → caller falls back to raw Yjs.
 */
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
 * Rewrite an arrow's label. Arrows keep text in a plain `texts` array
 * (NOT a Y.Text document): [{ position, id, text, editor }]. Replaces the
 * first label, preserving its position and any extra labels beyond the first.
 */
async function updateArrowText(session, objectId, text) {
  const entry = buildArrowTexts(text, 0.5)[0]; // position re-derived in page from the existing label
  const result = await session.evaluate(
    `(() => {
      try {
        const yDoc = window.ds.yPersistence.yDoc;
        const yObjects = yDoc.getMap('objects');
        const obj = yObjects.get(${JSON.stringify(objectId)});
        if (!obj || !obj.get) return { __error: 'object not found' };
        if (obj.get('type') !== 'arrow') return { __error: 'not an arrow' };
        const prevTexts = obj.get('texts');
        const prev = Array.isArray(prevTexts) && prevTexts.length ? prevTexts[0] : null;
        const entry = ${JSON.stringify(entry)};
        entry.position = prev && typeof prev.position === 'number' ? prev.position : 0.5;
        const rest = Array.isArray(prevTexts) ? prevTexts.slice(1) : [];
        yDoc.transact(() => {
          obj.set('texts', [entry, ...rest]);
          obj.set('updated', { a: 0, t: Date.now() });
        });
        const stored = obj.get('texts');
        const got = Array.isArray(stored) && stored[0] ? stored[0].text : null;
        if (got !== entry.text) return { __error: 'arrow text did not land' };
        return { ok: true, native: false, arrow: true, id: ${JSON.stringify(objectId)}, text: entry.text, labels: 1 + rest.length };
      } catch (e) { return { __error: String(e), stack: e.stack }; }
    })()`
  );
  if (result?.__error) throw new Error(result.__error);
  return result;
}

/**
 * Native Slate write with retries. The app's editor binding mounts a few
 * seconds after object creation and syncs its (empty) view-model INTO the
 * doc, wiping early writes — so we retry until content sticks.
 * Verification is paragraph/mark-aware: stored deltas join paragraphs
 * without newlines and styled runs render as mark tags (text-match.js).
 * Returns true/false on success; null if native API unavailable.
 */
async function nativeWriteWithRetry(session, objectId, docId, spec, attempts = 3) {
  const { segments, plainText } = buildSegments(spec);
  const hasColor = segments.some((s) => s.color !== undefined);
  const slateNodes = hasColor ? segmentsToSlateNodes(segments, randomUUID) : null;
  for (let i = 0; i < attempts; i++) {
    const r = await session.evaluate(
      `(() => {
        try {
          ${NATIVE_WRITE_HELPER}
          const w = __nativeWrite(${JSON.stringify(objectId)}, ${JSON.stringify(docId)}, ${JSON.stringify(segments)}, ${JSON.stringify(plainText)}, ${JSON.stringify(slateNodes)});
          return w;
        } catch (e) { return { native: true, error: String(e) }; }
      })()`
    );
    if (r === null) return null; // native API unavailable
    if (!r.error && docTextMatches(plainText, r.content)) return true;
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
  return acquirePooledSession('board:' + boardId, async () => {
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
  });
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
export async function getBoardContent(boardId, opts = {}) {
  assertBoardId(boardId);
  assertBoardReadable(boardId);
  const { bbox, positionsOnly } = opts;
  if (bbox !== undefined) {
    for (const k of ['x1', 'y1', 'x2', 'y2']) num(bbox[k], `bbox.${k}`);
    if (!(bbox.x2 > bbox.x1 && bbox.y2 > bbox.y1)) {
      throw new ValidationError('bbox must satisfy x2 > x1 and y2 > y1');
    }
  }
  const session = await getBoardSession(boardId);
  try {
    const meta = await gapiInPage(session, `/gapi/channel/${boardId}`).catch(() => null);
    const yjson = await session.evaluate(
      buildBoardContentExpr()
    );
    if (yjson?.__error) throw new Error(yjson.__error);
    let content = limitDump(yjson);
    // MCP-written ints read back as the same hex the caller sent (#RRGGBB).
    // UI-written palette names pass through (map: docs/palette.md).
    normalizeDumpColors(content);
    // Response shaping — saves LLM tokens; the CDP dump stays complete.
    if (bbox || positionsOnly) {
      const inBbox = (o) => {
        if (!bbox) return true;
        const x = o.position?.x ?? 0, y = o.position?.y ?? 0;
        const w = o.width ?? 0, h = o.height ?? 0;
        return x < bbox.x2 && x + w > bbox.x1 && y < bbox.y2 && y + h > bbox.y1;
      };
      const objects = {};
      for (const [id, o] of Object.entries(content.objects || {})) {
        if (!inBbox(o)) continue;
        objects[id] = positionsOnly
          ? { type: o.type, x: o.position?.x ?? 0, y: o.position?.y ?? 0, w: o.width ?? 0, h: o.height ?? 0 }
          : o;
      }
      content = positionsOnly ? { objects } : { ...content, objects };
    }
    return { meta, content };
  } finally {
    releaseSession(session);
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
    const it = {
      id: oid,
      type: obj.type,
      x: obj.position?.x ?? 0,
      y: obj.position?.y ?? 0,
      w: obj.width ?? 0,
      h: obj.height ?? 0,
      text: text(obj.documentId),
      shapeType: obj.shapeType,
    };
    if (obj.type === 'frame') it.label = stripTags(obj.labelText);
    if (obj.type === 'arrow') {
      it.label = stripTags((obj.texts || [])[0]?.text || '');
      it.from = obj.start?.objectId ?? (obj.start?.point ? `${Math.round(obj.start.point.x)},${Math.round(obj.start.point.y)}` : '?');
      it.to = obj.end?.objectId ?? (obj.end?.point ? `${Math.round(obj.end.point.x)},${Math.round(obj.end.point.y)}` : '?');
      it.style = [obj.strokeStyle, obj.arrowheadEnd === 'none' ? 'no-end-head' : null, obj.arrowheadStart && obj.arrowheadStart !== 'none' ? 'start-head' : null].filter(Boolean).join(' ') || 'solid';
    }
    items.push(it);
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
  // Frames as container sections + arrows inventory — one-step verification
  // of layout (frame coverage) and connectors (labels/styles/heads).
  const frames = items.filter((it) => it.type === 'frame');
  if (frames.length) {
    out.push(`## Фреймы (${frames.length})`);
    for (const f of frames.sort((a, b) => a.y - b.y || a.x - b.x)) {
      out.push(`- «${f.label || 'без подписи'}» _x=${Math.round(f.x)},y=${Math.round(f.y)} ${Math.round(f.w)}×${Math.round(f.h)}_ \`${f.id.slice(0, 8)}\``);
    }
    out.push('');
  }
  const arrows = items.filter((it) => it.type === 'arrow');
  if (arrows.length) {
    out.push(`## Стрелки (${arrows.length})`);
    for (const a of arrows) {
      const label = a.label ? ` «${a.label}»` : '';
      out.push(`- ${String(a.from).slice(0, 8)} → ${String(a.to).slice(0, 8)}${label} · ${a.style} \`${a.id.slice(0, 8)}\``);
    }
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
  assertBoardWritable(boardId);
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
    result.native = await nativeWriteWithRetry(session, result.id, result.documentId, { text });
    result.textOk = result.native;
    return result;
  } finally {
    releaseSession(session);
  }
}

/**
 * Update text on an existing sticker / shape / simple-text object.
 * Looks up the object's documentId and rewrites that document.
 */
/**
 * Update text on an existing sticker / shape / simple-text object.
 * Optional opts: fontSize, textScale, textColor, textBackgroundColor,
 * horizontalAlign, fontFamily, lineHeight (object fields — written before the
 * text) and bold / italic / underline / strikethrough (document marks that
 * ride with the text write).
 */
export async function updateText(boardId, objectId, text, opts = {}) {
  assertBoardId(boardId);
  assertBoardWritable(boardId);
  assertNotReadOnly();
  assertObjectId(objectId);
  const runs = opts.runs;
  if (runs === undefined) text = assertNoMarkdown(assertText(text, 'text'));
  else text = '';
  const marks = {
    bold: opts.bold, italic: opts.italic, underline: opts.underline, strikethrough: opts.strikethrough,
  };
  const hasMarks = Object.values(marks).some((v) => v !== undefined);
  const session = await getBoardSession(boardId);
  try {
    // Object kind first — style fields are kind-dependent (issue #2):
    // simple-text stores px sizes as textScale (base 14), never a fontSize field.
    const kind = await session.evaluate(
      buildKindExpr(objectId)
    );
    if (kind && kind.__error) throw new Error(kind.__error);
    const { extras: styleExtras, clearFields } = resolveUpdateStyleExtras(kind, opts);
    // Style fields — plain writes, independent of the text pipeline.
    if (Object.keys(styleExtras).length || clearFields.length) {
      let styled = null;
      if (kind === 'simple-text') {
        // Preferred: the app's own update path — the mounted editor re-renders
        // live; raw yDoc style writes leave the view stale until reload (issue #2).
        styled = await session.evaluate(
          buildNativeStyleUpdateExpr(objectId, styleExtras, clearFields),
          { awaitPromise: true }
        );
        if (styled?.__error) throw new Error(styled.__error);
        if (styled?.native !== true) styled = null; // older build → raw fallback
      }
      if (!styled) {
        styled = await session.evaluate(
          buildStyleFieldsExpr(objectId, styleExtras, clearFields)
        );
        if (styled?.__error) throw new Error(styled.__error);
      }
    }

    // Arrows carry label text as a plain `texts` field — no documentId.
    if (kind === 'arrow') return await updateArrowText(session, objectId, text);

    const doc = await resolveDoc(session, objectId);
    if (doc?.__error) throw new Error(doc.__error);

    // Preferred: native Slate pipeline (renders correctly).
    if (doc.nativeAvailable) {
      const ok = await nativeWriteWithRetry(session, objectId, doc.docId, { text, runs: opts.runs, marks });
      if (ok) {
        await session.evaluate(
          buildTouchUpdatedExpr(objectId)
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
          const storedStr = __docText(yDoc, ${JSON.stringify(doc.docId)});
          const norm = (s) => String(s).replace(/<[^>]*>/g, '').replace(/\\n/g, '');
          if (norm(storedStr) !== norm(${JSON.stringify(text)})) {
            return { __error: writeError ? writeError + ' (and content did not land)' : 'content mismatch after update' };
          }
          return { ok: true, native: false, id: ${JSON.stringify(objectId)}, documentId: ${JSON.stringify(doc.docId)}, warning: writeError || null };
        } catch (e) { return { __error: String(e) }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    return result;
  } finally {
    releaseSession(session);
  }
}

/**
 * Delete an object from the board. Also clears its document if exclusive.
 */
export async function deleteObject(boardId, objectId) {
  assertBoardId(boardId);
  assertBoardWritable(boardId);
  assertNotReadOnly();
  assertObjectId(objectId);
  const session = await getBoardSession(boardId);
  try {
    // Preferred: the app's own removal path (objectsService.remove). It deletes
    // from yDoc AND unmounts the domain object — raw yDoc deletes leave a stale
    // sprite on canvas until the user reloads the page.
    const native = await session.evaluate(
      `(async () => {
        try {
          const ds = window.ds;
          const os = ds && ds.store && ds.store.objectBuilder && ds.store.objectBuilder.getApp
            && ds.store.objectBuilder.getApp().objectsService;
          if (!os || typeof os.remove !== 'function') return { native: false };
          const yDoc = ds.yPersistence.yDoc;
          const obj = yDoc.getMap('objects').get(${JSON.stringify(objectId)});
          if (!obj) {
            // Already gone from the doc. If the domain store still holds a stale
            // entry (deleted via raw yDoc earlier), heal it with a native remove.
            const stale = !!(ds.store.objects && ds.store.objects.has && ds.store.objects.has(${JSON.stringify(objectId)}));
            if (!stale) return { native: true, error: 'object not found' };
            try { await os.remove(${JSON.stringify(objectId)}); } catch (e) {}
            await new Promise((r) => setTimeout(r, 300));
            const inStore2 = !!(ds.store.objects && ds.store.objects.has && ds.store.objects.has(${JSON.stringify(objectId)}));
            return { native: true, docId: null, inY: false, inStore: inStore2, healedStale: !inStore2 };
          }
          const docId = obj.get ? obj.get('documentId') : obj.documentId;
          await os.remove(${JSON.stringify(objectId)});
          await new Promise((r) => setTimeout(r, 300));
          let inY = yDoc.getMap('objects').has(${JSON.stringify(objectId)});
          let inStore = !!(ds.store.objects && ds.store.objects.has && ds.store.objects.has(${JSON.stringify(objectId)}));
          // one retry for transient unmount lag
          if (inY || inStore) {
            await new Promise((r) => setTimeout(r, 700));
            inY = yDoc.getMap('objects').has(${JSON.stringify(objectId)});
            inStore = !!(ds.store.objects && ds.store.objects.has && ds.store.objects.has(${JSON.stringify(objectId)}));
          }
          return { native: true, docId: docId || null, inY, inStore };
        } catch (e) { return { native: true, error: String(e) }; }
      })()`,
      { awaitPromise: true }
    );
    if (native?.native) {
      if (native.error) throw new Error('native remove failed: ' + native.error);
      if (!native.inY && !native.inStore) {
        return { ok: true, native: true, removed: objectId, removedDocument: native.docId };
      }
      // rare: unmount lagged — reload heals the render layer
      try {
        await session.send('Page.enable', {});
        await session.send('Page.reload', { ignoreCache: true });
        await new Promise((r) => setTimeout(r, 7000));
        const healed = await session.evaluate(
          `(() => { try { const ds = window.ds; return !ds.yPersistence.yDoc.getMap('objects').has(${JSON.stringify(objectId)}) && !ds.store.objects.has(${JSON.stringify(objectId)}); } catch (e) { return false; } })()`
        );
        return { ok: !!healed, native: true, removed: objectId, removedDocument: native.docId, healedByReload: !!healed };
      } catch {
        return { ok: false, native: true, removed: objectId, removedDocument: native.docId, warning: 'deleted in doc but render unmount unconfirmed' };
      }
    }

    // Fallback: raw yDoc delete (older builds) + unmount self-heal via reload.
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
          const inStore = !!(window.ds.store.objects && window.ds.store.objects.has(${JSON.stringify(objectId)}));
          return { ok: true, removed: ${JSON.stringify(objectId)}, removedDocument: docId || null, staleInStore: inStore };
        } catch (e) { return { __error: String(e) }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    if (result.staleInStore) {
      try {
        await session.send('Page.enable', {});
        await session.send('Page.reload', { ignoreCache: true });
        await new Promise((r) => setTimeout(r, 7000));
        result.healedByReload = true;
      } catch { /* keep result */ }
      delete result.staleInStore;
    }
    return result;
  } finally {
    releaseSession(session);
  }
}

/**
 * Add a section header — a shape (square by default) with a text label inside.
 * shapeType: 'square' | 'circle' | 'round-rect' | 'rhombus' | 'triangle' (Holst supports more)
 */
export async function deleteObjects(boardId, ids) {
  assertBoardId(boardId);
  assertBoardWritable(boardId);
  assertNotReadOnly();
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('ids must be a non-empty array of object ids');
  }
  if (ids.length > 200) throw new ValidationError('batch delete limit is 200 objects per call');
  for (const id of ids) assertObjectId(id);
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(buildDeleteObjectsExpr(ids), { awaitPromise: true });
    if (result?.__error) throw new Error(result.__error);
    return result;
  } finally {
    releaseSession(session);
  }
}

export async function addShape(boardId, {
  text = '',
  runs,
  x,
  y,
  width = 240,
  height = 48,
  shapeType = 'square',
  fillColor = '#ffffff',
  strokeColor = '#202020',
  strokeWidth = 2,
  fixedSize = true,
  borderRadius,
  fontSize,
  textColor,
  textBackgroundColor,
  horizontalAlign,
  verticalAlign,
  letterSpacing,
  fontFamily,
  lineHeight,
  bold,
  italic,
  underline,
  strikethrough,
}) {
  assertBoardId(boardId);
  assertBoardWritable(boardId);
  assertNotReadOnly();
  if (runs === undefined) text = assertNoMarkdown(assertText(text, 'text', { default: '' }));
  else text = '';
  x = num(x, 'x', COORD);
  y = num(y, 'y', COORD);
  width = num(width, 'width', SIZE);
  height = num(height, 'height', SIZE);
  shapeType = assertShapeType(shapeType, 'shapeType', { default: 'square' });
  fillColor = fillColor === undefined ? '#ffffff' : parseColor(fillColor, 'fillColor');
  strokeColor = strokeColor === undefined ? '#202020' : parseColor(strokeColor, 'strokeColor');
  borderRadius = borderRadius === undefined ? undefined : assertBorderRadius(borderRadius, 'borderRadius');
  strokeWidth = num(strokeWidth, 'strokeWidth', { min: 0, max: 100 });
  const styleExtras = buildStyleExtras({ fontSize, textScale: undefined, textColor, textBackgroundColor, horizontalAlign, verticalAlign, letterSpacing, fontFamily, lineHeight });
  const marks = { bold, italic, underline, strikethrough };
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
            ${borderRadius !== undefined ? `borderRadius: ${Number(borderRadius)},` : ''}
            position: { x: ${Number(x)}, y: ${Number(y)} },
            zIndex: maxZ + 1,
            created: { a: 0, t: Date.now() },
            updated: null,
            id: newId,
            parentId: null,
            ${Object.keys(styleExtras).length ? `...${JSON.stringify(styleExtras)},` : ''}
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
    result.native = await nativeWriteWithRetry(session, result.id, result.documentId, { text, runs, marks });
    result.textOk = result.native;
    return result;
  } finally {
    releaseSession(session);
  }
}

/**
 * Add a simple-text label (typed via T in UI). Sized automatically by content.
 * fontSize is in px and converts to the textScale field (base 14, verified).
 */
export async function addSimpleText(boardId, {
  text,
  runs,
  x,
  y,
  width,
  fontSize,
  textColor,
  textBackgroundColor,
  horizontalAlign,
  verticalAlign,
  letterSpacing,
  fontFamily,
  lineHeight,
  bold,
  italic,
  underline,
  strikethrough,
}) {
  assertBoardId(boardId);
  assertBoardWritable(boardId);
  assertNotReadOnly();
  if (runs === undefined) text = assertNoMarkdown(assertText(text, 'text'));
  else text = '';
  x = num(x, 'x', COORD);
  y = num(y, 'y', COORD);
  const styleExtras = buildStyleExtras({
    textScale: fontSize !== undefined ? pxToTextScale(fontSize) : undefined,
    textColor, textBackgroundColor, horizontalAlign, fontFamily, lineHeight,
  });
  const marks = { bold, italic, underline, strikethrough };
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      buildAddSimpleTextExpr({ x, y, width, styleExtras })
    );
    if (result?.__error) throw new Error(result.__error);
    result.mounted = await ensureMounted(session, result.id);
    // Text must land AFTER the editor binding settles: on mount the app syncs
    // its empty view-model into the doc, wiping writes made in the first ~1-3s.
    await new Promise((r) => setTimeout(r, 2000));
    result.native = await nativeWriteWithRetry(session, result.id, result.documentId, { text, runs, marks });
    result.textOk = result.native;
    return result;
  } finally {
    releaseSession(session);
  }
}

/**
 * Add an arrow connecting two points. Each endpoint can either be a free point {x, y}
 * or attached to an object: { objectId, relativePoint: {x, y} } where relativePoint
 * is normalized 0..1 within the object's bounds.
 * Optional `text` lands as an on-arrow label (plain `texts` field, position 0..1
 * along the path). strokeStyle: solid (default, stored as absent), dashed, dotted.
 */
export async function addArrow(boardId, {
  start,           // { x, y } | { objectId, relativePoint: {x, y} }
  end,
  arrowType = 'elbow',  // 'elbow' | 'straight' | 'curved'
  strokeColor = '#808080',
  strokeStyle = 'solid', // 'solid' | 'dashed' | 'dotted'
  strokeWidth,           // line thickness (UI examples: 5, 17)
  arrowheadStart,        // 'none' | 'miro' | 'arc' | 'figma' (undefined = app default: no start head)
  arrowheadEnd,          // 'none' disables the default end head
  text,            // optional on-arrow label
  textPosition = 0.5,   // 0..1 along the arrow path
  fontSize,        // label font size
  textColor,       // label color (#RRGGBB)
}) {
  assertBoardId(boardId);
  assertBoardWritable(boardId);
  assertNotReadOnly();
  assertArrowEndpoint(start, 'start');
  assertArrowEndpoint(end, 'end');
  arrowType = assertArrowType(arrowType, 'arrowType', { default: 'elbow' });
  strokeColor = parseColor(strokeColor, 'strokeColor', { default: '#808080' });
  strokeStyle = assertStrokeStyle(strokeStyle, 'strokeStyle', { default: 'solid' });
  strokeWidth = strokeWidth === undefined ? undefined : num(strokeWidth, 'strokeWidth', { min: 0, max: 100 });
  arrowheadStart = assertArrowhead(arrowheadStart, 'arrowheadStart');
  arrowheadEnd = assertArrowhead(arrowheadEnd, 'arrowheadEnd');
  if (text !== undefined) assertNoMarkdown(text);
  const texts = text === undefined ? null : buildArrowTexts(text, textPosition);
  const styleExtras = buildStyleExtras({ fontSize, textColor });
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
            ${strokeStyle !== 'solid' ? `strokeStyle: ${JSON.stringify(strokeStyle)},` : ''}
            strokeColor: { color: ${JSON.stringify(strokeColor)}, opacity: 1 },
            ${strokeWidth !== undefined ? `strokeWidth: ${Number(strokeWidth)},` : ''}
            ${arrowheadStart !== undefined ? `arrowheadStart: ${JSON.stringify(arrowheadStart)},` : ''}
            ${arrowheadEnd !== undefined ? `arrowheadEnd: ${JSON.stringify(arrowheadEnd)},` : ''}
            position: { x: 0, y: 0 },
            start: normalize(start),
            end: normalize(end),
            zIndex: maxZ + 1,
            created: { a: 0, t: Date.now() },
            updated: null,
            id: newId,
            parentId: null,
            ${texts ? `texts: ${JSON.stringify(texts)},` : ''}
            ${Object.keys(styleExtras).length ? `...${JSON.stringify(styleExtras)},` : ''}
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
    releaseSession(session);
  }
}

/**
 * Move an existing object to new coordinates.
 */
export async function moveObject(boardId, objectId, { x, y }) {
  assertBoardId(boardId);
  assertBoardWritable(boardId);
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
    releaseSession(session);
  }
}

/**
 * Set fill / stroke color (#RRGGBB), stroke style and stroke
 * width on an object. fillOpacity / strokeOpacity (0..1) adjust the opacity
 * inside the existing color object without touching its color.
 */
export async function setColor(boardId, objectId, { fillColor, strokeColor, strokeStyle, strokeWidth, fillOpacity, strokeOpacity, backgroundStyle } = {}) {
  assertBoardId(boardId);
  assertBoardWritable(boardId);
  assertNotReadOnly();
  assertObjectId(objectId);
  fillColor = fillColor === undefined ? undefined : parseColor(fillColor, 'fillColor');
  strokeColor = strokeColor === undefined ? undefined : parseColor(strokeColor, 'strokeColor');
  strokeStyle = strokeStyle === undefined ? undefined : assertStrokeStyle(strokeStyle, 'strokeStyle');
  strokeWidth = strokeWidth === undefined ? undefined : num(strokeWidth, 'strokeWidth', { min: 0, max: 100 });
  fillOpacity = fillOpacity === undefined ? undefined : assertOpacity(fillOpacity, 'fillOpacity');
  strokeOpacity = strokeOpacity === undefined ? undefined : assertOpacity(strokeOpacity, 'strokeOpacity');
  backgroundStyle = assertBackgroundStyle(backgroundStyle, 'backgroundStyle');
  if (fillColor === undefined && strokeColor === undefined && strokeStyle === undefined
      && strokeWidth === undefined && fillOpacity === undefined && strokeOpacity === undefined
      && backgroundStyle === undefined) {
    throw new ValidationError('provide at least one of fillColor, strokeColor, strokeStyle, strokeWidth, fillOpacity, strokeOpacity, backgroundStyle');
  }
  const session = await getBoardSession(boardId);
  try {
    const result = await session.evaluate(
      `(() => {
        try {
          const yDoc = window.ds.yPersistence.yDoc;
          const yObjects = yDoc.getMap('objects');
          const obj = yObjects.get(${JSON.stringify(objectId)});
          if (!obj || !obj.set) return { __error: 'object not found' };
          const colorWrite = (field, color, opacity) => {
            const cur = (obj.get(field) && typeof obj.get(field) === 'object') ? obj.get(field) : {};
            const next = { color: color !== undefined ? color : cur.color, opacity: opacity !== undefined ? opacity : (cur.opacity !== undefined ? cur.opacity : 1) };
            if (next.color === undefined) return 'no ' + field + ' to adjust';
            obj.set(field, next);
            return null;
          };
          let warn = [];
          yDoc.transact(() => {
            ${fillColor !== undefined || fillOpacity !== undefined ? `const e1 = colorWrite('fillColor', ${JSON.stringify(fillColor)}, ${fillOpacity !== undefined ? Number(fillOpacity) : 'undefined'}); if (e1) warn.push(e1);` : ''}
            ${strokeColor !== undefined || strokeOpacity !== undefined ? `const e2 = colorWrite('strokeColor', ${JSON.stringify(strokeColor)}, ${strokeOpacity !== undefined ? Number(strokeOpacity) : 'undefined'}); if (e2) warn.push(e2);` : ''}
            ${strokeWidth !== undefined ? `obj.set('strokeWidth', ${Number(strokeWidth)});` : ''}
            ${strokeStyle ? (strokeStyle === 'solid'
              ? `if (obj.get('strokeStyle') !== undefined) obj.delete('strokeStyle');`
              : `obj.set('strokeStyle', ${JSON.stringify(strokeStyle)});`) : ''}
            ${backgroundStyle !== undefined ? `if (obj.get('type') !== 'frame') { warn.push('backgroundStyle applies to frames only'); } else { obj.set('backgroundStyle', ${Number(backgroundStyle)}); }` : ''}
            obj.set('updated', { a: 0, t: Date.now() });
          });
          return { ok: true, id: ${JSON.stringify(objectId)}, warnings: warn.length ? warn : null };
        } catch (e) { return { __error: String(e), stack: e.stack }; }
      })()`
    );
    if (result?.__error) throw new Error(result.__error);
    return result;
  } finally {
    releaseSession(session);
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
  fillColor = '#ffffff',
  backgroundStyle,
}) {
  assertBoardId(boardId);
  assertBoardWritable(boardId);
  assertNotReadOnly();
  labelText = assertText(labelText, 'labelText', { default: 'Frame' });
  x = num(x, 'x', COORD);
  y = num(y, 'y', COORD);
  width = num(width, 'width', SIZE);
  height = num(height, 'height', SIZE);
  fillColor = fillColor === undefined ? '#ffffff' : parseColor(fillColor, 'fillColor');
  backgroundStyle = assertBackgroundStyle(backgroundStyle, 'backgroundStyle');
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
            fillColor: { color: ${JSON.stringify(fillColor)}, opacity: 1 },${backgroundStyle !== undefined ? `
            backgroundStyle: ${Number(backgroundStyle)},` : ''}
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
    releaseSession(session);
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
  assertBoardWritable(boardId);
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
    releaseSession(session);
  }
}

/**
 * Resize an object (shape / sticker).
 */
export async function resizeObject(boardId, objectId, { width, height }) {
  assertBoardId(boardId);
  assertBoardWritable(boardId);
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
    releaseSession(session);
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

// ---- batch create -------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkAllMounted(session, ids) {
  return await session.evaluate(
    buildCheckAllMountedExpr(ids)
  );
}

/**
 * Create a whole diagram in one call (10-15x faster than sequential add_*):
 * one pooled CDP session, one creation pass, ONE settle for all mounts,
 * one native text pass, one mount-check with a single self-healing reload.
 * entries: [{ kind, ref?, ...fields }] + arrows referencing refs.
 */
export async function batchCreate(boardId, entries, options = {}) {
  assertBoardId(boardId);
  assertBoardWritable(boardId);
  assertNotReadOnly();
  const arrowsBehind = Boolean(options.arrowsBehind);
  const plan = buildBatchPlan(entries);
  const session = await getBoardSession(boardId);
  try {
    // Phase 1a: create objects in chunks of 50
    const byIndex = [];
    for (let i = 0; i < plan.creations.length; i += 50) {
      const res = await session.evaluate(buildBatchCreationExpr(plan.creations.slice(i, i + 50)));
      if (res?.__error) throw new Error('batch creation failed: ' + res.__error);
      byIndex.push(...res);
    }
    // Phase 1b: arrows (reference created ids)
    let arrowIds = [];
    if (plan.arrows.length) {
      const res = await session.evaluate(buildBatchArrowsExpr(byIndex, plan.arrows, arrowsBehind));
      if (res?.__error) throw new Error('batch arrows failed: ' + res.__error);
      arrowIds = res.map((r) => r.id);
    }

    // Phase 2: ONE settle for all mounts, then one native text pass
    await sleep(2500);
    const textJobs = [];
    plan.creations.forEach((c, idx) => {
      if (c.hasDocument && ((c.text !== undefined && String(c.text) !== '') || c.runs !== undefined)) {
        const marks = {};
        for (const k of ['bold', 'italic', 'underline', 'strikethrough']) {
          if (c[k] !== undefined) marks[k] = c[k];
        }
        const { segments, plainText } = buildSegments(c.runs !== undefined ? { runs: c.runs } : { text: String(c.text), marks });
        const hasColor = segments.some((s) => s.color !== undefined);
        textJobs.push({
          idx, segments, plainText,
          slateNodes: hasColor ? segmentsToSlateNodes(segments, randomUUID) : undefined,
        });
      }
    });
    let writeResults = [];
    if (textJobs.length) {
      const res = await session.evaluate(buildBatchTextWriteExpr(byIndex, textJobs));
      writeResults = res;
    }

    // Phase 3: one mount-check for everything, self-heal with ONE reload
    const allIds = byIndex.map((c) => c.id).concat(arrowIds);
    let mountedMap = await checkAllMounted(session, allIds);
    const missing = () => allIds.filter((id) => !mountedMap[id]);
    if (missing().length) {
      for (let attempt = 0; attempt < 2 && missing().length; attempt++) {
        await sleep(1000);
        mountedMap = await checkAllMounted(session, allIds);
      }
      if (missing().length) {
        await session.send('Page.enable', {});
        await session.send('Page.reload', { ignoreCache: true });
        await sleep(8000);
        mountedMap = await checkAllMounted(session, allIds);
      }
    }

    // Retry failed texts individually (binding races)
    for (const w of writeResults) {
      if (!w.ok && w.idx >= 0) {
        const c = plan.creations[w.idx];
        const o = byIndex[w.idx];
        const marks = {};
        for (const k of ['bold', 'italic', 'underline', 'strikethrough']) {
          if (c[k] !== undefined) marks[k] = c[k];
        }
        w.ok = await nativeWriteWithRetry(session, o.id, o.documentId, { text: c.text, runs: c.runs, marks }, 2);
      }
    }

    // Assemble result
    const createdMap = {};
    const textFailedRefs = [];
    byIndex.forEach((c, idx) => {
      const wr = writeResults.find((w) => w.idx === idx);
      createdMap[c.ref] = {
        id: c.id,
        documentId: c.documentId,
        mounted: mountedMap[c.id] ?? false,
        textOk: wr ? wr.ok : null, // null = no text (frame/stamp/empty)
      };
      if (wr && !wr.ok) textFailedRefs.push(c.ref);
    });
    plan.arrows.forEach((a, ai) => {
      createdMap[a.ref] = {
        id: arrowIds[ai],
        type: 'arrow',
        mounted: mountedMap[arrowIds[ai]] ?? false,
      };
    });
    const unmountedRefs = byIndex.filter((c) => !mountedMap[c.id]).map((c) => c.ref);
    return {
      ok: textFailedRefs.length === 0 && unmountedRefs.length === 0,
      created: createdMap,
      arrowIds,
      objectCount: byIndex.length,
      arrowCount: arrowIds.length,
      textFailedRefs,
      unmountedRefs,
    };
  } finally {
    releaseSession(session);
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
    rwBoardIdsCount: ((process.env.HOLST_RW_BOARD_IDS || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []).length,
    roBoardIdsCount: ((process.env.HOLST_RO_BOARD_IDS || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []).length,
    maxDumpBytes: Number(process.env.HOLST_MAX_DUMP_BYTES) || 2000000,
  };
}

/**
 * Screenshot (v0.7.0): capture the board canvas as an image, without any
 * disk writes. Returns a special envelope { __image, ...meta } — the server
 * layer converts __image into an MCP ImageContent block (multimodal clients
 * see the picture; text-only models see only the compact meta JSON).
 * withBase64: true additionally embeds the base64 into the meta for agents
 * that need to save the file themselves (~2x base64 tokens — opt-in).
 *
 * Camera: bbox fits the view through the app's own navigation service
 * (never input synthesis), then the previous camera position is restored.
 * Colors: CDP captures have a slight color shift on P3 displays — fine for
 * layout verification, not for pixel-exact color checks.
 */
export async function screenshot(boardId, opts = {}) {
  assertBoardId(boardId);
  assertBoardReadable(boardId);
  const { bbox, withBase64 = false } = opts;
  const format = opts.format === undefined ? 'jpeg' : opts.format;
  const scale = opts.scale === undefined ? 'css' : opts.scale;
  const quality = opts.quality === undefined ? 85 : num(opts.quality, 'quality', { min: 1, max: 100 });
  if (!['jpeg', 'png'].includes(format)) throw new ValidationError('format must be jpeg or png');
  if (!['css', 'device'].includes(scale)) throw new ValidationError('scale must be css or device');
  if (bbox !== undefined) {
    if (bbox === null || typeof bbox !== 'object' || Array.isArray(bbox)) {
      throw new ValidationError('bbox must be an object { x1, y1, x2, y2 }');
    }
    for (const k of ['x1', 'y1', 'x2', 'y2']) num(bbox[k], `bbox.${k}`);
    if (!(bbox.x2 > bbox.x1 && bbox.y2 > bbox.y1)) {
      throw new ValidationError('bbox must satisfy x2 > x1 and y2 > y1');
    }
  }
  // Serialize captures: concurrent calls on the same board would interleave
  // camera state (fit/restore races) and capture each other's view.
  const run = async () => {
    const session = await getBoardSession(boardId);
    try {
      return await screenshotWithSession(session, { bbox, format, quality, scale, withBase64 });
    } finally {
      releaseSession(session);
    }
  };
  const prev = screenshotQueue;
  screenshotQueue = (async () => { await prev.catch(() => {}); return run(); })();
  try {
    return await screenshotQueue;
  } finally {
    screenshotQueue = Promise.resolve();
  }
}

let screenshotQueue = Promise.resolve();

/**
 * Testable orchestration over an existing CDP session: state → (optional fit)
 * → capture → restore. Exported for L1 tests with a stub session.
 *
 * Meta honesty rules (learned in review):
 * - widthPx/heightPx describe the ACTUAL bitmap: CDP emits clip × scale × dpr,
 *   so css mode (clip.scale=1/dpr) yields CSS-pixel size, device mode ×dpr.
 * - the camera restore runs in a finally AFTER a fit (capture failure must not
 *   leave the camera moved) and its real outcome lands in cameraRestored /
 *   cameraRestoreError — never assumed.
 */
/**
 * Actual bitmap dimensions, decoded from the returned image bytes (PNG IHDR /
 * JPEG SOF) — the only source that matches CDP's own rounding of fractional
 * clip rects. Returns null when parsing fails (caller falls back to math).
 */
function bitmapDims(buf, mimeType) {
  if (mimeType === 'image/png' && buf.length > 24 && buf[0] === 0x89) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

export async function screenshotWithSession(session, { bbox, format = 'jpeg', quality = 85, scale = 'css', withBase64 = false } = {}) {
  const before = await session.evaluate(buildCanvasStateExpr());
  if (before?.__error) throw new Error(before.__error);
  if (!before.canvasRect) throw new Error('canvas container not found — is the board view open?');

  const restoreCamera = async () => {
    const cx = before.viewport.x + before.viewport.width / 2;
    const cy = before.viewport.y + before.viewport.height / 2;
    try {
      const r = await session.evaluate(buildCameraSetExpr({ x: cx, y: cy }, before.zoom));
      if (r?.__error) return { restored: false, error: r.__error };
      return { restored: true, error: null };
    } catch (e) {
      return { restored: false, error: String(e) };
    }
  };

  let applied = null;
  let restore = { restored: !bbox, error: null };
  let shot = null;
  try {
    if (bbox !== undefined) {
      const fit = await session.evaluate(buildCameraFitExpr(bbox));
      if (fit?.__error) throw new Error(fit.__error);
      applied = fit.applied;
      await sleep(700); // let the renderer settle after the camera move
    }
    shot = await session.send('Page.captureScreenshot', {
      format,
      ...(format === 'jpeg' ? { quality: Math.round(quality) } : {}),
      clip: {
        x: before.canvasRect.x, y: before.canvasRect.y,
        width: before.canvasRect.width, height: before.canvasRect.height,
        scale: scale === 'css' ? 1 / before.dpr : 1,
      },
    });
  } finally {
    if (bbox !== undefined) restore = await restoreCamera();
  }

  // Actual bitmap = canvasRect (CSS px) × outScale; decimals differ by CDP
  // rounding — decode the real dims from the returned bytes when possible.
  const outScale = scale === 'css' ? 1 : before.dpr;
  const dims = bitmapDims(Buffer.from(shot.data, 'base64'), format === 'png' ? 'image/png' : 'image/jpeg');
  const meta = {
    ok: true,
    format,
    mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
    widthPx: dims ? dims.w : Math.round(before.canvasRect.width * outScale),
    heightPx: dims ? dims.h : Math.round(before.canvasRect.height * outScale),
    bytes: Math.round(shot.data.length * 3 / 4),
    worldRect: bbox !== undefined
      ? { x1: bbox.x1, y1: bbox.y1, x2: bbox.x2, y2: bbox.y2 }
      : { x1: before.viewport.x, y1: before.viewport.y, x2: before.viewport.x + before.viewport.width, y2: before.viewport.y + before.viewport.height },
    cameraMoved: bbox !== undefined,
    cameraRestored: restore.restored,
    ...(restore.error ? { cameraRestoreError: restore.error } : {}),
    ...(applied ? { fitApplied: applied } : {}),
    ...(withBase64 ? { base64: shot.data } : {}),
  };
  return { __image: { data: shot.data, mimeType: meta.mimeType }, ...meta };
}
