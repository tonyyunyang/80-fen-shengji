import { cp,mkdir,rm,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'dist/free-assets');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await cp(resolve(root,'public'),out,{recursive:true});
await mkdir(resolve(out,'src'),{recursive:true});
for(const name of ['cards.js','notebook.js','rules.js','training.js','player-settings.js','model-catalog.js'])await cp(resolve(root,'src',name),resolve(out,'src',name));
await writeFile(resolve(out,'_headers'),"/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n");
console.log('Built Free Worker assets from the existing public table and its six public modules. No server code or secrets included.');
