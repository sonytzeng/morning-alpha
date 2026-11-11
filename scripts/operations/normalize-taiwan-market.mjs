#!/usr/bin/env node
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeTaiwanMarketFacts,addTaiwanMonthlyRevenueCapture} from '../../research/taiwan-market-facts.mjs';
import {addTaiwanLatestHistoryQuotes,addTaiwanTwseDatedValuation} from '../../research/taiwan-market-postclose.mjs';
import {loadTaiwanResearchHistory} from '../../research/taiwan-market-financial-inputs.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const input=option('--input'),output=option('--output'),monthlyReceipt=option('--monthly-revenue-receipt');
const historyFile=option('--history'),valuationReceipt=option('--valuation-receipt');
if(!input||!output)throw Error('Usage: normalize-taiwan-market.mjs --input acquisition-directory --output output-directory');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const catalog=JSON.parse(await readFile(path.join(root,'research/taiwan-market-sources.json'),'utf8'));
const universe=JSON.parse(await readFile(path.join(input,'normalized/universe.json'),'utf8'));
const latest=new Map();
for(const name of (await readdir(input)).filter(n=>/^acquisition-.*\.json$/.test(n)).sort()){
 const document=JSON.parse(await readFile(path.join(input,name),'utf8'));
 if(document.schema!=='TAIWAN_PUBLIC_ACQUISITION_V1')throw Error('ACQUISITION_SCHEMA');
 for(const receipt of document.receipts){const old=latest.get(receipt.source_id);
  if(!old||Date.parse(receipt.received_at)>Date.parse(old.received_at))latest.set(receipt.source_id,receipt);
 }
}
const captures=[];
for(const receipt of latest.values())if(receipt.state==='CAPTURED')captures.push({receipt,bytes:await readFile(receipt.raw_path)});
const cutoff=new Date().toISOString();
let facts=normalizeTaiwanMarketFacts({universe,catalog,captures,cutoff});
if(monthlyReceipt){const receipt=JSON.parse(await readFile(monthlyReceipt,'utf8'));facts=addTaiwanMonthlyRevenueCapture({facts,receipt,bytes:await readFile(receipt.raw_path),cutoff});}
if(historyFile)facts=addTaiwanLatestHistoryQuotes({facts,history:await loadTaiwanResearchHistory(historyFile),cutoff});
if(valuationReceipt){const receipt=JSON.parse(await readFile(valuationReceipt,'utf8'));facts=addTaiwanTwseDatedValuation({facts,receipt,bytes:await readFile(receipt.raw_path),cutoff});}
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'universe.json'),JSON.stringify(universe,null,2)+'\n');
await writeFile(path.join(output,'facts.json'),JSON.stringify(facts,null,2)+'\n');
const coverage={schema:'TAIWAN_MARKET_FACT_COVERAGE_V1',cutoff,universe_hash:universe.universe_hash,facts_hash:facts.facts_hash,
 securities:universe.total,counts:universe.counts,captured_datasets:facts.captured_dataset_count,expected_datasets:facts.expected_dataset_count,
 failed_sources:[...latest.values()].filter(r=>r.state!=='CAPTURED').map(r=>({source_id:r.source_id,error:r.error})),
 families:Object.fromEntries(['ROSTER','PRICE','REVENUE','INCOME','BALANCE','EPS_AS_REPORTED','VALUATION','ANNOUNCEMENT','ACTION_DAILY','ACTION_ANNOUNCEMENT'].map(f=>[f,
  {securities:facts.securities.filter(s=>s.observations.some(o=>o.family===f&&!o.invalidated)).length,
   observations:facts.securities.reduce((n,s)=>n+s.observations.filter(o=>o.family===f&&!o.invalidated).length,0)}])),
 valid_price_securities:facts.securities.filter(s=>s.observations.some(o=>o.family==='PRICE'&&o.valid_trade&&!o.invalidated)).length,
 rejected_rows:facts.datasets.flatMap(d=>d.rejected.map(r=>({source_id:d.source_id,...r}))),
 data_dates:facts.datasets.map(d=>({source_id:d.source_id,source_dates:d.source_dates,received_at:d.received_at})),
 analysis_executed:false,member_published:false};
await writeFile(path.join(output,'fact-coverage.json'),JSON.stringify(coverage,null,2)+'\n');
console.log(JSON.stringify({...coverage,rejected_rows:coverage.rejected_rows.slice(0,20),data_dates:undefined},null,2));
