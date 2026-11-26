import { STORAGE_KEY, POS, STATUS, id, normalize, escapeHTML as esc, validateBook, createQuiz, eligibleWords } from './core.js';
import { lookupWord, getReading } from './dictionary.js';
import { createCloudSync } from './cloud-sync.js';
import { sharedBook } from './sync-model.js';
import { API_BASE } from './cloud-config.js';
const CACHE_KEY = 'hyena-note:shared-cache:v1';
const $ = selector => document.querySelector(selector);
const speaker = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
let state, persistence = true, initialMessage = '', lastRaw, cloudSync;
try {
  lastRaw = localStorage.getItem(CACHE_KEY);
  const cached = lastRaw ? validateBook(JSON.parse(lastRaw)) : sharedBook(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  cached.id = 'shared'; cached.name = '단어장';
  state = { version: 1, activeId: 'shared', books: [cached] };
} catch { persistence = false; initialMessage = '브라우저 저장소를 읽지 못했습니다. 서버에서 단어장을 불러옵니다.'; }
if (!state) state = { version: 1, activeId: 'shared', books: [sharedBook(null)] };
let statusFilter = 'all', view = 'words', scope = 'learning', quiz = null, editingWord = null, toastTimer, lookupTimer, lookupGeneration = 0, autoValues = {};
const book = () => state.books.find(b=>b.id === state.activeId);
const dateLabel = date => new Intl.DateTimeFormat('ko-KR', {year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
const fullDate = date => new Intl.DateTimeFormat('ko-KR', {dateStyle:'long',timeStyle:'short'}).format(new Date(date));
function toast(message, error = false) { clearTimeout(toastTimer); const element = $('#toast'); element.textContent = message; element.classList.toggle('error', error); element.hidden = false; toastTimer = setTimeout(()=>{element.hidden=true;},error?8500:4200); }
function storageNote() { $('#storage-note').textContent = persistence ? 'Cloudflare 동기화' : '브라우저 보관 불가 · 온라인 연결 필요'; $('#storage-note').classList.toggle('error',!persistence); }
function persist() {
  if (!persistence) return;
  try { lastRaw = JSON.stringify(book()); localStorage.setItem(CACHE_KEY, lastRaw); }
  catch { persistence=false; storageNote(); toast('브라우저 저장 공간이 부족하거나 차단되었습니다. 온라인 상태에서 동기화 완료를 확인하세요.',true); }
}
function update(change) {
  if (!cloudSync?.hasSession()) { openAuth(); return false; }
  if (!cloudSync.canEdit()) { toast('서버 단어장을 불러온 후 수정할 수 있습니다.', true); return false; }
  change(state); persist(); cloudSync.changed(); return true;
}
window.addEventListener('storage', event => { if (event.key === CACHE_KEY && event.newValue !== lastRaw) void cloudSync?.refresh(); });
function render() {
  $('#book-title').textContent=book().name;
  $('#tab-count').textContent=book().words.length;
  const counts = Object.fromEntries(Object.keys(STATUS).map(s=>[s,book().words.filter(w=>w.status===s).length]));
  $('#stats').innerHTML=[['all','모든 단어','▤',book().words.length],...Object.entries(STATUS).map(([key,s])=>[key,s.short,s.symbol,counts[key]])].map(([key,label,symbol,count])=>`<button class="stat ${key} ${statusFilter===key?'active':''}" data-filter="${key}" aria-pressed="${statusFilter===key}" ${STATUS[key]?`title="${esc(STATUS[key].label)}"`:''}><span class="stat-symbol" aria-hidden="true">${symbol}</span><span><span class="stat-label">${label}</span><strong>${count}<small>개</small></strong></span></button>`).join('');
  const selected = $('#pos-filter').value;
  $('#pos-filter').innerHTML='<option value="all">모든 품사</option>'+[...new Set(book().words.flatMap(w=>w.pos))].sort().map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
  $('#pos-filter').value=[...$('#pos-filter').options].some(o=>o.value===selected)?selected:'all';
  renderWords();
  if (view==='quiz') renderQuiz();
}
function renderWords() {
  const query = normalize($('#search').value);
  const pos = $('#pos-filter').value;
  const sort = $('#sort').value;
  const words=book().words.filter(w=>(statusFilter==='all'||w.status===statusFilter)&&(pos==='all'||w.pos.includes(pos))&&(!query||normalize(`${w.term} ${w.reading} ${w.meaning}`).includes(query)));
  words.sort((a,b)=>sort==='alpha'?a.term.localeCompare(b.term,'ja'):sort==='oldest'?Date.parse(a.createdAt)-Date.parse(b.createdAt):Date.parse(b.createdAt)-Date.parse(a.createdAt));
  $('#list-description').textContent=statusFilter==='all'?'등록된 단어를 검색하고 관리합니다.':STATUS[statusFilter].label;
  $('#word-grid').innerHTML=words.length?words.map(w=>`<article class="word-card"><div class="card-top"><button class="status-pill ${w.status}" data-edit="${esc(w.id)}" title="${esc(STATUS[w.status].label)} · 태그 수정">${STATUS[w.status].short}</button><button class="icon-button" data-edit="${esc(w.id)}" aria-label="${esc(w.term)} 수정">···</button></div><div class="word-term-line"><h3 class="word-term" lang="ja">${esc(w.term)}</h3><button class="speak-button" data-speak="${esc(w.id)}" aria-label="${esc(w.term)} 발음 듣기">${speaker}</button></div><p class="word-reading" lang="ja">${esc(w.reading)}</p><p class="word-meaning">${esc(w.meaning)}</p><div class="card-bottom"><div class="pos-tags">${w.pos.map(p=>`<span class="pos-tag">${esc(p)}</span>`).join('')}</div><time class="card-date" datetime="${esc(w.createdAt)}" title="${esc(fullDate(w.createdAt))} 입력">${dateLabel(w.createdAt)}</time></div></article>`).join(''):`<div class="empty"><h3>${book().words.length?'검색 결과 없음':'등록된 단어 없음'}</h3><p>${book().words.length?'검색어나 필터를 변경하세요.':'단어 추가 버튼으로 새 단어를 등록하세요.'}</p><button class="button primary" data-action="${book().words.length?'reset-filters':'add'}">${book().words.length?'필터 초기화':'단어 추가'}</button></div>`;
  $('#list-footer').textContent=`${book().words.length}개 중 ${words.length}개 표시`;
}
function setView(next) {
  view=next;
  for(const type of ['words','quiz']) {const active=next===type; $(`#side-${type}`).classList.toggle('active',active); $(`#${type}-panel`).hidden=!active; $(`#${type}-tab`).classList.toggle('active',active); $(`#${type}-tab`).setAttribute('aria-selected',active); $(`#${type}-tab`).tabIndex=active?0:-1;}
  if(next==='quiz') renderQuiz();
}
function resetFilters(){statusFilter='all';$('#search').value='';$('#pos-filter').value='all';render();}
function leaveQuiz(){return !quiz || quiz.done || confirm('진행 중인 시험을 종료하시겠습니까? 현재 시험 답안은 저장되지 않습니다.');}
$('#stats').addEventListener('click',event=>{const b=event.target.closest('[data-filter]');if(b){statusFilter=b.dataset.filter;render();}});
$('#search').addEventListener('input',renderWords);
$('#pos-filter').addEventListener('change',renderWords);
$('#sort').addEventListener('change',renderWords);
$('#words-tab').addEventListener('click',()=>setView('words'));
$('#quiz-tab').addEventListener('click',()=>setView('quiz'));
$('.tabs').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();setView(view==='words'?'quiz':'words');$(`#${view}-tab`).focus();}});
$('#hero-quiz').addEventListener('click',()=>{setView('quiz');$('#quiz-tab').focus();});
function renderPos(selected = []) { $('#pos-options').innerHTML=POS.map(p=>`<label class="pos-choice"><input type="checkbox" value="${esc(p)}" ${selected.includes(p)?'checked':''}><span>${esc(p)}</span></label>`).join('');$('#custom-pos').value=selected.filter(p=>!POS.includes(p)).join(', '); }
function openWord(wordId=null) {
  editingWord=wordId;
  const word=book().words.find(w=>w.id===wordId);
  $('#word-form').reset();$('#word-error').textContent='';$('#word-dialog-title').textContent=word?'단어 수정':'단어 추가';
  $('#word-term').value=word?.term??'';$('#word-reading').value=word?.reading??'';$('#word-meaning').value=word?.meaning??'';$('#word-status').value=word?.status??'unknown';
  renderPos(word?.pos??[]);$('#word-created').textContent=word?`${fullDate(word.createdAt)} 입력 · 입력일은 변경되지 않습니다.`:'';$('#delete-word').hidden=!word;
  lookupGeneration++;autoValues={};$('#dictionary-results').innerHTML='';$('#dictionary-note').textContent='일본어 입력 시 읽기·한국어 뜻·품사를 검색합니다.';
  $('#word-dialog').showModal();$('#word-term').focus();
}
$('#add-word').addEventListener('click',()=>openWord());
document.addEventListener('click',event=>{const close=event.target.closest('.close-dialog');if(close)close.closest('dialog').close();});
$('#word-dialog').addEventListener('close',()=>{lookupGeneration++;clearTimeout(lookupTimer);});
$('#word-form').addEventListener('submit',event=>{
  event.preventDefault();const term=$('#word-term').value.trim(),meaning=$('#word-meaning').value.trim(),reading=$('#word-reading').value.trim();
  if(!term||!meaning){$('#word-error').textContent='일본어와 뜻을 입력하세요.';return;}
  const pos=[...new Set([...$('#pos-options').querySelectorAll('input:checked')].map(i=>i.value).concat($('#custom-pos').value.split(',').map(s=>s.trim()).filter(Boolean)))];
  if(pos.length>20||pos.some(p=>p.length>30)){$('#word-error').textContent='품사는 20개까지, 각 30자 이내로 입력하세요.';return;}
  if(book().words.some(w=>w.id!==editingWord&&normalize(w.term)===normalize(term)&&normalize(w.meaning)===normalize(meaning))){$('#word-error').textContent='같은 단어와 뜻이 이미 존재합니다.';return;}
  if(!editingWord&&book().words.length>=10000){$('#word-error').textContent='한 단어장에는 10,000개까지 저장할 수 있습니다.';return;}
  const old=book().words.find(w=>w.id===editingWord);
  const word={id:old?.id??id(),term,reading,meaning,pos,status:$('#word-status').value,createdAt:old?.createdAt??new Date().toISOString()};
  if(!update(()=>{if(old)Object.assign(old,word);else book().words.unshift(word);})){return;}
  $('#word-dialog').close();render();toast(old?'단어를 수정했습니다.':'단어를 추가했습니다.');
});
$('#delete-word').addEventListener('click',()=>{if(!confirm('이 단어를 삭제하시겠습니까?'))return;if(!update(()=>{book().words=book().words.filter(w=>w.id!==editingWord);})){return;}$('#word-dialog').close();render();toast('단어를 삭제했습니다.');});
$('#word-grid').addEventListener('click',event=>{
  const edit=event.target.closest('[data-edit]'),say=event.target.closest('[data-speak]'),action=event.target.closest('[data-action]');
  if(edit)openWord(edit.dataset.edit);if(say)speakWord(book().words.find(w=>w.id===say.dataset.speak));if(action){if(action.dataset.action==='add')openWord();else resetFilters();}
});
$('#about-storage').addEventListener('click',()=>$('#info-dialog').showModal());
function speakWord(word){
  if(!word)return;
  if(!('speechSynthesis' in window)){toast('이 브라우저에서는 발음 듣기를 지원하지 않습니다.',true);return;}
  const voices=speechSynthesis.getVoices().filter(v=>/^ja(?:[-_]|$)/i.test(v.lang));
  const voice=voices.find(v=>v.localService)||voices[0];
  if(!voice){toast('일본어 음성을 찾지 못했습니다. 기기의 음성 설정에서 일본어를 추가한 뒤 다시 누르세요.',true);return;}
  speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(word.reading||word.term);utterance.lang='ja-JP';utterance.voice=voice;utterance.rate=.85;
  utterance.onerror=event=>{if(!['interrupted','canceled'].includes(event.error))toast('음성을 재생하지 못했습니다. 기기의 일본어 음성 설정을 확인하세요.',true);};
  if(!voice.localService)toast('기기의 온라인 일본어 음성으로 재생합니다. 인터넷 연결이 필요할 수 있습니다.');
  speechSynthesis.speak(utterance);
}
if('speechSynthesis' in window){speechSynthesis.getVoices();speechSynthesis.addEventListener('voiceschanged',()=>speechSynthesis.getVoices());}
function renderQuiz(){
  if(!quiz){
    const options=[['unknown','모르는 단어만','모르는 단어'],['learning','듣기 가능한 단어 포함','모르는 단어 + 알아듣지만 쓸 수 없는 단어'],['all','암기 완료 단어 포함','완전히 외운 단어까지 모두 포함']];
    const available=createQuiz(book().words,scope).length;
    $('#quiz-panel').innerHTML=`<div class="quiz-setup"><p class="eyebrow">TEST</p><h2>단어 테스트</h2><p>출제 범위를 선택하세요. 일본어에 해당하는 뜻을 고르는 객관식 테스트입니다.</p><div class="scope-options">${options.map(([key,title,description])=>`<label class="scope-option"><input type="radio" name="quiz-scope" value="${key}" ${scope===key?'checked':''}><span><strong>${title}</strong><small>${description}</small></span><span class="scope-count">${eligibleWords(book().words,key).length}개</span></label>`).join('')}</div><p class="quiz-notice">${available?`무작위 ${available}문제 · 최대 4지선다${available<10?' · 10개 미만이면 가능한 수만 출제':''}`:'다른 뜻을 가진 단어가 2개 이상 필요합니다. 선택한 범위의 단어도 확인하세요.'}</p><button class="button primary" data-quiz="start" ${available?'':'disabled'}>${available||10}문제 시작</button><p class="quiz-notice">보기는 단어장 전체에서 선택합니다.<br>테스트 결과는 숙련도에 자동 반영되지 않습니다.</p></div>`;return;
  }
  if(quiz.done){renderResults();return;}
  const question=quiz.questions[quiz.index],answered=question.answer!==null;
  $('#quiz-panel').innerHTML=`<div class="quiz-session"><div class="quiz-topline"><span><strong>${quiz.index+1}</strong> / ${quiz.questions.length} 문제</span><button class="text-button" data-quiz="quit">테스트 종료</button></div><div class="progress-track" role="progressbar" aria-label="시험 진행" aria-valuemin="0" aria-valuemax="${quiz.questions.length}" aria-valuenow="${quiz.index+(answered?1:0)}"><div class="progress-fill" style="width:${(quiz.index+(answered?1:0))/quiz.questions.length*100}%"></div></div><div class="question-card"><p class="question-label">알맞은 뜻을 선택하세요.</p><div class="word-term-line"><h2 class="word-term" lang="ja">${esc(question.word.term)}</h2><button class="speak-button" data-quiz="speak" aria-label="문제 단어 발음 듣기">${speaker}</button></div><p class="word-reading" lang="ja">${esc(question.word.reading)}</p><div class="choices">${question.choices.map((choice,index)=>`<button class="choice ${answered?(choice===question.word.meaning?'correct':choice===question.answer?'wrong':''):''}" data-choice="${index}" ${answered?'disabled':''}><span class="choice-number">${answered&&choice===question.word.meaning?'✓':index+1}</span><span>${esc(choice)}</span></button>`).join('')}</div>${answered?`<div class="answer-feedback" role="status">${question.answer===question.word.meaning?'정답입니다.':`오답입니다. 정답: <strong>${esc(question.word.meaning)}</strong>`}</div>`:''}</div>${answered?`<div class="next-row"><button class="button primary" id="next-question" data-quiz="next">${quiz.index===quiz.questions.length-1?'결과 확인':'다음 문제'}</button></div>`:''}<p class="quiz-hint">단축키: 숫자 1–4 선택 · Enter 다음 문제</p></div>`;
}
function renderResults(){
  const correct=quiz.questions.filter(q=>q.answer===q.word.meaning).length;
  $('#quiz-panel').innerHTML=`<div class="results-header"><h2>테스트 완료</h2><div class="result-score">${correct}<small> / ${quiz.questions.length}</small></div><p>정오답을 확인하고 각 단어의 숙련도를 수정하세요.</p><div class="results-actions"><button class="button primary" data-quiz="retry" ${correct===quiz.questions.length?'disabled':''}>오답 재시험</button><button class="button secondary" data-quiz="reset">새 테스트</button></div></div><p class="results-intro">숙련도는 선택 메뉴에서, 품사는 ‘태그 수정’에서 변경합니다.</p><div class="results-list">${quiz.questions.map(q=>{const current=book().words.find(w=>w.id===q.word.id),w=current??q.word,right=q.answer===q.word.meaning;return `<article class="result-row"><span class="result-mark ${right?'':'wrong'}" aria-label="${right?'정답':'오답'}">${right?'✓':'×'}</span><div><strong class="result-word" lang="ja">${esc(q.word.term)}<small>${esc(q.word.reading)}</small></strong><p class="result-meaning">${esc(q.word.meaning)}</p>${right?'':`<div class="result-selected">내 답: ${esc(q.answer)}</div>`}<div class="pos-tags">${w.pos.map(p=>`<span class="pos-tag">${esc(p)}</span>`).join('')}</div>${current?'':'<small>단어장에서 삭제된 단어입니다.</small>'}</div><select data-result-status="${esc(w.id)}" aria-label="${esc(w.term)} 숙련도" ${current?'':'disabled'}>${Object.entries(STATUS).map(([key,s])=>`<option value="${key}" ${w.status===key?'selected':''}>${s.label}</option>`).join('')}</select><button class="button secondary" data-result-edit="${esc(w.id)}" ${current?'':'disabled'}>태그 수정</button></article>`;}).join('')}</div>`;
}
$('#quiz-panel').addEventListener('change',event=>{
  if(event.target.name==='quiz-scope'){scope=event.target.value;renderQuiz();$('#quiz-panel').querySelector(`input[value="${scope}"]`).focus();}
  if(event.target.dataset.resultStatus){const word=book().words.find(w=>w.id===event.target.dataset.resultStatus);if(word&&Object.hasOwn(STATUS,event.target.value)){if(update(()=>{word.status=event.target.value;})){render();toast('숙련도를 변경했습니다.');}else event.target.value=word.status;}}
});
$('#quiz-panel').addEventListener('click',event=>{
  const action=event.target.closest('[data-quiz]')?.dataset.quiz,choice=event.target.closest('[data-choice]'),edit=event.target.closest('[data-result-edit]');
  if(edit){openWord(edit.dataset.resultEdit);return;}
  if(action==='start'){const questions=createQuiz(book().words,scope);if(questions.length){quiz={questions,index:0,done:false};renderQuiz();}}
  if(action==='quit'&&leaveQuiz()){quiz=null;renderQuiz();}
  if(action==='speak')speakWord(quiz.questions[quiz.index].word);
  if(choice&&quiz&&!quiz.done){const q=quiz.questions[quiz.index];if(q.answer===null){q.answer=q.choices[Number(choice.dataset.choice)];renderQuiz();$('#next-question').focus();}}
  if(action==='next'&&quiz&&!quiz.done&&quiz.questions[quiz.index].answer!==null){if(quiz.index+1===quiz.questions.length)quiz.done=true;else quiz.index++;renderQuiz();$('#quiz-panel').querySelector('.choice, [data-quiz="reset"]')?.focus();}
  if(action==='reset'){quiz=null;renderQuiz();}
  if(action==='retry'){
    const wrong=quiz.questions.filter(q=>q.answer!==q.word.meaning).map(q=>book().words.find(w=>w.id===q.word.id)).filter(Boolean),questions=createQuiz(book().words,'all',Math.random,wrong);
    if(!questions.length){toast('다시 출제할 수 있는 단어가 없습니다. 삭제된 단어와 뜻을 확인하세요.',true);return;}quiz={questions,index:0,done:false};renderQuiz();
  }
});
document.addEventListener('keydown',event=>{if(view!=='quiz'||!quiz||quiz.done||document.querySelector('dialog[open]')||['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName)||event.ctrlKey||event.metaKey||event.altKey)return;if(/^[1-4]$/.test(event.key)){const button=$('#quiz-panel').querySelector(`[data-choice="${Number(event.key)-1}"]`);if(button&&!button.disabled){event.preventDefault();button.click();}}else if(event.key==='Enter'&&event.target.tagName!=='BUTTON')$('#next-question')?.click();});
function applyDictionary(entry, overwrite=false){
  for(const field of ['reading','meaning'])if(entry[field]&&(overwrite||!$(`#word-${field}`).value.trim())){$(`#word-${field}`).value=entry[field];autoValues[field]=entry[field];}
  if(entry.pos?.length&&(overwrite||!$('#pos-options input:checked'))){renderPos(entry.pos);autoValues.pos=entry.pos;}
}
async function fillMissingReading(term,generation){
  if($('#word-reading').value.trim())return;
  const reading=await getReading(term);
  if(generation===lookupGeneration&&$('#word-dialog').open&&!$('#word-reading').value.trim()){$('#word-reading').value=reading;autoValues.reading=reading;}
}
async function lookup(force=false){
  const term=$('#word-term').value.trim();if(!term)return;const generation=++lookupGeneration;$('#dictionary-note').textContent='사전 검색 중…';$('#dictionary-results').innerHTML='';
  try{const entries=await lookupWord(term);if(generation!==lookupGeneration||!$('#word-dialog').open)return;
    if(entries.length===1){applyDictionary(entries[0],force);$('#dictionary-note').textContent='자동 입력 완료. 문맥에 맞는 뜻과 읽기인지 확인하세요.';}
    else if(entries.length>1){$('#dictionary-note').textContent=`${entries.length}개 후보가 있습니다. 사용할 뜻을 선택하세요.${entries.length>25?' 처음 25개를 표시합니다.':''}`;$('#dictionary-results').innerHTML=entries.slice(0,25).map((e,index)=>`<button type="button" class="dictionary-result" data-dictionary="${index}"><strong lang="ja">${esc(e.term)}</strong> ${esc(e.reading)}<br>${esc(e.meaning)}<small>${esc(e.pos.join(' · '))}</small></button>`).join('');$('#dictionary-results').onclick=async event=>{const b=event.target.closest('[data-dictionary]');if(b){const entry=entries[Number(b.dataset.dictionary)];applyDictionary(entry,true);$('#dictionary-results').innerHTML='';$('#dictionary-note').textContent='선택한 후보를 입력했습니다. 저장 전에 확인하세요.';try{await fillMissingReading(entry.term,generation);}catch{if(generation===lookupGeneration)$('#dictionary-note').textContent='읽기를 분석하지 못했습니다. 직접 입력하세요.';}}};}
    else {$('#dictionary-note').textContent='한국어 뜻을 찾지 못했습니다. 뜻은 직접 입력하세요.';}
    if(!$('#word-reading').value.trim()&&(entries.length<2)){
      $('#dictionary-note').textContent+=' 읽기 분석 중. 최초 사용 시 사전을 다운로드합니다.';
      const reading=await getReading(term);if(generation!==lookupGeneration||!$('#word-dialog').open)return;
      if(!$('#word-reading').value.trim()){ $('#word-reading').value=reading;autoValues.reading=reading;}
      $('#dictionary-note').textContent=entries.length?'읽기·뜻·품사를 확인하고 저장하세요.':'뜻은 직접 입력하세요. 자동 읽기는 이름·다의어에서 부정확할 수 있습니다.';
    }
  }catch(error){if(generation===lookupGeneration)$('#dictionary-note').textContent='사전을 불러오지 못했습니다. 다시 찾기를 누르거나 직접 입력하세요.';}
}
let composing=false;
$('#word-term').addEventListener('compositionstart',()=>{composing=true;clearTimeout(lookupTimer);lookupGeneration++;});
$('#word-term').addEventListener('compositionend',()=>{composing=false;scheduleLookup();});
function scheduleLookup(){clearTimeout(lookupTimer);lookupGeneration++;if(composing)return;if(editingWord)return;for(const f of ['reading','meaning'])if(autoValues[f]&&$(`#word-${f}`).value===autoValues[f])$(`#word-${f}`).value='';if(autoValues.pos){renderPos([]);}autoValues={};$('#dictionary-results').innerHTML='';lookupTimer=setTimeout(()=>lookup(),600);}
$('#word-term').addEventListener('input',scheduleLookup);
$('#pos-options').addEventListener('change',()=>{delete autoValues.pos;});
$('#custom-pos').addEventListener('input',()=>{delete autoValues.pos;});
$('#lookup-word').addEventListener('click',()=>{clearTimeout(lookupTimer);lookup(true);});
$('#preview-voice').addEventListener('click',()=>speakWord({term:$('#word-term').value,reading:$('#word-reading').value}));
function openAuth() {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  if (!$('#auth-dialog').open) $('#auth-dialog').showModal();
  $('#sync-key').focus();
}
cloudSync = createCloudSync({
  apiBase: API_BASE,
  getBoard: () => book(),
  canApply: () => !$('#word-dialog').open && !$('#conflict-dialog').open,
  onBoard: next => { state = {version:1,activeId:'shared',books:[structuredClone(next)]}; persist(); render(); },
  onAuth: openAuth,
  onStatus: info => {
    $('#save-status').textContent = info.message;
    $('#save-status').dataset.state = info.kind;
    $('#sync-session').hidden = !info.connected;
    $('#sync-conflicts').hidden = info.kind !== 'conflict';
    $('#conflict-count').textContent = info.conflicts.length ? info.conflicts.length+'개 단어에 중복 수정이 있습니다.' : '';
    $('#conflict-list').replaceChildren(...info.conflicts.map(item => {const li=document.createElement('li');li.textContent=item.term;return li;}));
  }
});
$('#auth-dialog').addEventListener('cancel', event => event.preventDefault());
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); const input = $('#sync-key'), key = input.value;
  if (!key) return; $('#auth-submit').disabled = true; $('#auth-error').textContent = '';
  try { await cloudSync.login(key); $('#auth-dialog').close(); }
  catch (error) { $('#auth-error').textContent = error.message; }
  finally { input.value = ''; $('#auth-submit').disabled = false; }
});
$('#sync-now').addEventListener('click', () => void cloudSync.refresh());
$('#sync-session').addEventListener('click', async () => {try {await cloudSync.logout();}catch(error){toast(error.message,true);}});
$('#sync-conflicts').addEventListener('click', () => $('#conflict-dialog').showModal());
for (const choice of ['local','remote']) $('#choose-'+choice).addEventListener('click', async () => {
  $('#conflict-dialog').close(); try {await cloudSync.resolve(choice);} catch(error){toast(error.message,true);}
});
$('#word-dialog').addEventListener('close', () => void cloudSync.refresh());
$('#side-words').addEventListener('click',()=>setView('words'));
$('#side-quiz').addEventListener('click',()=>setView('quiz'));
render();storageNote();if(initialMessage)toast(initialMessage,true);
void cloudSync.start();
