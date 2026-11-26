// Usage: node scripts/build-dictionary.mjs /path/to/kaikki-japanese.jsonl
// Source: Korean Wiktionary, via Kaikki.org / Wiktextract. CC BY-SA 4.0.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const raw=readFileSync(process.argv[2],'utf8');
const hira=s=>s.replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
const posMap={noun:'명사',verb:'동사',adj:'형용사',adv:'부사',pron:'대명사',particle:'조사',conj:'접속사',intj:'감탄사',phrase:'표현',proverb:'속담',name:'고유명사',num:'수사',prefix:'접두사',suffix:'접미사',adnominal:'연체사'};
const entries=[];const seen=new Set();
for(const line of raw.split('\n')){
  if(!line.trim())continue;const item=JSON.parse(line);
  if(item.lang_code!=='ja'||!item.word||item.word.length>100)continue;
  let reading='';
  if(/^[ぁ-ゖァ-ヶー\s]+$/.test(item.word))reading=hira(item.word);
  const sound=(item.sounds??[]).find(s=>s.other&&/^[ぁ-ゖァ-ヶー\s]+$/.test(s.other));
  if(!reading&&sound)reading=hira(sound.other);
  const rubyCandidates=[...(item.forms??[]).filter(f=>f.form===item.word).map(f=>f.ruby),...(item.senses??[]).flatMap(s=>(s.examples??[]).map(e=>e.ruby))].filter(Boolean);
  for(const ruby of rubyCandidates){if(reading)break;let candidate=item.word;for(const [written,kana] of [...ruby].sort((a,b)=>b[0].length-a[0].length)){candidate=candidate.split(written).join(kana);}if(/^[ぁ-ゖァ-ヶー\s]+$/.test(candidate))reading=hira(candidate);}
  let pos=posMap[item.pos]??'';const categories=(item.categories??[]).map(c=>typeof c==='string'?c:c.name).join(' ');
  if(pos==='형용사'){if(categories.includes('い형용사'))pos='い형용사';else if(categories.includes('な형용사'))pos='な형용사';}
  for(const sense of item.senses??[]){
    const meaning=(sense.glosses??[]).filter(g=>typeof g==='string').join(' · ').replace(/^\d+\.\s*/,'').replace(/\.$/,'').trim();
    if(!meaning||meaning.length>500||!( /[가-힣]/.test(meaning)))continue;
    const row=[item.word,reading,meaning,pos?[pos]:[]];const key=JSON.stringify(row);if(seen.has(key))continue;seen.add(key);entries.push(row);
  }
}
const output={source:'Korean Wiktionary contributors, via Kaikki.org / Wiktextract',sourceUrl:'https://kaikki.org/kowiktionary/일본어/index.html',license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',sourceDumpDate:'2026-11-01',sourceSha256:createHash('sha256').update(raw).digest('hex'),changes:'Japanese entries with Korean glosses only; examples and categories removed; kana readings inferred from supplied ruby; POS mapped to Korean; terminal periods removed.',entries};
writeFileSync(new URL('../data/japanese-ko.json',import.meta.url),JSON.stringify(output));
console.log(JSON.stringify({entries:entries.length,headwords:new Set(entries.map(e=>e[0])).size,readings:entries.filter(e=>e[1]).length,bytes:Buffer.byteLength(JSON.stringify(output))}));
