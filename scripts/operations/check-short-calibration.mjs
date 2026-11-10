/** Offline method-review prerequisite. Reads explicit retained inputs only. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assessDailyAiShortCalibration,shortCalibrationMethodReviewRequirement} from '../../research/daily-ai-short-calibration.ts';
const flags=new Map(),argv=process.argv.slice(2);
if(argv.length!==4)throw Error('Usage: node --experimental-strip-types scripts/operations/check-short-calibration.mjs --input INPUT.json --output NEW_RECEIPT.json');
for(let i=0;i<argv.length;i+=2){if(!['--input','--output'].includes(argv[i])||flags.has(argv[i])||!argv[i+1])throw Error('SHORT_CALIBRATION_CLI_ARGUMENTS');flags.set(argv[i],resolve(argv[i+1]));}
const text=await readFile(flags.get('--input'),'utf8');if(Buffer.byteLength(text)>16_000_000)throw Error('SHORT_CALIBRATION_CLI_INPUT_SIZE');
const input=JSON.parse(text),qualification=await assessDailyAiShortCalibration(input),method_review=await shortCalibrationMethodReviewRequirement(qualification,input.method);
const receipt={schema:'DAILY_AI_SHORT_CALIBRATION_REVIEW_RECEIPT_V1',qualification,method_review,new_data_acquired:false,production_writes:0,member_published:false};
await writeFile(flags.get('--output'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output:flags.get('--output'),state:qualification.state,history:qualification.history.unique_sessions,
 capacity:qualification.history.capacity,issues:qualification.issues,qualification_hash:qualification.qualification_hash,metrics:qualification.metrics}));
// A saved diagnostic is not a successful qualification gate.
process.exitCode=qualification.state==='READY_FOR_EXECUTION'?0:2;
