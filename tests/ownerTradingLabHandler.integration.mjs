// SYNTHETIC ISOLATION ONLY. Real Handler, real candidate SQL/RLS, loopback SDK transport.
import './ownerTradingLabDatabase.integration.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {evidenceRows,IDENTITY} from './fixtures/decision-evidence-rows.mjs';
import {DATA_QUERIES} from '../supabase/functions/_shared/decision-v1-data.ts';
const db=process.env.MA_ISOLATED_TEST_DB,container=process.env.MA_TEST_DOCKER_CONTAINER,port=process.env.MA_TEST_PGPORT||'55441';
const args=container?['exec','-i',container,'psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1']:['-X','-q','-h','127.0.0.1','-p',port,'-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync(container?'docker':'psql',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const owner='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',paid='10000000-0000-4000-8000-000000000003';
const identities={'fixture-owner':owner,'fixture-member':member,'fixture-paid':paid};
const read=table=>JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.${table} t`));
sql("alter table decision_snapshots add column session_type text default 'PREMARKET',add column is_current boolean default true,add column market_regime text default 'range',add column action text default 'WAIT';");
const sections={executive_summary:{text:'SYNTHETIC：目前等待確認，不追價。'},supporting_evidence:[{statement:'半導體相對強弱支持',evidence_refs:['fixture']}],counter_evidence:[{statement:'仍需等待量價確認',evidence_refs:['fixture']}],failure_scenario:{triggers:[{condition:'失去原始確認條件',evidence_required:['fixture']}]},decision_guide:{risk_level:'high'}};
sql(`update decision_snapshots set generated_text=${literal({daily_sentence:sections.executive_summary.text,market_bias:'中性偏多',market_report_gate:{recommendation_status:'BLOCKED',wait_reason:'正式進場確認尚未成立'},canonical_market_state:{document:{sections}}})}`);
const fixture=evidenceRows(),shift=Date.now()-Date.parse(IDENTITY.generated_at);
for(const rows of Object.values(fixture))if(Array.isArray(rows))for(const row of rows)if(typeof row==='object')for(const k of Object.keys(row)) {
 if(typeof row[k]==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(row[k]))row[k]=new Date(Date.parse(row[k])+shift).toISOString();
 if(k==='trading_date')row[k]=new Date(Date.parse(row[k]+'T02:00:00Z')+shift).toISOString().slice(0,10);
}
for(const q of fixture.quotes){q.id=randomUUID();if(q.phase==='intraday'&&/^\d/.test(q.symbol))sql(`insert into market_quotes values('${q.id}','${q.symbol}','${q.trading_date}','intraday','verified','fresh',${q.value},'${q.captured_at}','${q.ingested_at}')`);}
const byTable=Object.fromEntries(Object.entries(DATA_QUERIES).map(([key,q])=>[q.table,fixture[key]]));
let unavailable=false,calls=0;const logs=[];
const bridge=createServer(async(req,res)=>{
 try {
  let raw='';for await(const c of req){raw+=c;if(raw.length>1048576)throw Error('BOUND');}
  const {body:b,key,authorization}=JSON.parse(raw);calls++;
  const id=identities[String(authorization||'').replace(/^Bearer /,'')];let data;
  if(b.kind==='auth'){data={user:identities[b.token]?{id:identities[b.token]}:null};res.end(JSON.stringify({data,error:data.user?null:{message:'INVALID_SYNTHETIC_IDENTITY'}}));return;}
  if(b.kind==='rpc'&&b.name==='is_research_owner_v1')data=sql(`begin;set local role authenticated;set local request.jwt.claim.sub='${id||'00000000-0000-4000-8000-000000000000'}';select is_research_owner_v1();rollback;`)==='t';
  else if(b.kind==='rpc'&&b.name==='get_owner_analysis_v2'){assert.equal(id,owner);data={forward_sample:0};}
  else {
   assert.equal(key,'ISOLATED_SERVICE_ONLY');
   if(b.kind==='rpc'){
    const a=b.args;
    if(b.name==='market_calendar_session_v1')data=sql(`select market_calendar_session_v1('TW','${a.p_date}')`)==='t';
    else if(b.name==='owner_lab_record_trade_v1')data=JSON.parse(sql(`set role service_role;select owner_lab_record_trade_v1('${a.p_owner}','${a.p_request}',${literal(a.p_trade)},${literal(a.p_snapshot)})`));
    else if(b.name==='owner_lab_append_event_v1')data=JSON.parse(sql(`set role service_role;select owner_lab_append_event_v1('${a.p_owner}','${a.p_trade_id}',${literal(a.p_event)})`));
    else if(b.name==='owner_lab_target_sessions_v1')data=JSON.parse(sql(`set role service_role;select owner_lab_target_sessions_v1('${a.p_entry}')`));
    else throw Error('UNEXPECTED_RPC');
   } else {
    assert.equal(b.kind,'query');
    assert(['owner_lab_trades','owner_lab_trade_events','decision_snapshots','research_daily_analysis','prediction_outcomes',...Object.keys(byTable)].includes(b.table));
    if(unavailable&&b.table==='decision_snapshots')throw Error('SYNTHETIC_DEPENDENCY_FAILURE');
    data=['owner_lab_trades','owner_lab_trade_events','decision_snapshots'].includes(b.table)||(b.table==='market_quotes'&&!b.columns.includes('raw_payload'))?read(b.table):byTable[b.table]||[];
    for(const [op,k,v]of b.filters)data=data.filter(r=>op==='eq'?r[k]===v:op==='in'?v.includes(r[k]):op==='lte'?r[k]<=v:r[k]>=v);
    for(const [k,o]of b.orders)data.sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(o.ascending?1:-1));
    data=data.slice(0,b.limit);
   }
  }
  res.end(JSON.stringify({data,error:null}));
 }catch{res.end(JSON.stringify({data:null,error:{message:'ISOLATED_REJECTED'}}));}
});
bridge.listen(0,'127.0.0.1');await once(bridge,'listening');
const child=spawn('deno',['run','--cached-only','--no-lock','--allow-net=127.0.0.1','--allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY','--import-map=tests/helpers/owner-lab-import-map.json','tests/helpers/ownerLabDenoServer.ts'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,SUPABASE_URL:'http://127.0.0.1:'+bridge.address().port,SUPABASE_ANON_KEY:'ISOLATED_ANON_ONLY',SUPABASE_SERVICE_ROLE_KEY:'ISOLATED_SERVICE_ONLY'},stdio:['ignore','pipe','pipe']});
child.stderr.on('data',b=>logs.push(b.toString()));
try {
 const httpPort=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('START_TIMEOUT')),15000);child.once('exit',()=>{clearTimeout(t);reject(Error('START_FAILED'));});child.stdout.on('data',b=>{try{const p=JSON.parse(b.toString()).port;if(p){clearTimeout(t);resolve(p);}}catch{}});});
 const endpoint='http://127.0.0.1:'+httpPort;
 const request=async(body,identity='fixture-owner',origin='https://morningalphatw.com')=>{const r=await fetch(endpoint,{method:'POST',headers:{...(identity?{Authorization:'Bearer '+identity}:{}),Origin:origin},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 for(const [identity,status]of [['',401],['expired',401],['fixture-member',403],['fixture-paid',403]])assert.equal((await request({operation:'READ'},identity)).status,status);
 const before=calls;assert.equal((await request({operation:'READ'},'fixture-owner','https://not-allowed.example')).status,403);assert.equal(calls,before);
 const first=await request({operation:'READ'});assert.equal(first.status,200);assert.equal(first.data.discovery.watchlist.length,3);assert.equal(first.data.performance.market.forward_shadow_sample,0);
 const payload={operation:'RECORD_TRADE',request_id:randomUUID(),trade:{kind:'SYSTEM_SIMULATION',symbol:'2330',quantity:10,stop_price:90,horizon:'1D',notes:'SYNTHETIC HTTP ONLY'}};
 const saved=await request(payload);assert.equal(saved.status,200);assert.equal(saved.data.status,'RECORDED');
 unavailable=true;const duplicate=await request({...payload,trade:Object.fromEntries(Object.entries(payload.trade).reverse())});assert.equal(duplicate.data.status,'ALREADY_RECORDED');unavailable=false;
 assert.equal((await request({...payload,trade:{...payload.trade,quantity:11}})).status,409);
 const live={operation:'RECORD_TRADE',request_id:randomUUID(),trade:{kind:'SONY_LIVE_TRADE',symbol:'2330',quantity:10,entry_price:100,entered_at:new Date(Date.now()-120000).toISOString(),horizon:'CLOSE'}};
 const recorded=await request(live);assert.equal(recorded.status,200);
 const exit={operation:'RECORD_EXIT',trade_id:recorded.data.id,event:{price:105,occurred_at:new Date(Date.now()-10000).toISOString()}};
 assert.equal((await request(exit)).data.status,'RECORDED');assert.equal((await request(exit)).data.status,'ALREADY_RECORDED');
 assert.equal((await request({operation:'REFRESH_OUTCOMES'})).status,200);
 const state=await request({operation:'READ'});assert.equal(state.data.trades.length,5);assert.equal(state.data.discovery.formal_status,'BLOCKED');
 assert.equal(sql('select count(*) from decision_snapshots'),'1');assert.equal(sql('select count(*) from research_daily_analysis'),'0');
 console.log(JSON.stringify({handler:'PASS',auth_negative:'PASS',owner_rls:'PASS',paper:'PASS',live:'PASS',exit:'PASS',retry_dependency_independent:'PASS',core_diff:0,network:'LOOPBACK_ONLY',identity:'SYNTHETIC_NOT_PRODUCTION'}));
 if(process.env.MA_OWNER_UI_SERVER==='LOCAL_ONLY'){
  const proxy=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');try{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);const result=await request(b.payload,b.identity);res.end(JSON.stringify(result));}catch{res.statusCode=500;res.end('{}');}});
  proxy.listen(3197,'127.0.0.1');await once(proxy,'listening');console.log('LOCAL_OWNER_HANDLER_PROXY=3197');
  await new Promise(resolve=>process.once('SIGTERM',resolve));proxy.close();
 }
}finally{child.kill();await once(child,'exit');await new Promise(r=>bridge.close(r));assert(!logs.some(s=>s.includes('ISOLATED_SERVICE_ONLY')));}
