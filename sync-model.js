import { validateBook } from './core.js';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const sameBook = (a, b) => same(a, b);
export function sharedBook(state) {
  const source = state?.books ?? [];
  const words = [], seen = new Set(), ids = new Set();
  for (const book of source) for (const word of book.words ?? []) {
    const key = `${word.term}\u0000${word.meaning}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = ids.has(word.id) ? crypto.randomUUID() : word.id;
    ids.add(id); words.push({ ...word, id });
  }
  return validateBook({ id: 'shared', name: '단어장', createdAt: source[0]?.createdAt ?? new Date().toISOString(), words });
}
// Three-way merge: independent edits combine; conflicting edits require a choice.
export function mergeBooks(base, local, remote, preference = 'local') {
  const maps = [base, local, remote].map(b => new Map(b.words.map(w => [w.id, w])));
  const ids = new Set([...maps[2].keys(), ...maps[1].keys(), ...maps[0].keys()]);
  const words = [], conflicts = [];
  for (const id of ids) {
    const [before, ours, theirs] = maps.map(map => map.get(id));
    if (same(ours, theirs)) { if (ours) words.push(ours); continue; }
    if (same(before, ours)) { if (theirs) words.push(theirs); continue; }
    if (same(before, theirs)) { if (ours) words.push(ours); continue; }
    if (!ours || !theirs || !before) {
      conflicts.push({ id, term: ours?.term ?? theirs?.term ?? before.term, fields: ['단어 수정·삭제'] });
      const chosen = preference === 'local' ? ours : theirs; if (chosen) words.push(chosen); continue;
    }
    const merged = { ...theirs, createdAt: before.createdAt }, fields = [];
    for (const field of ['term', 'reading', 'meaning', 'status', 'pos']) {
      if (same(ours[field], theirs[field]) || same(ours[field], before[field])) continue;
      if (same(theirs[field], before[field])) merged[field] = ours[field];
      else { fields.push(field); merged[field] = preference === 'local' ? ours[field] : theirs[field]; }
    }
    if (fields.length) conflicts.push({ id, term: merged.term, fields });
    words.push(merged);
  }
  return { board: validateBook({ ...remote, words }), conflicts };
}
