/** Durable loopback candidate adapter, never a Production database writer. */
import {mkdirSync,realpathSync,lstatSync,readdirSync,readFileSync,writeFileSync,rmdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {verifyDailyLock,CandidateFailure} from '../../src/features/vnext/dailyIntelligence.ts';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';
export function dailyStore(directory){
 const path=resolve(directory);
 if(!/^\/(?:private\/)?tmp\/ma-daily-intelligence-[a-zA-Z0-9_-]+$/.test(path))throw Error('ISOLATED_STORE_REQUIRED');
 mkdirSync(path,{mode:0o700,recursive:true});
 if(lstatSync(path).isSymbolicLink()||(lstatSync(path).mode&0o077)||!realpathSync(path).startsWith('/private/tmp/')&&!realpathSync(path).startsWith('/tmp/'))throw Error('PRIVATE_STORE_REQUIRED');
 const root=realpathSync(path),dir=key=>{if(!/^[a-f0-9]{64}$/.test(key))throw Error('KEY_INVALID');const p=resolve(root,key);mkdirSync(p,{mode:0o700});return p;};
 const existing=key=>{if(!/^[a-f0-9]{64}$/.test(key))throw Error('KEY_INVALID');return resolve(root,key);};
 const read=p=>{if(!lstatSync(p).isFile()||lstatSync(p).isSymbolicLink())throw Error('REGULAR_FILE_REQUIRED');return JSON.parse(readFileSync(p,'utf8'));};
 const latest=key=>{let names;try{names=readdirSync(existing(key));}catch(e){if(e.code==='ENOENT')return null;throw e;}
  const name=names.filter(n=>/^checkpoint-\d{6}\.json$/.test(n)).sort().at(-1);return name?{name,state:read(resolve(existing(key),name))}:null;};
 return {
  async exclusive(key,work){let p;try{p=dir(key);}catch(e){if(e.code!=='EEXIST')throw e;p=existing(key);}
   const lease=resolve(p,'active');try{mkdirSync(lease,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw new CandidateFailure('RUN_BUSY');throw e;}
   try{return await work();}finally{rmdirSync(lease);}
  },
  async load(key){const row=latest(key);if(!row)return null;const {checkpoint_hash,...envelope}=row.state;
   if(checkpoint_hash!==await snapshotHash(envelope))throw Error('CHECKPOINT_INTEGRITY');
   if(envelope.state.completed.includes('PREDICTION_LOCK')&&!isDeepStrictEqual(read(resolve(existing(key),'prediction-batch.json')),envelope.state.locks))throw Error('PREDICTION_STORAGE_INTEGRITY');
   return envelope.state;},
  async save(state){const prev=latest(state.key);if(prev&&prev.state.state.request_hash!==state.request_hash)throw Error('IMMUTABLE_REQUEST');
   const n=prev?Number(prev.name.slice(11,17))+1:1;if(n>1000)throw Error('CHECKPOINT_LIMIT');
   const envelope={state,previous_hash:prev?.state.checkpoint_hash??null};
   writeFileSync(resolve(existing(state.key),`checkpoint-${String(n).padStart(6,'0')}.json`),JSON.stringify({...envelope,checkpoint_hash:await snapshotHash(envelope)}),{flag:'wx',mode:0o600});
  },
  async appendOutcome(key,result){
   if(!/^[a-f0-9]{64}$/.test(key)||!result||typeof result.prediction_id!=='string')throw Error('OUTCOME_KEY_INVALID');
   const run=result.prediction_id.split(':')[0],p=resolve(existing(run),'outcome-'+key+'.json');
   const lock=read(resolve(existing(run),'prediction-batch.json')).find(l=>l.id===result.prediction_id);
   if(!lock||!await verifyDailyLock(lock)||lock.lock_hash!==result.prediction_hash||!lock.target_sessions.includes(result.horizon)
    ||result.mode!==lock.mode||result.provenance!==lock.provenance||result.performance_eligible!==false
    ||key!==await snapshotHash({prediction:lock.lock_hash,horizon:result.horizon,source:result.outcome_source_hash}))throw Error('OUTCOME_SCOPE_INVALID');
   const envelope={result,hash:await snapshotHash(result)};
   try{writeFileSync(p,JSON.stringify(envelope),{flag:'wx',mode:0o600});}
   catch(e){if(e.code!=='EEXIST')throw e;if(!isDeepStrictEqual(read(p),envelope))throw Error('IMMUTABLE_OUTCOME_CONFLICT');}
  },
  async lock(rows){if(rows.length!==216||new Set(rows.map(x=>x.id)).size!==216)throw Error('LOCK_COUNT');
   for(const row of rows)if(!await verifyDailyLock(row))throw Error('LOCK_INVALID');
   const key=rows[0].id.split(':')[0];if(rows.some(r=>r.id.split(':')[0]!==key))throw Error('LOCK_SCOPE');
   const p=resolve(existing(key),'prediction-batch.json');
   try{writeFileSync(p,JSON.stringify(rows),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;if(!isDeepStrictEqual(read(p),rows))throw Error('IMMUTABLE_PREDICTION_CONFLICT');}
  },
 };
}
