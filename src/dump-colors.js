// Read-path color normalization (v0.6.0): MCP writes store #RRGGBB as an int
// (0xRRGGBB); the raw yDoc dump therefore shows numbers. LLM consumers expect
// the same hex they sent — this module converts int colors back to '#rrggbb'
// in getBoardContent's response shaping. Palette token names written by the
// native UI are left untouched (the name→hex map is documentation-only:
// docs/palette.md). Pure module — no CDP, no I/O.

const COLOR_FIELDS = ['fillColor', 'strokeColor', 'textColor', 'textBackgroundColor'];

export function colorIntToHex(int) {
  return '#' + int.toString(16).padStart(6, '0');
}

/**
 * Mutates `content` (the { objects, documents, … } dump): every known color
 * field shaped { color: <number>, opacity? } gets color → '#rrggbb'.
 * Strings (palette names), nulls and malformed values pass through as-is.
 */
export function normalizeDumpColors(content) {
  if (!content || typeof content !== 'object' || !content.objects || typeof content.objects !== 'object') return content;
  for (const obj of Object.values(content.objects)) {
    if (!obj || typeof obj !== 'object') continue;
    for (const field of COLOR_FIELDS) {
      const c = obj[field];
      if (c && typeof c === 'object' && typeof c.color === 'number' && Number.isInteger(c.color) && c.color >= 0 && c.color <= 0xffffff) {
        c.color = colorIntToHex(c.color);
      }
    }
  }
  return content;
}
