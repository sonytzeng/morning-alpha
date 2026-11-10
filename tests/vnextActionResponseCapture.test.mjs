/** Synthetic source contracts only; no external requests or performance claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchSource,assembleDaily,directoryPlan} from '../src/features/vnext/dailyAdapter.ts';
import {captureActionResponse,validateActionResponseCapture,ACTION_RESPONSE_MAX_BYTES,ACTION_RECEIPT_MAX_BYTES} from '../src/features/vnext/dailyActionCapture.ts';
import {ACTION_SOURCES,parseActionInventory} from '../src/features/vnext/dailyParsers.mjs';
import {workDailyRun} from '../src/features/vnext/dailyRuntime.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';

const at='2026-10-12T00:00:00.000Z',date='2026-10-12',encoder=new TextEncoder();
const actionTask=()=>({key:'a'.repeat(64),kind:'ACTION',url:'https://www.twse.com.tw/rwd/zh/exRight/TWT49U?startDate=20250901&endDate=20261008&response=json',
 format:'json',scope:'SYNTHETIC_ACTION_CAPTURE',symbols:['2330'],from:'2025-09-01',through:'2026-10-08',action_index:0,max_age_days:1});
const rawAction=()=>({stat:'OK',fields:[...ACTION_SOURCES[0].fields,'權值＋息值','權/息','漲停價格','跌停價格','開盤競價基準','減除股利參考價','詳細資料'],
 data:[['115年09月16日','2330','合成公司','100','93','7','權息','110','80','93','94','2330,20260916']],retained_unknown_field:{label:'完整原文',value:7}});
const fetchAction=text=>fetchSource(actionTask(),async()=>new Response(text),()=>at,new AbortController().signal);

test('future ACTION preserves exact decoded text and existing canonical-string raw_hash without upgrading completeness',async()=>{
 const text='\n '+JSON.stringify(rawAction(),null,1)+'\n',receipt=await fetchAction(text);
 assert.equal(receipt.raw_response.text,text);
 assert.equal(receipt.raw_response.schema,'VNEXT_ACTION_RESPONSE_TEXT_V1');
 assert.equal(receipt.raw_response.hash_scheme,'SNAPSHOT_HASH_CANONICAL_JSON_STRING_SHA256');
 assert.equal(receipt.raw_response.response_bytes,encoder.encode(text).length);
 assert.equal(receipt.raw_response.text_utf8_bytes,encoder.encode(text).length);
 assert.equal(receipt.raw_hash,await snapshotHash(text));
 assert.notEqual(receipt.raw_hash,createHash('sha256').update(text).digest('hex'),'raw_hash remains the existing JSON-string scheme');
 assert.deepEqual(JSON.parse(receipt.raw_response.text),rawAction());
 assert.equal(receipt.payload.complete,false);assert.equal(receipt.payload.rows[0].cash_per_share,null);
 assert.equal(receipt.payload.rows[0].adjustment_applied,false);
 assert.equal(receipt.first_seen_at,at);assert.equal(receipt.available_at,at);assert.equal(receipt.published_at,null);
 assert.equal(await validateActionResponseCapture(receipt.raw_response,receipt.raw_hash),'RETAINED_TEXT_VALID');
});

test('non-ACTION receipts keep their existing shape and raw_hash semantics',async()=>{
 const task=(await directoryPlan(date))[0],text=JSON.stringify([]);
 const receipt=await fetchSource(task,async()=>new Response(text),()=>at,new AbortController().signal);
 assert.equal(Object.hasOwn(receipt,'raw_response'),false);assert.equal(receipt.raw_hash,await snapshotHash(text));
});

test('legacy ACTION is read unchanged and capture never changes acquired facts or snapshot identity',async()=>{
 const receipt=await fetchAction(JSON.stringify(rawAction())),legacy=structuredClone(receipt);delete legacy.raw_response;
 const before=JSON.stringify(legacy);
 assert.equal(await validateActionResponseCapture(undefined,legacy.raw_hash),'LEGACY_CAPTURE_ABSENT');
 const oldResult=await assembleDaily(date,[],[legacy],at),newResult=await assembleDaily(date,[],[receipt],at);
 assert.deepEqual(newResult,oldResult);assert.equal(JSON.stringify(legacy),before);
 assert.equal(legacy.payload.complete,false);assert.equal(Object.hasOwn(legacy,'raw_response'),false);
});

test('cached capture verifies exact text, scheme, byte counts and scope before assembly',async()=>{
 const good=await fetchAction(JSON.stringify(rawAction()));
 for(const [change,code] of [
  [r=>{r.raw_response.text+=' ';r.raw_response.response_bytes++;r.raw_response.text_utf8_bytes++;},/ACTION_RESPONSE_HASH_MISMATCH/],
  [r=>{r.raw_response.hash_scheme='HTTP_BYTES_SHA256';},/ACTION_RESPONSE_CAPTURE_INVALID/],
  [r=>{r.raw_response.response_bytes--;},/ACTION_RESPONSE_CAPTURE_INVALID/],
  [r=>{r.raw_response.complete=true;},/ACTION_RESPONSE_CAPTURE_INVALID/],
  [r=>{r.task.kind='PRICE';},/ACTION_RESPONSE_SCOPE/]
 ]){const bad=structuredClone(good);change(bad);await assert.rejects(()=>assembleDaily(date,[],[bad],at),code);}
});

test('UTF-8 and BOM are lossless and explicit; replacement decoding is rejected',async()=>{
 const text=JSON.stringify(rawAction()),body=encoder.encode(text),bomBody=new Uint8Array(body.length+3);
 bomBody.set([0xef,0xbb,0xbf]);bomBody.set(body,3);
 const capture=captureActionResponse(bomBody);
 assert.equal(capture.text,text);assert.equal(capture.utf8_bom_removed,true);
 assert.equal(capture.response_bytes,capture.text_utf8_bytes+3);
 assert.equal(await validateActionResponseCapture(capture,await snapshotHash(text)),'RETAINED_TEXT_VALID');
 const receipt=await fetchAction(bomBody);assert.equal(receipt.raw_hash,await snapshotHash(text));
 for(const bytes of [new Uint8Array([0xc0,0xaf]),new Uint8Array([0xed,0xa0,0x80]),new Uint8Array([0xe4,0xb8])])
  assert.throws(()=>captureActionResponse(bytes),/ACTION_RESPONSE_ENCODING/);
});

test('response byte limit rejects before retention rather than truncating an oversized reply',async()=>{
 await assert.rejects(()=>fetchAction(new Uint8Array(ACTION_RESPONSE_MAX_BYTES+1).fill(32)),/SOURCE_SIZE_LIMIT/);
});

test('TWSE cash requires one explicitly named per-share field and is never inferred from reference prices',()=>{
 const parse=p=>parseActionInventory(ACTION_SOURCES[0],p,['2330'],actionTask().url,at,'2025-09-01','2026-10-08')[0];
 assert.equal(parse(rawAction()).cash_per_share,null);
 for(const label of ['每股現金股利','(每股配發現金股利)除息','現金股利(元/股)']){
  const p=rawAction();p.fields.push(label);p.data[0].push('6.000035 元／股');
  assert.equal(parse(p).cash_per_share,6.000035);assert.equal(parse(p).adjustment_applied,false);
 }
 for(const label of ['權值＋息值','現金股利總額','現金股利']){const p=rawAction();p.fields.push(label);p.data[0].push('6');assert.equal(parse(p).cash_per_share,null);}
 const duplicate=rawAction();duplicate.fields.push('每股現金股利','每股配發現金股利');duplicate.data[0].push('6','6');
 assert.throws(()=>parse(duplicate),/ACTION_CASH_FIELD_AMBIGUOUS/);
 const negative=rawAction();negative.fields.push('每股現金股利');negative.data[0].push('-6');
 assert.throws(()=>parse(negative),/ACTION_CASH_FIELD_INVALID/);
});

async function failingWorker({oversize=false}={}){
 const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'合成控制',exchange:'TWSE',industry:'24'}));
 const cache=new Map(await Promise.all((await directoryPlan(date)).map(async task=>{
  const payload={rows:task.exchange==='TWSE'?companies:[]};return [task.key,{task,payload,payload_hash:await snapshotHash(payload),raw_hash:await snapshotHash('synthetic'),
   first_seen_at:at,available_at:at,published_at:null,as_of:at,version:'VNEXT_DAILY_OFFICIAL_1',status:'OK',reason:null}];
 })));
 const task=actionTask(),calls=[],run={id:'synthetic-action-run',business_date:date,actionable_at:'2026-10-12T09:00:00+08:00',lease:'synthetic',fence:1,plan:[task],cursor:0,checkpoint:{}};
 const raw=rawAction();if(oversize)raw.padding='\\'.repeat(3_100_000);
 const text=JSON.stringify(raw);assert(encoder.encode(text).length<ACTION_RESPONSE_MAX_BYTES);
 if(oversize)assert(encoder.encode(JSON.stringify({raw_response:{text}})).length>ACTION_RECEIPT_MAX_BYTES);
 const result=await workDailyRun(run.id,{clock:()=>at,sleep:async()=>{},fetcher:async()=>new Response(text),rpc:async(name,args)=>{
  if(name==='claim_vnext_daily_research_v1')return {status:'ACQUIRED',run:structuredClone(run)};
  const op=args.p_op,data=args.p_data;calls.push({op,data});
  if(op==='DUE_OUTCOMES')return [];
  if(op==='SOURCE_BEGIN')return cache.has(data.key)?{status:'CACHE',receipt:cache.get(data.key)}:{status:'FETCH'};
  if(op==='SOURCE_SAVE')throw Error('DATABASE_RPC_REJECTED');
  if(op==='SOURCE_FAIL'||op==='FINISH')return {};
  throw Error('UNEXPECTED_ACTION_TEST_RPC_'+op);
 }});
 return {result,calls};
}

test('complete escaped receipt over 12 MB never reaches SOURCE_SAVE or advances the runtime cursor',async()=>{
 const {result,calls}=await failingWorker({oversize:true});
 assert.equal(result.status,'QUEUED');assert.equal(result.reason,'SOURCE_RETRY_PENDING');
 assert.equal(calls.filter(c=>c.op==='SOURCE_SAVE').length,0);
 assert.equal(calls.filter(c=>c.op==='CURSOR'||c.op==='PREDICTIONS').length,0);
 assert.equal(calls.find(c=>c.op==='SOURCE_FAIL').data.reason,'ACTION_RECEIPT_SIZE_LIMIT');
 assert.equal(calls.find(c=>c.op==='FINISH').data.status,'QUEUED');
});

test('SOURCE_SAVE rejection leaves ACTION pending and never reports acquisition complete',async()=>{
 const {result,calls}=await failingWorker();
 assert.equal(result.status,'QUEUED');assert.equal(result.reason,'SOURCE_RETRY_PENDING');
 assert.equal(calls.filter(c=>c.op==='SOURCE_SAVE').length,1);
 assert.equal(calls.filter(c=>c.op==='CURSOR'||c.op==='PREDICTIONS').length,0);
 const sent=JSON.parse(calls.find(c=>c.op==='SOURCE_SAVE').data.text);assert.equal(sent.raw_response.schema,'VNEXT_ACTION_RESPONSE_TEXT_V1');
 assert.equal(calls.find(c=>c.op==='SOURCE_FAIL').data.reason,'DATABASE_RPC_REJECTED');
});
