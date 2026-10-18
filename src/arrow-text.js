// Arrow label payload builder.
// Holst stores arrow text as a PLAIN `texts` array on the arrow object
// (not a Y.Array, not a document in `documents` — verified on Holst ≥ 2026-10):
//   texts: [{ position: 0..1, id: uuid, text: "flat", editor: [Slate tree] }]
// The renderer reads the Slate view-model (`editor`); `text` is the flat
// mirror — both must be written together. Each line of the text becomes one
// `wrapper -> paragraph -> {text}` node, mirroring what the app itself writes.

import { randomUUID } from 'node:crypto';
import { assertText, num } from './validate.js';

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
