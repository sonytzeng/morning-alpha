// Synthetic refusal / integration controls, NOT real research or Production E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildOfficialV1SourceCandidate as join} from '../research/recommendation-official-source-join.ts';
import {evidenceRows} from './fixtures/decision-evidence-rows.mjs';
import {COMPANY_EVENT_SOURCES,normalizeCompanyEvents} from '../supabase/functions/_shared/recommendation-company-events.ts';
import {buildEvidenceDecision} from '../supabase/functions/_shared/decision-v1-evidence.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
const identity={report_date:'2026-10-20',today_date:'2026-10-20',revision_id:'isolated-official-v1-test',
 generated_at:'2026-10-20T00:48:00.000Z',data_as_of:'2026-10-20T00:48:00.000Z',is_trading_day:true};
function setup(){
 const data=evidenceRows();data.news=[];data.mappings=[];data.catalysts=[];data.earnings=[];data.flows=[];
 const payload=[{'公司代號':'2330','主旨 ':'合成控制：本公司公告季度財務報告','發言日期':'1151020','發言時間':'081000',
  說明:'SYNTHETIC_PRIVATE_TEXT_MUST_NOT_ESCAPE',發言人:'SYNTHETIC_CONTACT',電話:'SYNTHETIC_CONTACT_NUMBER'}];
 const bytes=Buffer.from(JSON.stringify(payload));
 const input={source:COMPANY_EVENT_SOURCES[0],received_at:'2026-10-20T00:11:00.000Z',response_body:bytes,
  response_sha256:createHash('sha256').update(bytes).digest('hex')};
 return {data,payload,input,options:{data,identity,announcements:[input]}};
}
test('real evaluator wiring keeps unreviewed official facts separate from causal/news approval',async()=>{
 const {data,options}=setup(),before=structuredClone(data),out=await join(options);
 assert.equal(out.official_events.length,1);assert.equal(out.data.news.length,0);
 assert.equal(out.data.mappings.length,0);assert.equal(out.after.universe,3);assert.equal(out.after.evaluated,0);
 assert.equal(out.after.blocked,3);assert.equal(out.after.ready,0);
 assert.deepEqual(out.decision,buildEvidenceDecision(out.data,identity));assert.deepEqual(data,before);
 assert.equal(out.production_authorized,false);assert.equal(out.member_publication_approved,false);
 assert.deepEqual(out.business_writes,[]);assert.equal(out.forward_sample,0);
 assert.doesNotMatch(JSON.stringify(out),/SYNTHETIC_PRIVATE_TEXT|SYNTHETIC_CONTACT|response_body/);
 assert(out.issues.includes('ANNOUNCEMENT_SUBJECT_REVIEW_REQUIRED'));
});
test('an exact source-bound verified subject reaches news but never creates a beneficiary or a recommendation',async()=>{
 const {options,payload,input}=setup(),facts=await normalizeCompanyEvents(input.source,payload,input.received_at,['2330']);
 const review={symbol:'2330',source_hash:facts[0].source_hash,subject:payload[0]['主旨 '],reviewed_at:'2026-10-20T00:12:00.000Z'};
 const out=await join({...options,subject_reviews:[review]});
 assert.equal(out.data.news.length,1);assert.equal(out.data.news[0].source_hash,review.source_hash);
 assert.equal(out.data.news[0].published_at,'2026-10-20T00:10:00.000Z');
 assert.equal(out.data.news[0].first_seen_at,input.received_at);assert.equal(out.data.news[0].impact,'UNKNOWN');
 assert.equal(out.data.mappings.length,0);assert.equal(out.after.evaluated,0);assert.equal(out.after.ready,0);
 for(const candidate of out.decision.phase_evaluation.candidates){
  assert(candidate.reasons.includes('THREE_INSTITUTIONS_MISSING'));
  assert(candidate.reasons.includes('FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING'));
  assert(candidate.reasons.includes('SOURCED_COMPANY_CATALYST_MAPPING_MISSING'));
 }
});
test('retained issuer Actual reaches earnings with consensus/guidance/publication gaps intact',async()=>{
 const {options}=setup(),out=await join({...options,announcements:[]});
 assert.equal(out.data.earnings.length,4);
 for(const row of out.data.earnings){assert.equal(row.symbol,'2330');assert.equal(row.announced_at,null);
  assert.equal(row.eps_consensus,null);assert.equal(row.revenue_consensus,null);assert.equal(row.guidance_direction,null);
  assert.equal(row.actual_source.eps_basis,'DILUTED');assert.equal(row.source_admitted,false);}
 assert.equal(out.after.evaluated,0);
});
test('tampered bytes, invalid JSON, wrong source, future receipt and backdated scope fail closed',async()=>{
 const {options,input}=setup();
 for(const mutate of [o=>o.announcements[0].response_sha256='a'.repeat(64),
  o=>o.announcements[0].received_at='2026-10-20T00:49:00.000Z',
  o=>o.announcements[0].source={exchange:'TWSE',url:'https://example.test/unapproved'},
  o=>o.identity.generated_at='2026-10-19T00:48:00.000Z',
  o=>o.identity.generated_at='2026-02-30T00:48:00.000Z']){
  const o=structuredClone(options);mutate(o);await assert.rejects(join(o));
 }
 const bytes=Buffer.from('{');await assert.rejects(join({...options,announcements:[{...input,response_body:bytes,
  response_sha256:createHash('sha256').update(bytes).digest('hex')}]}));
});
test('subject mismatch, duplicate review and invented early review cannot pass or rewrite existing news',async()=>{
 const {options,payload,input}=setup(),facts=await normalizeCompanyEvents(input.source,payload,input.received_at,['2330']);
 const review={symbol:'2330',source_hash:facts[0].source_hash,subject:payload[0]['主旨 '],reviewed_at:'2026-10-20T00:12:00.000Z'};
 for(const override of [{subject:review.subject+'假的利多'},{symbol:'2317'},
  {reviewed_at:'2026-10-20T00:10:00.000Z'},{reviewed_at:'2026-10-20T00:49:00.000Z'},
  {subject:'聯絡我 user@example.test'}])await assert.rejects(join({...options,subject_reviews:[{...review,...override}]}));
 await assert.rejects(join({...options,subject_reviews:[review,review]}));
 const accepted=await join({...options,subject_reviews:[review]}),data=structuredClone(options.data);
 data.news.push({...accepted.data.news[0],title:'conflicting saved version'});
 await assert.rejects(join({...options,data,subject_reviews:[review]}),/EXISTING_ROW_CONFLICT/);
});
test('await-time caller mutation cannot change a validated source, subject or review instant',async()=>{
 const {options,payload,input}=setup(),facts=await normalizeCompanyEvents(input.source,payload,input.received_at,['2330']);
 const review={symbol:'2330',source_hash:facts[0].source_hash,subject:payload[0]['主旨 '],reviewed_at:'2026-10-20T00:12:00.000Z'};
 const pending=join({...options,subject_reviews:[review]});
 review.subject='CALLER_MUTATED_UNVERIFIED';review.reviewed_at='2099-01-01T00:00:00.000Z';input.response_body.fill(0);
 const out=await pending;assert.equal(out.data.news[0].title,payload[0]['主旨 ']);
 assert.equal(out.data.news[0].created_at,'2026-10-20T00:12:00.000Z');
});
test('aggregate source URL cannot connect an existing catalyst to a different issuer announcement',async()=>{
 const data=evidenceRows();data.news=[];
 data.catalysts[0].source_refs=[COMPANY_EVENT_SOURCES[0].url];
 const subject='合成控制：2330公司事件不是2317公告',payload=[{'公司代號':'2330','主旨':subject,'發言日期':'1150907','發言時間':'080000'}];
 const body=Buffer.from(JSON.stringify(payload)),received='2026-09-07T00:01:00.000Z',id={...identity,report_date:'2026-09-07',today_date:'2026-09-07',
  generated_at:'2026-09-07T02:00:00.000Z',data_as_of:'2026-09-07T02:00:00.000Z'};
 const facts=await normalizeCompanyEvents(COMPANY_EVENT_SOURCES[0],payload,received,['2330']);
 const out=await join({data,identity:id,announcements:[{source:COMPANY_EVENT_SOURCES[0],received_at:received,response_body:body,response_sha256:createHash('sha256').update(body).digest('hex')}],
  subject_reviews:[{symbol:'2330',source_hash:facts[0].source_hash,subject,reviewed_at:'2026-09-07T00:03:00.000Z'}]});
 assert.equal(out.data.news[0].source_list_url,COMPANY_EVENT_SOURCES[0].url);
 assert.equal(out.data.news[0].source_url,COMPANY_EVENT_SOURCES[0].url+'#record-sha256='+facts[0].source_hash);
 assert(out.decision.phase_evaluation.candidates.find(c=>c.symbol==='2317').reasons.includes('SOURCED_COMPANY_CATALYST_MAPPING_MISSING'));
 assert.equal(out.data.mappings.length,data.mappings.length); // Neither remove unrelated evidence nor invent new causal links.
});
test('official financial snapshot feeds original earnings without presenting YTD as quarterly or filling Consensus',async()=>{
 const {options}=setup(),capture={source:'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',
  first_seen_at:'2026-10-20T00:11:00.000Z',available_at:'2026-10-20T00:11:00.000Z',source_response_sha256:'b'.repeat(64),
  status:'CAPTURED_REVIEW_REQUIRED',published_at:null,source_admitted:false,rows:[{'公司代號':'2330','出表日期':'1151020','年度':'115','季別':'2',
   '營業收入':'999.00','基本每股盈餘（元）':'1.23',period_basis:'AS_REPORTED_PERIOD_BASIS_UNVERIFIED',direct_single_quarter:false,
   published_at:null,consensus:null,guidance:null,source_admitted:false,'聯絡人':'SYNTHETIC_CONTACT_MUST_NOT_ESCAPE'}]};
 const out=await join({...options,announcements:[],reported_financial_receipts:[capture]});
 const added=out.data.earnings.filter(r=>r.reported_snapshot_only===true);assert.equal(added.length,1);
 assert.equal(added[0].actual_source.reported_fields['基本每股盈餘（元）'],'1.23');
 assert.equal(added[0].eps_actual,null);assert.equal(added[0].revenue_actual,null);assert.equal(added[0].announced_at,null);
 assert.equal(out.after.evaluated,0);assert.equal(out.data.earnings.filter(r=>r.actual_only).length,4);
 assert.doesNotMatch(JSON.stringify(out),/SYNTHETIC_CONTACT_MUST_NOT_ESCAPE/);
 for(const mutate of [r=>r.available_at='2099-01-01T00:00:00.000Z',r=>r.rows[0].direct_single_quarter=true,
  r=>r.rows[0]['季別']='4',r=>r.rows[0]['基本每股盈餘（元）']='EMAIL@example.test']){
  const bad=structuredClone(capture);mutate(bad);await assert.rejects(join({...options,reported_financial_receipts:[bad]}));
 }
});
function financialReceipt(){return {
 source:'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',
 first_seen_at:'2026-10-20T00:11:00.000Z',available_at:'2026-10-20T00:12:00.000Z',source_response_sha256:'b'.repeat(64),
 status:'CAPTURED_REVIEW_REQUIRED',published_at:null,source_admitted:false,rows:[{
  '公司代號':'2330','出表日期':'1151020','年度':'115','季別':'2','營業收入':'999.00','基本每股盈餘（元）':'1.23',
  period_basis:'AS_REPORTED_PERIOD_BASIS_UNVERIFIED',direct_single_quarter:false,published_at:null,
  consensus:null,guidance:null,source_admitted:false}]
};}
function reorderJsonKeys(value){
 return Array.isArray(value)?value.map(reorderJsonKeys):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).reverse().map(([key,v])=>[key,reorderJsonKeys(v)])):value;
}
test('a JSONB-shaped financial re-read is idempotent, but every value and held-source flag still binds',async()=>{
 const {options}=setup(),capture=financialReceipt(),request={...options,announcements:[],reported_financial_receipts:[capture]};
 const first=await join(request),saved=reorderJsonKeys(first.data),before=structuredClone(saved);
 const replay=await join({...request,data:saved});
 assert.deepEqual(replay.data.earnings,saved.earnings);assert.deepEqual(saved,before);
 assert.deepEqual(replay.after,first.after);assert.equal(replay.after.evaluated,0);
 assert.equal(replay.production_authorized,false);assert.equal(replay.member_publication_approved,false);
 assert.deepEqual(replay.business_writes,[]);
 for(const change of [r=>r.actual_source.reported_fields['營業收入']='1000.00',
  r=>r.actual_source.response_sha256='c'.repeat(64),r=>r.source_admitted=true,r=>r.announced_at=capture.first_seen_at,
  r=>r.eps_consensus=0,r=>r.available_at='2026-10-20T00:13:00.000Z',r=>r.extra_unverified_field=true]){
  const bad=structuredClone(saved);change(bad.earnings.find(r=>r.reported_snapshot_only===true));
  await assert.rejects(join({...request,data:bad}),/OFFICIAL_FINANCIAL_CONFLICT/);
 }
});
test('a JSONB-shaped event re-read is idempotent without accepting changed evidence, review or publication',async()=>{
 const {options,payload,input}=setup(),facts=await normalizeCompanyEvents(input.source,payload,input.received_at,['2330']);
 const review={symbol:'2330',source_hash:facts[0].source_hash,subject:payload[0]['主旨 '],reviewed_at:'2026-10-20T00:12:00.000Z'};
 const request={...options,subject_reviews:[review]},first=await join(request),saved=reorderJsonKeys(first.data),before=structuredClone(saved);
 const replay=await join({...request,data:saved});
 assert.deepEqual(replay.data.news,saved.news);assert.deepEqual(saved,before);assert.deepEqual(replay.after,first.after);
 assert.equal(replay.data.mappings.length,0);assert.equal(replay.after.evaluated,0);
 assert.equal(replay.member_publication_approved,false);assert.deepEqual(replay.business_writes,[]);
 for(const change of [r=>r.title+='changed',r=>r.source_hash='c'.repeat(64),r=>r.publication_approved=true,
  r=>r.impact='POSITIVE',r=>r.causal_review='APPROVED',r=>r.symbols=['2317'],
  r=>r.first_seen_at='2026-10-20T00:12:00.000Z',r=>r.extra_unverified_field=true]){
  const bad=structuredClone(saved);change(bad.news[0]);
  await assert.rejects(join({...request,data:bad}),/EXISTING_ROW_CONFLICT/);
 }
});
test('financial first-seen before availability retains both instants without inventing publication or relaxing V1',async()=>{
 const {options}=setup(),capture=financialReceipt(),before=structuredClone(capture);
 const out=await join({...options,announcements:[],reported_financial_receipts:[capture]});
 const row=out.data.earnings.find(r=>r.reported_snapshot_only===true),receipt=out.source_receipts[0];
 assert.equal(row.actual_source.first_seen_at,capture.first_seen_at);
 assert.equal(row.actual_source.available_at,capture.available_at);
 assert.equal(row.id,'official-reported:'+await snapshotHash(row.actual_source));
 assert.equal(row.created_at,capture.available_at);assert.equal(row.available_at,capture.available_at);
 assert.equal(receipt.received_at,capture.first_seen_at);assert.equal(receipt.first_seen_at,capture.first_seen_at);
 assert.equal(receipt.available_at,capture.available_at);assert.equal(receipt.original_publication_time,null);
 assert.equal(row.announced_at,null);assert.equal(row.eps_actual,null);assert.equal(row.revenue_actual,null);
 assert.equal(row.eps_consensus,null);assert.equal(row.revenue_consensus,null);assert.equal(row.guidance_direction,null);
 assert.equal(row.source_admitted,false);assert.equal(receipt.source_admitted,false);assert.equal(row.actual_only,false);
 assert.equal(receipt.period_basis,'UNPROVEN_SINGLE_QUARTER_VS_YTD');
 assert.deepEqual(out.decision,buildEvidenceDecision(out.data,identity));assert.deepEqual(out.after,out.before);
 assert.equal(out.after.evaluated,0);assert.equal(out.after.blocked,3);assert.equal(out.after.ready,0);
 assert.equal(out.original_thresholds_changed,false);assert.equal(out.member_publication_approved,false);
 assert.equal(out.production_authorized,false);assert.deepEqual(out.business_writes,[]);
 assert.deepEqual(capture,before);
});
test('financial chronology compares instants across offsets and accepts availability exactly at cutoff',async()=>{
 const {options}=setup();
 for(const [first_seen_at,available_at] of [
  ['2026-10-20T08:11:00.000+08:00','2026-10-20T00:12:00.000Z'],
  ['2026-10-20T08:11:00.000+08:00','2026-10-20T00:11:00.000Z'],
  ['2026-10-20T00:11:00.000Z',identity.generated_at],
  [identity.generated_at,identity.generated_at],
  ['2026-10-20T00:11:00.001Z','2026-10-20T00:11:00.002Z']]){
  const capture={...financialReceipt(),first_seen_at,available_at};
  const out=await join({...options,announcements:[],reported_financial_receipts:[capture]});
  const row=out.data.earnings.find(r=>r.reported_snapshot_only===true),receipt=out.source_receipts[0];
  assert.equal(row.actual_source.first_seen_at,first_seen_at);assert.equal(row.actual_source.available_at,available_at);
  assert.equal(receipt.first_seen_at,first_seen_at);assert.equal(receipt.available_at,available_at);
  assert.equal(receipt.received_at,first_seen_at);assert.equal(row.created_at,available_at);
 }
});
test('each financial receipt instant independently binds row identity and candidate input hash',async()=>{
 const {options}=setup(),capture=financialReceipt();
 const run=receipt=>join({...options,announcements:[],reported_financial_receipts:[receipt]});
 const base=await run(capture),replay=await run(capture);
 assert.equal(replay.input_sha256,base.input_sha256);assert.deepEqual(replay.data.earnings,base.data.earnings);
 const baseRow=base.data.earnings.find(r=>r.reported_snapshot_only===true);
 for(const patch of [{first_seen_at:'2026-10-20T00:10:00.000Z'},{available_at:'2026-10-20T00:13:00.000Z'}]){
  const out=await run({...capture,...patch}),row=out.data.earnings.find(r=>r.reported_snapshot_only===true);
  assert.notEqual(row.id,baseRow.id);assert.notEqual(out.input_sha256,base.input_sha256);
  assert.deepEqual(row.actual_source,{...baseRow.actual_source,...patch});
  assert.equal(out.source_receipts[0].normalized_rows_sha256,base.source_receipts[0].normalized_rows_sha256);
 }
 const conflict=structuredClone(options.data);conflict.earnings.push({...baseRow,created_at:capture.first_seen_at});
 await assert.rejects(join({...options,data:conflict,announcements:[],reported_financial_receipts:[capture]}),/OFFICIAL_FINANCIAL_CONFLICT/);
});
test('both financial timestamps require a timezone and real calendar and reject reversed or future availability',async()=>{
 const {options}=setup();
 const run=capture=>join({...options,announcements:[],reported_financial_receipts:[capture]});
 for(const key of ['first_seen_at','available_at']){
  for(const value of [undefined,null,'','2026-10-20T00:11:00','2026-02-30T00:11:00Z',
   '2026-02-29T00:11:00Z','2026-04-31T00:11:00+08:00','2026-13-01T00:11:00Z',
   '2026-10-20T24:00:00Z','2026-10-20T00:11:00+24:00','2026-10-20T00:11:00+08:60']){
   await assert.rejects(run({...financialReceipt(),[key]:value}),/OFFICIAL_FINANCIAL_RECEIPT/,`${key}: ${value}`);
  }
 }
 for(const patch of [
  {first_seen_at:'2026-10-20T00:12:00.001Z'},
  {first_seen_at:'2026-10-20T00:11:00.002Z',available_at:'2026-10-20T00:11:00.001Z'},
  {first_seen_at:'2026-10-20T00:12:00.000Z',available_at:'2026-10-20T08:11:00.000+08:00'},
  {available_at:'2026-10-20T00:48:00.001Z'},
  {first_seen_at:'2026-10-20T00:48:00.001Z',available_at:'2026-10-20T00:48:00.002Z'},
  {available_at:'2026-10-20T00:48:00.000001Z'},
  {first_seen_at:'2099-01-01T00:00:00.000Z',available_at:'2099-01-01T00:00:00.000Z'}]){
  await assert.rejects(run({...financialReceipt(),...patch}),/OFFICIAL_FINANCIAL_RECEIPT/);
 }
});
