import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const commit = '96f69258b68495904f360a199738b161da4f4998';
const root = 'https://raw.githubusercontent.com/ChannonTian/80fen/' + commit + '/';
const destination = new URL('../vendor/peilian/', import.meta.url);
const download = async (path) => {
  const response = await fetch(root + path);
  if (!response.ok) throw new Error('Reference download failed: ' + response.status);
  return response.text();
};
const html = await download('index.html');
const core = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!core?.includes('module.exports=ENGINE')) throw new Error('Reference export boundary changed');
const hash = (value) => createHash('sha256').update(value).digest('hex');
await mkdir(destination, { recursive: true });
await writeFile(new URL('reference-core.cjs', destination), core);
await writeFile(new URL('LICENSE', destination), await download('LICENSE'));
await writeFile(new URL('provenance.json', destination), JSON.stringify({
  repository: 'https://github.com/ChannonTian/80fen',
  commit, version: 'v0.7.14', source: 'index.html, first script block',
  sourceSha256: hash(html), coreSha256: hash(core),
  purpose: 'Unmodified strategy and private helpers; never the authoritative game engine.'
}, null, 2) + '\n');
console.log('Imported pinned 陪练 core: ' + hash(core));
