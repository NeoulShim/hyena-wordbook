import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleBook,serializeBoard,serializeCollection,parseCollection} from '../core.js';
import {writeFileSnapshot} from '../file-sync.js';
test('automatic storage round-trips the full library and selected book',()=>{const a=sampleBook(),b=sampleBook();b.name='두 번째 단어장';const state={version:1,books:[a,b],activeId:b.id};assert.deepEqual(parseCollection(serializeCollection(state)),state);});
test('automatic storage can also open ordinary single-book files',()=>{const book=sampleBook();assert.deepEqual(parseCollection(serializeBoard(book)),{version:1,books:[book],activeId:book.id});});
test('library import validates structure and duplicate IDs',()=>{assert.throws(()=>parseCollection('{"format":"neoulboard","version":1,"library":{"books":[]}}'));const b=sampleBook();assert.throws(()=>serializeCollection({version:1,books:[b,b],activeId:b.id}));});
test('external file modifications prevent overwriting',async()=>{let opened=false;const handle={getFile:async()=>({text:async()=>'externally edited'}),createWritable:async()=>{opened=true;}};await assert.rejects(writeFileSnapshot(handle,'previous snapshot','our update'),{code:'FILE_CONFLICT'});assert.equal(opened,false);});
test('matching file snapshots commit the whole document',async()=>{const calls=[];const handle={getFile:async()=>({text:async()=>'previous snapshot'}),createWritable:async()=>({write:async value=>calls.push(['write',value]),close:async()=>calls.push(['close'])})};await writeFileSnapshot(handle,'previous snapshot','complete new state');assert.deepEqual(calls,[['write','complete new state'],['close']]);});
