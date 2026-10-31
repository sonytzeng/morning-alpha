import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {loadOrIntakeDailyStockAiBatch} from '../supabase/functions/daily-stock-analysis-v1/intake.ts';

const projection='DAILY_AI_RETAINED_INPUT_PROJECTION_V1';
const baseGaps=['RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED','NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE',
 'NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS','NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES','MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE'];
const taipeiDay=time=>new Date(Date.parse(time)+8*3600000).toISOString().slice(0,10);
const hashText=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const nextMicro=time=>time.replace(/\.(\d{6})Z$/,(_,fraction)=>'.'+String(Number(fraction)+1).padStart(6,'0')+'Z');
async function fixture(){
 const cutoff=new Date(Date.now()-3600000).toISOString().replace(/(\.\d{3})Z$/,'$1123Z');
 const sourceCutoff=new Date(Date.parse(cutoff)-2*3600000).toISOString(),observed=new Date(Date.parse(sourceCutoff)-60000).toISOString();
 const through=new Date(Date.parse(cutoff)-2*86400000).toISOString().slice(0,10),privateIssueKey='8'.repeat(64);
 const trace=id=>({id,source:'https://www.twse.com.tw/',published_at:null,first_seen_at:observed,available_at:observed,
  as_of:through+'T05:30:00Z',evidence_hash:'a'.repeat(64)});
 const inputs=Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司'+i,cutoff:sourceCutoff,through,next_session:'2027-01-01',v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},
  expected_sessions:[through],facts:[{...trace('eps-ytd'),kind:'EPS_BASIC_CONTEXT',period:'2026-Q3',basis:'AS_REPORTED_YTD',values:{eps:8}}],
  bars:[{...trace('bar'),date:through,open:10,high:12,low:9,close:11,volume:1000,amount:11000,session_scope:'TEST'}]}));
 const publication=new Date(Date.parse(cutoff)-10*60000).toISOString(),ingested=new Date(Date.parse(cutoff)-5*60000).toISOString();
 const news=await Promise.all(['1000',null].map(async(symbol,i)=>{
  const content=JSON.stringify({coverage:'HEADLINE_AND_PROVIDER_EXCERPT',title:symbol?'1000 測試公司0 的來源標題':'來源全球市場標題',
   provider_excerpt:'測試供應商摘要，並非全文或 AI 生成摘要。',source_name:'測試新聞社',provider:'test-provider',first_ingested_at:ingested,original_fingerprint:String(i+1).repeat(64)});
  return {id:'NEWS:11111111-1111-4111-8111-11111111111'+i+':'+(symbol??'GLOBAL'),symbol,kind:'NEWS',source:'https://news.example.invalid/item/'+i,
   published_at:publication,time_basis:'PUBLISHED',available_at:cutoff,first_seen_at:cutoff,as_of:cutoff,content,evidence_hash:await hashText(content)};
 }));
 return {privateIssueKey,observed,handoff:{schema:'DAILY_AI_SOURCE_HANDOFF_V1',projection,handoff_id:'c'.repeat(64),source_run_id:'11111111-1111-4111-8111-111111111111',source_revision:'d'.repeat(64),
  business_date:taipeiDay(cutoff),source_business_date:taipeiDay(sourceCutoff),source_cutoff:sourceCutoff,cutoff,inputs,news,market:[],
  source_issues:[{kind:'FINANCIAL_YTD',key:privateIssueKey,reason:'FINANCIAL_RESPONSE_PERIOD_UNPROVEN'}],intake_gaps:baseGaps.slice(),member_published:false}};
}

test('real Edge entrypoint compiles only a retained receipt with known NEWS and original source identity before bounded analysis',async()=>{
 const original=await fixture(),cutoff=original.handoff.cutoff,internal='test-only-internal-secret-0123456789',oldFetch=globalThis.fetch,oldDeno=globalThis.Deno;
 let worker,handoff=structuredClone(original.handoff),failure=null,stored=null,providerCalls=0,storedBody;
 const calls=[];
 try{
  globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-service-role',CRON_SECRET:internal,OPENAI_API_KEY:'test-only-provider-key'})[name]},serve:handler=>{worker=handler;}};
  globalThis.fetch=async(url,init)=>{
   const parsed=new URL(String(url)),name=parsed.pathname.split('/').at(-1);calls.push(name);
   if(parsed.hostname==='api.openai.com'){
    providerCalls++;const packet=JSON.parse(JSON.parse(init.body).messages[1].content),news=packet.evidence.filter(e=>e.kind==='NEWS');
    assert.equal(packet.cutoff,cutoff);assert.equal(packet.data_through,original.handoff.inputs[0].through);
    const price=packet.evidence.find(e=>e.kind==='PRICE'),financial=packet.evidence.find(e=>e.kind==='FINANCIAL');
    assert.equal(price.published_at,null);assert.equal(price.available_at,original.observed);assert.equal(price.time_basis,'OBSERVED_AFTER_RECEIPT');
    assert.equal(JSON.parse(financial.content).basis,'AS_REPORTED_YTD');assert.equal(JSON.parse(financial.content).values.eps,8);
    assert.equal(news.length,handoff.news.length);assert.deepEqual(news,handoff.news);
    for(const gap of handoff.intake_gaps)assert(packet.data_gaps.includes(gap),gap);
    assert(packet.data_gaps.includes('SOURCE_INGEST_FINANCIAL_YTD_FINANCIAL_RESPONSE_PERIOD_UNPROVEN'));assert(!JSON.stringify(packet).includes(original.privateIssueKey));
    if(news.length){assert(news.every(e=>JSON.parse(e.content).coverage==='HEADLINE_AND_PROVIDER_EXCERPT'));assert(news.every(e=>e.published_at!==cutoff));}
    else{assert(packet.data_gaps.includes('NEWS_NOT_CAPTURED_NO_ABSENCE_OF_RISK_CLAIM'));assert(packet.data_gaps.includes('COMPANY_NEWS_NOT_CAPTURED'));}
    return Response.json({id:'test-provider-receipt',model:'test-model',usage:{prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify({symbol:packet.symbol,
     horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'測試判讀',evidence_ids:[packet.evidence[0].id]},counter_evidence:[],confirmation:'等待新資料',invalidation:'證據改變時重評',gaps:['尚缺市場快照']}))})}}]});
   }
   assert(init.signal instanceof AbortSignal,'all intake database calls remain bounded');const args=JSON.parse(init.body);
   if(failure===name)return Response.json({message:'private database detail'},{status:503});
   if(name==='load_daily_stock_ai_batch_v1'){
    if(args.p_batch_id===null){assert.equal(args.p_cutoff,cutoff);return Response.json(null);}
    assert(stored);assert.equal(args.p_batch_id,stored.id);return Response.json(failure==='reload-null'?null:failure==='reload-cutoff'?{...stored,cutoff:original.observed}:stored);
   }
   if(name==='load_daily_stock_ai_handoff_v1'){assert.equal(args.p_cutoff,cutoff);return Response.json(handoff);}
   if(name==='store_daily_stock_ai_batch_v1'){
    const body=JSON.parse(args.p_text);storedBody=body;assert.equal(args.p_hash,await snapshotHash(body));assert.equal(body.cutoff,cutoff);
    const source=body.source_handoff;assert.equal(source.handoff_id,handoff.handoff_id);assert.equal(source.source_run_id,handoff.source_run_id);
    assert.equal(source.source_revision,handoff.source_revision);assert.equal(source.source_cutoff,handoff.source_cutoff);assert.equal(source.source_business_date,handoff.source_business_date);assert.equal(source.projection,projection);
    const packets=Object.values(body.packet_texts).map(text=>JSON.parse(text));assert.equal(packets.length,72);assert(!args.p_text.includes(original.privateIssueKey));
    for(const [symbol,text] of Object.entries(body.packet_texts))assert.equal(body.packet_hashes[symbol],await snapshotHash(JSON.parse(text)));
    stored={id:args.p_hash,cutoff,packets};
    return Response.json({state:'STORED',batch_id:failure==='save-unconfirmed'?'f'.repeat(64):stored.id,packets:72,member_published:false});
   }
   if(name==='load_daily_stock_ai_progress_v1')return Response.json({schema:'DAILY_AI_PROGRESS_V1',batch_id:stored.id,model_revision:args.p_model_revision,completed:{}});
   if(name==='daily_stock_ai_job_v1'){
    if(args.p_op==='CLAIM')return Response.json({state:'ACQUIRED',lease:'test-lease'});
    assert.equal(args.p_op,'COMPLETE');assert.equal(args.p_result.publication_ready,false);return Response.json({state:'STORED'});
   }
   if(name==='dispatch_daily_stock_ai_batch_v1'){assert.equal(args.p_batch_id,stored.id);return Response.json({state:'DISPATCHED'});}
   assert.fail('unexpected network call: '+name);
  };
  await import('../supabase/functions/daily-stock-analysis-v1/index.ts');
  const invoke=()=>worker(new Request('https://worker.example.invalid',{method:'POST',headers:{'x-vnext-internal':internal},body:JSON.stringify({cutoff})}));
  const reset=()=>{handoff=structuredClone(original.handoff);failure=null;stored=null;storedBody=null;providerCalls=0;calls.length=0;};
  let response=await invoke(),body=await response.json();assert.equal(response.status,202);assert.equal(body.model_calls,1);assert.equal(body.counts.COMPLETE,1);assert.equal(body.counts.DEFERRED,71);assert.equal(body.member_published,false);assert.equal(providerCalls,1);
  assert.notEqual(storedBody.cutoff,storedBody.source_handoff.source_cutoff);
  assert.deepEqual(calls,['load_daily_stock_ai_batch_v1','load_daily_stock_ai_handoff_v1','store_daily_stock_ai_batch_v1','load_daily_stock_ai_batch_v1','load_daily_stock_ai_progress_v1','daily_stock_ai_job_v1','completions','daily_stock_ai_job_v1','dispatch_daily_stock_ai_batch_v1']);
  reset();handoff.news=[];handoff.intake_gaps.push('NEWS_NONE_AVAILABLE_WITHIN_48H');
  response=await invoke();body=await response.json();assert.equal(response.status,202);assert.equal(providerCalls,1);assert.equal(body.model_calls,1);
  const cases=[
   ['missing handoff',()=>{handoff=null;},'SOURCE_BATCH_UNAVAILABLE'],
   ['wrong receipt cutoff',()=>{handoff.cutoff=original.observed;}],
   ['future source cutoff by one microsecond',()=>{handoff.source_cutoff=nextMicro(cutoff);handoff.inputs.forEach(i=>i.cutoff=handoff.source_cutoff);}],
   ['future input cutoff by one microsecond',()=>{handoff.inputs[0].cutoff=nextMicro(cutoff);}],
   ['wrong source business date',()=>{handoff.source_business_date='2000-01-01';}],
   ['wrong projection marker',()=>{handoff.projection='untrusted-projection';}],
   ['incomplete universe',()=>{handoff.inputs.pop();}],
   ['duplicate universe',()=>{handoff.inputs[71]=handoff.inputs[0];}],
   ['future publication by one microsecond',()=>{handoff.news[0].published_at=nextMicro(cutoff);}],
   ['unknown publication',()=>{handoff.news[0].published_at=null;}],
   ['expired publication',()=>{handoff.news[0].published_at=new Date(Date.parse(cutoff)-49*3600000).toISOString();}],
   ['forged news hash',()=>{handoff.news[0].evidence_hash='0'.repeat(64);}],
   ['forged news coverage',async()=>{const c=JSON.parse(handoff.news[0].content);c.coverage='FULL_ARTICLE';handoff.news[0].content=JSON.stringify(c);handoff.news[0].evidence_hash=await hashText(handoff.news[0].content);}],
   ['derived AI summary is not provider evidence',async()=>{const c=JSON.parse(handoff.news[0].content);c.ai_summary='generated assertion';handoff.news[0].content=JSON.stringify(c);handoff.news[0].evidence_hash=await hashText(handoff.news[0].content);}],
   ['future ingestion by one microsecond',async()=>{const c=JSON.parse(handoff.news[0].content);c.first_ingested_at=nextMicro(cutoff);handoff.news[0].content=JSON.stringify(c);handoff.news[0].evidence_hash=await hashText(handoff.news[0].content);}],
   ['wrong news receipt',()=>{handoff.news[0].available_at=original.observed;}],
   ['cross-universe news',()=>{handoff.news[0].symbol='9999';}],
   ['unsafe source URL',()=>{handoff.news[0].source='https://news.example.invalid/?token=private';}],
   ['too many news',()=>{handoff.news=Array.from({length:869},()=>structuredClone(original.handoff.news[0]));}],
   ['too many global news',()=>{handoff.news=Array.from({length:5},(_,i)=>({...original.handoff.news[1],id:'GLOBAL:'+i}));}],
   ['too many company news',()=>{handoff.news=Array.from({length:13},(_,i)=>({...original.handoff.news[0],id:'COMPANY:'+i}));}],
   ['too many bars',()=>{handoff.inputs[0].bars=Array.from({length:401},()=>({...handoff.inputs[0].bars[0]}));}],
   ['too many facts',()=>{handoff.inputs[0].facts=Array.from({length:1001},()=>({...handoff.inputs[0].facts[0]}));}],
   ['too many sessions',()=>{handoff.inputs[0].expected_sessions=Array.from({length:401},()=>handoff.inputs[0].through);}],
   ['too many source issues',()=>{handoff.source_issues=Array.from({length:1601},()=>({...handoff.source_issues[0]}));}],
   ['oversized projected inputs',()=>{handoff.inputs[0].unrecognized_padding='x'.repeat(8000001);}],
   ['oversized frozen news',async()=>{
    handoff.news=[];
    for(let i=0;i<288;i++){
     const n={...original.handoff.news[0],symbol:String(1000+Math.floor(i/4)),id:'NEWS:'+i},c=JSON.parse(n.content);
     c.title=n.symbol+' 測試來源';c.provider_excerpt='x'.repeat(6000);n.content=JSON.stringify(c);n.evidence_hash=await hashText(n.content);handoff.news.push(n);
    }
   }],
   ['missing no-news gap',()=>{handoff.news=[];}],
   ['market without immutable proof',()=>{handoff.market=[{kind:'MARKET'}];}],
   ['issue prose',()=>{handoff.source_issues[0].reason='private response body';}],
   ['handoff failure',()=>{failure='load_daily_stock_ai_handoff_v1';}],
   ['store failure',()=>{failure='store_daily_stock_ai_batch_v1';}],
   ['unconfirmed store',()=>{failure='save-unconfirmed';}],
   ['missing reload',()=>{failure='reload-null';}],
   ['changed reload',()=>{failure='reload-cutoff';}],
  ];
  for(const [label,change,error='STOCK_ANALYSIS_REJECTED'] of cases){
   reset();await change();response=await invoke();body=await response.json();
   assert.equal(response.status,409,label);assert.equal(body.error,error,label);assert.equal(body.member_published,false,label);assert.equal(providerCalls,0,label);
   assert(!calls.includes('load_daily_stock_ai_progress_v1'),label);assert(!JSON.stringify(body).includes('private'),label);
  }
 }finally{globalThis.fetch=oldFetch;if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;}
});

test('batch ID misses never intake, and cancellation blocks all later intake writes',async()=>{
 const controller=new AbortController(),cutoff='2026-10-30T12:00:00Z';let calls=0;
 assert.equal(await loadOrIntakeDailyStockAiBatch({batch_id:'a'.repeat(64)},async(name)=>{calls++;assert.equal(name,'load_daily_stock_ai_batch_v1');return null;},controller.signal),null);
 assert.equal(calls,1);calls=0;
 await assert.rejects(()=>loadOrIntakeDailyStockAiBatch({cutoff},async name=>{
  calls++;if(name==='load_daily_stock_ai_batch_v1')return null;
  assert.equal(name,'load_daily_stock_ai_handoff_v1');controller.abort();return {};
 },controller.signal),/AI_INTAKE_ABORTED/);assert.equal(calls,2);
 await assert.rejects(()=>loadOrIntakeDailyStockAiBatch({cutoff},async()=>assert.fail('pre-aborted intake'),controller.signal),/AI_INTAKE_ABORTED/);
});
