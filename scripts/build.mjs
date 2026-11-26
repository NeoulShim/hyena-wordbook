import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),dist=new URL('../dist/',import.meta.url);
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
for(const file of ['index.html','style.css','app.js','core.js','dictionary.js','reading-worker.js','cloud-sync.js','cloud-config.js','sync-model.js','hyena.svg','licenses.html','data','vendor'])await cp(new URL(file,root),new URL(file,dist),{recursive:true});
await mkdir(new URL('scripts/',dist));await cp(new URL('scripts/build-dictionary.mjs',root),new URL('scripts/build-dictionary.mjs',dist));
await writeFile(new URL('.nojekyll',dist),'');
console.log('Static site ready in dist/');
