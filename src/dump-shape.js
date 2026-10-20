// Response shaping for get_board_content (issue #4): bbox filtering and
// positionsOnly projection. Extracted from holst.js as a pure module so the
// object-space semantics are unit-testable against the fake dump shape.
// Arrows carry no position/width/height in yDoc — their geometry lives in
// start/end endpoints (objectId+relativePoint when attached, point when free);
// arrowBox reconstructs a box from those.

function posBox(o) {
  return { x: o.position?.x ?? 0, y: o.position?.y ?? 0, w: o.width ?? 0, h: o.height ?? 0 };
}

/**
 * Effective box of an object in board coordinates. For arrows this is
 * reconstructed from the start/end endpoints; when no endpoint resolves
 * (dangling refs) it degrades to the stored position box.
 */
export function arrowBox(o, objectsById) {
  if (!o || o.type !== 'arrow') return posBox(o);
  const anchors = [];
  for (const ep of [o.start, o.end]) {
    if (!ep || typeof ep !== 'object') continue;
    if (typeof ep.objectId === 'string' && ep.objectId) {
      // Attached: the anchor sits on the referenced object's box at
      // relativePoint fractions (point is a {0,0} placeholder there).
      const ref = objectsById?.[ep.objectId];
      if (!ref) continue; // dangling ref — no anchor from this endpoint
      const rb = posBox(ref);
      const rp = ep.relativePoint || { x: 0, y: 0 };
      anchors.push({ x: rb.x + (rp.x || 0) * rb.w, y: rb.y + (rp.y || 0) * rb.h });
    } else if (ep.point && Number.isFinite(ep.point.x) && Number.isFinite(ep.point.y)) {
      // Free endpoint: the point is the anchor.
      anchors.push({ x: ep.point.x, y: ep.point.y });
    }
  }
  if (!anchors.length) return posBox(o);
  const xs = anchors.map((a) => a.x);
  const ys = anchors.map((a) => a.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Apply bbox / positionsOnly shaping to a full board dump.
 * - bbox {x1,y1,x2,y2}: keep only objects whose box overlaps (strict edges)
 * - positionsOnly: project every kept object to { type, x, y, w, h }
 * Returns the content untouched when neither option is set.
 */
export function shapeContent(content, { bbox, positionsOnly } = {}) {
  if (!bbox && !positionsOnly) return content;
  const inBbox = (o) => {
    if (!bbox) return true;
    const b = o.type === 'arrow' ? arrowBox(o, content.objects) : posBox(o);
    return b.x < bbox.x2 && b.x + b.w > bbox.x1 && b.y < bbox.y2 && b.y + b.h > bbox.y1;
  };
  const objects = {};
  for (const [id, o] of Object.entries(content.objects || {})) {
    if (!inBbox(o)) continue;
    objects[id] = positionsOnly
      ? (o.type === 'arrow'
          ? { type: o.type, ...arrowBox(o, content.objects) }
          : { type: o.type, ...posBox(o) })
      : o;
  }
  return positionsOnly ? { objects } : { ...content, objects };
}

// The delete audit map name in the Holst yDoc: every entry carries FULL
// snapshots (s[]) of deleted objects — never trimmed by the app, never
// useful for reading the board (issue #34: 56% of raw dump bytes).
const DELETE_EVENTS_STORE = 'delete-events-metaStore';

function dropEmptyStores(out) {
  for (const k of Object.keys(out)) {
    if (k === 'objects' || k === 'documents') continue;
    const v = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) {
      delete out[k];
    }
  }
  return out;
}

/**
 * Remove dead weight from a raw board dump (issue #34):
 * - delete-events-metaStore (the app delete audit) — always dropped;
 * - empty top-level stores (aux kanban, reactions, task-card families and
 *   whatever the app adds next) — dropped, objects/documents exempt;
 * - documents referenced by no live object (orphans of deleted objects)
 *   — dropped.
 * includeDeleteEvents: true restores the audit view: the delete store and
 * all documents are kept as-is (empty stores are still dropped).
 * Pure: returns a new object, never mutates the input.
 */
export function trimContent(content, { includeDeleteEvents } = {}) {
  const out = { ...content };
  dropEmptyStores(out);
  if (includeDeleteEvents) return out;
  delete out[DELETE_EVENTS_STORE];
  if (out.documents) {
    const referenced = new Set();
    for (const o of Object.values(content.objects || {})) {
      if (o && typeof o.documentId === 'string' && o.documentId) referenced.add(o.documentId);
    }
    const kept = {};
    for (const [id, text] of Object.entries(out.documents)) {
      if (referenced.has(id)) kept[id] = text;
    }
    out.documents = kept;
  }
  return out;
}
