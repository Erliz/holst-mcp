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

/** Apply typography extras (fontSize/textColor/…) as plain object fields. */
export function buildStyleFieldsExpr(objectId, styleExtras) {
  return `(() => {
    try {
      const yDoc = window.ds.yPersistence.yDoc;
      const obj = yDoc.getMap('objects').get(${JSON.stringify(objectId)});
      if (!obj || !obj.set) return { __error: 'object not found' };
      const extras = ${JSON.stringify(styleExtras)};
      yDoc.transact(() => {
        for (const k of Object.keys(extras)) obj.set(k, extras[k]);
        obj.set('updated', { a: 0, t: Date.now() });
      });
      return { ok: true, styled: Object.keys(extras) };
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
          fields = { type: 'frame', width: s.width, height: s.height, labelText: s.labelText, fillColor: { color: s.fillColor }, position: pos, zIndex: s.zIndex !== undefined ? s.zIndex : minZ - 1, created: { a: 0, t: Date.now() }, updated: null, id: newId, parentId: null };
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
            return { objectId: byIndex[ep.refIndex].id, point: { x: 0, y: 0 }, relativePoint: ep.relativePoint || { x: 0.5, y: 0.5 }, control: null };
          }
          if (ep.objectId !== undefined) {
            // existing board object — attaching to a live diagram
            return { objectId: ep.objectId, point: { x: 0, y: 0 }, relativePoint: ep.relativePoint || { x: 0.5, y: 0.5 }, control: null };
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
          ...(a.textColor !== undefined ? { textColor: a.textColor } : {}),
          ...(a.fontSize !== undefined ? { fontSize: a.fontSize } : {}),
        };
        for (const k of Object.keys(fields)) map.set(k, fields[k]);
        yDoc.transact(() => { yObjects.set(newId, map); });
        out.push({ id: newId });
      }
      return out;
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
      return { ok: Object.values(report).every((r) => r.ok), deleted: Object.values(report).filter((r) => r.ok).length, report };
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
