#!/usr/bin/env node
import process from 'node:process';
import console from 'node:console';
/** Refresh local, portable daily inputs. This command has no database,
 * credential lookup, review, deployment or member-publication operation. */
import {pathToFileURL} from 'node:url';
import {refreshTaiwanMarketInputs,loadTaiwanDailyInputManifest} from '../../research/taiwan-market-input-cache.mjs';

export async function runTaiwanInputRefreshCli(args,dependencies={}){
 const flags=new Map();let offline=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--offline'){if(offline)throw Error('TAIWAN_INPUT_CACHE_ARGUMENTS');offline=true;continue;}
  if(!['--cache','--universe','--slot','--seed','--acquisition-dir','--read-manifest'].includes(args[i])||!args[i+1]||flags.has(args[i]))throw Error('TAIWAN_INPUT_CACHE_ARGUMENTS');
  flags.set(args[i],args[++i]);
 }
 if(flags.has('--read-manifest')){
  if(flags.size!==1||offline)throw Error('TAIWAN_INPUT_CACHE_ARGUMENTS');return loadTaiwanDailyInputManifest(flags.get('--read-manifest'));
 }
 if(!flags.has('--cache')||!flags.has('--universe')||!flags.has('--slot'))throw Error('TAIWAN_INPUT_CACHE_ARGUMENTS');
 return refreshTaiwanMarketInputs({cacheDir:flags.get('--cache'),universeFile:flags.get('--universe'),slot:flags.get('--slot'),
  seedManifestFile:flags.get('--seed'),acquisitionDir:flags.get('--acquisition-dir'),allowNetwork:!offline},dependencies);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 console.log(JSON.stringify(await runTaiwanInputRefreshCli(process.argv.slice(2))));
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}}
