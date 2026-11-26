import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedBook, mergeBooks } from '../sync-model.js';
import { sampleBook } from '../core.js';
const setup = () => { const base = sharedBook({ books: [sampleBook()] }); return [base, structuredClone(base), structuredClone(base)]; };
test('separate words and separate fields merge without conflicts', () => {
  const [base, local, remote] = setup(); local.words[0].status = 'mastered'; remote.words[0].meaning = '수정한 뜻'; remote.words[1].pos = ['표현'];
  const merged = mergeBooks(base, local, remote); assert.equal(merged.conflicts.length, 0); assert.equal(merged.board.words[0].status, 'mastered'); assert.equal(merged.board.words[0].meaning, '수정한 뜻'); assert.deepEqual(merged.board.words[1].pos, ['표현']);
});
test('same-field conflict requires a choice while independent edits survive either choice', () => {
  const [base, local, remote] = setup(); local.words[0].meaning = '로컬'; remote.words[0].meaning = '서버'; local.words[0].status = 'mastered'; remote.words[0].reading = 'よみ';
  for (const preference of ['local','remote']) { const merged = mergeBooks(base, local, remote, preference); assert.equal(merged.conflicts.length, 1); assert.equal(merged.board.words[0].meaning, preference === 'local' ? '로컬' : '서버'); assert.equal(merged.board.words[0].status, 'mastered'); assert.equal(merged.board.words[0].reading, 'よみ'); }
});
test('deletions propagate and edit/delete collisions never silently discard edits', () => {
  const [base, local, remote] = setup(); const removed = remote.words.shift(); assert.equal(mergeBooks(base,local,remote).board.words.length, base.words.length-1);
  local.words[0].meaning = '새 뜻'; assert.equal(mergeBooks(base,local,remote).conflicts.length, 1); assert.ok(mergeBooks(base,local,remote,'local').board.words.some(w=>w.id===removed.id)); assert.ok(!mergeBooks(base,local,remote,'remote').board.words.some(w=>w.id===removed.id));
});
test('independent additions survive and old library becomes one shared book', () => {
  const [base, local, remote] = setup(); local.words.push({...local.words[0],id:'local'}); remote.words.push({...remote.words[0],id:'remote'});
  assert.equal(mergeBooks(base,local,remote).board.words.length, base.words.length+2);
  const single = sharedBook({books:[base,base]}); assert.equal(single.words.length,base.words.length); assert.equal(single.id,'shared'); assert.equal(single.name,'단어장'); assert.equal(sharedBook(null).words.length,0);
});
