export const FORMAT = 'neoulboard';
export const VERSION = 1;
export const STORAGE_KEY = 'hyena-note:v1';
export const POS = ['명사', '동사', 'い형용사', 'な형용사', '부사', '대명사', '조사', '접속사', '감탄사', '표현'];
export const STATUS = {
  unknown: { label: '모르는 단어', short: '아직 낯섦', symbol: '✧' },
  learning: { label: '알아듣지만 쓸 수 없는 단어', short: '듣기 가능', symbol: '◐' },
  mastered: { label: '완전히 외운 단어', short: '암기 완료', symbol: '✦' },
};
export const id = () => crypto.randomUUID();
export const normalize = text => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
export const escapeHTML = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const text = (value, max, label, empty = false) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error(`${label} 형식을 확인하세요.`);
  return value.trim();
};
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('입력일 형식이 올바르지 않습니다.');
  return new Date(value).toISOString();
};
export function validateBook(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.words) || raw.words.length > 10000) throw new Error('단어장은 최대 10,000개 단어를 저장할 수 있습니다.');
  const seen = new Set();
  const words = raw.words.map(word => {
    if (!word || typeof word !== 'object') throw new Error('단어 형식이 올바르지 않습니다.');
    const wordId = text(word.id, 100, '단어 ID');
    if (seen.has(wordId)) throw new Error('단어 ID가 중복되었습니다.');
    seen.add(wordId);
    if (!Object.hasOwn(STATUS, word.status)) throw new Error('알 수 없는 숙련도 태그입니다.');
    if (!Array.isArray(word.pos) || word.pos.length > 20) throw new Error('품사 태그 형식을 확인하세요.');
    return { id: wordId, term: text(word.term, 100, '일본어'), reading: text(word.reading ?? '', 150, '읽기', true), meaning: text(word.meaning, 500, '뜻'), pos: [...new Set(word.pos.map(p => text(p, 30, '품사')))], status: word.status, createdAt: date(word.createdAt) };
  });
  return { id: text(raw.id, 100, '단어장 ID'), name: text(raw.name, 80, '단어장 이름'), createdAt: date(raw.createdAt), words };
}
export function parseBoard(contents) {
  let parsed;
  try { parsed = JSON.parse(contents); } catch { throw new Error('파일을 읽을 수 없습니다. 올바른 .neoulboard 파일인지 확인하세요.'); }
  if (parsed?.format !== FORMAT) throw new Error('혜나용 단어장 파일이 아닙니다. .neoulboard 파일을 선택하세요.');
  if (parsed.version !== VERSION) throw new Error('지원하지 않는 파일 버전입니다. 앱을 업데이트한 뒤 다시 시도하세요.');
  return validateBook(parsed.book);
}
export const serializeBoard = book => JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), dictionaryAttribution: { source: 'Korean Wiktionary contributors, via Kaikki.org / Wiktextract', url: 'https://kaikki.org/kowiktionary/일본어/index.html', originalEntryUrl: 'https://ko.wiktionary.org/wiki/{term}', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', note: 'Applies to dictionary-derived definitions. Readings and POS may have been normalized and users may have edited definitions. User-authored entries remain their own.' }, book: validateBook(book) }, null, 2);
export function parseCollection(contents){
  let data;try{data=JSON.parse(contents);}catch{throw Error('단어장 파일을 읽을 수 없습니다.');}
  if(data?.format!==FORMAT||data.version!==VERSION)throw Error('지원하지 않는 단어장 파일입니다.');
  if(!data.library){const single=parseBoard(contents);return {version:1,activeId:single.id,books:[single]};}
  if(!Array.isArray(data.library.books)||!data.library.books.length||data.library.books.length>100)throw Error('단어장 목록 형식이 올바르지 않습니다.');
  const books=data.library.books.map(validateBook);
  if(new Set(books.map(b=>b.id)).size!==books.length)throw Error('단어장 ID가 중복되었습니다.');
  return {version:1,books,activeId:books.some(b=>b.id===data.library.activeId)?data.library.activeId:books[0].id};
}
export function serializeCollection(state){
  const {dictionaryAttribution}=JSON.parse(serializeBoard(state.books[0]));
  const payload={format:FORMAT,version:VERSION,exportedAt:new Date().toISOString(),dictionaryAttribution,library:{version:1,activeId:state.activeId,books:state.books}};
  parseCollection(JSON.stringify(payload));return JSON.stringify(payload,null,2);
}
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function eligibleWords(words, scope) {
  return words.filter(w => scope === 'all' || w.status === 'unknown' || (scope === 'learning' && w.status === 'learning'));
}
export function createQuiz(words, scope = 'learning', random = Math.random, candidates = null) {
  if(new Set(words.map(w=>normalize(w.term))).size<2||new Set(words.map(w=>normalize(w.meaning))).size<2)return [];
  const chosenTerms = new Set();
  const candidatesPool = shuffle(candidates ?? eligibleWords(words, scope), random);
  const questions = [];
  for (const word of candidatesPool) {
    const term = normalize(word.term);
    if (chosenTerms.has(term)) continue;
    const meanings = new Map();
    for (const other of shuffle(words, random)) {
      if (normalize(other.term) !== term && normalize(other.meaning) !== normalize(word.meaning)) meanings.set(normalize(other.meaning), other.meaning);
    }
    if (!meanings.size) continue;
    chosenTerms.add(term);
    questions.push({ word: structuredClone(word), choices: shuffle([word.meaning, ...[...meanings.values()].slice(0, 3)], random), answer: null });
    if (questions.length === 10) break;
  }
  return questions;
}
export function sampleBook() {
  const now = new Date().toISOString();
  const entries = [
    ['木漏れ日','こもれび','나뭇잎 사이로 비치는 햇빛',['명사'],'unknown'],
    ['ときめく','ときめく','설레다',['동사'],'unknown'],
    ['穏やか','おだやか','온화하다, 평온하다',['な형용사'],'unknown'],
    ['寄り道','よりみち','가는 길에 다른 곳에 들름',['명사'],'unknown'],
    ['きらきら','きらきら','반짝반짝',['부사'],'unknown'],
    ['懐かしい','なつかしい','그립다, 옛 생각이 나다',['い형용사'],'unknown'],
    ['頑張る','がんばる','힘내다, 열심히 하다',['동사'],'unknown'],
    ['約束','やくそく','약속',['명사'],'unknown'],
    ['優しい','やさしい','상냥하다, 다정하다',['い형용사'],'unknown'],
    ['ゆっくり','ゆっくり','천천히, 느긋하게',['부사'],'unknown'],
    ['見つける','みつける','찾다, 발견하다',['동사'],'unknown'],
    ['大切','たいせつ','소중하다, 중요하다',['な형용사'],'unknown'],
    ['散歩','さんぽ','산책',['명사'],'learning'],
    ['美味しい','おいしい','맛있다',['い형용사'],'learning'],
    ['時々','ときどき','가끔, 때때로',['부사'],'learning'],
    ['楽しみ','たのしみ','즐거움, 기대',['명사'],'learning'],
    ['ありがとう','ありがとう','고마워',['감탄사','표현'],'mastered'],
    ['友達','ともだち','친구',['명사'],'mastered'],
  ];
  return { id: id(), name: '기본 단어장', createdAt: now, words: entries.map(([term,reading,meaning,pos,status],index) => ({ id:id(),term,reading,meaning,pos,status,createdAt:new Date(Date.now()-index*1000).toISOString() })) };
}
