import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
const root=resolve(import.meta.dirname,'..'),skip=new Set(['.git','.codex','.playwright-cli','.wrangler','node_modules','output','data','dist','.public-release']);
async function markdown(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(skip.has(entry.name))continue;const p=resolve(dir,entry.name);if(entry.isDirectory())result.push(...await markdown(p));else if(entry.name.endsWith('.md'))result.push(p);}return result;}
const withoutCode=s=>s.replace(/```[\s\S]*?```/g,'');
function anchors(text){const result=new Set(),seen=new Map();for(const match of withoutCode(text).matchAll(/^#{1,6}\s+(.+)$/gm)){let slug=match[1].replace(/<[^>]*>/g,'').toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu,'').trim().replace(/ /g,'-');const n=seen.get(slug)||0;seen.set(slug,n+1);result.add(slug+(n?'-'+n:''));}for(const match of text.matchAll(/\bid=["']([^"']+)["']/g))result.add(match[1]);return result;}
let links=0;const errors=[];
for(const path of await markdown(root)){
 const source=withoutCode(await readFile(path,'utf8'));
 const targets=[...source.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g),...source.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map(m=>m[1].replace(/^<|>$/g,''));
 for(const target of targets){if(/^(https?:|mailto:|data:)/.test(target))continue;links++;const [file,fragment]=target.split('#'),destination=file?resolve(dirname(path),decodeURIComponent(file)):path;
  if(!destination.startsWith(root+sep)){errors.push(relative(root,path)+': link leaves the repository: '+target);continue;}
  try{await stat(destination);if(fragment&&destination.endsWith('.md')&&!anchors(await readFile(destination,'utf8')).has(decodeURIComponent(fragment)))errors.push(relative(root,path)+': missing heading: '+target);}catch{errors.push(relative(root,path)+': missing file: '+target);}
 }
}
for(const entry of await readdir(resolve(root,'docs/media'),{withFileTypes:true})){if(entry.isFile()&&(await stat(resolve(root,'docs/media',entry.name))).size>6*1024*1024)errors.push('Media exceeds 6 MiB: '+entry.name);}
if(errors.length)throw new Error('Documentation checks failed:\n'+errors.join('\n'));
console.log('Checked '+links+' local documentation links and media size limits.');
