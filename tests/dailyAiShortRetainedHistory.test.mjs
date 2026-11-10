import test from 'node:test';
import assert from 'node:assert/strict';
import {bindRetainedShortHistory} from '../research/daily-ai-short-retained-history.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {canonical} from '../research/entry-opportunity.ts';

async function fixture(){
 const source='https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20261001&stockNo=2330',at='2026-11-04T23:00:00Z';
 const bar={id:'original-2330-2026-10-01',symbol:'2330',date:'2026-10-01',open:100,high:103,low:99,close:102,volume:1000,amount:102000,
  source,source_ref:source,available_at:at,first_seen_at:at,published_at:null,as_of:'2026-10-01T13:30:00+08:00',evidence_hash:'b'.repeat(64),session_scope:'OFFICIAL_STOCK_DAY'};
 const receipt={task:{key:'key',kind:'PRICE',url:source,exchange:'TWSE',symbols:['2330'],month:'2026-10'},
  status:'OK',payload:{rows:[bar],rejected:[]},as_of:at,available_at:at,first_seen_at:at,published_at:null,raw_hash:'a'.repeat(64)};
 receipt.payload_hash=await snapshotHash(receipt.payload);const text=canonical(receipt),id=await snapshotHash(receipt);
 return {schema:'MORNING_ALPHA_RETAINED_2330_MARKET_SNAPSHOT_V1',symbol:'2330',read_at:'2026-11-10T10:00:00Z',source_relation:'vnext_runtime.source_revisions',
  price_receipts:[{revision_id:id,source,task_key:'key',received_at:at,created_at:'2026-11-04T23:00:01Z',is_projection:false,
   original_row_count:1,selected_row_count:1,receipt_document:receipt,original_payload_text:text}],action_receipts:[]};
}
const bind=s=>bindRetainedShortHistory({snapshot_text:JSON.stringify(s),symbol:'2330',as_of:'2026-11-10T11:00:00Z'});
test('complete normalized receipts bind exact hashes and retain late acquisition rather than historical bar close as availability',async()=>{
 const r=await bind(await fixture()),e=r.packets[0].evidence[0];assert.equal(e.available_at,'2026-11-04T23:00:00Z');assert.equal(e.as_of,'2026-10-01T13:30:00+08:00');
 assert.equal(r.verified_normalized_receipts.length,1);assert.equal(r.raw_http_bytes_verified,false);assert.equal(r.source_use_approval,null);assert.equal(r.member_published,false);
});
test('tampered original bytes or payloads cannot reach calibration',async()=>{
 const s=await fixture();s.price_receipts[0].receipt_document.payload.rows[0].close=101;await assert.rejects(()=>bind(s),/receipt.hash/);
 const t=await fixture();t.price_receipts[0].original_payload_text+=' ';await assert.rejects(()=>bind(t),/receipt.hash/);
});
test('a projected full-market payload is excluded instead of claiming its projection hash equals the original receipt',async()=>{
 const s=await fixture(),projected=structuredClone(s.price_receipts[0]);projected.revision_id='c'.repeat(64);projected.is_projection=true;
 projected.original_payload_text=null;projected.original_row_count=1000;s.price_receipts.push(projected);
 const r=await bind(s);assert.equal(r.packets.length,1);assert.equal(r.excluded_projections.length,1);
 assert.notEqual(r.excluded_projections[0].projection_hash,projected.revision_id);assert.equal(r.verified_normalized_receipts.length,1);
});
