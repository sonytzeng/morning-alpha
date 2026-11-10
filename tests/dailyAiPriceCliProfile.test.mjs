// Entirely synthetic saved work/profile fixtures. The real binder, calculator,
// preparer and CLI execute without a database port, source fetch or approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {canonical} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {calculateSavedDailyPrices} from '../scripts/operations/calculate-daily-prices.mjs';

const NOW='2026-11-10T00:10:00Z',CUTOFF='2026-11-09T22:00:00Z',THROUGH='2026-11-09';
const HASH=text=>createHash('sha256').update(text).digest('hex');
const source=(id,symbol,kind,body,date)=>({id,symbol,kind,source:'https://www.twse.com.tw/synthetic-cli-profile-fixture',
 published_at:date+'T09:01:00Z',available_at:date+'T09:01:00Z',time_basis:'PUBLISHED',content:JSON.stringify(body)});
const financial=symbol=>source('F-'+symbol,symbol,'FINANCIAL',{kind:'EPS',period:'2026-Q3',basis:'SYNTHETIC_TEST',value:10},'2026-11-06');
const price=(symbol,date,id)=>source(id,symbol,'PRICE',{date,close:100,currency:'TWD',price_basis:'RAW_UNADJUSTED'},date);

function template(symbol){
 return {schema:'DAILY_AI_PRICE_CALCULATION_INPUT_V1',symbol,horizon:'MEDIUM',method_id:'MEDIUM_EPS_PE_SCENARIOS_V1',currency:'TWD',
  cutoff:'2026-11-06T22:00:00Z',data_through:'2026-11-06',as_of:'2026-11-07T00:00:00Z',expires_at:'2026-11-07T05:30:00Z',
  quote_evidence_id:'P-old-'+symbol,evidence:[price(symbol,'2026-11-06','P-old-'+symbol),financial(symbol)],
  assumption_basis:{available_at:'2026-11-06T23:00:00Z',description:'SYNTHETIC fixed scenario assumptions only; not actual issuer forecasts or a reviewed investment method.',evidence_ids:['F-'+symbol]},
  invalidation:'Stop when the source earnings or diluted-share basis changes and obtain a new method review.',
  parameters:{earnings_basis:'FORWARD_12_MONTH_DILUTED_EPS',forecast_period:{start:'2027-01-01',end:'2027-12-31'},
   dilution_basis:{description:'SYNTHETIC per diluted common-share assumption.',evidence_ids:['F-'+symbol]},
   scenarios:[{name:'conservative',eps:8,pe:10},{name:'base',eps:10,pe:12},{name:'upside',eps:12,pe:14}],
   entry_scenarios:['conservative','base'],margin_of_safety:.2,stop_evidence_ids:['F-'+symbol]}};
}
function fixture({registered=false,expiredProfile=false}={}){
 const edition={id:'e'.repeat(64),evidence_cutoff:CUTOFF,prepared_at:'2026-11-10T00:00:00Z',
  expires_at:'2026-11-10T05:30:00Z',data_through:THROUGH};
 const packets=Array.from({length:72},(_,index)=>{
  const symbol=String(1000+index);return {symbol,company:'合成 CLI 測試公司 '+symbol,cutoff:CUTOFF,data_through:THROUGH,
   evidence:[price(symbol,THROUGH,'P-new-'+symbol),financial(symbol)]};
 });
 const cards=packets.flatMap(packet=>['SHORT','MEDIUM','LONG'].map(horizon=>({symbol:packet.symbol,company:packet.company,horizon,status:'WAIT'})));
 const profile={schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',symbol:'1000',horizon:'MEDIUM',
  method_id:'MEDIUM_EPS_PE_SCENARIOS_V1',created_at:'2026-11-07T00:00:01Z',
  valid_until:expiredProfile?'2026-11-10T00:09:59Z':'2026-11-20T05:30:00Z',
  revision_note:'SYNTHETIC saved method profile, not approved commercial investment research.',template_input:template('1000')};
 const profile_text=canonical(profile),profiles=[{registration_id:17,profile_text,profile_hash:HASH(profile_text),symbol:'1000',horizon:'MEDIUM'}];
 const inputs=[];
 if(registered){
  const input={...template('1001'),cutoff:CUTOFF,data_through:THROUGH,as_of:'2026-11-10T00:05:00Z',expires_at:edition.expires_at,
   quote_evidence_id:'P-new-1001',evidence:structuredClone(packets[1].evidence)};
  const input_text=canonical(input);inputs.push({registration_id:7,input_text,input_hash:HASH(input_text),symbol:'1001',horizon:'MEDIUM'});
 }
 return {schema:'DAILY_AI_PRICE_WORK_V1',batch_id:'b'.repeat(64),edition,packets,cards,inputs,profiles,member_published:false,review_required:true};
}
async function executeSaved(work,run){
 const directory=await mkdtemp(join(tmpdir(),'ma-price-cli-profile-'));
 try{
  const input=join(directory,'input.json'),output=join(directory,'output.json'),original=JSON.stringify(work);
  await writeFile(input,original);
  await run({input,output,original,directory});
  assert.equal(await readFile(input,'utf8'),original,'The saved server work must remain unchanged.');
 }finally{await rm(directory,{recursive:true,force:true});}
}
const args=(input,output,at=NOW)=>['--input',input,'--output',output,'--replay-at',at];

test('offline CLI produces a concrete profile input registration request without inventing database registration',async()=>{
 const work=fixture();await executeSaved(work,async({input,output})=>{
  const result=await calculateSavedDailyPrices(args(input,output)),saved=JSON.parse(await readFile(output,'utf8'));
  assert.equal(result.production_writes,0);assert.equal(saved.production_writes,0);assert.equal(saved.historical_replay,true);
  assert.equal(saved.member_published,false);assert.equal(saved.profile_preparation.member_published,false);
  assert.equal(saved.profile_preparation.review_required,true);
  assert.deepEqual(saved.input_registration_request,saved.profile_preparation.registration_request);
  assert.equal(saved.input_registration_request.name,'stage_daily_ai_price_inputs_batch_v1');
  assert.equal(saved.input_registration_request.args.p_batch_id,work.batch_id);
  const items=saved.input_registration_request.args.p_items;assert.equal(items.length,1);
  const item=items[0],calculationInput=JSON.parse(item.input_text);
  assert.deepEqual(Object.keys(item).sort(),['input_hash','input_text']);
  assert.equal(HASH(item.input_text),item.input_hash);assert.equal(await snapshotHash(calculationInput),item.input_hash);
  assert.equal(calculationInput.symbol,'1000');assert.equal(calculationInput.quote_evidence_id,'P-new-1000');
  assert.equal(calculationInput.data_through,THROUGH);assert.equal(calculationInput.as_of,new Date(NOW).toISOString());
  assert.deepEqual(calculationInput.parameters,JSON.parse(work.profiles[0].profile_text).template_input.parameters);
  assert.equal(saved.stage_request.args.p_items.length,0);assert.equal(saved.review_packets.length,0);
  assert.equal(saved.summary.counts.calculated,0);assert.equal(saved.summary.counts.missing_inputs,216);
  assert.equal(work.inputs.length,0);
 });
});

test('profile-prepared inputs never enter price staging alongside genuinely registered saved inputs',async()=>{
 const work=fixture({registered:true});await executeSaved(work,async({input,output})=>{
  await calculateSavedDailyPrices(args(input,output));const saved=JSON.parse(await readFile(output,'utf8'));
  assert.equal(saved.input_registration_request.args.p_items.length,1);assert.equal(saved.stage_request.args.p_items.length,1);
  const profileHash=saved.input_registration_request.args.p_items[0].input_hash;
  const staged=saved.stage_request.args.p_items[0];
  assert.equal(staged.input_hash,work.inputs[0].input_hash);assert.notEqual(staged.input_hash,profileHash);
  assert.equal(JSON.parse(staged.body_text).symbol,'1001');assert.deepEqual(JSON.parse(staged.body_text).entry_range,[64,96]);
  assert.equal(saved.review_packets.length,1);assert.equal(saved.review_packets[0].symbol,'1001');
  assert.equal(saved.summary.rows.find(row=>row.symbol==='1000'&&row.horizon==='MEDIUM').state,'METHOD_INPUT_REQUIRED');
 });
});

test('expired profiles report their blocker and do not create replacement inputs or prices',async()=>{
 await executeSaved(fixture({expiredProfile:true}),async({input,output})=>{
  await calculateSavedDailyPrices(args(input,output));const saved=JSON.parse(await readFile(output,'utf8'));
  assert.equal(saved.input_registration_request.args.p_items.length,0);assert.equal(saved.stage_request.args.p_items.length,0);
  assert(JSON.stringify(saved.profile_preparation.rows).includes('PROFILE_EXPIRED'));
  assert.equal(saved.member_published,false);assert.equal(saved.production_writes,0);
 });
});

test('expired editions fail before writing output and malformed profile bytes are never registered',async()=>{
 const work=fixture();await executeSaved(work,async({input,output})=>{
  await assert.rejects(()=>calculateSavedDailyPrices(args(input,output,work.edition.expires_at)),/PRICE_WORK_EDITION_EXPIRED/);
  await assert.rejects(()=>stat(output),{code:'ENOENT'});
 });
 const tampered=fixture();tampered.profiles[0].profile_text+=' ';
 await executeSaved(tampered,async({input,output})=>{
  await assert.rejects(()=>calculateSavedDailyPrices(args(input,output)),/PRICE_WORK_PROFILE/);
  await assert.rejects(()=>stat(output),{code:'ENOENT'});
 });
});

test('profile CLI has no network or RPC transport and preserves no-overwrite behavior',async()=>{
 const originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=()=>{requests++;throw Error('NETWORK_FORBIDDEN_IN_PROFILE_CLI_TEST');};
 try{
  await executeSaved(fixture({registered:true}),async({input,output})=>{
   await calculateSavedDailyPrices(args(input,output));const before=await readFile(output,'utf8');
   await assert.rejects(()=>calculateSavedDailyPrices(args(input,output)),{code:'EEXIST'});
   assert.equal(await readFile(output,'utf8'),before);
   assert.equal(JSON.parse(before).production_writes,0);
  });
  assert.equal(requests,0);
 }finally{globalThis.fetch=originalFetch;}
});
