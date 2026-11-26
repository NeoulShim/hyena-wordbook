import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sampleBook,serializeBoard,parseBoard,createQuiz,eligibleWords,validateBook,escapeHTML} from '../core.js';
import {hiragana} from '../dictionary.js';
test('neoulboard round-trip preserves words, multiple POS, mastery and original dates',()=>{const book=sampleBook();assert.deepEqual(parseBoard(serializeBoard(book)),book);assert.ok(JSON.parse(serializeBoard(book)).dictionaryAttribution.license);});
test('reject malformed, wrong version, invalid mastery, dates, duplicate IDs, excessive and non-array tags',()=>{
  assert.throws(()=>parseBoard('not JSON'));assert.throws(()=>parseBoard('{"format":"other","version":1}'));assert.throws(()=>parseBoard('{"format":"neoulboard","version":100}'));
  for(const corrupt of [b=>b.words[0].status='__proto__',b=>b.words[0].createdAt='yesterday',b=>b.words[1].id=b.words[0].id,b=>b.words[0].pos='명사',b=>b.words[0].pos=Array(21).fill('명사'),b=>b.words[0].term='   ',b=>b.words[0].meaning=null]){const book=sampleBook();corrupt(book);assert.throws(()=>validateBook(book));}
});
test('each mastery pool respects the requested range',()=>{const words=sampleBook().words;assert.equal(eligibleWords(words,'unknown').length,12);assert.equal(eligibleWords(words,'learning').length,16);assert.equal(eligibleWords(words,'all').length,18);});
test('ten random questions, no repeated terms or choices, exactly one correct answer',()=>{
  const words=sampleBook().words,original=structuredClone(words);
  for(let i=0;i<50;i++){const questions=createQuiz(words,'unknown');assert.equal(questions.length,10);assert.equal(new Set(questions.map(q=>q.word.term)).size,10);for(const q of questions){assert.equal(q.word.status,'unknown');assert.equal(q.choices.length,4);assert.equal(new Set(q.choices).size,4);assert.equal(q.choices.filter(c=>c===q.word.meaning).length,1);}}
  assert.deepEqual(words,original);
});
test('gracefully handles small decks and unusable distractors',()=>{
  const words=sampleBook().words.slice(0,3);assert.equal(createQuiz(words,'all').length,3);assert.ok(createQuiz(words,'all').every(q=>q.choices.length===3));assert.equal(createQuiz(words.slice(0,1),'all').length,0);words.forEach(w=>w.meaning='same meaning');assert.equal(createQuiz(words,'all').length,0);
});
test('same Japanese spelling never appears twice and cannot be its own distractor',()=>{const words=sampleBook().words.slice(0,3);words[1].term=words[0].term;const questions=createQuiz(words,'all');assert.equal(questions.length,2);for(const q of questions.filter(q=>q.word.term===words[0].term)){assert.ok(!q.choices.includes(q.word.meaning===words[0].meaning?words[1].meaning:words[0].meaning));}});
test('retry candidates and quiz snapshots stay independent of later edits',()=>{const words=sampleBook().words;const questions=createQuiz(words,'all',Math.random,[words[2],words[7]]);assert.equal(questions.length,2);const before=questions[0].word.meaning;words.find(w=>w.id===questions[0].word.id).meaning='changed';assert.equal(questions[0].word.meaning,before);});
test('HTML escaping protects imported content',()=>{assert.equal(escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');});
test('Japanese dictionary includes usable Korean glosses and source metadata',()=>{const dict=JSON.parse(readFileSync(new URL('../data/japanese-ko.json',import.meta.url)));assert.equal(dict.license,'CC BY-SA 4.0');assert.ok(dict.entries.length>10000);for(const term of ['猫','学校','食べる'])assert.ok(dict.entries.some(e=>e[0]===term&&/[가-힣]/.test(e[2])));assert.equal(hiragana('コンニチハ'),'こんにちは');for(const entry of dict.entries){assert.ok(entry[2].length<=500);assert.ok(Array.isArray(entry[3]));}});
