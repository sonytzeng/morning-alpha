// Opt-in REAL local Supabase/Edge test, not a mocked Data API test.
// Prerequisite: isolated harness + vendor boundary described in the release runbook.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
if(process.env.MA_LOCAL_SCOPE!=='ma-core-final-20260907')throw Error('Explicit isolated environment required');
const {sql,config,root,literal:q}=await import('/private/tmp/ma-core-final-20260907/local-contract.mjs');
assert.equal(config.API_URL,'http://127.0.0.1:54371');
const secret=readFileSync(root+'/local-only.env','utf8').match(/^CRON_SECRET=(.+)$/m)?.[1];
const date=process.env.MA_FETCH_TEST_DATE || '2026-09-08',records=[];
assert.match(date,/^2026-09-\d{2}$/);
const nextDate=days=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const lineBefore=sql('select md5(coalesce(jsonb_agg(to_jsonb(o) order by id)::text,\'[]\')) from public.line_delivery_outbox o;');
const save=(name,evidence)=>{records.push({name,...evidence});writeFileSync(root+'/fetch-contract-e2e.json',JSON.stringify({scope:'ISOLATED_LOCAL_ONLY',vendor:'synthetic JSON at provider boundary',auth:'real local gateway/internal auth',rpc_invocations_prohibited:['capture_morning_alpha_acceptance_v1','reconcile_runtime_terminal_failures_v1','reconcile_runtime_http_dispatches_v1'],records},null,2));console.log(JSON.stringify(records.at(-1)));};
async function fetchCheckpoint(checkpoint,time,fixture={},correlation=randomUUID(),phase=['1410','1430'].includes(checkpoint)?'close':'intraday',testDate=date){
 const r=await fetch(config.API_URL+'/functions/v1/fetch-market-data-v10',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.SERVICE_ROLE_KEY,Authorization:'Bearer '+config.SERVICE_ROLE_KEY,'x-cron-secret':secret,'x-correlation-id':correlation},body:JSON.stringify({phase,checkpoint,__local_fixture:{now:testDate+'T'+time+':00+08:00',...fixture}}),signal:AbortSignal.timeout(95000)});
 const body=await r.json();if(r.status>=500)throw Error(JSON.stringify({http:r.status,body,checkpoint}));return {http:r.status,body};
}
const count=(date,checkpoint)=>Number(sql(`select count(*) from public.market_checkpoint_snapshots where trading_date=${q(date)} and checkpoint=${q(checkpoint)};`));
const hash=(date,checkpoint)=>sql(`select md5(coalesce(jsonb_agg(to_jsonb(s) order by snapshot_version)::text,'[]')) from public.market_checkpoint_snapshots s where trading_date=${q(date)} and checkpoint=${q(checkpoint)};`);
const good=(r,name)=>{assert.equal(r.http,200,JSON.stringify(r));assert.equal(r.body.success,true,JSON.stringify(r));assert.equal(r.body.immutable_evidence_complete,true);save(name,{status:'PASS',http:r.http,correlation:r.body.evidence_correlation_id,versions:r.body.immutable_snapshot_versions});};
try {
 const noAuth=await fetch(config.API_URL+'/functions/v1/fetch-market-data-v10',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(noAuth.status,401);save('real local auth rejects anonymous',{status:'PASS',http:401});
 good(await fetchCheckpoint('0900','09:00'),'actual Fetch opening (or original retained reuse)');
 const stale=await fetchCheckpoint('0930','09:30',{sourceAt:date+'T09:20:00+08:00'});
 assert.equal(stale.body.success,false);assert.equal(stale.body.required_core_complete,false);
 assert.equal(sql(`select count(*) from public.market_checkpoint_snapshots where trading_date=${q(date)} and checkpoint='0930' and symbol in ('TAIEX','2330','TXF');`),'0');
 save('09:20 source rejected at 09:30',{status:'PASS',http:stale.http,success:false});
 good(await fetchCheckpoint('0930','09:30',{sourceAt:date+'T09:27:00+08:00'},stale.body.correlation_id),'09:27 accepted; actual immutable retry and lifecycle');
 const nullQuote=await fetchCheckpoint('1030','10:30',{missingPercent:true});
 assert.equal(nullQuote.body.success,false);assert.equal(nullQuote.body.required_core_complete,false);
 save('provider missing change fields never normalized to zero',{status:'PASS',success:false});
 good(await fetchCheckpoint('1030','10:30',{},nullQuote.body.correlation_id),'valid retry after missing provider data');
 const failureId=randomUUID();
 sql(`create or replace function ma_isolated_guard.reject_one_fetch() returns trigger language plpgsql as $$ begin if new.correlation_id=${q(failureId)}::uuid and new.symbol='TXF' then raise exception 'LOCAL_INJECTED_RETENTION_FAILURE'; end if; return new; end $$; create trigger local_fetch_fault before insert on public.market_checkpoint_snapshots for each row execute function ma_isolated_guard.reject_one_fetch();`);
 let partial;
 try {partial=await fetchCheckpoint('1300','13:00',{},failureId);}finally{sql('drop trigger local_fetch_fault on public.market_checkpoint_snapshots; drop function ma_isolated_guard.reject_one_fetch();');}
 assert.equal(partial.body.success,false);assert.equal(partial.body.immutable_evidence_complete,false);
 assert.ok(partial.body.snapshot_errors.some(e=>e.error.includes('LOCAL_INJECTED_RETENTION_FAILURE')));
 save('real DB write failure cannot mark checkpoint complete',{status:'PASS',success:false});
 const partialVersions=JSON.parse(sql(`select jsonb_agg(snapshot_version order by snapshot_version) from public.market_checkpoint_snapshots where correlation_id=${q(failureId)};`));
 good(await fetchCheckpoint('1300','13:00',{priceDelta:10},failureId),'partial retry keeps original per-symbol observation');
 const currentVersions=JSON.parse(sql(`select jsonb_agg(snapshot_version order by snapshot_version) from public.market_checkpoint_snapshots where correlation_id=${q(failureId)};`));
 assert.ok(partialVersions.every(v=>currentVersions.includes(v)));
 assert.equal(sql(`select count(*) from public.market_data_snapshots s join public.market_checkpoint_snapshots e on e.snapshot_version=(s.raw->>'immutable_snapshot_version')::bigint where s.trading_date=${q(date)} and s.checkpoint='1300' and (s.value is distinct from e.value or s.change_percent is distinct from e.change_percent or s.captured_at is distinct from e.source_timestamp);`),'0');
 const parallelId=randomUUID();
 const parallel=await Promise.all([fetchCheckpoint('1410','14:15',{coreClose:true},parallelId),fetchCheckpoint('1410','14:15',{coreClose:true},parallelId)]);
 parallel.forEach((r,i)=>good(r,'concurrent identical close request '+(i+1)));
 assert.equal(count(date,'1410'),9,'only one append-only row per symbol/request');
 good(await fetchCheckpoint('1430','14:30',{coreClose:true}),'real close 14:30');
 const before=hash(date,'0930'),num=count(date,'0930');
 const reuse=await fetchCheckpoint('0930','15:00',{priceDelta:100});good(reuse,'late retry reuses original observation, no refetch');
 assert.equal(reuse.body.__local_provider_requests.length,0);assert.equal(hash(date,'0930'),before);assert.equal(count(date,'0930'),num);
 // Execute the exact candidate Acceptance checkpoint predicate as a read-only
 // query. DO NOT invoke any of the three rollback RPCs, even for this test.
 const missing=JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('checkpoint',cp,'symbol',sym)),'[]') from unnest(array['0900','0930','1030','1300','1410','1430']) cp cross join unnest(array['TAIEX','2330','TXF']) sym join public.trading_day_state d on d.trading_date=${q(date)} where d.checkpoint_status#>>array[cp,'status'] is distinct from 'SUCCEEDED' or d.checkpoint_status#>array[cp,'metadata','core_batch_complete'] is distinct from 'true'::jsonb or not exists(select 1 from public.market_checkpoint_snapshots where trading_date=${q(date)} and checkpoint=cp and symbol=sym and value is not null and change_percent is not null and value::text not in ('NaN','Infinity','-Infinity') and change_percent::text not in ('NaN','Infinity','-Infinity') and source_timestamp is not null and coalesce(source,'')<>'' and correlation_id::text=d.checkpoint_status#>>array[cp,'correlation_id']);`));
 assert.deepEqual(missing,[]);save('Acceptance six checkpoints × three core symbols, actual producer only',{status:'PASS',matched:18,missing:0,acceptance_rpc_called:false});
 const recoveryDate=nextDate(1);
 good(await fetchCheckpoint('premarket','07:20',{},randomUUID(),'premarket',recoveryDate),'actual PREMARKET retention');
 const premarketHash=hash(recoveryDate,'PREMARKET');
 const recovery=await fetchCheckpoint('manual','12:00',{},randomUUID(),'manual_backfill',recoveryDate);
 assert.ok(count(recoveryDate,'RECOVERY')>0);assert.equal(hash(recoveryDate,'PREMARKET'),premarketHash);
 assert.equal(recovery.body.success,false,'rank-regression no-op must not masquerade as completed lifecycle');
 save('RECOVERY is separate; immutable PREMARKET unchanged; lifecycle no-op not success',{status:'PASS'});
 const late=await fetchCheckpoint('0930','10:30',{},randomUUID(),'intraday',nextDate(2));
 assert.equal(late.http,409);assert.equal(count(nextDate(2),'0930'),0);assert.equal(late.body.__local_provider_requests.length,0);
 save('late execution does not backfill historical checkpoint',{status:'PASS',http:409});
 const missingTxf=await fetchCheckpoint('0930','09:30',{missingTXF:true},randomUUID(),'intraday',nextDate(2));
 assert.equal(missingTxf.body.success,false);assert.equal(missingTxf.body.required_core_complete,false);
 assert.equal(missingTxf.body.healthy,false);
 save('TAIEX + 2330 without TXF is insufficient, not healthy',{status:'PASS'});
 assert.throws(()=>sql(`update public.market_checkpoint_snapshots set value=1 where trading_date=${q(date)};`),/immutable/);
 assert.throws(()=>sql(`delete from public.market_checkpoint_snapshots where trading_date=${q(date)};`),/immutable/);
 save('real immutable UPDATE/DELETE guards reject mutation',{status:'PASS'});
 const lineAfter=sql('select md5(coalesce(jsonb_agg(to_jsonb(o) order by id)::text,\'[]\')) from public.line_delivery_outbox o;');
 assert.equal(lineAfter,lineBefore);save('LINE untouched, no recovery or acceptance RPC invocation',{status:'PASS'});
 save('FINAL',{status:'PASS',scope:'Fetch → true immutable persistence → lifecycle → Acceptance evidence predicate (not full Production Acceptance)'});
} catch(error) {save('FIRST_FAILURE',{status:'FAIL',error:String(error.stderr||error.message).replace(/eyJ[\w.-]+/g,'[REDACTED]')});process.exitCode=1;}
