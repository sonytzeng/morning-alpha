// Local compiler only. Never calls a provider, database or publication API.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {buildDailyAiSeed} from './daily-ai-seed.ts';

export {buildDailyAiSeed,canonical,snapshotHash} from './daily-ai-seed.ts';
function parseArguments(args){
 const known=new Set(['--retained','--cutoff','--output','--supplements']),options={};
 for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];
  if(!known.has(key)||!value||value.startsWith('--')||Object.hasOwn(options,key))throw Error('AI_SEED_ARGUMENTS');options[key]=value;
 }
 if(!options['--retained']||!options['--cutoff']||!options['--output'])throw Error('AI_SEED_ARGUMENTS');
 return options;
}
async function cli(){
 const args=parseArguments(process.argv.slice(2)),retainedPath=resolve(args['--retained']),outputPath=resolve(args['--output']);
 const supplementalPath=args['--supplements']?resolve(args['--supplements']):null,metadataPath=outputPath+'.metadata.json';
 if([outputPath,metadataPath].some(p=>p===retainedPath||p===supplementalPath))throw Error('AI_SEED_OUTPUT_COLLISION');
 const retainedBytes=readFileSync(retainedPath),retained=JSON.parse(retainedBytes.toString('utf8'));
 const supplementalBytes=supplementalPath?readFileSync(supplementalPath):null;
 const supplement=supplementalBytes?JSON.parse(supplementalBytes.toString('utf8')):{news:[],market:[]};
 if(!Array.isArray(retained.inputs)||!Array.isArray(supplement.news)||!Array.isArray(supplement.market))throw Error('AI_SEED_INPUT_FORMAT');
 const seed=await buildDailyAiSeed({inputs:retained.inputs,cutoff:args['--cutoff'],news:supplement.news,market:supplement.market});
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const metadata={...seed.metadata,retained_input_sha256:hash(retainedBytes),supplement_input_sha256:supplementalBytes?hash(supplementalBytes):null};
 writeFileSync(outputPath,seed.payload_text);writeFileSync(metadataPath,JSON.stringify(metadata,null,2)+'\n');
 console.log(JSON.stringify({output:outputPath,metadata:metadataPath,...metadata}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 cli().catch(error=>{console.error(error instanceof Error?error.message:'AI_SEED_FAILED');process.exitCode=1;});
}
