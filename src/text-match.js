// Document text matching. Holst stores paragraphs as separate delta inserts
// with NO newline characters, and styled runs as XML-ish mark nodes whose
// toString renders like '<bold>text</bold>'. Naive `stored === text`
// comparison therefore fails for every multiline write (the P0 multiline bug)
// and for every styled write. Both sides normalize to a comparable plain form.

/** Strip mark tags (<bold>, <color …>, …) and paragraph newlines from a board-side string. */
export function plainDocText(s) {
  return String(s).replace(/<[^>]*>/g, '').replace(/\n/g, '');
}

/** Normalize caller-side text: newline = paragraph boundary, not a character. */
export function expectedDocText(text) {
  return String(text).split('\n').join('');
}

/** True when the stored doc text matches the requested text modulo marks/paragraphs. */
export function docTextMatches(expected, storedJoined) {
  return expectedDocText(expected) === plainDocText(storedJoined);
}
