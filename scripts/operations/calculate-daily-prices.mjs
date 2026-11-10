/** Local, zero-network calculation entry. Input is the exact saved result of
 * get_daily_ai_price_work_v1. This CLI cannot write to a database or approve. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareDailyAiPriceWork,prepareDailyAiProfileInputs,prepareDailyAiLongReviewWork} from '../../research/daily-ai-price-work.mjs';
import {validObservationTime} from '../../src/features/vnext/contracts.ts';

export async function calculateSavedDailyPrices(argv){
 const args={};
 for(let i=0;i<argv.length;i+=2){
  const key=argv[i],value=argv[i+1];
  if(!['--input','--output','--replay-at'].includes(key)||!value||value.startsWith('--')||Object.hasOwn(args,key))throw Error('PRICE_CLI_ARGUMENTS');
  args[key]=value;
 }
 if(!args['--input']||!args['--output'])throw Error('PRICE_CLI_ARGUMENTS');
 const source=resolve(args['--input']),target=resolve(args['--output']);
 if(source===target)throw Error('PRICE_CLI_OUTPUT_COLLISION');
 if(args['--replay-at']&&!validObservationTime(args['--replay-at']))throw Error('PRICE_CLI_REPLAY_TIME');
 const bytes=await readFile(source);if(bytes.length>64_000_000)throw Error('PRICE_CLI_INPUT_SIZE');
 const executionAt=new Date().toISOString(),now=args['--replay-at']?Date.parse(args['--replay-at']):Date.now();
 const work=JSON.parse(bytes.toString('utf8'));
 const profilePreparation=await prepareDailyAiProfileInputs(work,{now});
 // Prepared profile bindings are concrete registration requests, not database
 // registrations. Keep work.inputs untouched: only its already registered
 // inputs can enter the independently prepared price/audit stage request.
 const result=await prepareDailyAiPriceWork(work,{now});
 const longPreparation=await prepareDailyAiLongReviewWork(work,{now});
 const output={schema:'DAILY_AI_SAVED_PRICE_CALCULATION_V1',executed_at:executionAt,
  evaluated_at:new Date(now).toISOString(),historical_replay:Boolean(args['--replay-at']),
  production_writes:0,member_published:false,...result,
  profile_preparation:profilePreparation,input_registration_request:profilePreparation.registration_request,
  long_review_preparation:longPreparation};
 // Never overwrite an earlier result or its original input.
 await writeFile(target,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
 return {output:target,historical_replay:output.historical_replay,...result.summary,
  profile_counts:profilePreparation.counts,input_registration_required:profilePreparation.counts.inputs_prepared>0,
  production_writes:0};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 calculateSavedDailyPrices(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value)))
  .catch(error=>{console.error(error instanceof Error?error.message:'PRICE_CLI_FAILED');process.exitCode=1;});
}
