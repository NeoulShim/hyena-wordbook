import {parseCollection,serializeCollection} from './core.js';
const DIRTY_KEY='hyena-note:file-dirty';
export async function writeFileSnapshot(handle,expected,contents){
  const current=await(await handle.getFile()).text();
  if(current!==expected){const error=Error('File changed externally');error.code='FILE_CONFLICT';throw error;}
  const stream=await handle.createWritable();await stream.write(contents);await stream.close();
}
function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open('hyena-note-files',1);request.onupgradeneeded=()=>request.result.createObjectStore('handles');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function stored(value){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('handles',value===undefined?'readonly':'readwrite'),store=tx.objectStore('handles'),request=value===undefined?store.get('default'):value===null?store.delete('default'):store.put(value,'default');let result;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};});}
export function createFileSync({getState,onLoad,onStatus,onError}){
  const supported='showOpenFilePicker' in window&&'showSaveFilePicker' in window;
  let handle=null,lastText='',paused=false,writing=false,queued=null,revision=0,connected=false;
  const status=(kind,message)=>onStatus({supported,connected,name:handle?.name??'',kind,message});
  const dirty=()=>{try{return localStorage.getItem(DIRTY_KEY)==='1';}catch{return false;}};
  const setDirty=value=>{try{value?localStorage.setItem(DIRTY_KEY,'1'):localStorage.removeItem(DIRTY_KEY);}catch{}};
  async function write(){
    if(writing||paused||!handle||!queued)return;
    writing=true;
    try{
      while(queued&&!paused){
        const contents=queued,currentRevision=revision;queued=null;
        if(await handle.queryPermission({mode:'readwrite'})!=='granted'){paused=true;status('permission','파일 접근 권한 필요');break;}
        try{await writeFileSnapshot(handle,lastText,contents);}catch(error){if(error.code==='FILE_CONFLICT'){paused=true;status('conflict','파일 외부 변경 감지');onError('자동 저장 파일이 외부에서 변경되었습니다. 파일을 다시 읽거나 다른 파일로 저장하세요.');break;}throw error;}lastText=contents;
        await stored({handle,lastText});if(currentRevision===revision&&!queued)setDirty(false);
        status('ready',`${handle.name} · 자동 저장 완료`);
      }
    }catch(error){paused=true;status('error','파일 자동 저장 실패');onError('파일 자동 저장에 실패했습니다. 변경 내용은 브라우저에 보관됩니다. 연결을 복원하거나 다른 파일로 저장하세요.');}
    finally{writing=false;}
  }
  async function readCurrent(){const contents=await (await handle.getFile()).text();const next=parseCollection(contents);onLoad(next);lastText=contents;await stored({handle,lastText});setDirty(false);paused=false;queued=null;status('ready',`${handle.name} · 자동 저장 연결됨`);}
  const pickerOptions={types:[{description:'Neoulboard 단어장',accept:{'application/json':['.neoulboard']}}],excludeAcceptAllOption:true};
  async function openExisting(){
    if(writing)throw Error('파일 저장이 완료된 후 다시 시도하세요.');
    const [selected]=await window.showOpenFilePicker({...pickerOptions,multiple:false});
    if(await selected.requestPermission({mode:'readwrite'})!=='granted')throw Error('파일 읽기·쓰기 권한이 필요합니다.');
    const content=await (await selected.getFile()).text();const next=parseCollection(content);
    handle=selected;lastText=content;connected=true;paused=false;queued=null;
    // Keep unrelated browser decks when connecting a single exported deck.
    const current=getState();for(const old of current.books)if(!next.books.some(b=>b.id===old.id))next.books.push(old);
    onLoad(next);await stored({handle,lastText});setDirty(false);status('ready',`${handle.name} · 자동 저장 연결됨`);schedule();
  }
  async function createNew(){
    if(writing)throw Error('파일 저장이 완료된 후 다시 시도하세요.');
    const selected=await window.showSaveFilePicker({...pickerOptions,suggestedName:'default.neoulboard',startIn:'documents'});
    const contents=serializeCollection(getState()),stream=await selected.createWritable();await stream.write(contents);await stream.close();
    handle=selected;lastText=contents;connected=true;paused=false;queued=null;await stored({handle,lastText});setDirty(false);status('ready',`${handle.name} · 자동 저장 연결됨`);
  }
  async function restore(){
    if(!supported){status('unsupported','브라우저 내부 자동 저장');return;}
    try{const saved=await stored();if(!saved?.handle){status('browser','브라우저 내부 자동 저장');return;}handle=saved.handle;lastText=saved.lastText??'';connected=true;
      if(await handle.queryPermission({mode:'readwrite'})!=='granted'){paused=true;status('permission','파일 접근 권한 필요');return;}
      if(dirty()){status('pending','저장 대기 중인 변경 있음');schedule();}else await readCurrent();
    }catch{paused=true;status('error','자동 저장 파일 확인 필요');}
  }
  function schedule(){if(!handle)return;revision++;setDirty(true);queued=serializeCollection(getState());if(!paused){status('saving','파일 저장 중');void write();}}
  async function resume(){if(!handle)return;if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('파일 읽기·쓰기 권한이 필요합니다.');paused=false;if(dirty()){schedule();}else await readCurrent();}
  async function reload(){if(!handle)return;if(writing)throw Error('파일 저장이 완료된 후 다시 시도하세요.');if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('파일 접근 권한이 필요합니다.');await readCurrent();}
  async function disconnect(){if(writing)throw Error('파일 저장이 완료된 후 다시 시도하세요.');await stored(null);handle=null;connected=false;paused=false;queued=null;setDirty(false);status('browser','브라우저 내부 자동 저장');}
  document.addEventListener('visibilitychange',async()=>{if(document.visibilityState!=='visible'||!handle||paused||writing||dirty()||document.querySelector('dialog[open]'))return;try{const contents=await(await handle.getFile()).text();if(contents!==lastText)await readCurrent();}catch{paused=true;status('error','자동 저장 파일 확인 필요');}});
  window.addEventListener('beforeunload',event=>{if(handle&&dirty()&&!paused){event.preventDefault();event.returnValue='';}});
  return {supported,restore,schedule,openExisting,createNew,resume,reload,disconnect};
}
