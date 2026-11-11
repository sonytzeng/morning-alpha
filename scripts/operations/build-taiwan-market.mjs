#!/usr/bin/env node
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {normalizeOfficialCompanyCapture,buildTaiwanMarketUniverse,planTaiwanMarketAnalysis,TAIWAN_COMPANY_SOURCES} from '../../research/taiwan-market-universe.mjs';

const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const input=get('--input'),output=get('--output');
if(!input||!output||args.some((v,i)=>i%2===0&&!['--input','--output','--formed-at'].includes(v)))throw Error('Usage: --input ACQUISITION_DIRECTORY --output DIRECTORY [--formed-at ISO_TIME]');
const captures=[];
for(const name of (await readdir(input)).filter(n=>n.startsWith('acquisition-')&&n.endsWith('.json'))){
 const doc=JSON.parse(await readFile(join(input,name),'utf8'));
 if(doc.schema!=='TAIWAN_PUBLIC_ACQUISITION_V1')throw Error('ACQUISITION_SCHEMA');
 captures.push(...doc.receipts.filter(r=>Object.hasOwn(TAIWAN_COMPANY_SOURCES,r.source_id)&&r.state==='CAPTURED'));
}
const rosters=[];
for(const id of Object.keys(TAIWAN_COMPANY_SOURCES)){
 const latest=captures.filter(r=>r.source_id===id).sort((a,b)=>Date.parse(a.received_at)-Date.parse(b.received_at)).at(-1);
 if(!latest)throw Error('OFFICIAL_MARKET_ROSTER_REQUIRED: '+id);
 rosters.push(normalizeOfficialCompanyCapture({receipt:latest,bytes:await readFile(latest.raw_path)}));
}
const formed_at=get('--formed-at')??new Date().toISOString(),universe=buildTaiwanMarketUniverse({rosters,formed_at});
const business_date=new Date(Date.parse(formed_at)+8*3600_000).toISOString().slice(0,10);
const plan=planTaiwanMarketAnalysis({universe,business_date,cutoff:formed_at});
await mkdir(output,{recursive:true});
for(const [name,value]of [['universe.json',universe],['work-plan.json',plan]])await writeFile(resolve(output,name),JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify({universe_hash:universe.universe_hash,counts:universe.counts,total:universe.total,
 expected_cards:plan.expected_cards,shards:plan.shards.length,source_dates:universe.sources.map(s=>({market:s.market,source_as_of:s.source_as_of,received_at:s.received_at})),
 instruments:Object.fromEntries([...new Set(universe.companies.map(c=>c.instrument_kind))].map(k=>[k,universe.companies.filter(c=>c.instrument_kind===k).length])),
 cross_market_conflicts:universe.cross_market_conflicts,coverage_complete:universe.coverage_complete,analysis_executed:false,output:resolve(output)},null,2));
