// SYNTHETIC TRANSPORT ONLY; never labels these results Production acquisition.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleRecommendationSmoke,verifySmokeCapture} from '../supabase/functions/_shared/recommendation-smoke.ts';
import {normalizeDailyCandles,normalizeIntradayQuote,RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
const date='2026-10-07',at='2026-10-06T23:00:00.000Z';
const credentials={currentToken:'SYNTHETIC_INTERNAL',previousToken:'',previousExpiresAt:'',version:'v1',serviceRoleKey:'SYNTHETIC.JWT.ONLY'};
function request(mode='SMOKE_2330',extra={},headers={'x-cron-secret':credentials.currentToken}){
 return new Request('https://example.test/smoke',{method:'POST',headers,body:JSON.stringify({business_date:date,correlation_id:'synthetic-run',mode,...extra})});
}
async function capture(symbol,now=at){
 let d=previousMarketTradingDate('TW',date);const data=[];
 for(let i=0;i<20;i++){data.push({date:d,open:100,high:103,low:99,close:102,volume:1000000,turnover:102000000,change:1});d=previousMarketTradingDate('TW',d);}
 return {symbol,endpoint:'historical/candles',received_at:now,status:'PASS',http_status:200,payload_hash:'SYNTHETIC_DIGEST',rows:await normalizeDailyCandles(symbol,{symbol,timeframe:'D',data},now,date)};
}
async function result(scope,now=at){
 const symbols=scope==='SMOKE_2330'?['2330']:RECOMMENDATION_UNIVERSE;
 const captures=await Promise.all(symbols.map(s=>capture(s,now)));
 if(new Date(now).getUTCHours()>=1&&new Date(now).getUTCDate()===7)for(const symbol of symbols){
  const rows=await normalizeIntradayQuote(symbol,{symbol,date,lastTrade:{time:Date.parse(now)*1000,price:102},changePercent:1,total:{tradeVolume:1000,tradeValue:102000000}},now,date);
  captures.push({symbol,endpoint:'intraday/quote',received_at:now,status:'PASS',http_status:200,payload_hash:'SYNTHETIC_DIGEST',rows});
 }
 return {scope,acquisition:{contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',business_date:date,cutoff:now,universe_count:72,requested_count:symbols.length,captures},complete_universe_evaluation:false,business_writes:[],decision:{report_date:date,revision_id:`synthetic-run:${scope}`,generated_at:now}};
}
function runtime(fetcher,now=()=>at){return {url:'https://cttfzgvhiewfckydcrci.supabase.co',credentials,fetcher,now};}
test('real internal validator denies anonymous, Owner/member/paid JWT, wrong identity and browser before dispatch',async()=>{
 let calls=0;const env=runtime(async()=>{calls++;throw Error('NEVER');});
 for(const headers of [{},{Authorization:'Bearer OWNER.JWT.ONLY'},{Authorization:'Bearer MEMBER.JWT.ONLY'},{Authorization:'Bearer PAID.JWT.ONLY'},{'x-cron-secret':'wrong'},{'x-cron-secret':credentials.currentToken,'x-internal-auth-version':'v2'}])assert.equal((await handleRecommendationSmoke(request('SMOKE_2330',{},headers),env)).status,401);
 assert.equal((await handleRecommendationSmoke(request('SMOKE_2330',{}, {'x-cron-secret':credentials.currentToken,Origin:'https://owner.test'}),env)).status,403);
 assert.equal((await handleRecommendationSmoke(new Request('https://example.test'),env)).status,405);
 assert.equal(calls,0);
});
test('2330 only, Runtime credentials sent only to fixed target; output excludes rows, secrets and decisions',async()=>{
 const calls=[];const env=runtime(async(url,init)=>{
  calls.push(JSON.parse(init.body));assert.equal(url,'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/recommendation-stock-evidence-v1');
  assert.equal(init.headers['x-cron-secret'],credentials.currentToken);assert.equal(init.headers.Authorization,`Bearer ${credentials.serviceRoleKey}`);assert.equal(init.redirect,'error');
  const body=await result('SMOKE_2330');body.private='DO_NOT_ECHO';return Response.json(body);
 });
 const response=await handleRecommendationSmoke(request(),env),body=await response.json();assert.equal(response.status,200);
 assert.equal(calls.length,1);assert.equal(body.smoke_2330.verification.pass,true);assert.equal(body.universe_72,'NOT_RUN');
 assert.doesNotMatch(JSON.stringify(body),/SYNTHETIC_INTERNAL|SYNTHETIC.JWT|DO_NOT_ECHO|raw_payload|Authorization|decision/);
});
test('bounded72 is strictly sequential after independently passing2330; no claimed pass shortcut',async()=>{
 const scopes=[];const env=runtime(async(_url,init)=>{const p=JSON.parse(init.body);scopes.push(p.scope);return Response.json(await result(p.scope));});
 const response=await handleRecommendationSmoke(request('BOUNDED_72_ACQUISITION_VERIFY'),env),body=await response.json();
 assert.equal(response.status,200);assert.deepEqual(scopes,['SMOKE_2330','UNIVERSE_72']);assert.equal(body.universe_72.verification.amount_20d,72);
 assert.equal((await handleRecommendationSmoke(request('BOUNDED_72_ACQUISITION_VERIFY',{smoke_pass:true}),env)).status,422);assert.equal(scopes.length,2);
});
test('2330 HTTP, contract, missing amount or provider failure forbids72 and sanitizes failure',async()=>{
 for(const kind of ['401','403','500','malformed','amount','provider','throw']){
  let calls=0;const env=runtime(async()=>{
   calls++;if(kind==='throw')throw Error('SECRET_ERROR');if(/^\d+$/.test(kind))return new Response('SECRET_ERROR',{status:Number(kind)});
   if(kind==='malformed')return new Response('{');const body=await result('SMOKE_2330');
   if(kind==='amount')delete body.acquisition.captures[0].rows[0].raw_payload.amount_twd;
   if(kind==='provider'){body.acquisition.captures[0].status='SECRET_ERROR';body.acquisition.captures[0].rows=[];}
   return Response.json(body);
  });
  const response=await handleRecommendationSmoke(request('BOUNDED_72_ACQUISITION_VERIFY'),env);assert.equal(response.status,422,kind);assert.equal(calls,1);assert.doesNotMatch(await response.text(),/SECRET_ERROR/);
 }
});
test('partial72 coverage is measured, never zero-filled or silently marked complete',async()=>{
 const env=runtime(async(_url,init)=>{const p=JSON.parse(init.body),body=await result(p.scope);
  if(p.scope==='UNIVERSE_72'){const c=body.acquisition.captures[0];c.status='ENTITLEMENT_NON_RETRYABLE';c.http_status=403;c.rows=[];}
  return Response.json(body);
 });
 const response=await handleRecommendationSmoke(request('BOUNDED_72_ACQUISITION_VERIFY'),env),body=await response.json();
 assert.equal(response.status,422);assert.equal(body.universe_72.verification.amount_20d,71);assert.equal(body.universe_72.verification.failed,1);
});
test('date, arbitrary symbol/URL, extra payload, missing Runtime credentials fail closed before network',async()=>{
 let calls=0;const env=runtime(async()=>{calls++;throw Error('NEVER');});
 for(const extra of [{business_date:'2026-10-06'},{symbol:'2317'},{url:'https://attacker.test'},{correlation_id:'x'.repeat(2000)}])assert.equal((await handleRecommendationSmoke(request('SMOKE_2330',extra),env)).status,422);
 for(const change of [{url:'https://attacker.test'},{credentials:{...credentials,serviceRoleKey:'opaque'}},{credentials:{...credentials,currentToken:''}}]){
  // Use existing legacy API-key branch solely to authenticate this synthetic
  // negative control; absence of target Runtime identity must still reject.
  const req=request('SMOKE_2330',{}, {apikey:change.credentials?.serviceRoleKey??credentials.serviceRoleKey});
  assert.equal((await handleRecommendationSmoke(req,{...env,...change})).status,503);
 }
 assert.equal(calls,0);
});
test('duplicate/missing/future/stale/wrong-session/identity/business-write proof rejected',async()=>{
 const mutations=[
  b=>b.acquisition.captures.push(b.acquisition.captures[0]),
  b=>b.acquisition.captures[0].rows.pop(),
  b=>b.acquisition.captures[0].rows[0].available_at='2026-10-08T00:00:00Z',
  b=>b.acquisition.captures[0].rows[0].trading_date='2026-10-07',
  b=>b.acquisition.captures[0].rows[0].raw_payload.volume_unit='LOTS',
  b=>b.acquisition.captures[0].rows[0].raw_payload.high=1,
  b=>b.acquisition.captures[0].received_at='2026-10-06T00:00:00Z',
  b=>b.acquisition.business_date='2026-10-06',
  b=>b.business_writes.push('report'),
 ];
 for(const mutate of mutations){const b=await result('SMOKE_2330');mutate(b);assert.throws(()=>verifySmokeCapture(b,'SMOKE_2330',date,'synthetic-run',at,at));}
 const full=await result('UNIVERSE_72');full.decision.revision_id='wrong';assert.throws(()=>verifySmokeCapture(full,'UNIVERSE_72',date,'synthetic-run:UNIVERSE_72',at,at));
});
test('intraday uses the same Production freshness predicate; daily-only cannot pass',async()=>{
 const now='2026-10-07T02:00:00.000Z',body=await result('SMOKE_2330',now);
 assert.equal(verifySmokeCapture(body,'SMOKE_2330',date,'run',now,now).pass,true);
 const stale=structuredClone(body),r=stale.acquisition.captures[1].rows[0];r.captured_at='2026-10-07T01:00:00.000Z';r.source_timestamp=r.captured_at;
 assert.throws(()=>verifySmokeCapture(stale,'SMOKE_2330',date,'run',now,now),/LATEST_FRESHNESS/);
 body.acquisition.captures.pop();assert.throws(()=>verifySmokeCapture(body,'SMOKE_2330',date,'run',now,now),/CAPTURE_SET/);
});
test('response bound and date/phase transition do not produce a false smoke PASS',async()=>{
 const oversize=runtime(async()=>new Response(' '.repeat(8_000_001)));
 assert.equal((await handleRecommendationSmoke(request(),oversize)).status,422);
 const body=await result('SMOKE_2330');body.acquisition.cutoff='2026-10-07T01:00:00Z';
 assert.throws(()=>verifySmokeCapture(body,'SMOKE_2330',date,'run',at,'2026-10-07T01:00:00Z'));
});
test('candidate has no DB write/public caller/forward/Cron and existing auth is reused',()=>{
 const entry=readFileSync('supabase/functions/recommendation-stock-evidence-smoke-v1/index.ts','utf8');
 const core=readFileSync('supabase/functions/_shared/recommendation-smoke.ts','utf8');
 assert.match(entry,/internalCredentialsFromEnv/);assert.match(core,/authorizeInternalRequest\(request.headers,runtime.credentials\)/);
 assert.doesNotMatch(entry+core,/createClient|\.rpc\(|\.insert\(|\.update\(|\.upsert\(|console\.|Deno\.write|localStorage|Access-Control-Allow-Origin/);
});
