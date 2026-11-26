import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudSync } from '../cloud-sync.js';
import { sharedBook } from '../sync-model.js';
import { sampleBook } from '../core.js';
const TOKEN = '1'.repeat(64), TOKEN_KEY = 'hyena-note:session:v1', BASE_KEY = 'hyena-note:server-base:v1';
function setup(t, { cached = true, server = true } = {}) {
  const initial = sharedBook({ books: [sampleBook()] });
  let board = structuredClone(initial), remote = server ? structuredClone(initial) : null, revision = server ? 1 : 0, online = true, auth = 0, status, beforePut, calls = [];
  const data = new Map(cached ? [[TOKEN_KEY,TOKEN],[BASE_KEY,JSON.stringify({ revision, board: remote })]] : []);
  const originals = Object.fromEntries(['localStorage','window','document','navigator','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const globals = {
    localStorage: { getItem:key=>data.get(key)??null, setItem:(key,value)=>data.set(key,value), removeItem:key=>data.delete(key) },
    window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState:'visible' }), navigator: {get onLine(){return online;}},
    fetch: async (url, options) => {
      const path = new URL(url).pathname; calls.push([path, options.method]);
      if (!online) throw Error('offline');
      if (path === '/api/session') return Response.json(options.method==='POST' ? {token:TOKEN} : {ok:true});
      if (options.headers.Authorization !== 'Bearer '+TOKEN) return Response.json({error:'auth'}, {status:401});
      if (options.method === 'PUT') {
        const payload = JSON.parse(options.body);
        if (beforePut) { const hook = beforePut; beforePut = null; await hook(); }
        if (payload.baseRevision !== revision) return Response.json({revision,board:remote}, {status:409});
        remote = payload.board; revision++;
      }
      return Response.json({revision,board:remote});
    }
  };
  for(const [key,value] of Object.entries(globals)) Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const sync = createCloudSync({apiBase:'https://sync.invalid',getBoard:()=>board,onBoard:next=>{board=next;},onStatus:next=>{status=next;},onAuth:()=>auth++});
  t.after(()=>{sync.stop();for(const [key,descriptor] of Object.entries(originals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  return {sync,data,calls,get board(){return board;},get remote(){return remote;},get status(){return status;},get auth(){return auth;},set online(value){online=value;},set beforePut(fn){beforePut=fn;},changeRemote(fn){fn(remote);revision++;}};
}
test('saved browser session reconnects without sending a password',async t=>{
  const s=setup(t);await s.sync.start();assert.equal(s.auth,0);assert.equal(s.status.kind,'synced');assert.ok(!s.calls.some(([path])=>path==='/api/session'));
  s.changeRemote(board=>{board.words[0].meaning='서버 수정';});await s.sync.refresh();assert.equal(s.board.words[0].meaning,'서버 수정');
  // Mutating displayed words must not mutate the remembered synchronization base.
  s.board.words[0].status='mastered';s.changeRemote(board=>{board.words[0].reading='よみ';});await s.sync.refresh();assert.equal(s.remote.words[0].status,'mastered');assert.equal(s.remote.words[0].reading,'よみ');
});
test('first login loads canonical server book and persists only opaque session',async t=>{
  const s=setup(t,{cached:false});await s.sync.start();assert.equal(s.auth,1);assert.equal(s.sync.canEdit(),false);s.changeRemote(board=>{board.words.splice(0,10);});await s.sync.login('test-only');assert.equal(s.board.words.length,8);assert.equal(s.sync.canEdit(),true);assert.equal(s.data.get(TOKEN_KEY),TOKEN);assert.ok(![...s.data.values()].some(value=>value.includes('test-only')));
});
test('offline edits merge with other-device edits on reconnect',async t=>{
  const s=setup(t);await s.sync.start();s.online=false;assert.equal(s.sync.canEdit(),true);s.board.words[0].meaning='오프라인';await s.sync.refresh();assert.equal(s.status.kind,'offline');s.changeRemote(board=>{board.words[1].meaning='다른 기기';});s.online=true;await s.sync.refresh();assert.equal(s.remote.words[0].meaning,'오프라인');assert.equal(s.remote.words[1].meaning,'다른 기기');
});
test('edits during a pending save are preserved and subsequently sent',async t=>{
  const s=setup(t);await s.sync.start();s.board.words[0].meaning='첫 수정';s.beforePut=()=>{s.board.words[1].meaning='전송 중 수정';};await s.sync.refresh();assert.equal(s.board.words[1].meaning,'전송 중 수정');await s.sync.refresh();assert.equal(s.remote.words[0].meaning,'첫 수정');assert.equal(s.remote.words[1].meaning,'전송 중 수정');
});
test('server revision race retries and preserves independent changes',async t=>{
  const s=setup(t);await s.sync.start();s.board.words[0].meaning='로컬';s.beforePut=()=>s.changeRemote(board=>{board.words[1].meaning='동시 수정';});await s.sync.refresh();assert.equal(s.remote.words[0].meaning,'로컬');assert.equal(s.remote.words[1].meaning,'동시 수정');
});
test('conflicting edits pause writes until resolved, and logout removes the token',async t=>{
  const s=setup(t);await s.sync.start();s.board.words[0].meaning='로컬';s.changeRemote(board=>{board.words[0].meaning='서버';});await s.sync.refresh();assert.equal(s.status.kind,'conflict');assert.equal(s.remote.words[0].meaning,'서버');await s.sync.resolve('local');assert.equal(s.remote.words[0].meaning,'로컬');await s.sync.logout();assert.equal(s.data.has(TOKEN_KEY),false);assert.equal(s.sync.hasSession(),false);assert.equal(s.auth,1);
});
