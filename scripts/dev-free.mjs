import { readFile,writeFile,mkdir,open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import './build-worker-assets.mjs';

const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'output/free-local');
await mkdir(dir,{recursive:true});
const config=JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));
config.main=resolve(root,config.main);config.assets.directory=resolve(root,config.assets.directory);
delete config.routes;delete config.build;
config.vars.SPONSORED_ENABLED='false';config.vars.SPONSOR_PROFILES='[]';
config.dev={ip:'127.0.0.1'};
await writeFile(resolve(dir,'wrangler.jsonc'),JSON.stringify(config,null,2)+'\n');
try{
  const file=await open(resolve(dir,'.dev.vars'),'wx',0o600);
  await file.writeFile('EIGHTY_GATEWAY_SECRET='+randomBytes(32).toString('hex')+'\n');await file.close();
}catch(error){if(error.code!=='EEXIST')throw error;}
const args=process.argv.slice(2),at=args.indexOf('--port'),port=at>=0?args[at+1]:'8231';
if(!/^\d+$/.test(port)||Number(port)<1024||Number(port)>65535)throw new Error('Choose a valid local port');
const child=spawn(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--config',resolve(dir,'wrangler.jsonc'),'--port',port,'--inspector-port','0'],{
  cwd:root,env:{PATH:process.env.PATH,WRANGLER_SEND_METRICS:'false'},stdio:'inherit',
});
for(const name of ['SIGINT','SIGTERM'])process.on(name,()=>child.kill(name));
child.on('exit',code=>process.exit(code||0));
