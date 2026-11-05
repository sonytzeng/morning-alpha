/** Disposable PostgreSQL controls. Synthetic evidence is NEVER sent to a service. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {PGlite}=await import(process.env.MA_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();await db.waitReady;
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const checks=[];
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const rpc=(id,hash,ids)=>scalar('select public.stage_vnext_daily_publication_v1($1,$2,$3)',[id,hash,ids]);
const reject=async(work,pattern)=>{await assert.rejects(work,pattern);await db.exec('rollback');};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
 create schema academy_private;create function academy_private.access_v11() returns text language sql stable as $$select case when public.is_research_owner_v1() then 'owner' else 'free' end$$;
 create schema vnext_runtime;create table vnext_runtime.predictions(id text primary key,run_id uuid,symbol text,horizon text,lock_hash text,payload_text text,payload jsonb,locked_at timestamptz);
 `);
 await db.exec(read('supabase/migrations/20261010061630_vnext_research_projection_candidate.sql'));
 await db.exec(read('supabase/migrations/20261012080628_vnext_member_publication_control_candidate.sql'));
 const before=await db.query("select relname,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='vnext_private'::regnamespace and relkind='r' order by relname");
 const ingressSql=read('src/features/vnext/dailyPublicationIngress.candidate.sql');
 assert.equal(read('supabase/migrations/20261029144410_vnext_daily_publication_ingress.sql'),ingressSql);
 await db.exec(ingressSql);
 assert.deepEqual((await db.query("select relname,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='vnext_private'::regnamespace and relkind='r' order by relname")).rows,before.rows);
 for(const role of ['anon','authenticated'])for(const fn of ['stage_vnext_daily_publication_v1(text,text,text[])','stage_vnext_daily_publication_batch_v1(uuid)'])
  assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[role,'public.'+fn]),false);
 checks.push('exact existing publication migrations apply; RLS unchanged; browser roles cannot stage');
 await db.exec(`insert into vnext_private.source_licenses values('synthetic-license','SYNTHETIC_TEST','https://example.test/license',now()-interval '1 day',null,true,true,true,true,'Synthetic isolated control');
 insert into vnext_private.event_sources(id,symbol,kind,source,source_ref,license_id,published_at,first_seen_at,available_at,as_of,last_verified_at,valid_until,snapshot_hash,classification,quality,relevant,summary)
 select k,'TEST',k,'SYNTHETIC_TEST','https://example.test/fact','synthetic-license',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 hour',now()-interval '3 hours',now()-interval '10 minutes',now()+interval '1 day',repeat('a',64),'CONFIRMED_FACT','PASS',true,'Synthetic '||k
 from unnest(array['PRICE_VOLUME','INSTITUTIONAL','NEWS','TECHNICAL_STRUCTURE'])k;`);
 const times=(await db.query("select now()-interval '5 minutes' cutoff,now()-interval '2 minutes' generated,now()-interval '1 minute' locked,now()+interval '1 minute' actionable,now()+interval '2 hours' expiry")).rows[0];
 const used=(await db.query("select id,source,snapshot_hash evidence_hash,published_at,first_seen_at,available_at,as_of from vnext_private.event_sources where id='PRICE_VOLUME'")).rows;
 const body={id:'fixture',business_date:'2026-10-29',symbol:'TEST',company:'Synthetic test only',horizon:'SHORT',mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',strategy_version:'SYNTHETIC_SELECTOR',
  evidence_cutoff:times.cutoff,generated_at:times.generated,locked_at:times.locked,actionable_at:times.actionable,next_review_at:times.expiry,
  confirmation:'Synthetic condition, unconfirmed',invalidation:'Synthetic risk, unconfirmed',research:{state:'QUALIFIED',reason:'Synthetic research only',used}};
 const put=async(id,change={})=>{const b={...body,id,...change},text=JSON.stringify(b),hash=createHash('sha256').update(text).digest('hex');
  await db.query('insert into vnext_runtime.predictions values($1,$2,$3,$4,$5,$6,$7,$8)',[id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',b.symbol,b.horizon,hash,text,JSON.stringify({...b,lock_hash:hash}),times.locked]);return hash;};
 const ids=['PRICE_VOLUME','INSTITUTIONAL','NEWS','TECHNICAL_STRUCTURE'];
 const hash=await put('fixture');
 await reject(()=>rpc('fixture','b'.repeat(64),ids),/PREDICTION_CHANGED/);
 await reject(()=>rpc('fixture',hash,[...ids,ids[0]]),/EVIDENCE_DUPLICATE/);
 await reject(()=>rpc('fixture',hash,[...ids,'missing']),/EVIDENCE_UNAVAILABLE/);
 const missing=await rpc('fixture',hash,['PRICE_VOLUME']);assert.equal(missing.reason,'HORIZON_EVIDENCE_MISSING');
 assert.equal(await scalar('select count(*)::int from vnext_private.stock_horizon_observations'),0);
 checks.push('wrong lock, duplicate/missing evidence and incomplete horizon cannot create rows');
 const noTrace=await put('no-trace',{research:{...body.research,used:[{...used[0],published_at:null}]}});
 await reject(()=>rpc('no-trace',noTrace,ids),/TRACE_MISMATCH/);
 const wrongTrace=await put('wrong-trace',{research:{...body.research,used:[{...used[0],evidence_hash:'b'.repeat(64)}]}});
 await reject(()=>rpc('wrong-trace',wrongTrace,ids),/TRACE_MISMATCH/);
 const old=await put('expired',{next_review_at:new Date(Date.now()-60000).toISOString()});
 await reject(()=>rpc('expired',old,ids),/RESEARCH_EXPIRED|PREDICTION_TIME/);
 const replay=await put('replay',{mode:'HISTORICAL_REPLAY'});await reject(()=>rpc('replay',replay,ids),/NOT_ELIGIBLE/);
 checks.push('unknown publication time, changed evidence version, expired and historical inputs rejected');
 const noLock=await put('no-lock',{locked_at:null});await reject(()=>rpc('no-lock',noLock,ids),/PREDICTION_TIME/);
 const late=await put('late-cutoff',{evidence_cutoff:new Date(Date.now()).toISOString()});await reject(()=>rpc('late-cutoff',late,ids),/PREDICTION_TIME/);
 const unsafe=await put('unsafe-copy',{confirmation:'保證必漲'});await reject(()=>rpc('unsafe-copy',unsafe,ids),/PREFLIGHT_REJECTED/);
 assert.equal(await scalar('select count(*)::int from vnext_private.stock_horizon_observations'),0);
 assert.equal(await scalar('select count(*)::int from vnext_private.observation_evidence'),0);
 checks.push('null or late original times rejected; publication preflight failure rolls back both observation and evidence links');
 const staged=await rpc('fixture',hash,ids);assert.equal(staged.status,'STAGED_REVIEW_REQUIRED');assert.equal(staged.member_published,0);
 const observation=staged.observation_id;
 assert.equal((await rpc('fixture',hash,[...ids].reverse())).status,'ALREADY_STAGED');
 assert.equal(await scalar('select count(*)::int from vnext_private.stock_horizon_observations'),1);
 assert.equal(await scalar('select count(*)::int from vnext_private.observation_evidence'),4);
 assert.equal(await scalar('select count(*)::int from vnext_private.member_copy'),0);
 const linked=(await db.query('select origin_prediction_id,created_at=locked_at correct_time from vnext_private.stock_horizon_observations')).rows[0];
 assert.deepEqual(linked,{origin_prediction_id:'fixture',correct_time:true});
 await db.query("select set_config('test.uid',$1,false)",[owner]);
 let review=await scalar('select public.get_owner_vnext_publication_review_v1()');assert.equal(review.rows[0].prerequisites_ready,false);assert.equal(review.rows[0].review_id,null);
 checks.push('atomic staging, exact retry and true current editorial time; Owner sees pending independent review; no member copy');
 // Independent reviewer is a separate fixture step, not performed by ingress.
 const rid=await scalar(`insert into vnext_private.publication_reviews(observation_id,snapshot_hash,review_hash,review_version,reviewer_ref,quality,time_status,licensing,quality_document_hash,time_document_hash,license_document_hash,evidence_set_hash,free_allowed,premium_allowed,reason,primary_risk,supporting_ids,contradicting_ids,expires_at)
 select id,snapshot_hash,repeat('d',64),'SYNTHETIC_REVIEW','INDEPENDENT_TEST_REVIEWER','PASS','PASS','PASS',repeat('e',64),repeat('f',64),repeat('a',64),vnext_private.publication_evidence_hash(id),true,true,'Synthetic independent review','Synthetic risk',array['PRICE_VOLUME'],array['NEWS'],next_review_at
 from vnext_private.stock_horizon_observations where id=$1 returning id`,[observation]);
 review=await scalar('select public.get_owner_vnext_publication_review_v1()');assert.equal(review.rows[0].prerequisites_ready,true);
 assert.equal(await scalar('select count(*)::int from vnext_private.member_copy'),0);
 const approval=await scalar("select public.review_vnext_publication_candidate_v1($1,$2,'APPROVE','premium','cccccccc-cccc-4ccc-8ccc-cccccccccccc')",[observation,rid]);assert.equal(approval.action,'APPROVE');
 assert.equal(await scalar('select vnext_private.member_allowed($1,false)',[observation]),true);
 const member=await scalar('select public.get_vnext_member_v1()');assert.equal(member.observations.length,1);
 await scalar("select public.review_vnext_publication_candidate_v1($1,$2,'REVOKE','premium','dddddddd-dddd-4ddd-8ddd-dddddddddddd')",[observation,rid]);
 assert.equal(await scalar('select vnext_private.member_allowed($1,false)',[observation]),false);
 checks.push('separate independent review -> explicit Owner approval -> actual member RPC visibility -> revocation');
 const batch=await scalar("select public.stage_vnext_daily_publication_batch_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')");
 assert.equal(batch.already_staged,1);assert.equal(batch.blocked,7);assert.equal(batch.member_published,0);
 checks.push('batch isolates rejected siblings and retries exact staged result without publication');
 await db.exec(`insert into vnext_private.source_licenses values('denied','SYNTHETIC_DENIED','https://example.test/denied',now()-interval '1 day',null,true,true,false,false,'No commercial rights');
 insert into vnext_private.event_sources select 'DENIED',symbol,kind,'SYNTHETIC_DENIED',source_ref,'denied',published_at,first_seen_at,available_at,as_of,last_verified_at,valid_until,snapshot_hash,classification,quality,relevant,summary
 from vnext_private.event_sources where id='NEWS';`);
 const denied=await rpc('fixture',hash,[...ids,'DENIED']);assert.equal(denied.reason,'SOURCE_RIGHTS_UNVERIFIED');
 assert.equal(await scalar('select count(*)::int from vnext_private.stock_horizon_observations'),1);
 assert.equal(await scalar('select count(*)::int from vnext_private.publication_reviews'),1);
 assert.equal(await scalar('select count(*)::int from vnext_private.owner_publication_events'),2);
 checks.push('unlicensed source cannot be staged or auto-reviewed, approved or substituted on a retry');
 console.log(JSON.stringify({checks,passed:checks.length,production_operations:0},null,2));
}finally{await db.close();}
