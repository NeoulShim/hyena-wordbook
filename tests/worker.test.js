import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { sha256, readBoard, writeBoard } from '../backend/worker.js';
import { sharedBook } from '../sync-model.js';
import { sampleBook } from '../core.js';

// Exercise real SQLite SQL and transaction semantics behind the D1 interface.
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../backend/migrations/0001_sync.sql', import.meta.url), 'utf8'));
  return {
    sql,
    prepare(query) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async first() { return sql.prepare(query).get(...args) ?? null; },
        async all() { return { results: sql.prepare(query).all(...args) }; },
        async run() { return { meta: sql.prepare(query).run(...args) }; }
      };
      return statement;
    },
    async batch(statements) {
      sql.exec('BEGIN IMMEDIATE');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    }
  };
}
async function setup(t) {
  const DB = database(); t.after(() => DB.sql.close());
  const key = crypto.randomUUID(), env = { DB, AUTH_KEY_HASH: await sha256(key), ALLOWED_ORIGINS: 'https://neoulshim.github.io' };
  const pending = [];
  const call = async (path, { method = 'GET', token, body, origin = 'https://neoulshim.github.io', ip = '127.0.0.1' } = {}) => {
    const result = await worker.fetch(new Request('https://test.invalid' + path, { method, headers: { Origin: origin, 'CF-Connecting-IP': ip, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env, { waitUntil(promise) { pending.push(promise); } });
    await Promise.all(pending.splice(0));
    return { status: result.status, headers: result.headers, data: result.status === 204 ? null : await result.json() };
  };
  const login = () => call('/api/session', { method: 'POST', body: { key } });
  return { DB, env, call, login };
}
test('private board requires authentication; CORS only allows the deployed origin', async t => {
  const { call } = await setup(t);
  for (const method of ['GET', 'PUT']) assert.equal((await call('/api/board', { method })).status, 401);
  assert.equal((await call('/api/board', { token: 'a'.repeat(64) })).status, 401);
  assert.equal((await call('/api/board', { origin: 'https://example.com' })).status, 403);
  const options = await call('/api/board', { method: 'OPTIONS' });
  assert.equal(options.status, 204); assert.equal(options.headers.get('access-control-allow-origin'), 'https://neoulshim.github.io');
  assert.equal(options.headers.get('cache-control'), 'no-store');
});
test('login stores only token hashes; session reuse, renewal, expiry, rotation and logout', async t => {
  const { call, login, DB, env } = await setup(t);
  const { data: { token }, status } = await login(); assert.equal(status, 200); assert.match(token, /^[a-f0-9]{64}$/);
  const stored = DB.sql.prepare('SELECT * FROM sessions').get(); assert.notEqual(stored.token_hash, token); assert.equal(stored.token_hash, await sha256(token));
  assert.equal((await call('/api/board', { token })).status, 200);
  DB.sql.prepare('UPDATE sessions SET expires_at=?').run(Math.floor(Date.now()/1000) + 60);
  assert.equal((await call('/api/board', { token })).status, 200);
  assert.ok(DB.sql.prepare('SELECT expires_at FROM sessions').get().expires_at > Date.now()/1000 + 300*86400);
  const originalHash = env.AUTH_KEY_HASH; env.AUTH_KEY_HASH = await sha256('rotated-test-key');
  assert.equal((await call('/api/board', { token })).status, 401); env.AUTH_KEY_HASH = originalHash;
  DB.sql.prepare('UPDATE sessions SET expires_at=1').run(); assert.equal((await call('/api/board', { token })).status, 401);
  const fresh = (await login()).data.token;
  assert.equal((await call('/api/session', { method: 'DELETE', token: fresh })).status, 200);
  assert.equal((await call('/api/board', { token: fresh })).status, 401);
});
test('wrong key, malformed login and repeated guessing cannot obtain sessions', async t => {
  const { call, DB } = await setup(t);
  assert.equal((await call('/api/session', { method: 'POST', body: null })).status, 401);
  for (let i=1; i<10; i++) assert.equal((await call('/api/session', { method: 'POST', body: { key: 'incorrect' } })).status, 401);
  assert.equal((await call('/api/session', { method: 'POST', body: { key: 'incorrect' } })).status, 429);
  assert.equal(DB.sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
});
test('single shared board preserves dates, rejects stale overwrites and invalid data', async t => {
  const { call, login } = await setup(t); const token = (await login()).data.token;
  const board = sharedBook({ books: [sampleBook()] });
  const initial = await call('/api/board', { token }); assert.deepEqual(initial.data, { revision: 0, updatedAt: null, board: null });
  const saved = await call('/api/board', { method: 'PUT', token, body: { baseRevision: 0, board } }); assert.equal(saved.status, 200); assert.equal(saved.data.revision, 1);
  const changed = structuredClone(board); changed.words[0].meaning = '변경'; changed.words[0].createdAt = '2000-01-01T00:00:00.000Z'; changed.createdAt = changed.words[0].createdAt; changed.name = 'other';
  const stale = await call('/api/board', { method: 'PUT', token, body: { baseRevision: 0, board: changed } }); assert.equal(stale.status, 409); assert.deepEqual(stale.data.board, board);
  const next = await call('/api/board', { method: 'PUT', token, body: { baseRevision: 1, board: changed } }); assert.equal(next.status, 200); assert.equal(next.data.board.name, '단어장'); assert.equal(next.data.board.createdAt, board.createdAt); assert.equal(next.data.board.words[0].createdAt, board.words[0].createdAt); assert.equal(next.data.board.words[0].meaning, '변경');
  changed.words[0].status = 'invalid';
  assert.equal((await call('/api/board', { method: 'PUT', token, body: { baseRevision: 2, board: changed } })).status, 400);
  assert.equal((await call('/api/board', { method: 'PUT', token, body: null })).status, 400);
  assert.equal((await call('/api/board', { token })).data.revision, 2);
});
test('chunked snapshots preserve multi-byte text; stale transaction is a complete no-op', async t => {
  const DB = database(); t.after(() => DB.sql.close());
  const board = sharedBook(null), word = sampleBook().words[0];
  board.words = Array.from({ length: 1500 }, (_, i) => ({ ...word, id: String(i), meaning: '학교𠮷'.repeat(100) }));
  assert.ok(Buffer.byteLength(JSON.stringify(board)) > 1024*1024);
  await writeBoard(DB, board, 0); assert.deepEqual((await readBoard(DB)).board, board);
  assert.ok(DB.sql.prepare('SELECT count(*) AS n FROM board_chunks').get().n > 2);
  assert.equal(await writeBoard(DB, sharedBook(null), 0), null); assert.deepEqual((await readBoard(DB)).board, board);
  await writeBoard(DB, sharedBook(null), 1); assert.equal(DB.sql.prepare('SELECT count(*) AS n FROM board_chunks').get().n, 1);
});
