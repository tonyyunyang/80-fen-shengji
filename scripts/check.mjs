import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result;
}
let count = 0;
for (const directory of ['src', 'server', 'public', 'scripts', 'test', 'cloudflare']) {
  for (const file of await files(root + '/' + directory)) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (check.status) { console.error(check.stderr); process.exit(1); }
    count++;
  }
}
const provenance = JSON.parse(await readFile(root + '/vendor/peilian/provenance.json', 'utf8'));
const hash = createHash('sha256').update(await readFile(root + '/vendor/peilian/reference-core.cjs')).digest('hex');
if (hash !== provenance.coreSha256) throw new Error('Pinned 陪练 changed: review the vendor diff before proceeding');
console.log('Syntax checked ' + count + ' modules; pinned 陪练 checksum verified.');

const html=(await files(root+'/public')).filter(file=>file.endsWith('.html'));
if(html.length!==1||html[0]!==root+'/public/index.html')throw new Error('public/index.html must be the only runtime HTML entry.');
await import('./check-docs.mjs');
