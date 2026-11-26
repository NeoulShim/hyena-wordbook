import { validateBook } from '../core.js';

const encoder = new TextEncoder();
const SESSION_SECONDS = 365 * 24 * 60 * 60;
const MAX_BYTES = 12 * 1024 * 1024;
const CHUNK_BYTES = 512 * 1024;
const now = () => Math.floor(Date.now() / 1000);
export async function sha256(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function equalHash(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== 64 || right.length !== 64) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
function response(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
async function readJSON(request, limit) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw Object.assign(Error('JSON 형식이 필요합니다.'), { status: 415 });
  if (Number(request.headers.get('content-length')) > limit) throw Object.assign(Error('요청 크기가 너무 큽니다.'), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(Error('요청 내용이 없습니다.'), { status: 400 });
  let bytes = 0, content = ''; const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.length;
    if (bytes > limit) { await reader.cancel(); throw Object.assign(Error('요청 크기가 너무 큽니다.'), { status: 413 }); }
    content += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(content + decoder.decode()); }
  catch { throw Object.assign(Error('JSON 형식이 올바르지 않습니다.'), { status: 400 }); }
}
export async function readBoard(db) {
  // One SQL statement gives an internally consistent revision and snapshot.
  const { results } = await db.prepare('SELECT m.revision, m.updated_at, c.part, c.content FROM board_meta m LEFT JOIN board_chunks c ON 1=1 WHERE m.id=1 ORDER BY c.part').all();
  return { revision: results[0]?.revision ?? 0, updatedAt: results[0]?.updated_at ?? null, board: results[0]?.content == null ? null : JSON.parse(results.map(r => r.content).join('')) };
}
export async function writeBoard(db, board, revision) {
  const contents = JSON.stringify(board), bytes = encoder.encode(contents);
  if (bytes.length > MAX_BYTES) throw Object.assign(Error('동기화 단어장은 최대 12MB입니다.'), { status: 413 });
  const commitId = crypto.randomUUID(), updatedAt = new Date().toISOString();
  const statements = [
    db.prepare('UPDATE board_meta SET revision=revision+1, commit_id=?, updated_at=? WHERE id=1 AND revision=?').bind(commitId, updatedAt, revision),
    db.prepare('DELETE FROM board_chunks WHERE EXISTS (SELECT 1 FROM board_meta WHERE id=1 AND commit_id=?)').bind(commitId)
  ];
  const decoder = new TextDecoder();
  for (let start = 0, part = 0; start < bytes.length; start += CHUNK_BYTES, part++) {
    const end = Math.min(start + CHUNK_BYTES, bytes.length);
    const chunk = decoder.decode(bytes.slice(start, end), { stream: end < bytes.length });
    statements.push(db.prepare('INSERT INTO board_chunks(part,content) SELECT ?,? WHERE EXISTS (SELECT 1 FROM board_meta WHERE id=1 AND commit_id=?)').bind(part, chunk, commitId));
  }
  // D1 batch is transactional. The commit guard makes every statement a no-op on a stale revision.
  const results = await db.batch(statements);
  if (!results[0].meta.changes) return null;
  return { revision: revision + 1, updatedAt, board };
}
async function authenticate(request, env) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  const hash = await sha256(token);
  const session = await env.DB.prepare('SELECT token_hash,expires_at FROM sessions WHERE token_hash=? AND key_version=? AND expires_at>?').bind(hash, env.AUTH_KEY_HASH, now()).first();
  if (!session) return null;
  if (session.expires_at < now() + SESSION_SECONDS - 86400) await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(now() + SESSION_SECONDS, hash).run();
  return hash;
}
async function route(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (path === '/api/health' && request.method === 'GET') return response({ ok: true });
  if (!env.DB || !/^[a-f0-9]{64}$/.test(env.AUTH_KEY_HASH ?? '')) return response({ error: '동기화 서비스 설정이 완료되지 않았습니다.' }, 503);
  if (path === '/api/session' && request.method === 'POST') {
    const bucket = Math.floor(now() / 600);
    const bucketKey = await sha256(`${env.AUTH_KEY_HASH}:${request.headers.get('CF-Connecting-IP') ?? 'local'}:${bucket}`);
    const count = await env.DB.prepare('INSERT INTO login_attempts(bucket_key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucketKey, (bucket + 1) * 600).first();
    if (count.attempts > 10) return response({ error: '시도 횟수를 초과했습니다. 최대 10분 후 다시 시도하세요.' }, 429);
    const payload = await readJSON(request, 1024);
    if (typeof payload?.key !== 'string' || payload.key.length > 256 || !equalHash(await sha256(payload.key), env.AUTH_KEY_HASH)) return response({ error: '동기화 키가 일치하지 않습니다.' }, 401);
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
    await env.DB.prepare('INSERT INTO sessions(token_hash,key_version,expires_at) VALUES (?,?,?)').bind(await sha256(token), env.AUTH_KEY_HASH, now() + SESSION_SECONDS).run();
    ctx.waitUntil(env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),env.DB.prepare('DELETE FROM login_attempts WHERE expires_at<?').bind(now())]).catch(() => {}));
    return response({ token });
  }
  const session = await authenticate(request, env);
  if (!session) return response({ error: '동기화 키를 입력하세요.' }, 401);
  if (path === '/api/session' && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session).run(); return response({ ok: true });
  }
  if (path === '/api/board' && request.method === 'GET') return response(await readBoard(env.DB));
  if (path === '/api/board' && request.method === 'PUT') {
    const payload = await readJSON(request, MAX_BYTES + 1024);
    if (!Number.isSafeInteger(payload?.baseRevision) || payload.baseRevision < 0) return response({ error: '동기화 버전이 올바르지 않습니다.' }, 400);
    let board;
    try { board = validateBook(payload.board); } catch (error) { return response({ error: error.message }, 400); }
    board.id = 'shared'; board.name = '단어장';
    const current = await readBoard(env.DB);
    if (current.revision !== payload.baseRevision) return response({ error: '다른 기기에서 변경되었습니다.', ...current }, 409);
    if (current.board) {
      board.createdAt = current.board.createdAt;
      const originalDates = new Map(current.board.words.map(w => [w.id, w.createdAt]));
      for (const word of board.words) if (originalDates.has(word.id)) word.createdAt = originalDates.get(word.id);
    }
    const saved = await writeBoard(env.DB, board, payload.baseRevision);
    return saved ? response(saved) : response({ error: '다른 기기에서 변경되었습니다.', ...await readBoard(env.DB) }, 409);
  }
  return response({ error: '지원하지 않는 요청입니다.' }, 404);
}
export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS ?? 'https://neoulshim.github.io').split(',').map(x => x.trim());
    if (origin && !allowed.includes(origin)) return response({ error: '허용되지 않은 출처입니다.' }, 403);
    let result;
    if (request.method === 'OPTIONS') result = new Response(null, { status: 204 });
    else { try { result = await route(request, env, ctx); } catch (error) { result = response({ error: error.status ? error.message : '동기화 서비스에 일시적인 오류가 발생했습니다.' }, error.status ?? 500); } }
    if (origin) result.headers.set('Access-Control-Allow-Origin', origin);
    result.headers.set('Vary', 'Origin');
    result.headers.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    result.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    result.headers.set('Access-Control-Max-Age', '600');
    result.headers.set('Cache-Control', 'no-store');
    return result;
  }
};
