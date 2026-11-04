// Portable isolated PostgreSQL contract tests. All issuers, source values and
// source receipts below are synthetic. This is not production SOURCE E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

let PGlite,missingRuntime;
try{({PGlite}=await import(process.env.MA_PGLITE_MODULE||'@electric-sql/pglite'));}
catch(error){
 if(process.env.MA_PGLITE_MODULE||error.code!=='ERR_MODULE_NOT_FOUND')throw error;
 missingRuntime='Install @electric-sql/pglite or set MA_PGLITE_MODULE to run real PostgreSQL; no assertions executed.';
}
const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'
 ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
const canonical=v=>JSON.stringify(sort(v));
const sha=v=>createHash('sha256').update(v).digest('hex');
const cutoff='2026-11-02T00:00:00.000Z',beforeCutoff='2026-11-01T23:59:59.999Z';
const receipt='2026-11-01T23:00:00.000Z';
// Identity seals are code contracts; no actual issuer facts are loaded here.
const issuerSeal='f4ea34657aa08d4e9db61bb45851510fe1aaa97193ca592a8c983be3ff4c4b32';
const umcSeal='fd579e5d06f89ff3e3d84aba9cf532e7839e79b1984841906387cc9b04ac5ccc';
const symbols=['2454','2379','2303','3006','3711',...Array.from({length:67},(_,i)=>String(1000+i))];
const trace=(id,symbol,kind,period,values)=>({id,symbol,kind,period,values,basis:'SINGLE_QUARTER',
 source:'https://example.invalid/synthetic-source/'+symbol,published_at:null,first_seen_at:receipt,
 available_at:receipt,source_received_at:receipt,as_of:'2026-09-30T23:59:59+08:00',
 evidence_hash:sha('SYNTHETIC_EVIDENCE_ONLY:'+id),source_sha256:sha('SYNTHETIC_RAW_ONLY:'+symbol),
 source_admitted:false,member_publication_approved:false});
const issuer14=Array.from({length:14},(_,i)=>trace('issuer-ir-direct:SYNTHETIC:'+i,i<8?'2454':'2379','EPS','2026-Q3',{value:101+i}));
const umc12=Array.from({length:12},(_,i)=>trace('umc-ir-direct:SYNTHETIC:'+i,'2303','EPS','2026-Q3',{value:201+i}));
const institutional=symbols.flatMap((symbol,i)=>['2026-10-29','2026-10-30'].map((period,j)=>({
 ...trace('INSTITUTIONAL-SYNTHETIC-'+symbol+'-'+period,symbol,'INSTITUTIONAL',period,
  {net_shares:i+j+10,foreign_net_shares:i+5,trust_net_shares:j+3,dealer_net_shares:2}),
 basis:'SHARES',unit:'SHARES',not_currency:true,
})));
const periods=['2025-Q4','2026-Q1','2026-Q2','2026-Q3'];
const issuer16=['3006','3711'].flatMap((symbol,i)=>periods.flatMap((period,j)=>['EPS','MARGIN'].map(kind=>({
 ...trace('native16-SYNTHETIC-'+symbol+'-'+period+'-'+kind,symbol,kind,period,
  kind==='EPS'?{value:301+i*10+j,unit:'TWD_PER_COMMON_SHARE',measurement_basis:'BASIC'}:
   {value:11+j/10,unit:'PERCENT',measurement_basis:symbol==='3006'&&j===0?'DIRECTLY_REPORTED_GROSS_MARGIN':
    'CALCULATED_GROSS_MARGIN_FROM_SAME_QUARTER_REPORTED_AMOUNTS',revenue_thousand_twd:1000,gross_profit_thousand_twd:110+j}),
 normalizer_version:'ISSUER16_NATIVE_FINANCIALS_V1',as_of_basis:'FINANCIAL_PERIOD_END_NOT_PUBLICATION',
}))));
const input=()=>symbols.map(symbol=>({symbol,company:'SYNTHETIC ONLY '+symbol,cutoff,
 facts:[trace('SYNTHETIC-OLD-INSTITUTIONAL-'+symbol,symbol,'INSTITUTIONAL','2026-10-28',{net_shares:1}),
  ...structuredClone([...issuer14,...umc12].filter(f=>f.symbol===symbol))]}));
const append=(inputs,facts)=>inputs.map(i=>({...structuredClone(i),facts:[...structuredClone(i.facts),...structuredClone(facts.filter(f=>f.symbol===i.symbol))]}));

test('synthetic institutional/native16 SQL contracts in real isolated PostgreSQL',
 {skip:missingRuntime||false},async t=>{
 const db=new PGlite();await db.waitReady;let checks=0;
 const equal=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
 const rejects=async(fn,pattern,message)=>{await assert.rejects(fn,pattern,message);checks++;};
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const definition=async signature=>(await q('select pg_get_functiondef(to_regprocedure($1)) d',[signature]))[0].d;
 const sourceSignature='public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)';
 const projectionSignature='vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(jsonb)';
 const priorSignature='vnext_runtime.validate_daily_ai_financial_refresh_umc_ir_v1(jsonb,jsonb,jsonb,timestamptz,date)';
 const stage=async(path,facts,seal,sourceHash,projectionHash)=>{
  let sql=await readFile(new URL('../research/'+path,import.meta.url),'utf8');
  const text=canonical(facts);
  for(const[key,value]of Object.entries({'__SOURCE_SEAL__':seal,'__FACTS_HASH__':sha(text),'__REGISTRY_CUTOFF__':cutoff,
   '__FACTS_TEXT__':text,'__SOURCE_RPC_BASELINE_SHA256__':sourceHash,'__PROJECTION_BASELINE_SHA256__':projectionHash}))sql=sql.replaceAll(key,value);
  // Test-memory substitution only: the real template pins its immutable old
  // registries; this fixture uses independently constructed synthetic values.
  sql=sql.replaceAll('feda7f3fd3dc513e30c62c6e398cd4d915178a11a3a52cf3c71f7cbfc435c36e',sha(canonical(issuer14)))
   .replaceAll('294e037c75a35ae1ab272540685bede596c92c2f7677007c10c3d0bca0ed346b',sha(canonical(umc12)));
  assert(!/__(?:SOURCE_SEAL|FACTS_HASH|REGISTRY_CUTOFF|FACTS_TEXT|SOURCE_RPC_BASELINE_SHA256|PROJECTION_BASELINE_SHA256)__/.test(sql));
  await db.exec(sql);
 };
 const call=async(base,incoming,proof,at=cutoff)=>(await q(`select public.daily_stock_ai_intake_v1(
  'SOURCE','00000000-0000-4000-8000-000000000001',null,$1,$2,null,$3,null,null,$4) r`,[incoming,base,at,proof]))[0].r;
 const replay=(schema,seal,facts)=>({schema,source_seal_sha256:seal,facts_sha256:sha(canonical(facts)),
  fact_ids:facts.map(f=>f.id).sort(),source_refetched:false,source_admitted:false,member_publication_approved:false});
 const instSeal=sha('SYNTHETIC_144_REGISTRY_IDENTITY'),nativeSeal=sha('SYNTHETIC_NATIVE16_REGISTRY_IDENTITY');
 const proof144={institutional_replay:replay('DAILY_AI_OFFICIAL_INSTITUTIONAL_REPLAY_V1',instSeal,institutional)};
 const proof16={...proof144,issuer16_replay:replay('DAILY_AI_ISSUER16_IR_REPLAY_V1',nativeSeal,issuer16)};
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema vnext_private;create schema vnext_runtime;
   create function vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(p_inputs jsonb) returns jsonb
    language sql immutable set search_path='' as $$select p_inputs$$;
   create function vnext_runtime.validate_daily_ai_financial_refresh_umc_ir_v1(
    p_base jsonb,p_incoming jsonb,p_proof jsonb,p_cutoff timestamptz,p_day date) returns jsonb
    language plpgsql stable set search_path='' as $$declare old_item jsonb;new_item jsonb;begin
     if jsonb_array_length(p_base)<>72 or jsonb_array_length(p_incoming)<>72 then raise exception 'SYNTHETIC_PRIOR_SCOPE';end if;
     for old_item in select * from jsonb_array_elements(p_base) loop
      select x into strict new_item from jsonb_array_elements(p_incoming)x where x->>'symbol'=old_item->>'symbol';
      if new_item->'facts' is distinct from old_item->'facts' then raise exception 'SYNTHETIC_PRIOR_RETAINED_BYTES';end if;
     end loop;return coalesce(p_proof,'{}'::jsonb);end$$;
   create function public.daily_stock_ai_intake_v1(p_op text,p_intake_id uuid,p_lease uuid default null,
    p_inputs jsonb default null,p_gaps jsonb default null,p_batch_id text default null,p_code text default null,
    p_symbol_gaps jsonb default null,p_market jsonb default null,p_financial_refresh jsonb default null) returns jsonb
    language plpgsql security definer set search_path='' as $$begin
     if p_op is distinct from 'SOURCE' then raise exception 'SYNTHETIC_SOURCE_ONLY';end if;
     return vnext_runtime.validate_daily_ai_financial_refresh_umc_ir_v1(p_gaps,p_inputs,p_financial_refresh,
      p_code::timestamptz,(p_code::timestamptz at time zone 'Asia/Taipei')::date);end$$;
   revoke all on function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
   grant execute on function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb) to service_role;
   create table vnext_private.verified_issuer_ir_facts_v1(source_seal_sha256 text,facts_sha256 text,facts_text text,
    ingestion_verified boolean,source_admitted boolean,member_publication_approved boolean);
   create table vnext_private.verified_umc_ir_facts_v1(like vnext_private.verified_issuer_ir_facts_v1 including all);`);
  for(const[table,seal,facts]of[['verified_issuer_ir_facts_v1',issuerSeal,issuer14],['verified_umc_ir_facts_v1',umcSeal,umc12]])
   await q('insert into vnext_private.'+table+' values($1,$2,$3,true,false,false)',[seal,sha(canonical(facts)),canonical(facts)]);
  const oldValidator=await definition(priorSignature),oldProjection=await definition(projectionSignature);
  const oldRegistries=await q('select source_seal_sha256,facts_text from vnext_private.verified_issuer_ir_facts_v1 union all select source_seal_sha256,facts_text from vnext_private.verified_umc_ir_facts_v1 order by source_seal_sha256');
  const baseline=input(),with144=append(baseline,institutional);
  await rejects(()=>call(baseline,with144,proof144),/SYNTHETIC_PRIOR_RETAINED_BYTES/,'Prior gate really rejects unadmitted generic institutional additions');
  await stage('institutional-source-replay.template.sql',institutional,instSeal,sha(await definition(sourceSignature)),sha(oldProjection));
  equal((await call(baseline,with144,proof144)).institutional_replay,proof144.institutional_replay);
  equal((await call(with144,with144,{})).institutional_replay,proof144.institutional_replay,'Exact previous set can replay without fabricated additions');
  await rejects(()=>call(baseline,with144,{}),/INSTITUTIONAL_PROOF_REQUIRED/);
  await rejects(()=>call(baseline,with144,proof144,beforeCutoff),/INSTITUTIONAL_FACT_DRIFT/);
  const mutate144=async(change,base=baseline)=>{const next=structuredClone(with144);change(next);await rejects(()=>call(base,next,proof144),/INSTITUTIONAL_|SYNTHETIC_PRIOR_/);};
  for(const change of [i=>i[0].facts.pop(),i=>i[0].facts.at(-1).values.net_shares++,i=>i[0].facts.at(-1).basis='TWD',
   i=>i[0].facts.at(-1).unit='LOTS',i=>i[0].facts.at(-1).not_currency=false,i=>i[0].facts.at(-1).available_at=cutoff,
   i=>i[0].facts.at(-1).source='https://example.invalid/forged',i=>i[0].facts.at(-1).source_admitted=true,
   i=>i[1].facts.push(i[0].facts.pop())])await mutate144(change);
  const partialOld=structuredClone(with144);partialOld[0].facts.pop();await rejects(()=>call(partialOld,with144,proof144),/INSTITUTIONAL_FACT_DRIFT/);
  const generic=structuredClone(with144);generic[0].facts.push({...institutional[0],id:'INSTITUTIONAL-UNKNOWN-NEW'});
  await rejects(()=>call(baseline,generic,proof144),/SYNTHETIC_PRIOR_RETAINED_BYTES/,'Unknown same-prefix additions are not stripped');
  for(const change of [p=>p.institutional_replay.source_admitted=true,p=>p.institutional_replay.fact_ids.reverse(),p=>p.institutional_replay.extra=true]){
   const p=structuredClone(proof144);change(p);await rejects(()=>call(baseline,with144,p),/INSTITUTIONAL_PROOF_REQUIRED_OR_DRIFT/);
  }
  // New isolated compatibility branch: distinct observed receipts share a row ID
  // without claiming the sealed receipt or changing any timestamp.
  let compatibility=await readFile(new URL('../research/institutional-existing-capture.candidate.sql',import.meta.url),'utf8');
  compatibility=compatibility.replaceAll('322a73e452f1f5c25561925d87cb37500f1f6bacb832d84cfd1f8a822e8ef3c8',instSeal)
   .replace('c6aa315d3d957dfea4126af5b126255ce1b9a9eb3826f475e4f7c3e084808d59',sha(await definition('vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(jsonb,jsonb,jsonb,timestamptz,date)')));
  // Only this synthetic registry uses a different seal. Obtain PostgreSQL's
  // normalized after-image in a rolled-back fixture transaction; the full
  // nested test separately enforces the unchanged real before/after hashes.
  const candidateCreate=compatibility.match(/create or replace function[\s\S]*?end \$fn\$;/)?.[0];assert(candidateCreate);
  await db.exec('begin;'+candidateCreate);
  const fixtureCandidateHash=sha(await definition('vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(jsonb,jsonb,jsonb,timestamptz,date)'));
  await db.exec('rollback');
  compatibility=compatibility.replace('f5d0235827dda68d85fafe050e8b462b4be2bc94d5b3938b5789d3e94c5e180b',fixtureCandidateHash);
  await db.exec(compatibility);
  const observed=institutional.map(f=>{const v=structuredClone(f);for(const k of ['unit','not_currency','source_admitted','member_publication_approved','source_received_at','source_sha256','source_bytes','source_locator'])delete v[k];
   v.first_seen_at='2026-11-01T23:30:00.000Z';v.available_at=v.first_seen_at;return v;});
  const withObserved=append(baseline,observed);
  equal(await call(withObserved,withObserved,{}),{},'Different receipt of exact row remains unchanged without registry proof');
  await rejects(()=>call(withObserved,withObserved,{},beforeCutoff),/INSTITUTIONAL_EXISTING_CAPTURE_DRIFT/,'Registry cutoff still enforced');
  for(const change of [i=>i[0].facts.at(-1).values.net_shares++,i=>i[0].facts.at(-1).available_at='2026-11-02T00:00:00.001Z',
    i=>i[0].facts.at(-1).source_admitted=true,i=>i[0].facts.pop(),i=>i[1].facts.push(i[0].facts.pop())]){
   const modified=structuredClone(withObserved);change(modified);
   await rejects(()=>call(withObserved,modified,{}),/INSTITUTIONAL_EXISTING_CAPTURE_DRIFT/);
  }
  for(const change of [i=>i[0].facts.at(-1).values.net_shares++,i=>i[0].facts.at(-1).evidence_hash='b'.repeat(64),
    i=>i[0].facts.at(-1).available_at='2026-11-02T00:00:00.001Z',i=>i[0].facts.at(-1).source_admitted=true]){
   const modified=structuredClone(withObserved);change(modified);
   await rejects(()=>call(modified,modified,{}),/INSTITUTIONAL_EXISTING_CAPTURE_DRIFT/,'Equal altered base/input cannot bypass registry identity checks');
  }
  await db.exec(`create or replace function vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(p_inputs jsonb) returns jsonb
   language sql immutable set search_path='' as $$select jsonb_agg(case when x->>'symbol'='2454' then jsonb_set(x,'{facts}','[]'::jsonb) else x end) from jsonb_array_elements(p_inputs)x$$`);
  await rejects(()=>call(withObserved,withObserved,{}),/INSTITUTIONAL_PROJECTION_TRUNCATED/,'Projection loss fails closed');
  await db.exec(oldProjection);
  await stage('issuer16-source-replay.template.sql',issuer16,nativeSeal,sha(await definition(sourceSignature)),sha(oldProjection));
  const full=append(with144,issuer16),result=await call(with144,full,proof16);
  equal(result.institutional_replay,proof144.institutional_replay);equal(result.issuer16_replay,proof16.issuer16_replay);
  equal((await call(full,full,{})).issuer16_replay,proof16.issuer16_replay,'Second full replay preserves native identity');
  await rejects(()=>call(with144,full,proof144),/ISSUER16_PROOF_REQUIRED/);
  await rejects(()=>call(with144,full,proof16,beforeCutoff),/ISSUER16_FACT_DRIFT/);
  for(const change of [i=>i.find(s=>s.symbol==='3006').facts.pop(),i=>i.find(s=>s.symbol==='3006').facts.at(-1).values.value++,
   i=>i.find(s=>s.symbol==='3006').facts.at(-1).basis='AS_REPORTED',i=>i.find(s=>s.symbol==='3006').facts.at(-1).values.unit='TWD',
   i=>i.find(s=>s.symbol==='3006').facts.at(-1).source_admitted=true,i=>i[0].facts.push(i.find(s=>s.symbol==='3006').facts.pop())]){
   const next=structuredClone(full);change(next);await rejects(()=>call(with144,next,proof16),/ISSUER16_|SYNTHETIC_PRIOR_/);
  }
  for(const change of [i=>i.forEach(s=>s.facts=s.facts.filter(f=>!f.id.startsWith('issuer-ir-direct:')&&!f.id.startsWith('umc-ir-direct:'))),
   i=>{const s=i.find(s=>s.symbol==='2303'),id=s.facts.find(f=>f.id.startsWith('umc-ir-direct:')).id;s.facts=s.facts.filter(f=>f.id!==id);},
   i=>i.find(s=>s.symbol==='2454').facts[1].values.value++,
   i=>{const s=i.find(s=>s.symbol==='2454'),f=s.facts.find(f=>f.id.startsWith('issuer-ir-direct:'));s.facts=s.facts.filter(x=>x!==f);i[5].facts.push(f);}]){
   const old=structuredClone(with144),next=structuredClone(full);change(old);change(next);
   await rejects(()=>call(old,next,proof16),/ISSUER16_REQUIRED_COMPLETE_26/,'Native16 requires exact original26 in both arrays');
  }
  const missingOld26=structuredClone(with144),oldUmc=missingOld26.find(s=>s.symbol==='2303');oldUmc.facts=oldUmc.facts.filter(f=>f.id!==oldUmc.facts.find(x=>x.id.startsWith('umc-ir-direct:')).id);
  await rejects(()=>call(missingOld26,full,proof16),/ISSUER16_REQUIRED_COMPLETE_26/,'Correct result cannot cover a partial original baseline');
  const partial16=structuredClone(full);partial16.find(s=>s.symbol==='3006').facts.pop();await rejects(()=>call(partial16,full,proof16),/ISSUER16_FACT_DRIFT/);
  const unknown16=structuredClone(full);unknown16[0].facts.push({...issuer16[0],symbol:unknown16[0].symbol,id:'native16-SYNTHETIC-UNKNOWN'});
  await rejects(()=>call(with144,unknown16,proof16),/SYNTHETIC_PRIOR_RETAINED_BYTES/,'Unknown native-source IDs reach the unchanged strict prior gate');
  for(const change of [p=>p.issuer16_replay.source_refetched=true,p=>p.issuer16_replay.member_publication_approved=true,p=>p.issuer16_replay.fact_ids.pop()]){
   const p=structuredClone(proof16);change(p);await rejects(()=>call(with144,full,p),/ISSUER16_PROOF_REQUIRED_OR_DRIFT/);
  }
  equal(await definition(priorSignature),oldValidator,'Old financial validator byte-for-byte unchanged');
  equal(await definition(projectionSignature),oldProjection,'Existing projector byte-for-byte unchanged');
  equal(await q('select source_seal_sha256,facts_text from vnext_private.verified_issuer_ir_facts_v1 union all select source_seal_sha256,facts_text from vnext_private.verified_umc_ir_facts_v1 order by source_seal_sha256'),oldRegistries,'Original synthetic26 registries not changed');
  for(const[table,loader,seal,facts]of[
   ['verified_institutional_facts_20261029_30_v1','load_daily_stock_ai_institutional_replay_v1',instSeal,institutional],
   ['verified_issuer16_facts_v1','load_daily_stock_ai_issuer16_replay_v1',nativeSeal,issuer16]]){
   equal((await q("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",['vnext_private.'+table]))[0],{relrowsecurity:true,relforcerowsecurity:true});
   for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);
    await rejects(()=>q('select public.'+loader+'($1,$2::timestamptz)',[seal,cutoff]),/permission denied/);
    await rejects(()=>q('select * from vnext_private.'+table),/permission denied/);
    await rejects(()=>call(with144,full,proof16),/permission denied/);await db.exec('reset role');
   }
   await db.exec('set role service_role');
   equal((await q('select public.'+loader+'($1,$2::timestamptz) r',[seal,cutoff]))[0].r.facts,facts);
   await rejects(()=>q('select public.'+loader+'($1,$2::timestamptz)',[seal,beforeCutoff]),/FUTURE_RECEIPT/);
   await rejects(()=>q('select public.'+loader+'($1,$2::timestamptz)',['f'.repeat(64),cutoff]),/REGISTRY_SCOPE/);
   await rejects(()=>q('select * from vnext_private.'+table),/permission denied/);await db.exec('reset role');
   for(const operation of ['update vnext_private.'+table+' set source_admitted=source_admitted','delete from vnext_private.'+table,'truncate vnext_private.'+table])
    await rejects(()=>db.exec(operation),/REGISTRY_IMMUTABLE/);
  }
  await db.exec('set role service_role');equal((await call(with144,full,proof16)).issuer16_replay,proof16.issuer16_replay,'Service-only SOURCE wrapper executes under its original definer');await db.exec('reset role');
  equal((await q('select count(*)::int n from vnext_private.verified_institutional_facts_20261029_30_v1'))[0].n,1);
  equal((await q('select count(*)::int n from vnext_private.verified_issuer16_facts_v1'))[0].n,1);
  t.diagnostic(JSON.stringify({assertions:checks,fixture:'SYNTHETIC_ONLY',production_e2e:false,model_calls:0,production_writes:0}));
 }finally{await db.close();}
});
