import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export async function publishRefresh({branch=process.env.GITHUB_REF_NAME,run=(args)=>spawnSync('git',args,{stdio:'inherit'}).status,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=6}={}) {
 if(!branch || run(['check-ref-format','--branch',branch])!==0)throw Error('Invalid publication branch');
 for(let attempt=1;attempt<=attempts;attempt++) {
  // Never conceal a real rebase conflict or overwrite another writer's data.
  if(run(['pull','origin',branch,'--rebase'])!==0)throw Error('Cannot synchronize refresh commit; manual conflict review required');
  if(run(['push','origin',`HEAD:${branch}`])===0)return;
  if(attempt<attempts)await wait(1000*attempt);
 }
 throw Error('Publication failed after six synchronization attempts');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)publishRefresh().catch(error=>{console.error(error.message);process.exitCode=1;});
