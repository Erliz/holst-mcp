// Arrow label payload builder.
// Holst stores arrow text as a PLAIN `texts` array on the arrow object
// (not a Y.Array, not a document in `documents` — verified on Holst ≥ 2026-10):
//   texts: [{ position: 0..1, id: uuid, text: "flat", editor: [Slate tree] }]
// The renderer reads the Slate view-model (`editor`); `text` is the flat
// mirror — both must be written together. Each line of the text becomes one
// `wrapper -> paragraph -> {text}` node, mirroring what the app itself writes.

import { randomUUID } from 'node:crypto';
import { assertText, num, ValidationError, LABEL_SIDES } from './validate.js';

/**
 * Resolve a screen-side label placement to the app model's `anchor` value.
 * The renderer offsets a beside-label along the normal of the local path
 * direction: anchor +1 → normal (y,−x) of travel, −1 → opposite, 0 → on the
 * line (hole-masked). Screen-side contract (issue #42, live-verified):
 * 'right' = the side whose offset points to +x (east); horizontal segments
 * (offset purely ±y) resolve right = below, left = above. Degenerate zero
 * direction behaves like left-to-right horizontal.
 */
export function labelSideToAnchor(vx, vy, side) {
  if (side === undefined || side === 'on') return 0;
  if (!LABEL_SIDES.includes(side)) {
    throw new ValidationError(`labelSide must be one of ${LABEL_SIDES.join(', ')}, got: ${typeof side === 'string' ? JSON.stringify(side) : typeof side}`);
  }
  const len = Math.hypot(vx, vy);
  const nx = len > 1e-6 ? vy / len : 0; // anchor +1 offsets toward (nx, ny)
  const ny = len > 1e-6 ? -vx / len : -1; // zero vector ≈ d=(1,0) → normal (0,−1)
  const plusIsRight = Math.abs(nx) > 1e-6 ? nx > 0 : ny > 0;
  const wantPlus = side === 'right' ? plusIsRight : !plusIsRight;
  return wantPlus ? 1 : -1;
}

/**
 * Build the plain-JSON `texts` payload for an arrow label.
 * position: 0..1 fraction along the arrow path (default 0.5 = middle).
 */
export function buildArrowTexts(text, position = 0.5) {
  text = assertText(text, 'text');
  position = num(position, 'textPosition', { default: 0.5, min: 0, max: 1 });
  const editor = String(text).split('\n').map((line) => ({
    type: 'wrapper',
    key: randomUUID(),
    children: [
      { type: 'paragraph', key: randomUUID(), children: [{ text: line }] },
    ],
  }));
  return [{ position, id: randomUUID(), text, editor }];
}

/**
 * Compare an expected on-arrow label against what the app's render layer
 * reports (getTextOnArrowString). Newline-insensitive: the editor mirrors
 * each \n as a separate paragraph, and some builds join them without \n.
 * null/undefined actual = "no label rendered" and only matches empty expected.
 */
export function arrowLabelMatches(expected, actual) {
  const norm = (s) => (typeof s === 'string' ? s.replace(/\n/g, '') : '');
  return norm(expected) === norm(actual);
}
