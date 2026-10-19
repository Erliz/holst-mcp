// Typography field builder. All Holst text styling that lives on the OBJECT
// (not in the document marks) is written as plain Y.Map fields — verified on
// the live board: fontSize (shape/arrow, int), textScale (simple-text/sticker,
// float), textColor / textBackgroundColor ({color: token|hexInt, opacity}),
// horizontalAlign, fontFamily, lineHeight ("250%"), textRotated.
// bold/italic/underline/strikethrough are NOT object fields — they are mark
// nodes inside the document and travel with the text write pipeline.

import { num, parseColor, safeToken, assertHorizontalAlign, assertOpacity, ValidationError, assertVerticalAlign, assertNoMarkdown, assertText, assertRuns } from './validate.js';

const TEXT_BASE_PX = 14; // verified: UI "normal text 24" → textScale 24/14

/** Convert a pixel font size to simple-text textScale (base 14). */
export function pxToTextScale(px) {
  const v = num(px, 'fontSize', { min: 1, max: 512 });
  return v / TEXT_BASE_PX;
}

/**
 * Render run-level segments to HTML for the native paste pipeline.
 * Emphasis wraps OUTSIDE the color span (mirrors the app's own mark order:
 * <bold><color>…</color></bold>). \n starts a new paragraph.
 */
export function segmentsToHtml(segments) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const colorCss = (c) => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c);
  const segHtml = (s) => {
    let h = esc(s.text);
    if (s.color !== undefined) h = `<span style="color:${colorCss(s.color)};">${h}</span>`;
    const m = s.marks || {};
    if (m.bold) h = `<strong>${h}</strong>`;
    if (m.italic) h = `<em>${h}</em>`;
    if (m.underline) h = `<u>${h}</u>`;
    if (m.strikethrough) h = `<s>${h}</s>`;
    return h;
  };
  const lines = [[]];
  for (const s of segments) {
    const parts = String(s.text).split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part !== '') lines[lines.length - 1].push(segHtml({ ...s, text: part }));
    });
  }
  return lines.map((l) => '<p>' + l.join('') + '</p>').join('');
}

/**
 * Render segments to Slate editor nodes for the createFromJSON write path
 * (run-level colors do NOT survive the HTML paste pipeline — the app strips
 * them; colors are mark props on text nodes: {text, color: 0xe54d2e, bold}).
 */
export function segmentsToSlateNodes(segments, uuid) {
  const lines = [[]];
  for (const s of segments) {
    const parts = String(s.text).split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part !== '') lines[lines.length - 1].push({ ...s, text: part });
    });
  }
  return lines.map((line) => ({
    type: 'wrapper',
    key: uuid(),
    children: [{
      type: 'paragraph',
      key: uuid(),
      children: line.map((seg) => {
        const t = { text: seg.text };
        if (seg.color !== undefined) t.color = seg.color;
        const m = seg.marks || {};
        for (const k of ['bold', 'italic', 'underline', 'strikethrough']) {
          if (m[k]) t[k] = true;
        }
        return t;
      }),
    }],
  }));
}

export function buildSegments({ text, runs, marks } = {}) {
  if (runs !== undefined) {
    if (text !== undefined && String(text) !== '') {
      throw new ValidationError('pass either text or runs, not both');
    }
    const segs = assertRuns(runs, 'runs');
    return { segments: segs, plainText: segs.map((s) => s.text).join('') };
  }
  const m = {};
  for (const k of ['bold', 'italic', 'underline', 'strikethrough']) {
    if (marks && marks[k] !== undefined) m[k] = marks[k];
  }
  return {
    segments: [{ text: String(text), ...(Object.keys(m).length ? { marks: m } : {}) }],
    plainText: String(text),
  };
}

/**
 * Build the plain object of extra Y.Map fields for a text-bearing object.
 * Every option is optional; undefined options produce no field (back-compat).
 * `textScale` must already be final (convert fontSize → textScale at the
 * call site via pxToTextScale where the base-14 conversion is verified).
 */
export function buildStyleExtras(opts = {}) {
  const extras = {};
  if (opts.fontSize !== undefined) extras.fontSize = num(opts.fontSize, 'fontSize', { min: 6, max: 512 });
  if (opts.textScale !== undefined) extras.textScale = num(opts.textScale, 'textScale', { min: 0.1, max: 10 });
  if (opts.textColor !== undefined) {
    extras.textColor = { color: parseColor(opts.textColor, 'textColor'), opacity: 1 };
  }
  if (opts.textOpacity !== undefined) {
    // Opacity rides inside the textColor object — big faded numerals are
    // "ink/coral at 6-10%": pass textColor + textOpacity together.
    if (opts.textColor === undefined) {
      throw new ValidationError('textOpacity requires textColor (no verified default ink token)');
    }
    extras.textColor = { color: parseColor(opts.textColor, 'textColor'), opacity: assertOpacity(opts.textOpacity, 'textOpacity') };
  }
  if (opts.textBackgroundColor !== undefined) {
    extras.textBackgroundColor = { color: parseColor(opts.textBackgroundColor, 'textBackgroundColor'), opacity: 1 };
  }
  if (opts.horizontalAlign !== undefined) {
    const align = assertHorizontalAlign(opts.horizontalAlign, 'horizontalAlign');
    if (align !== 'left') extras.horizontalAlign = align; // left = app default (absent)
  }
  if (opts.verticalAlign !== undefined) {
    extras.verticalAlign = assertVerticalAlign(opts.verticalAlign, 'verticalAlign');
  }
  if (opts.letterSpacing !== undefined) {
    extras.letterSpacing = num(opts.letterSpacing, 'letterSpacing', { min: -10, max: 100 });
  }
  if (opts.fontFamily !== undefined) extras.fontFamily = safeToken(opts.fontFamily, 'fontFamily');
  if (opts.lineHeight !== undefined) {
    const pct = num(opts.lineHeight, 'lineHeight', { min: 50, max: 500 });
    extras.lineHeight = `${pct}%`;
  }
  if (opts.textRotated !== undefined) extras.textRotated = Boolean(opts.textRotated);
  return extras;
}

/**
 * Kind-aware style extras for update_text (issue #2). The object kinds store
 * typography differently: shape/arrow carry a native absolute `fontSize` field,
 * while simple-text/sticker only have `textScale` (base 14). Passing `fontSize`
 * through verbatim for simple-text writes an alien field — older app builds
 * multiplied it with textScale ("relative multiplier" symptom), newer builds
 * ignore it (silent no-op). Same mapping as the create paths: px → textScale,
 * explicit textScale wins; stickers have no verified px base → reject.
 * Returns { extras, clearFields }: for simple-text the stale `fontSize` field
 * (planted by the pre-fix update_text) is always cleared to heal old boards.
 */
export function resolveUpdateStyleExtras(kind, opts = {}) {
  if (kind === 'simple-text') {
    const { fontSize, ...rest } = opts;
    const mapped = {
      ...rest,
      textScale: opts.textScale !== undefined ? opts.textScale
        : (fontSize !== undefined ? pxToTextScale(fontSize) : undefined),
    };
    return { extras: buildStyleExtras(mapped), clearFields: ['fontSize'] };
  }
  if (kind === 'sticker' && opts.fontSize !== undefined) {
    throw new ValidationError('fontSize is not supported for stickers — use textScale (no verified px base)');
  }
  return { extras: buildStyleExtras(opts), clearFields: [] };
}
