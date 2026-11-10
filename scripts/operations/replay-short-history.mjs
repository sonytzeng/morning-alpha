#!/usr/bin/env node
/** Explicit local inputs only. Does not fetch providers or register reviews. */
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {bindRetainedShortHistory} from '../../research/daily-ai-short-retained-history.ts';
import {assessDailyAiShortCalibration} from '../../research/daily-ai-short-calibration.ts';
import {replayDailyAiShortMethod} from '../../research/daily-ai-short-replay.ts';
import {auditHistory} from '../../research/entry-history.ts';
import {retrospectiveShapes} from '../../research/entry-official-history.ts';
import {compareTime,snapshotHash} from '../../src/features/vnext/contracts.ts';

export async function replayRetainedShortHistory({snapshot_text,parameters}){
 const p=structuredClone(parameters);
 if(p.schema!=='SHORT_RETAINED_REPLAY_PARAMETERS_V1'||!Array.isArray(p.additional_packets)||p.protocol!==null&&typeof p.protocol!=='object')throw Error('SHORT_REPLAY_PARAMETERS');
 const binding=await bindRetainedShortHistory({snapshot_text,symbol:p.symbol,as_of:p.as_of});
 const packets=[...binding.packets,...p.additional_packets],args={symbol:p.symbol,packets,method:p.method,holding_sessions:p.holding_sessions,
  as_of:p.as_of,provenance:'REAL_RETAINED',corporate_action_policy:p.corporate_action_policy,cost_model:p.cost_model};
 const qualification=await assessDailyAiShortCalibration({...args,protocol:p.protocol}),replay=await replayDailyAiShortMethod(args);
 const byDate=new Map();
 for(const e of packets.flatMap(p=>p.evidence).filter(e=>e.kind==='PRICE')){
  const b=JSON.parse(e.content),old=byDate.get(b.date);if(!old||compareTime(e.available_at,old.available_at)<0)byDate.set(b.date,{...b,source_ref:e.source,available_at:e.available_at});
 }
 const bars=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
 const actionDates=[...new Set([...binding.action_inventories.flatMap(r=>r.events.map(e=>e.effective_date??e.date)).filter(d=>typeof d==='string'),...qualification.excluded_action_dates])];
 const body={schema:'RETAINED_SHORT_METHOD_EXPERIMENT_V1',parameters:p,parameters_hash:await snapshotHash(p),binding,qualification,replay,
  calendar_coverage:[20,60,120].map(n=>auditHistory(bars,p.history_business_date,p.as_of,n)),
  shape_diagnostic:retrospectiveShapes(bars,actionDates,qualification.action_coverage.length>0),
  provider_requests:0,production_writes:0,methodology_approved:false,member_published:false};
 return {...body,experiment_hash:await snapshotHash(body)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2),flags=new Map();for(let i=0;i<args.length;i+=2){if(!['--snapshot','--parameters','--output'].includes(args[i])||!args[i+1]||flags.has(args[i]))throw Error('SHORT_REPLAY_ARGUMENTS');flags.set(args[i],args[i+1]);}
  if(flags.size!==3)throw Error('SHORT_REPLAY_ARGUMENTS');
  const result=await replayRetainedShortHistory({snapshot_text:await readFile(flags.get('--snapshot'),'utf8'),parameters:JSON.parse(await readFile(flags.get('--parameters'),'utf8'))});
  await writeFile(flags.get('--output'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({output:flags.get('--output'),history:result.qualification.history.unique_sessions,readiness:result.qualification.state,
   replay:result.replay.counts,experiment_hash:result.experiment_hash,member_published:false}));
  if(result.qualification.state!=='READY_FOR_EXECUTION')process.exitCode=2;
 }catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
