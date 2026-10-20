// Page-eval script builders (plan: docs/plans/2026-10-18-unit-testing-cdp-layer.md).
// Every script holst.js sends through Runtime.evaluate is composed HERE as a
// pure function — testable without Holst: compile checks (new Function uses
// the same parser the page does), placeholder scans and injection guards run
// in test/eval-scripts.test.js. Builders take PRE-VALIDATED values; numeric
// coordinates get a finite-number guard as the last line of defense.

import { buildArrowTexts } from './arrow-text.js';

/**
 * Native document write through the app's own Slate editor pipeline
 * (singleDocumentStore.replaceFromJSON). Raw Y.Text inserts are NOT
 * rendered by Holst ≥ 2026-10 builds — the editor layer (toDelta) is
 * the rendering source of truth. Returns null when the native API is
 * unavailable (older builds) → caller falls back to raw Yjs.
 */
export const NATIVE_WRITE_HELPER = `
  function __nativeWrite(objectId, docId, segments, plainText, slateNodes) {
    try {
      const ds = window.ds;
      const sds = ds && ds.store && ds.store.objectBuilder && ds.store.objectBuilder.singleDocumentStore;
      if (!sds || typeof sds.getEditor !== 'function' || typeof sds.createFromString !== 'function') return null;
      const yDoc = ds.yPersistence.yDoc;
      const yDocs = yDoc.getMap('documents');
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Run-level styling rides as HTML through the app's own paste pipeline —
      // the editor maps it to Slate mark nodes (<bold>/<color>/… in yDoc).
      // Emphasis wraps OUTSIDE the color span (app's own mark order).
      const segHtml = (s) => {
        let h = esc(String(s.text));
        if (s.color !== undefined) {
          const css = typeof s.color === 'number' ? '#' + s.color.toString(16).padStart(6, '0') : s.color;
          h = '<span style="color:' + css + ';">' + h + '</span>';
        }
        const m = s.marks || {};
        if (m.bold) h = '<strong>' + h + '</strong>';
        if (m.italic) h = '<em>' + h + '</em>';
        if (m.underline) h = '<u>' + h + '</u>';
        if (m.strikethrough) h = '<s>' + h + '</s>';
        return h;
      };
      const lines = [[]];
      for (const s of (segments || [{ text: String(plainText) }])) {
        const parts = String(s.text).split('\\n');
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) lines.push([]);
          if (parts[i] !== '') lines[lines.length - 1].push(segHtml(Object.assign({}, s, { text: parts[i] })));
        }
      }
      const html = lines.map((l) => '<p>' + l.join('') + '</p>').join('');
      const hasColor = (segments || []).some((sg) => sg && sg.color !== undefined);
      if (hasColor && typeof sds.createFromJSON === 'function') {
        // Run-level colors do NOT survive HTML paste (the app strips them) —
        // write Slate nodes directly through the app's own JSON pipeline.
        const nodes = slateNodes || null;
        if (nodes) {
          yDoc.transact(() => { yDocs.set(docId, new window.Yjs.Text()); });
          if (typeof sds.removeEditor === 'function') sds.removeEditor(docId);
          sds.createFromJSON(docId, { children: JSON.stringify(nodes) });
          const t = yDocs.get(docId);
          const got = t && typeof t.toDelta === 'function' ? t.toDelta().map((d) => d.insert || '').join('') : '';
          return { native: true, content: got };
        }
      }
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

const fin = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${name} must be a finite number (last-line guard in expr builder), got: ${v}`);
  }
  return v;
};

/** Full board dump: objects + document texts (Slate layer is the truth). */
export function buildBoardContentExpr() {
  return `(() => {
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
  })()`;
}

/** Mount-check for a set of ids (used by batch + self-heal flows). */
export function buildCheckAllMountedExpr(ids) {
  return `(() => { try { const ids = ${JSON.stringify(ids)}; const m = {}; for (const id of ids) m[id] = !!(window.ds && window.ds.store && window.ds.store.objects.has(id)); return m; } catch (e) { return {}; } })()`;
}

/** Object type probe — routes update_text between arrow/doc branches. */
export function buildKindExpr(objectId) {
  return `(() => { try { const o = window.ds.yPersistence.yDoc.getMap('objects').get(${JSON.stringify(objectId)}); return o && o.get ? o.get('type') : (o ? o.type : null); } catch (e) { return { __error: String(e) }; } })()`;
}

/** Touch the `updated` timestamp after a successful text write. */
export function buildTouchUpdatedExpr(objectId) {
  return `(() => { try { const o = window.ds.yPersistence.yDoc.getMap('objects').get(${JSON.stringify(objectId)}); if (o && o.set) o.set('updated', { a: 0, t: Date.now() }); return true; } catch (e) { return false; } })()`;
}

/** Apply typography extras (fontSize/textColor/…) as plain object fields.
 * deleteFields (optional) removes stale fields in the same transaction — used
 * to heal the alien `fontSize` field the pre-fix update_text planted on
 * simple-text objects (issue #2). */
export function buildStyleFieldsExpr(objectId, styleExtras, deleteFields = []) {
  return `(() => {
    try {
      const yDoc = window.ds.yPersistence.yDoc;
      const obj = yDoc.getMap('objects').get(${JSON.stringify(objectId)});
      if (!obj || !obj.set) return { __error: 'object not found' };
      const extras = ${JSON.stringify(styleExtras)};
      const clear = ${JSON.stringify(deleteFields)};
      yDoc.transact(() => {
        for (const k of Object.keys(extras)) obj.set(k, extras[k]);
        for (const k of clear) obj.delete(k);
        obj.set('updated', { a: 0, t: Date.now() });
      });
      return { ok: true, styled: Object.keys(extras), ${deleteFields.length ? 'cleared: clear,' : ''} };
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

/**
 * Style update through the app's own objectsService.update — the only path
 * that re-renders the MOUNTED editor live (issue #2: raw yDoc textScale
 * writes persist but the mounted view keeps the old scale until reload,
 * verified on app 0.0.7). The service applies domain+render immediately but
 * persists to yDoc with a debounce, so the script polls the doc until the
 * expected fields land (bounded wait). Service patches cannot delete fields,
 * so the heal of alien fields (pre-fix `fontSize` on simple-text) still runs
 * as a raw transaction. Returns { native: false } when the service is missing
 * (older builds) — callers fall back to buildStyleFieldsExpr.
 */
export function buildNativeStyleUpdateExpr(objectId, styleExtras = {}, deleteFields = []) {
  return `(async () => {
    try {
      const ds = window.ds;
      const app = ds && ds.store && ds.store.objectBuilder && ds.store.objectBuilder.getApp
        && ds.store.objectBuilder.getApp();
      const svc = app && app.objectsService;
      if (!svc || typeof svc.update !== 'function') return { native: false };
      const extras = ${JSON.stringify(styleExtras)};
      if (Object.keys(extras).length) await svc.update(${JSON.stringify(objectId)}, extras);
      const yDoc = ds.yPersistence.yDoc;
      const obj = yDoc.getMap('objects').get(${JSON.stringify(objectId)});
      const clear = ${JSON.stringify(deleteFields)};
      const cleared = [];
      if (obj && obj.delete && clear.length) {
        yDoc.transact(() => {
          for (const k of clear) if (obj.has(k)) { obj.delete(k); cleared.push(k); }
        });
      }
      // wait (bounded) for the debounced yDoc persistence to reflect the patch
      const matches = () => {
        const o = yDoc.getMap('objects').get(${JSON.stringify(objectId)});
        if (!o || !o.get) return false;
        for (const k of Object.keys(extras)) {
          if (JSON.stringify(o.get(k)) !== JSON.stringify(extras[k])) return false;
        }
        for (const k of clear) if (o.get(k) !== undefined) return false;
        return true;
      };
      const deadline = Date.now() + 1500;
      while (!matches() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return { ok: true, native: true, styled: Object.keys(extras), cleared, converged: matches() };
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

/**
 * Z-order update on an EXISTING object (issue #10): layer order is the plain
 * `zIndex` object field. Two modes, both one page pass:
 * - absolute: spec.zIndex written as-is (same vocabulary as batch entries);
 * - placement front/back: computed in-page from the z landscape with the
 *   TARGET EXCLUDED from the scan (front = othersMax+1, back = othersMin-1;
 *   already-top object stays at the same value — no drift on repeats; empty
 *   landscape → 0).
 * Write path: the app's own objectsService.update — the only path that
 * re-renders the MOUNTED editor live (issue #2: raw style writes persist but
 * the mounted view keeps the stale order until reload) — with an in-page raw
 * transact fallback for older builds. The convergence poll waits for the
 * debounced yDoc persistence (same budget as buildNativeStyleUpdateExpr).
 */
export function buildSetZOrderExpr(objectId, { zIndex, placement } = {}) {
  const spec = { id: objectId };
  if (zIndex !== undefined) spec.zIndex = Number(zIndex);
  if (placement !== undefined) spec.placement = placement;
  return `(async () => {
    try {
      const spec = ${JSON.stringify(spec)};
      const ds = window.ds;
      const yDoc = ds.yPersistence.yDoc;
      const yObjects = yDoc.getMap('objects');
      const obj = yObjects.get(spec.id);
      if (!obj || !obj.get) return { __error: 'object not found: ' + spec.id };
      let z;
      if (spec.zIndex !== undefined) {
        z = spec.zIndex;
      } else {
        let maxZ = -Infinity, minZ = Infinity;
        for (const [k, v] of yObjects.entries()) {
          if (k === spec.id) continue;
          const zz = v && v.get ? v.get('zIndex') : null;
          if (typeof zz !== 'number') continue;
          if (zz > maxZ) maxZ = zz;
          if (zz < minZ) minZ = zz;
        }
        if (maxZ === -Infinity) z = 0;
        else z = spec.placement === 'front' ? maxZ + 1 : minZ - 1;
      }
      const app = ds.store && ds.store.objectBuilder && ds.store.objectBuilder.getApp
        && ds.store.objectBuilder.getApp();
      const svc = app && app.objectsService;
      if (svc && typeof svc.update === 'function') {
        await svc.update(spec.id, { zIndex: z });
        const matches = () => {
          const o = yObjects.get(spec.id);
          return !!(o && o.get && o.get('zIndex') === z);
        };
        const deadline = Date.now() + 1500;
        while (!matches() && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return { ok: true, native: true, zIndex: z, converged: matches() };
      }
      // older build → raw write (persists; the mounted view may keep the
      // stale order until reload — issue #2)
      yDoc.transact(() => {
        obj.set('zIndex', z);
        obj.set('updated', { a: 0, t: Date.now() });
      });
      return { ok: true, native: false, zIndex: z };
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

/** Create a simple-text object (typed via T in UI). */
export function buildAddSimpleTextExpr({ x, y, width, styleExtras = {} }) {
  fin(x, 'x'); fin(y, 'y');
  if (width !== undefined) fin(width, 'width');
  return `(() => {
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
        ${width !== undefined ? `width: ${Number(width)}, fixedWidth: true,` : ''}
        documentId: newDocId,
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
  })()`;
}

/**
 * Create an arrow object (issue #39 extraction from holst.js so the write-path
 * is unit-testable). Values are PRE-VALIDATED by addArrow. midwayControls
 * (issue #39) rides verbatim: absolute [{ x, y }] points the app routes the
 * arrow through — its UI exposes them as draggable "elbows".
 */
export function buildAddArrowExpr({
  start, end, arrowType, strokeColor, strokeStyle, strokeWidth,
  arrowheadStart, arrowheadEnd, texts, styleExtras = {}, midwayControls, elbowMidwayControls,
}) {
  return `(() => {
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
        ${midwayControls !== undefined ? `midwayControls: ${JSON.stringify(midwayControls)},` : ''}
        ${elbowMidwayControls !== undefined ? `elbowMidwayControls: ${JSON.stringify(elbowMidwayControls)},` : ''}
        ${Object.keys(styleExtras).length ? `...${JSON.stringify(styleExtras)},` : ''}
      };
      for (const k of Object.keys(fields)) map.set(k, fields[k]);
      yDoc.transact(() => {
        yObjects.set(newId, map);
      });
      return { ok: true, id: newId };
    } catch (e) { return { __error: String(e), stack: e.stack }; }
  })()`;
}

/** Batch phase 1a: create non-arrow objects in one pass. */
export function buildBatchCreationExpr(chunk) {
  return `(() => {
    try {
      const yDoc = window.ds.yPersistence.yDoc;
      const Yjs = window.Yjs;
      const yObjects = yDoc.getMap('objects');
      const yDocs = yDoc.getMap('documents');
      const spec = ${JSON.stringify(chunk)};
      const mkId = () => (window.crypto || crypto).randomUUID();
      const out = [];
      for (const s of spec) {
        const newId = mkId();
        let docId = null;
        let maxZ = 0, minZ = 0;
        for (const [, v] of yObjects.entries()) {
          const z = v && v.get ? v.get('zIndex') : null;
          if (typeof z === 'number') { if (z > maxZ) maxZ = z; if (z < minZ) minZ = z; }
        }
        const pos = { x: s.x, y: s.y };
        let fields;
        if (s.kind === 'shape') {
          docId = mkId();
          fields = { type: 'shape', shapeType: s.shapeType, documentId: docId, width: s.width, height: s.height, fixedSize: s.fixedSize, fillColor: s.fillColor, strokeColor: s.strokeColor, strokeWidth: s.strokeWidth, position: pos, zIndex: s.zIndex !== undefined ? s.zIndex : maxZ + 1, created: { a: 0, t: Date.now() }, updated: null, id: newId, parentId: null };
        } else if (s.kind === 'sticker') {
          docId = mkId();
          fields = { type: 'sticker', documentId: docId, position: pos, width: s.width, height: s.height, textScale: 0.7346875, zIndex: s.zIndex !== undefined ? s.zIndex : maxZ + 1, created: { a: 0, t: Date.now() }, updated: null, id: newId, parentId: null };
        } else if (s.kind === 'simple-text') {
          docId = mkId();
          fields = { type: 'simple-text', position: pos, ...(s.width !== undefined ? { width: s.width, fixedWidth: true } : {}), documentId: docId, zIndex: s.zIndex !== undefined ? s.zIndex : maxZ + 1, created: { a: 0, t: Date.now() }, updated: null, id: newId, parentId: null };
        } else if (s.kind === 'frame') {
          fields = { type: 'frame', width: s.width, height: s.height, labelText: s.labelText, fillColor: s.fillColor, ...(s.backgroundStyle !== undefined ? { backgroundStyle: s.backgroundStyle } : {}), position: pos, zIndex: s.zIndex !== undefined ? s.zIndex : minZ - 1, created: { a: 0, t: Date.now() }, updated: null, id: newId, parentId: null };
        } else if (s.kind === 'stamp') {
          fields = { type: 'stamp', data: { type: s.stampType, text: s.text }, width: s.width, height: s.height, position: pos, zIndex: s.zIndex !== undefined ? s.zIndex : maxZ + 1, created: { a: 0, t: Date.now() }, updated: null, id: newId, parentId: null };
        } else {
          throw new Error('unknown kind: ' + s.kind);
        }
        // Typography extras (fontSize/textScale/textColor/horizontalAlign/…) —
        // plain object fields, ride as-is from the validated batch plan.
        for (const k of ['fontSize','textScale','textColor','textBackgroundColor','horizontalAlign','verticalAlign','letterSpacing','fontFamily','lineHeight','borderRadius']) {
          if (s[k] !== undefined) fields[k] = s[k];
        }
        const map = new Yjs.Map();
        for (const k of Object.keys(fields)) map.set(k, fields[k]);
        yDoc.transact(() => {
          if (docId) yDocs.set(docId, new Yjs.Text());
          yObjects.set(newId, map);
        });
        out.push({ ref: s.ref, id: newId, documentId: docId });
      }
      return out;
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

/** Batch phase 1b: arrows (optionally below the created nodes). */
export function buildBatchArrowsExpr(byIndex, arrows, arrowsBehind) {
  // Prebuild on-arrow label payloads Node-side (plain JSON → travels in spec).
  const spec = arrows.map((a) => ({
    ...a,
    texts: a.text !== undefined && String(a.text) !== '' ? buildArrowTexts(String(a.text), a.textPosition ?? 0.5) : undefined,
  }));
  return `(() => {
    try {
      const yDoc = window.ds.yPersistence.yDoc;
      const Yjs = window.Yjs;
      const yObjects = yDoc.getMap('objects');
      const byIndex = ${JSON.stringify(byIndex.map((c) => ({ id: c.id })))};
      const spec = ${JSON.stringify(spec)};
      const mkId = () => (window.crypto || crypto).randomUUID();
      const out = [];
      // arrowsBehind: place arrows BELOW the just-created nodes (design systems
      // draw connectors behind boxes) but ABOVE frames — frames carry background
      // fills, so arrows below a frame would be invisible.
      let behindBase = null;
      if (${arrowsBehind ? 'true' : 'false'}) {
        let minZNew = Infinity, maxFrameZ = -Infinity;
        for (const c of byIndex) {
          const o = yObjects.get(c.id);
          const t = o && o.get ? o.get('type') : null;
          const z = o && o.get ? o.get('zIndex') : null;
          if (typeof z !== 'number') continue;
          if (t === 'frame') { if (z > maxFrameZ) maxFrameZ = z; continue; }
          if (z < minZNew) minZNew = z;
        }
        // No non-frame creations → sit just above the highest frame.
        behindBase = minZNew !== Infinity ? minZNew - 1 : (maxFrameZ !== -Infinity ? maxFrameZ + 1 : 0);
      }
      for (const a of spec) {
        const newId = mkId();
        let maxZ = 0;
        for (const [, v] of yObjects.entries()) {
          const z = v && v.get ? v.get('zIndex') : null;
          if (typeof z === 'number' && z > maxZ) maxZ = z;
        }
        const normalize = (ep) => {
          if (ep.refIndex !== undefined) {
            return { objectId: byIndex[ep.refIndex].id, point: { x: 0, y: 0 }, relativePoint: ep.relativePoint || { x: 0.5, y: 0.5 }, control: ep.control ?? null };
          }
          if (ep.objectId !== undefined) {
            // existing board object — attaching to a live diagram
            return { objectId: ep.objectId, point: { x: 0, y: 0 }, relativePoint: ep.relativePoint || { x: 0.5, y: 0.5 }, control: ep.control ?? null };
          }
          return { point: ep.point, relativePoint: { x: 0, y: 0 }, control: null };
        };
        const map = new Yjs.Map();
        const fields = {
          type: 'arrow',
          arrowType: a.arrowType,
          ...(a.strokeStyle && a.strokeStyle !== 'solid' ? { strokeStyle: a.strokeStyle } : {}),
          strokeColor: { color: a.strokeColor, opacity: 1 },
          ...(a.strokeWidth !== undefined ? { strokeWidth: a.strokeWidth } : {}),
          ...(a.arrowheadStart !== undefined ? { arrowheadStart: a.arrowheadStart } : {}),
          ...(a.arrowheadEnd !== undefined ? { arrowheadEnd: a.arrowheadEnd } : {}),
          position: { x: 0, y: 0 },
          start: normalize(a.from),
          end: normalize(a.to),
          zIndex: a.zIndex !== undefined ? a.zIndex : (behindBase !== null ? behindBase-- : maxZ + 1),
          created: { a: 0, t: Date.now() },
          updated: null,
          id: newId,
          parentId: null,
          ...(a.texts ? { texts: a.texts } : {}),
          ...(a.midwayControls ? { midwayControls: a.midwayControls } : {}),
          ...(a.elbowMidwayControls ? { elbowMidwayControls: a.elbowMidwayControls } : {}),
          ...(a.textColor !== undefined ? { textColor: a.textColor } : {}),
          ...(a.fontSize !== undefined ? { fontSize: a.fontSize } : {}),
          ...(a.textRotated !== undefined ? { textRotated: a.textRotated } : {}),
        };
        for (const k of Object.keys(fields)) map.set(k, fields[k]);
        yDoc.transact(() => { yObjects.set(newId, map); });
        out.push({ id: newId });
      }
      return out;
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

/**
 * Read the label-placement state for issue #42 side resolution: per arrow id
 * the renderer's local path direction at the label position (fulcrumVector
 * from the mounted label instance) plus the anchor stored in yDoc. The
 * screen-side → anchor resolution happens Node-side (labelSideToAnchor).
 * Per id: { fv: {x, y} | null, storedAnchor: number | null, noLabel: bool }
 * or { missing: true } for an unknown object.
 */
export function buildArrowLabelAnchorsExpr(ids) {
  return `(() => {
    try {
      const ids = ${JSON.stringify(ids)};
      const out = {};
      for (const id of ids) {
        const o = window.ds && window.ds.store && window.ds.store.objects && window.ds.store.objects.get
          ? window.ds.store.objects.get(id) : null;
        if (!o) { out[id] = { missing: true }; continue; }
        const yObj = window.ds.yPersistence.yDoc.getMap('objects').get(id);
        const stored = yObj && yObj.get ? yObj.get('texts') : null;
        const entry = Array.isArray(stored) && stored.length ? stored[0] : null;
        const byId = entry && entry.id !== undefined
          ? (l) => l && l.id === entry.id
          : (l) => !!l;
        const lbl = Array.isArray(o.textsOnArrow) ? (o.textsOnArrow.find(byId) || o.textsOnArrow[0]) : null;
        const fv = lbl && lbl.fulcrumVector && typeof lbl.fulcrumVector.x === 'number'
          ? { x: lbl.fulcrumVector.x, y: lbl.fulcrumVector.y } : null;
        out[id] = { fv, storedAnchor: entry && entry.anchor !== undefined ? entry.anchor : null, noLabel: !entry };
      }
      return out;
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

/**
 * Set the beside-line anchor on the FIRST label of an arrow (issue #42),
 * preserving its id/text/editor/position and any extra labels — unlike a
 * full rewrite this keeps the label identity the render layer diffs by.
 * Prefers objectsService.update (repaints the mounted arrow live, issue #7);
 * falls back to a raw yDoc write, and raw-writes as a guarantee when the
 * debounced service persist has not landed within persistDeadlineMs.
 */
export function buildSetArrowTextAnchorExpr(objectId, anchor, { persistDeadlineMs = 1500 } = {}) {
  return `(async () => {
    try {
      const ds = window.ds;
      const id = ${JSON.stringify(objectId)};
      const yObj = ds.yPersistence.yDoc.getMap('objects').get(id);
      if (!yObj || !yObj.get) return { __error: 'object not found' };
      if (yObj.get('type') !== 'arrow') return { __error: 'not an arrow' };
      const prevTexts = yObj.get('texts');
      if (!Array.isArray(prevTexts) || !prevTexts.length) return { __error: 'arrow has no label' };
      const entry = { ...prevTexts[0], anchor: ${Number(anchor)} };
      const rest = prevTexts.slice(1);
      const yDoc = ds.yPersistence.yDoc;
      const rawWrite = () => yDoc.transact(() => {
        yObj.set('texts', [entry, ...rest]);
        yObj.set('updated', { a: 0, t: Date.now() });
      });
      const app = ds.store && ds.store.objectBuilder && ds.store.objectBuilder.getApp
        && ds.store.objectBuilder.getApp();
      const svc = app && app.objectsService;
      if (svc && typeof svc.update === 'function') {
        await svc.update(id, { texts: [entry, ...rest] });
      } else {
        rawWrite();
      }
      const matches = () => {
        const stored = yDoc.getMap('objects').get(id).get('texts');
        return Array.isArray(stored) && stored[0] && stored[0].anchor === ${Number(anchor)};
      };
      if (!matches()) {
        const deadline = Date.now() + ${Number(persistDeadlineMs)};
        while (!matches() && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!matches()) rawWrite(); // guarantee the data (debounced persist may lag)
      }
      return { ok: true, arrow: true, id, anchor: ${Number(anchor)}, labels: 1 + rest.length, converged: matches() };
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

/**
 * Read the render-layer state of on-arrow labels (issue #3 verify pass):
 * for each arrow id, ask the app's own API what label it has mounted.
 * Per id returns { str } | { apiMissing } | { missing } | { error } —
 * apiMissing = app build without the API (fail-open at the call site).
 */
export function buildArrowLabelsStateExpr(ids) {
  return `(() => {
    try {
      const ids = ${JSON.stringify(ids)};
      const out = {};
      for (const id of ids) {
        const o = window.ds && window.ds.store && window.ds.store.objects && window.ds.store.objects.get
          ? window.ds.store.objects.get(id) : null;
        if (!o) { out[id] = { missing: true }; continue; }
        if (typeof o.getTextOnArrowString !== 'function') { out[id] = { apiMissing: true }; continue; }
        try { out[id] = { str: o.getTextOnArrowString() ?? null }; }
        catch (e) { out[id] = { error: String(e) }; }
      }
      return out;
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

/**
 * On-arrow label rewrite through the app's own objectsService.update — the
 * only path that re-renders the MOUNTED arrow live. Raw yDoc `texts` writes
 * persist fine but the render layer never repaints them until a page reload
 * (issue #7, verified on app 0.0.7: after a raw write yDoc shows the label
 * while getTextOnArrowString() keeps returning null; objectsService.update
 * paints within a second). The service persists to yDoc with a debounce, so
 * the script polls the doc until the label lands (bounded wait) and reports
 * converged — the caller raw-writes as a follow-up when it stays false.
 * The entry arrives Node-side (buildArrowTexts); its position is overridden
 * in-page from the previous label, and extra labels beyond the first are
 * preserved. Returns { native: false } when the service is missing (older
 * builds) — the caller falls back to the raw write.
 */
export function buildNativeArrowTextExpr(objectId, entry, { persistDeadlineMs = 1500 } = {}) {
  return `(async () => {
    try {
      const ds = window.ds;
      const app = ds && ds.store && ds.store.objectBuilder && ds.store.objectBuilder.getApp
        && ds.store.objectBuilder.getApp();
      const svc = app && app.objectsService;
      if (!svc || typeof svc.update !== 'function') return { native: false };
      const id = ${JSON.stringify(objectId)};
      const yDoc = ds.yPersistence.yDoc;
      const obj = yDoc.getMap('objects').get(id);
      if (!obj || !obj.get) return { __error: 'object not found' };
      if (obj.get('type') !== 'arrow') return { __error: 'not an arrow' };
      const prevTexts = obj.get('texts');
      const prev = Array.isArray(prevTexts) && prevTexts.length ? prevTexts[0] : null;
      const e = ${JSON.stringify(entry)};
      e.position = prev && typeof prev.position === 'number' ? prev.position : 0.5;
      if (prev && prev.anchor !== undefined) e.anchor = prev.anchor;
      const rest = Array.isArray(prevTexts) ? prevTexts.slice(1) : [];
      await svc.update(id, { texts: [e, ...rest] });
      const matches = () => {
        const stored = yDoc.getMap('objects').get(id).get('texts');
        return Array.isArray(stored) && stored[0] && stored[0].text === e.text;
      };
      const deadline = Date.now() + ${Number(persistDeadlineMs)};
      while (!matches() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return { ok: true, native: true, arrow: true, id, text: e.text, labels: 1 + rest.length, converged: matches() };
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

/** Delete many objects in ONE page pass (native objectsService.remove loop). */
export function buildDeleteObjectsExpr(ids) {
  return `(async () => {
    try {
      const ds = window.ds;
      const os = ds && ds.store && ds.store.objectBuilder && ds.store.objectBuilder.getApp
        && ds.store.objectBuilder.getApp().objectsService;
      const yDoc = ds.yPersistence.yDoc;
      const yObjects = yDoc.getMap('objects');
      const ids = ${JSON.stringify(ids)};
      const report = {};
      for (const id of ids) {
        try {
          const inY = yObjects.has(id);
          const stale = !inY && !!(ds.store.objects && ds.store.objects.has && ds.store.objects.has(id));
          if (!inY && !stale) {
            // Gone before we got here — typically a CASCADE delete (the app
            // removed an attached arrow when its node was deleted in this
            // same pass). That is a clean end-state, not a failure.
            report[id] = { ok: true, alreadyGone: true };
            continue;
          }
          if (os && typeof os.remove === 'function') {
            await os.remove(id);
          } else {
            yObjects.delete(id); // legacy fallback: raw delete (stale sprite until reload)
          }
          await new Promise((r) => setTimeout(r, 120));
          const stillY = yObjects.has(id);
          const stillStore = !!(ds.store.objects && ds.store.objects.has && ds.store.objects.has(id));
          report[id] = stillY || stillStore
            ? { ok: false, error: 'still present after remove' }
            : { ok: true, alreadyGone: stale };
        } catch (e) {
          report[id] = { ok: false, error: String(e).slice(0, 200) };
        }
      }
      // Counts (deleted/alreadyGone/failed) are computed by the orchestration
      // layer from the merged per-chunk reports — one source of truth.
      return { ok: Object.values(report).every((r) => r.ok), report };
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

/** Batch phase 2: one native text pass for all creations. */
export function buildBatchTextWriteExpr(byIndex, textJobs) {  return `(() => {
    try {
      ${NATIVE_WRITE_HELPER}
      const ids = ${JSON.stringify(byIndex.map((c) => ({ id: c.id, documentId: c.documentId })))};
      const jobs = ${JSON.stringify(textJobs)};
      const norm = (s) => String(s).replace(/<[^>]*>/g, '').replace(/\\n/g, '');
      const out = [];
      for (const j of jobs) {
        const o = ids[j.idx];
        const w = __nativeWrite(o.id, o.documentId, j.segments, j.plainText, j.slateNodes || null);
        out.push({ idx: j.idx, ok: !!(w && !w.error && norm(w.content) === norm(j.plainText)) });
      }
      return out;
    } catch (e) { return [{ idx: -1, ok: false, error: String(e) }]; }
  })()`;
}

// ─── Screenshot support (v0.7.0) ─────────────────────────────────────────────
// Camera moves go through the app's own navigation service (never input
// synthesis). Three small builders: read state, fit a world bbox, restore.

/** Read canvas + camera state for screenshot capture (read-only). */
export function buildCanvasStateExpr() {
  return `(() => {
    try {
      const ds = window.ds;
      const obj = ds && ds.store && ds.store.objects && ds.store.objects.entries().next().value?.[1];
      if (!obj) return { __error: 'board has no objects to reach the navigation service' };
      const nav = obj.objectBoundsService.visibilityService.navigationService;
      const cc = nav.canvasContainer;
      const r = cc && cc.getBoundingClientRect ? cc.getBoundingClientRect() : null;
      const v = nav.viewportRect;
      return {
        canvasRect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
        dpr: window.devicePixelRatio || 1,
        viewport: { x: v.x, y: v.y, width: v.width ?? v.w, height: v.height ?? v.h },
        zoom: nav.zoom,
      };
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

// Camera zoom writes go through the app's method API. On current builds
// (verified live, Holst 0.0.7 — issue #15) `zoom` is a GETTER-ONLY accessor
// on the navigation service prototype, so a bare `nav.zoom = x` assignment
// is a silent no-op under CDP's sloppy-mode Runtime.evaluate. `setZoomManual`
// was verified effective and matches a manual user camera move; `setZoom` is
// the same absolute-scale setter; the bare write stays as a fallback for
// older builds where `zoom` was a writable field.
const cameraZoomWrite = (valueExpr) => `
      if (typeof nav.setZoomManual === 'function') nav.setZoomManual(${valueExpr});
      else if (typeof nav.setZoom === 'function') nav.setZoom(${valueExpr});
      else nav.zoom = ${valueExpr};`;

/**
 * Fit the camera onto a world bbox (padding fraction applied in-page) and
 * report the exact applied center/zoom so the caller can restore later.
 */
export function buildCameraFitExpr(bbox, padFraction = 0.12) {
  const x1 = Number(bbox.x1), y1 = Number(bbox.y1), x2 = Number(bbox.x2), y2 = Number(bbox.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) throw new Error('buildCameraFitExpr: bbox must be finite numbers');
  const pad = Number(padFraction);
  return `(() => {
    try {
      const ds = window.ds;
      const obj = ds && ds.store && ds.store.objects && ds.store.objects.entries().next().value?.[1];
      if (!obj) return { __error: 'board has no objects to reach the navigation service' };
      const nav = obj.objectBoundsService.visibilityService.navigationService;
      const v = nav.viewportRect;
      const viewW = v.width ?? v.w, viewH = v.height ?? v.h;
      const pad = ${pad};
      const w = (${x2} - ${x1}) * (1 + 2 * pad), h = (${y2} - ${y1}) * (1 + 2 * pad);
      let zoom = Math.min(viewW / w, viewH / h);
      if (!Number.isFinite(zoom) || zoom <= 0) return { __error: 'computed zoom is not finite' };
      const cx = (${x1} + ${x2}) / 2, cy = (${y1} + ${y2}) / 2;
      nav.setViewportCenter(cx, cy);${cameraZoomWrite('zoom')}
      // Report the APPLIED zoom: the setter may clamp extreme fits.
      return { applied: { center: { x: cx, y: cy }, zoom: nav.zoom } };
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

/** Restore the camera to an explicit center/zoom. */
export function buildCameraSetExpr(center, zoomToApply) {
  const x = Number(center?.x), y = Number(center?.y), z = Number(zoomToApply);
  if (![x, y, z].every(Number.isFinite)) throw new Error('buildCameraSetExpr: center/zoom must be finite numbers');
  return `(() => {
    try {
      const ds = window.ds;
      const obj = ds && ds.store && ds.store.objects && ds.store.objects.entries().next().value?.[1];
      if (!obj) return { __error: 'board has no objects to reach the navigation service' };
      const nav = obj.objectBoundsService.visibilityService.navigationService;
      nav.setViewportCenter(${x}, ${y});${cameraZoomWrite(String(z))}
      return { ok: true, zoom: nav.zoom };
    } catch (e) { return { __error: String(e) }; }
  })()`;
}

// ─── Text measurement (issue #8) ────────────────────────────────────────────
// Real rendered metrics differ from nominal ones (SourceCodePro measures
// ~0.72em/char, not 0.6; bold caps ~0.9em) — sizing boxes by rule of thumb
// overflows. The board page has the EXACT font files the renderer uses, and
// canvas measureText runs the same shaping engine (HarfBuzz) as the canvas
// text pipeline, so measuring in-page gives the renderer's own numbers.
// Pure read: nothing is created, nothing is mutated.

/**
 * Measure how `text` renders with the given typography. Values must be
 * PRE-VALIDATED (holst.js); fin() guards numbers as the last line of
 * defense. The whole spec travels as ONE JSON-escaped literal — hostile
 * text cannot break out of the script. Returns an async IIFE (the face is
 * loaded via document.fonts.load before measuring) → evaluate with
 * { awaitPromise: true }.
 *
 * No silent fallbacks (the rhombus lesson): an unknown fontFamily token
 * errors WITH the available family list; a matched family that fails to
 * load errors instead of measuring in a substitute font; letterSpacing
 * on a build without ctx.letterSpacing errors instead of returning an
 * unspaced width.
 */
export function buildMeasureTextExpr({ text, fontSize, fontFamily, bold = false, italic = false, letterSpacing } = {}) {
  fontSize = fin(fontSize, 'fontSize');
  const ls = letterSpacing === undefined || letterSpacing === null ? null : fin(letterSpacing, 'letterSpacing');
  const spec = {
    text: String(text),
    fontSize,
    fontFamily: String(fontFamily),
    bold: Boolean(bold),
    italic: Boolean(italic),
    letterSpacing: ls,
  };
  return `(async () => {
    try {
      const spec = ${JSON.stringify(spec)};
      const doc = window.document;
      if (!doc || !doc.fonts || typeof doc.createElement !== 'function') {
        return { __error: 'page has no document.fonts surface for measurement' };
      }
      // Token → real CSS family: the app registers faces like "Source Code
      // Pro" while the MCP interface uses SourceCodePro. Compare with all
      // non-alphanumerics stripped, case-insensitive.
      const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
      const want = norm(spec.fontFamily);
      const families = [];
      const seen = {};
      for (const f of doc.fonts) {
        const fam = f && f.family;
        if (fam && !seen[fam]) { seen[fam] = true; families.push(fam); }
      }
      const hit = families.find((fam) => norm(fam) === want);
      if (!hit) {
        return { __error: 'unknown fontFamily "' + spec.fontFamily + '" — available: ' + families.sort().join(', ') };
      }
      const weight = spec.bold ? '700' : '400';
      const style = spec.italic ? 'italic' : 'normal';
      const fontSpec = style + ' ' + weight + ' ' + spec.fontSize + 'px "' + hit + '"';
      // Force the face to actually load — canvas silently substitutes a
      // fallback font for unloaded faces (wrong numbers, no error).
      try { await doc.fonts.load(fontSpec, spec.text.slice(0, 100)); } catch (e) {}
      if (typeof doc.fonts.check === 'function' && !doc.fonts.check(fontSpec)) {
        return { __error: 'fontFamily "' + hit + '" matched but its face failed to load — refusing to measure in a substitute font' };
      }
      const canvas = doc.createElement('canvas');
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx || typeof ctx.measureText !== 'function') {
        return { __error: 'canvas 2d context unavailable for measurement' };
      }
      ctx.font = fontSpec;
      if (spec.letterSpacing !== null) {
        if (!('letterSpacing' in ctx)) {
          return { __error: 'letterSpacing requested but ctx.letterSpacing is unavailable in this browser build — measure without letterSpacing' };
        }
        ctx.letterSpacing = spec.letterSpacing + 'px';
      }
      const lines = spec.text.split('\\n');
      const metrics = lines.map((ln) => ctx.measureText(ln));
      const ascent = metrics[0].fontBoundingBoxAscent;
      const descent = metrics[0].fontBoundingBoxDescent;
      if (typeof ascent !== 'number' || typeof descent !== 'number') {
        return { __error: 'fontBoundingBox metrics unavailable in this browser build' };
      }
      const lineHeightPx = ascent + descent;
      let widthPx = 0;
      for (const m of metrics) if (m.width > widthPx) widthPx = m.width;
      return {
        ok: true,
        fontFamily: hit,
        fontSize: spec.fontSize,
        bold: spec.bold,
        italic: spec.italic,
        letterSpacing: spec.letterSpacing,
        widthPx,
        lineHeightPx,
        heightPx: lineHeightPx * lines.length,
        lines: lines.map((ln, i) => ({ text: ln, widthPx: metrics[i].width })),
        method: 'canvas-measure',
      };
    } catch (e) { return { __error: String(e) }; }
  })()`;
}
