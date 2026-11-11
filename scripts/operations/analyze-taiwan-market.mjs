#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import {planTaiwanMarketAnalysis,marketSnapshotHash} from '../../research/taiwan-market-universe.mjs';
import {runTaiwanMarketResearch} from '../../research/taiwan-market-research.mjs';
import {loadTaiwanFinancialHistory,loadTaiwanResearchHistory} from '../../research/taiwan-market-financial-inputs.mjs';
import {buildTaiwanMarketActionCoverage} from '../../research/taiwan-market-actions.mjs';
const args=process.argv.slice(2),option=n=>{const i=args.indexOf(n);return i<0?null:args[i+1];};
const input=option('--input'),output=option('--output'),historyPath=option('--history'),financialPath=option('--financial-history');
const actionsPath=option('--actions-source-manifest');
if(!input||!output)throw Error('Usage: analyze-taiwan-market.mjs --input normalized-directory --output new-run-directory [--history checkpoint-manifest.json] [--financial-history normalized-document.json]');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const universe=await json(path.join(input,'universe.json')),facts=await json(path.join(input,'facts.json'));
let history=null,financial_history=null;
if(historyPath)history=await loadTaiwanResearchHistory(historyPath);
if(financialPath)financial_history=await loadTaiwanFinancialHistory(financialPath);
const cutoff=new Date().toISOString(),business_date=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10);
const plan=planTaiwanMarketAnalysis({universe,business_date,cutoff,shard_size:64});
let corporate_actions=null;
if(actionsPath){const source=await json(actionsPath);if(source.schema!=='TAIWAN_ACTION_ORIGINAL_CAPTURE_SET_V1')throw Error('ACTION_SOURCE_MANIFEST');
 const captures=[];for(const c of source.captures)captures.push({receipt:c.receipt,bytes:await readFile(c.raw_path)});
 corporate_actions=buildTaiwanMarketActionCoverage({universe,captures,from:'2025-08-15',through:business_date,cutoff});}
const run=runTaiwanMarketResearch({universe,plan,facts,history,financial_history,corporate_actions});
await mkdir(path.join(output,'shards'),{recursive:true});
await writeFile(path.join(output,'work-plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
const manifest=[];
for(const shard of run.shards){const name=`shard-${String(manifest.length).padStart(3,'0')}.json`,file=path.join(output,'shards',name);
 await writeFile(file,JSON.stringify(shard)+'\n',{flag:'wx'});manifest.push({shard_id:shard.shard_id,stocks:shard.stocks.length,cards:shard.cards.length,file:path.resolve(file),sha256:marketSnapshotHash(shard)});}
await writeFile(path.join(output,'price-research.json'),JSON.stringify(run.price_research,null,2)+'\n',{flag:'wx'});
await writeFile(path.join(output,'price-input-pool.json'),JSON.stringify(run.price_input_pool,null,2)+'\n',{flag:'wx'});
await writeFile(path.join(output,'price-input-bindings.json'),JSON.stringify(run.price_input_bindings,null,2)+'\n',{flag:'wx'});
await writeFile(path.join(output,'diagnostics.json'),JSON.stringify(run.diagnostics,null,2)+'\n',{flag:'wx'});
await writeFile(path.join(output,'acquisition-queue.json'),JSON.stringify(run.acquisition_queue,null,2)+'\n',{flag:'wx'});
const {shards,price_research,price_input_pool,price_input_bindings,diagnostics,acquisition_queue,...summary}=run;void shards;void price_research;void price_input_pool;void price_input_bindings;void diagnostics;void acquisition_queue;
const peerPriceCount=run.price_research.filter(p=>p.medium.state==='CALCULATED_RESEARCH_ONLY').length;
const longPriceCount=run.price_research.filter(p=>p.long.state==='CALCULATED_RESEARCH_ONLY').length;
await writeFile(path.join(output,'manifest.json'),JSON.stringify({...summary,shards:manifest,peer_price_research_count:peerPriceCount,
 long_price_research_count:longPriceCount,history_manifest:historyPath?path.resolve(historyPath):null,financial_history_path:financialPath?path.resolve(financialPath):null},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output:path.resolve(output),cutoff,run_hash:run.run_hash,coverage:run.coverage,peer_price_research_count:peerPriceCount,
 long_price_research_count:longPriceCount,research_only:true,member_published:false},null,2));
