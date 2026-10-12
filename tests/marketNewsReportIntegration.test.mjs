import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash,webcrypto} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {retainMarketNews,marketNewsFunnel,sanitizeMarketNewsFunnel} from '../supabase/functions/_shared/market-news-retention.ts';
import {newsAcquisitionObservation} from '../supabase/functions/_shared/market-news-acquisition.ts';
import {filterPremiumNewsEvidence} from '../supabase/functions/_shared/premium-evidence.ts';
import {filterRecentNewsRows} from '../supabase/functions/generate-daily-report-v7/market-freshness.ts';
import {isolatedFunction,declaration} from './helpers/isolatedEdgeLoader.mjs';
const base='fff51d76a8e6c90768772023c37afbb112761a3a';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const now=Date.parse('2026-10-12T07:00:03.956+08:00');
const synthetic=(n,change={})=>({title:`Synthetic NVIDIA earnings guidance rises ${n}`,summary:'Synthetic only',source:'Synthetic fixture',url:`https://fixture.example.invalid/${n}`,
 publishedAt:'2026-10-11T20:00:00Z',isBlacklisted:false,isSelected:true,finalScore:65,taiwanImpactSummary:'影響台灣半導體供應鏈',...change});

test('real saved predicate audit: 188 observations != 2 canonical != 0 accepted; unknown stays unknown',()=>{
 const f=JSON.parse(read('tests/fixtures/market-news-integration-20261012.json'));
 assert.equal(f.raw_observations,188);assert.equal(f.raw_retained,80);assert.equal(f.raw_not_retained,108);
 assert.equal(f.entire_batch_freshness,null);assert.equal(f.canonical_upserted,2);assert.equal(f.canonical_tagged_before_reader,2);
 assert.equal(f.canonical_direct_market_relevance_pass,0);assert.equal(f.report_accepted,0);
 assert(f.canonical_predicates.every(r=>!r.direct_market_anchor&&r.source_valid&&r.url_valid&&r.decision_catalyst));
 assert.equal(f.retained_fresh_predicate_groups.reduce((n,g)=>n+g.count,0),8);
 assert.equal(f.retained_fresh_predicate_groups.filter(g=>g.direct_market_anchor&&g.decision_catalyst).length,0);
 assert(Date.parse(f.canonical_created_at)>Date.parse(f.date+'T07:00:00+08:00'));
 assert(Date.parse(f.canonical_created_at)<Date.parse(f.report_generation_started_at));
});

test('synthetic starvation control: stale high scores cannot evict fresh evidence; no admission relaxation',()=>{
 const rows=[...Array.from({length:80},(_,i)=>synthetic(i,{publishedAt:'2026-10-08T20:00:00Z',finalScore:100,isSelected:false})),synthetic(81)];
 const before=JSON.stringify(rows),old=[...rows].sort((a,b)=>b.finalScore-a.finalScore).slice(0,80);
 assert.equal(old.filter(x=>x.isSelected).length,0);
 const retained=retainMarketNews(rows,now);assert.equal(retained.length,80);assert.equal(retained[0].url,rows[80].url);
 assert.equal(retained.filter(x=>x.isSelected).length,1);assert.equal(JSON.stringify(rows),before);
 const audit=marketNewsFunnel(rows,retained,now);
 assert.equal(audit.freshness_pass,1);assert.equal(audit.freshness_rejected,80);
 assert.equal(audit.report_preflight.quality_pass,1);assert.equal(audit.report_accepted,null);
});

test('bounds, low scores, blacklist, future/malformed timestamps and report-quality rejection remain fail closed',()=>{
 const rows=Array.from({length:25},(_,i)=>synthetic(i));
 assert.equal(retainMarketNews(rows,now).filter(x=>x.isSelected).length,12);
 for(const change of [{isSelected:false,finalScore:59},{isBlacklisted:true},{publishedAt:'invalid'},
  {publishedAt:'2026-10-12T07:01:00+08:00'},{publishedAt:'2026-10-10T07:00:03.955+08:00'}])
  assert.equal(retainMarketNews([synthetic(1,change)],now)[0].isSelected,false);
 const irrelevant=synthetic(1,{title:'Synthetic unrelated business earnings rise'});
 const audit=marketNewsFunnel([irrelevant],retainMarketNews([irrelevant],now),now);
 assert.equal(audit.canonical_requested,1);assert.equal(audit.report_preflight.relevance_pass,0);
 assert.equal(audit.report_preflight.reason_counts.taiwan_market_relevance_unproven,1);
 assert.equal(audit.report_preflight.quality_pass,0);
});

test('counters-only observation sanitizes unknown keys and cannot relabel preflight as Report accepted',()=>{
 const f=marketNewsFunnel([synthetic(1)],retainMarketNews([synthetic(1)],now),now);
 const unsafe={...f,raw:1,report_accepted:999,token:'DO_NOT_PERSIST',title:'DO_NOT_PERSIST',
  report_preflight:{...f.report_preflight,reason_counts:{source_missing:1,DO_NOT_PERSIST:1},payload:'DO_NOT_PERSIST'}};
 const result=newsAcquisitionObservation({ok:true,status:200,payload:{funnel:unsafe,total_raw:1,canonical_upserted_count:1}});
 assert.equal(result.report_accepted,null);assert.equal(result.funnel.report_accepted,null);
 assert(!JSON.stringify(result).includes('DO_NOT_PERSIST'));assert.equal(result.funnel.report_preflight.quality_pass,1);
 assert.equal(sanitizeMarketNewsFunnel({schema_version:'UNREVIEWED'}),null);
 assert.equal(newsAcquisitionObservation({ok:true,status:200,payload:{}}).funnel,null);
 const rejected={ok:true,status:200,payload:{total_raw:1,canonical_upserted_count:0}};
 assert.equal(newsAcquisitionObservation(rejected).classification,'FILTER_REJECTION_BREAKDOWN_NOT_RETAINED');
 assert.equal(newsAcquisitionObservation({...rejected,payload:{...rejected.payload,funnel:f}}).classification,'FILTER_REJECTED');
});

test('audited all-invalid input is not a fetch failure; empty source, transport and write failures stay distinct',()=>{
 const funnel={...marketNewsFunnel([],[],now),raw:3,invalid_record:1,invalid_timestamp:2,duplicates:0};
 const payload={success:false,error:'NO_VALID_NEWS_FETCHED',total_raw:3,after_dedup:0,funnel,provider_failures:[]};
 const rejected=newsAcquisitionObservation({ok:false,status:200,payload});
 assert.equal(rejected.classification,'FILTER_REJECTED');assert.equal(rejected.success,false);
 assert.equal(rejected.funnel.invalid_timestamp,2);assert.equal(rejected.report_accepted,null);
 assert.equal(newsAcquisitionObservation({ok:false,status:401,payload}).classification,'FETCH_FAILED');
 assert.equal(newsAcquisitionObservation({ok:false,status:200,payload:{...payload,funnel:null}}).classification,'FETCH_FAILED');
 assert.equal(newsAcquisitionObservation({ok:false,status:200,payload:{...payload,total_raw:0}}).classification,'SOURCE_EMPTY');
 assert.equal(newsAcquisitionObservation({ok:false,status:200,payload:{...payload,total_raw:0,provider_failures:[{}]}}).classification,'FETCH_FAILED');
 assert.equal(newsAcquisitionObservation({ok:false,status:200,payload:{canonical_complete:false}}).classification,'INTEGRATION_FAILED');
});

test('unchanged actual Report reader: tag, freshness and independent relevance are required',async()=>{
 const source=read('supabase/functions/generate-daily-report-v7/index.ts');
 const clock=class extends Date {static now(){return now;}};
 const fetchNews=isolatedFunction(source,'fetchMarketNews',{Date:clock,HOURS_24:86400000,
  filterRecentNewsRows,safeUnwrap:r=>r,canonicalRecord:v=>v&&typeof v==='object'?v:{},canonicalText:(...v)=>v.find(x=>typeof x==='string'&&x.trim())||''});
 const raw=synthetic(1),event={id:'synthetic',title:raw.title,source_name:raw.source,source_url:raw.url,
  published_at:raw.publishedAt,created_at:new Date(now-1000).toISOString(),fingerprint:'synthetic',event_type:'semiconductor',
  raw_payload:{taiwan_impact_summary:raw.taiwanImpactSummary}};
 const run=async(events,tags)=>{const sdk={from:table=>{const q=new Proxy({}, {get:(_,key)=>key==='then'?fn=>Promise.resolve(fn({data:table==='news_events'?events:tags,error:null})):()=>q});return q;}};return fetchNews(sdk,()=>{});};
 const tags=[{news_key:'synthetic',related_sectors:['半導體'],related_symbols:[],event_type:'semiconductor'}];
 const valid=await run([event],tags);assert.equal(filterPremiumNewsEvidence(valid.newsData,now).verified.length,1);
 assert.equal((await run([event],[])).newsData.length,0);
 assert.equal((await run([{...event,published_at:'2026-10-08T00:00:00Z'}],tags)).newsData.length,0);
 const unrelated=await run([{...event,title:'Synthetic unrelated business earnings rise'}],tags);
 assert.equal(unrelated.newsData.length,1);assert.equal(filterPremiumNewsEvidence(unrelated.newsData,now).verified.length,0);
});

test('real deployed policies, Report, LINE, Atomic and recommendation sources remain byte-identical',()=>{
 const protectedPaths=['supabase/functions/generate-daily-report-v7/index.ts','supabase/functions/_shared/premium-evidence.ts',
  'supabase/functions/_shared/market-report-gate.ts','supabase/functions/line-daily-push/index.ts',
  'supabase/functions/fetch-market-data-v10/index.ts','supabase/functions/recommendation-stock-evidence-v1/index.ts',
  'supabase/functions/_shared/news-catalyst-scoring.mjs','supabase/functions/daily-delivery-orchestrator/index.ts'];
 for(const p of protectedPaths)assert.equal(read(p),execFileSync('git',['show',base+':'+p],{encoding:'utf8',maxBuffer:8*1024*1024}),p);
 const p='supabase/functions/fetch-global-market-news/index.ts',before=execFileSync('git',['show',base+':'+p],{encoding:'utf8'});
 for(const name of ['scoreNewsItem','detectTaiwanMapping','fetchGNews','fetchNewsAPI','fetchFinnhubNews'])
  assert.equal(declaration(read(p),name),declaration(before,name),name);
});

test('actual producer handler retains full sequential counters through auth, provider parser, caps and writes (synthetic, network denied)',async()=>{
 const title='Synthetic NVIDIA TSMC semiconductor AI server earnings guidance revenue demand orders capacity rise';
 const item=(id,at)=>({id,headline:title+' '+id,summary:'Synthetic semiconductor revenue earnings guidance demand orders capacity expansion',
  url:'https://fixture.example.invalid/'+id,datetime:Date.parse(at)/1000,source:'Synthetic fixture'});
 const fresh=item(81,'2026-10-11T20:00:00Z');
 const feed=[...Array.from({length:80},(_,i)=>item(i+1,'2026-10-08T20:00:00Z')),fresh,
  {...fresh,id:82},item(83,'2026-10-13T20:00:00Z'),{...item(84,'2026-10-11T20:00:00Z'),headline:''}];
 const cache=new Map(),writes=[];let handler,calls=0;
 const clock=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const sdk={from:table=>({upsert:async records=>{assert(['market_news','news_events','news_event_tags'].includes(table));writes.push({table,records});return {error:null};}})};
 function load(file){
  if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);
  if(file.endsWith('.json')){module.exports={default:JSON.parse(readFileSync(file,'utf8'))};return module.exports;}
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:specifier=>specifier.startsWith('.')?load(resolve(dirname(file),specifier)):
   specifier==='https://esm.sh/@supabase/supabase-js@2.39.0'?{createClient:()=>sdk}:(()=>{throw Error('unexpected import');})(),
   Date:clock,URL,Request,Response,Headers,TextEncoder,crypto:webcrypto,AbortController,setTimeout,clearTimeout,
   console:{log(){},warn(){},error(){}},Deno:{serve:fn=>handler=fn,env:{get:key=>({CRON_SECRET:'ISOLATED_ONLY',
    SUPABASE_URL:'http://127.0.0.1',SUPABASE_SERVICE_ROLE_KEY:'ISOLATED_ONLY',FINNHUB_API_KEY:'ISOLATED_ONLY'})[key]}},
   fetch:async url=>{assert.equal(new URL(url).hostname,'finnhub.io');calls++;return new Response(JSON.stringify(feed));}
  });return module.exports;
 }
 load(resolve('supabase/functions/fetch-global-market-news/index.ts'));
 const request=secret=>new Request('http://127.0.0.1/isolated-news',{method:'POST',headers:{'x-cron-secret':secret}});
 assert.equal((await handler(request('WRONG'))).status,401);assert.equal(calls,0);assert.equal(writes.length,0);
 const response=await handler(request('ISOLATED_ONLY')),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.success,true);assert.equal(calls,3);
 assert.equal(body.total_raw,84);assert.equal(body.after_dedup,81);
 assert.equal(body.funnel.invalid_record,1);assert.equal(body.funnel.invalid_timestamp,1);assert.equal(body.funnel.duplicates,1);
 assert.equal(body.funnel.freshness_rejected,80);assert.equal(body.funnel.freshness_pass,1);
 assert.equal(body.canonical_upserted_count,1);assert.equal(body.funnel.report_preflight.quality_pass,1);
 assert.equal(body.funnel.report_accepted,null);assert.equal(writes.filter(w=>w.table==='market_news').flatMap(w=>w.records).length,80);
 const observed=newsAcquisitionObservation({ok:true,status:response.status,payload:body});
 assert.equal(observed.funnel.raw,84);assert.equal(observed.funnel.quality_pass,undefined);
 assert.equal(observed.funnel.report_preflight.quality_pass,1);assert(!JSON.stringify(observed).includes(title));
 assert.equal(observed.raw_upserted_count,80);assert.equal(observed.canonical_requested_count,1);
 assert.equal(observed.catalyst_tag_upserted_count,1);
});
