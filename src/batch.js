// Batch plan builder for holst_batch_create: validates entries with the
// shared validators, assigns refs, orders creations before arrows, and
// resolves arrow ref-endpoints to creation indexes. Pure — no side effects.

import { COORD, ValidationError, assertText, assertNoMarkdown, num, safeToken, assertStrokeStyle, assertOpacity, assertBorderRadius, assertRuns, assertShapeType, assertArrowType, assertObjectId, parseColor, assertArrowhead, assertBackgroundStyle, assertMidwayControls, assertElbowMidwayControls, assertEndpointControl, assertLabelSide, assertLabelSideHasText } from './validate.js';
import { buildStyleExtras, pxToTextScale } from './text-style.js';

const KINDS = ['shape', 'sticker', 'simple-text', 'frame', 'stamp', 'arrow'];
const REF_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const BATCH_LIMIT = 200;

// COORD lives in validate.js now (issue #62 dedupe).
const SIZE = { min: 1, max: 1e6 };

function endpoint(ep, label, index) {
  if (ep === null || typeof ep !== 'object' || Array.isArray(ep)) {
    throw new ValidationError(`objects[${index}].${label} must be { ref, relativePoint? }, { objectId, relativePoint? } or { x, y }`);
  }
  if (ep.ref !== undefined) {
    if (typeof ep.ref !== 'string' || !REF_RE.test(ep.ref)) {
      throw new ValidationError(`objects[${index}].${label}.ref must match ${REF_RE}`);
    }
    const out = { ref: ep.ref };
    if (ep.relativePoint !== undefined) {
      if (ep.relativePoint === null || typeof ep.relativePoint !== 'object') {
        throw new ValidationError(`objects[${index}].${label}.relativePoint must be { x, y }`);
      }
      out.relativePoint = {
        x: num(ep.relativePoint.x, `objects[${index}].${label}.relativePoint.x`),
        y: num(ep.relativePoint.y, `objects[${index}].${label}.relativePoint.y`),
      };
    }
    const control = assertEndpointControl(ep.control, `objects[${index}].${label}.control`);
    if (control !== undefined) out.control = control;
    return out;
  }
  // Existing board object — lets a batch attach arrows to a live diagram.
  if (ep.objectId !== undefined) {
    assertObjectId(ep.objectId);
    const out = { objectId: ep.objectId };
    if (ep.relativePoint !== undefined) {
      if (ep.relativePoint === null || typeof ep.relativePoint !== 'object') {
        throw new ValidationError(`objects[${index}].${label}.relativePoint must be { x, y }`);
      }
      out.relativePoint = {
        x: num(ep.relativePoint.x, `objects[${index}].${label}.relativePoint.x`),
        y: num(ep.relativePoint.y, `objects[${index}].${label}.relativePoint.y`),
      };
    }
    const control = assertEndpointControl(ep.control, `objects[${index}].${label}.control`);
    if (control !== undefined) out.control = control;
    return out;
  }
  if (ep.control !== undefined) {
    throw new ValidationError(`objects[${index}].${label}.control is only valid on object endpoints ({ ref } / { objectId }), not free points { x, y }`);
  }
  return {
    point: {
      x: num(ep.x, `objects[${index}].${label}.x`),
      y: num(ep.y, `objects[${index}].${label}.y`),
    },
  };
}

function validateByKind(kind, e, i) {
  const c = { kind, ref: e.ref, x: num(e.x, `objects[${i}].x`, COORD), y: num(e.y, `objects[${i}].y`, COORD) };
  if (e.zIndex !== undefined) c.zIndex = num(e.zIndex, `objects[${i}].zIndex`, { min: -1e7, max: 1e7 });
  // Document-text params that ride with the native text pipeline (marks).
  const marks = {};
  if (e.bold !== undefined) marks.bold = Boolean(e.bold);
  if (e.italic !== undefined) marks.italic = Boolean(e.italic);
  if (e.underline !== undefined) marks.underline = Boolean(e.underline);
  if (e.strikethrough !== undefined) marks.strikethrough = Boolean(e.strikethrough);
  switch (kind) {
    case 'shape': {
      c.text = e.runs !== undefined ? '' : assertText(e.text, `objects[${i}].text`, { default: '' });
      if (e.runs !== undefined) c.runs = assertRuns(e.runs, `objects[${i}].runs`);
      c.width = num(e.width, `objects[${i}].width`, { default: 240, ...SIZE });
      c.height = num(e.height, `objects[${i}].height`, { default: 48, ...SIZE });
      c.shapeType = assertShapeType(e.shapeType, `objects[${i}].shapeType`, { default: 'square' });
      c.borderRadius = e.borderRadius === undefined ? undefined : assertBorderRadius(e.borderRadius, `objects[${i}].borderRadius`);
      const fillOp = e.fillOpacity === undefined ? undefined : assertOpacity(e.fillOpacity, `objects[${i}].fillOpacity`);
      const strokeOp = e.strokeOpacity === undefined ? undefined : assertOpacity(e.strokeOpacity, `objects[${i}].strokeOpacity`);
      c.fillColor = { color: parseColor(e.fillColor, `objects[${i}].fillColor`, { default: '#ffffff' }), opacity: fillOp === undefined ? 1 : fillOp };
      c.strokeColor = { color: parseColor(e.strokeColor, `objects[${i}].strokeColor`, { default: '#202020' }), opacity: strokeOp === undefined ? 1 : strokeOp };
      c.strokeWidth = num(e.strokeWidth, `objects[${i}].strokeWidth`, { default: 2, min: 0, max: 100 });
      c.fixedSize = e.fixedSize === undefined ? true : Boolean(e.fixedSize);
      Object.assign(c, marks, buildStyleExtras({
        fontSize: e.fontSize, textScale: e.textScale, textColor: e.textColor, textOpacity: e.textOpacity,
        textBackgroundColor: e.textBackgroundColor, horizontalAlign: e.horizontalAlign,
        verticalAlign: e.verticalAlign, letterSpacing: e.letterSpacing,
        fontFamily: e.fontFamily, lineHeight: e.lineHeight,
      }));
      c.hasDocument = true;
      return c;
    }
    case 'sticker': {
      c.text = assertText(e.text, `objects[${i}].text`);
      c.width = num(e.width, `objects[${i}].width`, { default: 192, ...SIZE });
      c.height = num(e.height, `objects[${i}].height`, { default: 192, ...SIZE });
      if (e.fontSize !== undefined) throw new ValidationError(`objects[${i}].fontSize is not supported for stickers — use textScale (no verified px base)`);
      Object.assign(c, marks, buildStyleExtras({ textScale: e.textScale, textColor: e.textColor, horizontalAlign: e.horizontalAlign }));
      c.hasDocument = true;
      return c;
    }
    case 'simple-text': {
      c.text = e.runs !== undefined ? '' : assertText(e.text, `objects[${i}].text`);
      if (e.runs !== undefined) c.runs = assertRuns(e.runs, `objects[${i}].runs`);
      // width → width + fixedWidth:true (parity with add_simple_text; enables
      // horizontalAlign centering under nodes instead of manual math).
      if (e.width !== undefined) c.width = num(e.width, `objects[${i}].width`, SIZE);
      // fontSize → textScale (base 14 verified); explicit textScale wins if both given.
      const scale = e.textScale !== undefined ? e.textScale : (e.fontSize !== undefined ? pxToTextScale(e.fontSize) : undefined);
      Object.assign(c, marks, buildStyleExtras({
        textScale: scale,
        textColor: e.textColor, textOpacity: e.textOpacity, textBackgroundColor: e.textBackgroundColor,
        horizontalAlign: e.horizontalAlign, verticalAlign: e.verticalAlign, letterSpacing: e.letterSpacing,
        fontFamily: e.fontFamily, lineHeight: e.lineHeight,
      }));
      c.hasDocument = true;
      return c;
    }
    case 'frame': {
      c.labelText = assertText(e.labelText, `objects[${i}].labelText`, { default: 'Frame' });
      c.width = num(e.width, `objects[${i}].width`, { default: 800, ...SIZE });
      c.height = num(e.height, `objects[${i}].height`, { default: 600, ...SIZE });
      c.fillColor = { color: parseColor(e.fillColor, `objects[${i}].fillColor`, { default: '#ffffff' }), opacity: 1 };
      c.backgroundStyle = assertBackgroundStyle(e.backgroundStyle, `objects[${i}].backgroundStyle`);
      c.hasDocument = false;
      return c;
    }
    case 'stamp': {
      c.text = assertText(e.text, `objects[${i}].text`, { maxLen: 1000 });
      c.width = num(e.width, `objects[${i}].width`, { default: 60, ...SIZE });
      c.height = num(e.height, `objects[${i}].height`, { default: 60, ...SIZE });
      c.stampType = safeToken(e.stampType, `objects[${i}].stampType`, { default: 'textStamp' });
      c.hasDocument = false;
      return c;
    }
    default:
      throw new ValidationError(`objects[${i}].kind must be one of ${KINDS.join(', ')}`);
  }
}

/**
 * entries: array of { kind, ref?, ...fields } or { kind: 'arrow', from, to }.
 * Returns { creations: [validated objects with refs], arrows: [{ from, to,
 * arrowType, strokeColor }] with ref endpoints resolved to refIndex }.
 */
export function buildBatchPlan(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ValidationError('objects must be a non-empty array');
  }
  if (entries.length > BATCH_LIMIT) {
    throw new ValidationError(`batch limit is ${BATCH_LIMIT} objects per call`);
  }

  const creations = [];
  const rawArrows = [];
  const refIndex = new Map();
  let auto = 0;

  entries.forEach((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      throw new ValidationError(`objects[${i}] must be an object`);
    }
    if (e.kind === 'arrow') {
      rawArrows.push({ a: validateArrowEntry(e, i), i });
      return;
    }
    if (e.ref === undefined) {
      let ref;
      do { ref = 'obj' + (++auto); } while (refIndex.has(ref));
      e = { ...e, ref };
    } else if (typeof e.ref !== 'string' || !REF_RE.test(e.ref)) {
      throw new ValidationError(`objects[${i}].ref must match ${REF_RE}`);
    }
    if (refIndex.has(e.ref)) {
      throw new ValidationError(`duplicate ref: ${e.ref}`);
    }
    refIndex.set(e.ref, creations.length);
    const c = validateByKind(e.kind, e, i);
    if (c.text !== undefined && String(c.text) !== '') assertNoMarkdown(c.text);
    if (c.labelText !== undefined) assertNoMarkdown(c.labelText);
    if (c.runs !== undefined) assertRuns(c.runs, 'runs');
    creations.push(c);
  });

  const arrows = rawArrows.map(({ a, i: origIdx }) => {
    if (a.text !== undefined) assertNoMarkdown(a.text);
    if (a.ref === undefined) {
      do { a.ref = 'arrow' + (++auto); } while (refIndex.has(a.ref));
    } else if (typeof a.ref !== 'string' || !REF_RE.test(a.ref)) {
      throw new ValidationError(`objects[${origIdx}].ref must match ${REF_RE}`);
    }
    if (refIndex.has(a.ref)) throw new ValidationError(`duplicate ref: ${a.ref}`);
    const resolve = (ep) => {
      if (ep.ref === undefined) return ep;
      if (!refIndex.has(ep.ref)) {
        throw new ValidationError(`arrow endpoint references unknown ref: ${ep.ref}`);
      }
      return { ...ep, refIndex: refIndex.get(ep.ref) };
    };
    return { ...a, from: resolve(a.from), to: resolve(a.to) };
  });

  return { creations, arrows };
}

function validateArrowEntry(e, i) {
  const text = e.text === undefined ? undefined : assertText(e.text, `objects[${i}].text`);
  const labelSide = assertLabelSide(e.labelSide, `objects[${i}].labelSide`, { default: 'on' });
  // Issue #61: fail fast BEFORE any writes — an entry with a side but no
  // label used to be silently skipped by the sideJobs filter.
  assertLabelSideHasText(labelSide, text, `objects[${i}].labelSide`);
  return {
    ref: e.ref,
    arrowType: assertArrowType(e.arrowType, `objects[${i}].arrowType`, { default: 'elbow' }),
    strokeColor: parseColor(e.strokeColor, `objects[${i}].strokeColor`, { default: '#808080' }),
    strokeStyle: assertStrokeStyle(e.strokeStyle, `objects[${i}].strokeStyle`, { default: 'solid' }),
    strokeWidth: e.strokeWidth === undefined ? undefined : num(e.strokeWidth, `objects[${i}].strokeWidth`, { min: 0, max: 100 }),
    zIndex: e.zIndex === undefined ? undefined : num(e.zIndex, `objects[${i}].zIndex`, { min: -1e7, max: 1e7 }),
    arrowheadStart: assertArrowhead(e.arrowheadStart, `objects[${i}].arrowheadStart`),
    arrowheadEnd: assertArrowhead(e.arrowheadEnd, `objects[${i}].arrowheadEnd`),
    text,
    textPosition: num(e.textPosition, `objects[${i}].textPosition`, { default: 0.5, min: 0, max: 1 }),
    labelSide,
    textRotated: e.textRotated === undefined ? undefined : Boolean(e.textRotated),
    textColor: e.textColor === undefined ? undefined : { color: parseColor(e.textColor, `objects[${i}].textColor`), opacity: 1 },
    fontSize: e.fontSize === undefined ? undefined : num(e.fontSize, `objects[${i}].fontSize`, { min: 6, max: 512 }),
    midwayControls: assertMidwayControls(e.midwayControls, `objects[${i}].midwayControls`),
    elbowMidwayControls: assertElbowMidwayControls(e.elbowMidwayControls, `objects[${i}].elbowMidwayControls`),
    from: endpoint(e.from, 'from', i),
    to: endpoint(e.to, 'to', i),
  };
}

export { ValidationError };
