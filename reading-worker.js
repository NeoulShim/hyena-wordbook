/* kuromoji.js 0.1.2 (Apache-2.0), IPADIC notices in vendor/kuromoji/NOTICE.md. */
importScripts('./vendor/kuromoji/kuromoji.js');
let tokenizerPromise;
function tokenizer(){
  if(!tokenizerPromise)tokenizerPromise=new Promise((resolve,reject)=>{
    kuromoji.builder({dicPath:'./vendor/kuromoji/dict/'}).build((error,value)=>error?reject(error):resolve(value));
  }).catch(error=>{tokenizerPromise=null;throw error;});
  return tokenizerPromise;
}
self.onmessage=async ({data})=>{
  try{const engine=await tokenizer();const reading=engine.tokenize(data.term).map(token=>token.reading||token.surface_form).join('').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));self.postMessage({id:data.id,reading});}
  catch{self.postMessage({id:data.id,error:'사전을 불러오지 못했습니다.'});}
};
