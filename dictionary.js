import { normalize } from './core.js';
let dictionaryPromise, worker, pending = new Map(), requestId = 0;
export const hiragana = text => text.replace(/[ァ-ヶ]/g, c=>String.fromCharCode(c.charCodeAt(0)-0x60));
async function loadDictionary(){
  if(!dictionaryPromise)dictionaryPromise=fetch(new URL('./data/japanese-ko.json',import.meta.url)).then(response=>{if(!response.ok)throw Error('Dictionary unavailable');return response.json();}).then(data=>{
    const index=new Map();
    for(const row of data.entries){const entry={term:row[0],reading:row[1],meaning:row[2],pos:row[3]};for(const key of new Set([normalize(entry.term),normalize(hiragana(entry.term)),normalize(entry.reading)].filter(Boolean))){if(!index.has(key))index.set(key,[]);index.get(key).push(entry);}}
    return index;
  }).catch(error=>{dictionaryPromise=null;throw error;});
  return dictionaryPromise;
}
export async function lookupWord(term){const index=await loadDictionary();return index.get(normalize(term))??index.get(normalize(hiragana(term)))??[];}
export function getReading(term){
  if(!/[一-龯々〆ヵヶ]/.test(term))return Promise.resolve(hiragana(term));
  if(!worker){
    worker=new Worker(new URL('./reading-worker.js',import.meta.url));
    worker.onmessage=({data})=>{const request=pending.get(data.id);if(request){clearTimeout(request.timer);pending.delete(data.id);data.error?request.reject(Error(data.error)):request.resolve(data.reading);}};
    worker.onerror=()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Reading unavailable'));}pending.clear();worker.terminate();worker=null;};
  }
  return new Promise((resolve,reject)=>{const id=++requestId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Reading timed out'));},45000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,term});});
}
