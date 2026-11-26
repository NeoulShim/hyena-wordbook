import { validateBook } from './core.js';
import { sameBook, mergeBooks } from './sync-model.js';
const TOKEN_KEY = 'hyena-note:session:v1';
const BASE_KEY = 'hyena-note:server-base:v1';
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {} };

export function createCloudSync({ apiBase, getBoard, onBoard, onStatus, onAuth, canApply = () => true }) {
  let token = read(TOKEN_KEY), base = null, busy = false, ready = false, queued = false, timer, poll, collision = null;
  try { const stored = JSON.parse(read(BASE_KEY)); if (stored && Number.isSafeInteger(stored.revision)) base = { ...stored, board: validateBook(stored.board) }; } catch {}
  function status(kind, message, details = []) { onStatus({ kind, message, connected: !!token, conflicts: details }); }
  function remember(snapshot) { base = structuredClone(snapshot); save(BASE_KEY, JSON.stringify(snapshot)); }
  async function request(path, { method = 'GET', body, authenticated = true } = {}) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await fetch(`${apiBase}${path}`, { method, cache: 'no-store', credentials: 'omit', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      let data; try { data = await result.json(); } catch { throw Error('동기화 서비스 응답을 확인할 수 없습니다.'); }
      if (!result.ok) throw Object.assign(Error(data.error || '동기화 요청에 실패했습니다.'), { status: result.status, data });
      return data;
    } finally { clearTimeout(timeout); }
  }
  async function tick() {
    if (!token || collision || !canApply()) return;
    if (busy) { queued = true; return; }
    if (!navigator.onLine) { status('offline', '오프라인 · 변경 내용은 연결 후 동기화'); return; }
    busy = true; queued = false;
    try {
      let latest = await request('/api/board');
      if (latest.board) latest.board = validateBook(latest.board);
      if (!base && latest.board) { remember(latest); onBoard(latest.board); ready = true; status('synced', '동기화 완료'); return; }
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!canApply()) return;
        const local = structuredClone(getBoard());
        const merge = latest.board && base ? mergeBooks(base.board, local, latest.board) : { board: local, conflicts: [] };
        if (merge.conflicts.length) { collision = { latest, base: base.board }; status('conflict', '변경 충돌 · 확인 필요', merge.conflicts); return; }
        if (latest.board && sameBook(merge.board, latest.board)) { remember(latest); if (!sameBook(local, latest.board)) onBoard(latest.board); ready = true; status('synced', '동기화 완료'); return; }
        status('saving', '서버에 저장 중');
        try {
          const sent = merge.board;
          const saved = await request('/api/board', { method: 'PUT', body: { baseRevision: latest.revision, board: sent } });
          saved.board = validateBook(saved.board);
          // Keep edits made while this request was in flight.
          const after = mergeBooks(local, getBoard(), saved.board).board;
          remember(saved); onBoard(after); ready = true;
          if (!sameBook(after, saved.board)) queued = true;
          status(queued ? 'saving' : 'synced', queued ? '변경 내용 저장 대기' : '동기화 완료'); return;
        } catch (error) {
          if (error.status !== 409) throw error;
          latest = error.data;
          if (latest.board) latest.board = validateBook(latest.board);
        }
      }
      queued = true; status('pending', '다른 기기 변경 반영 중');
    } catch (error) {
      if (error.status === 401) { token = null; ready = false; save(TOKEN_KEY, null); status('auth', '동기화 키 입력 필요'); onAuth(); }
      else status(error.status === 400 || error.status === 413 ? 'error' : 'offline', error.status ? error.message : '서버 연결 대기 · 변경 내용은 브라우저에 보관됨');
    } finally { busy = false; if (queued && token && !collision) { queued = false; timer = setTimeout(tick, 800); } }
  }
  async function login(key) {
    if (!apiBase) throw Error('동기화 서비스 주소가 설정되지 않았습니다.');
    const result = await request('/api/session', { method: 'POST', body: { key }, authenticated: false });
    token = result.token; save(TOKEN_KEY, token); collision = null;
    await tick(); if (!token) throw Error('인증 세션을 확인할 수 없습니다.');
    return true;
  }
  function changed() { if (!token) return; status('saving', '변경 내용 저장 대기'); clearTimeout(timer); timer = setTimeout(tick, 300); }
  async function logout() {
    if (busy) throw Error('동기화가 끝난 후 다시 시도하세요.');
    if (token) { try { await request('/api/session', { method: 'DELETE' }); } catch {} }
    token = null; ready = false; collision = null; save(TOKEN_KEY, null); status('auth', '동기화 키 입력 필요'); onAuth();
  }
  async function resolve(preference) {
    if (!collision) return;
    const { latest, base: before } = collision;
    const merged = mergeBooks(before, getBoard(), latest.board, preference).board;
    remember(latest); onBoard(merged); collision = null; await tick();
  }
  async function start() {
    if (!token) { status('auth', '동기화 키 입력 필요'); onAuth(); }
    else { status('connecting', '단어장 연결 중'); await tick(); }
    poll = setInterval(() => { if (document.visibilityState === 'visible') void tick(); }, 15000);
  }
  window.addEventListener('online', () => void tick());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void tick(); });
  window.addEventListener('focus', () => void tick());
  return { start, login, changed, refresh: tick, logout, resolve, hasSession: () => !!token, canEdit: () => !!token && (ready || !!base), stop: () => { clearTimeout(timer); clearInterval(poll); } };
}
