// SYNTHETIC ID/transport controls. SQL, not this wrapper, decides admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendCanonicalActual,V1_ACTUAL_CANONICAL_CONTRACT as contract,V1_ACTUAL_CANONICAL_FUNCTION as functionName} from '../src/features/vnext/v1ActualCanonical.ts';
const ids={source_revision_id:'10000000-0000-0000-0000-000000000001',row_id:'20000000-0000-0000-0000-000000000001'};
const receipt={...ids,contract,status:'INSERTED',earnings_event_id:'50000000-0000-0000-0000-000000000001',audit_id:'60000000-0000-0000-0000-000000000001',actual_only:true,v1_ready:false,member_publication_approved:false};
test('thin adapter sends exactly two IDs and never accepts caller data or permission',async()=>{
 let calls=0;
 const sql=async(name,args)=>{calls++;assert.equal(name,functionName);assert.deepEqual(args,{p_source_revision_id:ids.source_revision_id,p_row_id:ids.row_id});return {data:receipt,error:null};};
 assert.deepEqual(await appendCanonicalActual(ids,sql),receipt);
 for(const extra of [{quality:true},{license:true},{status:'APPROVED'},{revenue_actual:9},{announced_at:'2026-10-20T00:00:00Z'},{cutoff:'2025-01-01T00:00:00Z'},{source_authority:'APPROVED'}]){
  await assert.rejects(appendCanonicalActual({...ids,...extra},sql),/ID_ONLY_REQUIRED/);
 }
 assert.equal(calls,1);
});
test('unknown IDs, SQL refusal and forged readiness cannot become a successful receipt',async()=>{
 for(const value of [null,{},[],{...ids,row_id:null},{...ids,row_id:'not-a-uuid'}])await assert.rejects(appendCanonicalActual(value,async()=>({data:receipt,error:null})));
 await assert.rejects(appendCanonicalActual(ids,async()=>{throw Error('ACTUAL_REVIEW_MISSING');}),/ACTUAL_REVIEW_MISSING/);
 for(const patch of [{v1_ready:true},{member_publication_approved:true},{actual_only:false},{row_id:'20000000-0000-0000-0000-000000000002'},{status:'APPROVED'}]){
  await assert.rejects(appendCanonicalActual(ids,async()=>({data:{...receipt,...patch},error:null})),/SQL_RECEIPT_INVALID/);
 }
 await assert.rejects(appendCanonicalActual(ids,async()=>({data:null,error:{message:'SYNTHETIC_SQL_REFUSAL'}})),/RPC_DENIED/);
});
test('input snapshot is stable across an awaiting transport',async()=>{
 const input={...ids};let release;const wait=new Promise(r=>{release=r;});
 const work=appendCanonicalActual(input,async()=>{await wait;return {data:receipt,error:null};});input.row_id='20000000-0000-0000-0000-000000000002';release();
 assert.equal((await work).row_id,ids.row_id);
});
test('candidate exposes exactly one service-only public-schema wrapper, no sources/approvals or old table/ACL changes',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261020070000_v1_actual_canonical_candidate.sql',import.meta.url),'utf8');
 assert.doesNotMatch(sql,/alter table public\.|(?:update|delete from) public\.earnings_events|(?:grant|revoke)[^;]*on table public\./i);
 assert.equal((sql.match(/create function public\./g)||[]).length,1);
 assert.match(sql,/create function public\.append_v1_canonical_actual_candidate_v1\(p_source_revision_id uuid,p_row_id uuid\)/);
 assert.match(sql,/return v1_actual_candidate\.append_actual_v1\(p_source_revision_id,p_row_id\)/);
 assert.match(sql,/revoke all on function public\.append_v1_canonical_actual_candidate_v1\(uuid,uuid\) from public,anon,authenticated,service_role/);
 assert.match(sql,/grant execute on function public\.append_v1_canonical_actual_candidate_v1\(uuid,uuid\) to service_role/);
 assert.doesNotMatch(sql,/insert into v1_actual_candidate\.(?:authorities|source_revisions|actual_rows|independent_reviews|internal_rights)\b/i);
 assert.match(sql,/force row level security/i);assert.match(sql,/security definer set search_path=''/i);
 assert.match(sql,/v\.status is distinct from 'APPROVED'/);assert.match(sql,/g\.status is distinct from 'APPROVED'/);
 assert.match(sql,/null,null,null,null,s\.source_ref,body,clock_timestamp\(\)/);
 assert.match(sql,/raise exception 'ACTUAL_FINANCIAL_CANONICAL_METHOD_REVIEW_REQUIRED'/);
});
