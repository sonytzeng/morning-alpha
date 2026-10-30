import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCompletedResearch,completedPlanState} from '../src/features/vnext/completedResearch.ts';
import {completedFixture,completedResponse} from './helpers/completedResearchFixture.mjs';
const at=Date.parse('2026-10-30T14:00:00Z');
test('complete 72-stock / three-horizon Owner snapshot retains the actual data date',async()=>{
 const result=await parseCompletedResearch(await completedResponse(),at);assert.equal(result.rows.length,216);assert.equal(result.data_through,'2026-10-30');
 assert.equal(result.focus[0].plan.status,'WAIT_CONFIRMATION');assert.equal(result.member_published,false);
 assert.equal(await parseCompletedResearch({schema:'VNEXT_COMPLETED_OWNER_V1',owner_only:true,snapshot_text:null,snapshot_hash:null},at),null);
});
test('tampered hash and member/forward promotion flags fail closed',async()=>{
 const response=await completedResponse();response.snapshot_hash='f'.repeat(64);await assert.rejects(()=>parseCompletedResearch(response,at),/COMPLETED_HASH/);
 for(const [key,value] of [['owner_only',false],['member_published',true],['forward_sample',1],['mode','FORWARD_SHADOW']]){
  const body=completedFixture();body[key]=value;await assert.rejects(()=>completedResponse(body).then(r=>parseCompletedResearch(r,at)),/COMPLETED_SCOPE/);
 }
});
test('missing or duplicated horizons and cross-horizon company/price mismatches are rejected',async()=>{
 for(const mutate of [b=>b.rows.pop(),b=>b.rows[1]={...b.rows[0]},b=>b.rows[1].close=101,b=>b.rows[1].company='不同公司']){
  const b=completedFixture();mutate(b);await assert.rejects(()=>completedResponse(b).then(r=>parseCompletedResearch(r,at)),/COMPLETED_UNIVERSE/);
 }
});
test('future analysis, incomplete closing data and unsafe sources are rejected',async()=>{
 for(const mutate of [b=>b.evaluated_at='2026-10-31T14:00:00Z',b=>b.data_through='2026-10-31',b=>b.rows[0].sources=['javascript:alert(1)']]){
  const b=completedFixture();mutate(b);await assert.rejects(()=>completedResponse(b).then(r=>parseCompletedResearch(r,at)),/COMPLETED_(CHRONOLOGY|SOURCE)/);
 }
});
test('invalid risk, price and event states cannot display as a valid conditional plan',async()=>{
 for(const mutate of [p=>p.status='ENTRY_READY',p=>p.pending=[],p=>p.stop=100,p=>p.no_chase=101,p=>p.range.reverse(),p=>p.reward_risk=1.9,p=>p.valid_until=p.valid_from]){
  const b=completedFixture();mutate(b.focus[0].plan);await assert.rejects(()=>completedResponse(b).then(r=>parseCompletedResearch(r,at)),/COMPLETED_PLAN/);
 }
});
test('older data stays readable but price plans expire and cannot be revived by viewing later',async()=>{
 const b=completedFixture(),p=b.focus[0].plan;
 assert.equal(completedPlanState(p,at),'UPCOMING');assert.equal(completedPlanState(p,Date.parse(p.valid_from)),'CONDITIONAL');
 assert.equal(completedPlanState(p,Date.parse(p.valid_until)),'EXPIRED');assert.equal(completedPlanState(p,Date.parse('2026-11-10T00:00:00Z')),'EXPIRED');
 assert.equal((await parseCompletedResearch(await completedResponse(b),Date.parse('2026-11-10T00:00:00Z'))).data_through,'2026-10-30');
});
test('Owner-only read shares existing abort, identity, date and entitlement invalidation',()=>{
 const s=readFileSync(new URL('../src/pages/vnext/MemberPage.tsx',import.meta.url),'utf8');
 assert.match(s,/if\(data\.tier==='owner'&&!account\)/);assert.match(s,/rpc\('get_owner_completed_research_v1'\)\.abortSignal\(controller\.signal\)/);
 assert.match(s,/if\(valid\(\)\)setState\(\{identity:access\.id,generation:access\.generation,readEpoch:epoch,requestDate,data,completed,completedError\}\)/);
 assert.match(s,/data\.tier==='owner'&&state\?\.completed\?/);assert.match(s,/setState\(null\)/);
 assert(!s.includes('localStorage'));assert(!s.includes('sessionStorage'));
});
