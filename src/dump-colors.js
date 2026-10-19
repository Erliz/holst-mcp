// Read-path color normalization (v0.6.1): every color in get_board_content
// presents as #RRGGBB. MCP writes store hex as an int (0xRRGGBB) — converted
// back on read; UI-created objects store palette token names — translated via
// the generated table (src/palette-data.js, provenance: docs/palette.md).
// Unknown strings pass through untouched (never guessed). Pure module.

import { PALETTE_HEX } from './palette-data.js';

const COLOR_FIELDS = ['fillColor', 'strokeColor', 'textColor', 'textBackgroundColor'];

export function colorIntToHex(int) {
  return '#' + int.toString(16).padStart(6, '0');
}

/**
 * Mutates `content` (the { objects, documents, … } dump): every known color
 * field shaped { color: <number>|<string>, opacity? } gets color → '#rrggbb'.
 * Ints convert arithmetically; known palette names translate via the table;
 * unknown strings/nulls/malformed values pass through as-is.
 */
export function normalizeDumpColors(content) {
  if (!content || typeof content !== 'object' || !content.objects || typeof content.objects !== 'object') return content;
  for (const obj of Object.values(content.objects)) {
    if (!obj || typeof obj !== 'object') continue;
    for (const field of COLOR_FIELDS) {
      const c = obj[field];
      if (!c || typeof c !== 'object') continue;
      if (typeof c.color === 'number' && Number.isInteger(c.color) && c.color >= 0 && c.color <= 0xffffff) {
        c.color = colorIntToHex(c.color);
      } else if (typeof c.color === 'string' && Object.prototype.hasOwnProperty.call(PALETTE_HEX, c.color)) {
        c.color = PALETTE_HEX[c.color];
      }
    }
  }
  return content;
}
