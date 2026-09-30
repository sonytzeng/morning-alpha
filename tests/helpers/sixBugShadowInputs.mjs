// Seed retained upstream evidence only into the explicitly guarded local DB.
// No Report, Publication, Recommendation, LINE outcome or lifecycle PASS seed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=new URL('../../',import.meta.url);
const read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
assert.equal(process.env.MA_LOCAL_SCOPE,'ma-six-bug-preventive-20260930');
const container='ma-six-bug-shadow-db',db=process.env.MA_ISOLATED_TEST_DB||'ma_six_bug_test2';
assert.match(db,/^ma_six_bug_test\d+$/);
const sql=input=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',maxBuffer:4e6}).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`;
assert.equal(sql('select scope from ma_isolated_guard.identity'),'ma-six-bug-preventive-20260930');
assert.equal(sql('select count(*) from reports'),'0');
assert.equal(sql('select count(*) from market_checkpoint_snapshots'),'0');
const f=read('tests/fixtures/production-parity-v4/research-cross-day-20260930.json');
let commands='begin;';
function insert(table,rows){if(!rows?.length)return;const cols=Object.keys(rows[0]);assert(cols.every(x=>/^[a-z_]+$/.test(x)));commands+=`insert into public.${table} (${cols.join(',')}) overriding system value select ${cols.join(',')} from jsonb_populate_recordset(null::public.${table},${q(JSON.stringify(rows))}::jsonb);`;}
insert('market_quotes',f.market_quotes);insert('market_data',f.market_data);
insert('news_events',f.news_events);insert('news_event_tags',f.news_event_tags);
insert('runtime_quality_policies',[f.runtime_policy]);
const prior=read('tests/fixtures/production-parity-v4/runtime-sparse-recovery-20260929.json').captures.find(c=>c.checkpoint==='1430');
const batch=f.batches.find(b=>b.business_date==='2026-09-29');
insert('market_checkpoint_batches',[batch]);
const rows=prior.rows.map(r=>({...r,...f.close_rows.find(x=>x.symbol===r.symbol),batch_id:batch.batch_id,idempotency_key:batch.idempotency_key}));
insert('market_checkpoint_snapshots',rows);
insert('market_data_snapshots',rows.map(r=>({trading_date:r.trading_date,checkpoint:r.checkpoint,phase:r.market_session,symbol:r.symbol,market:r.raw.market,name:r.raw.name,value:r.value,change_percent:r.change_percent,captured_at:r.source_timestamp,source:r.source,raw:{provider:r.source,source_symbol:r.raw.source_symbol,display_symbol:r.symbol,requested_at:r.captured_at,returned_date:r.source_timestamp,freshness_status:r.raw.freshness_status,freshness_age_minutes:r.raw.freshness_age_minutes,captured_session_date:r.raw.captured_session_date,fallback_used:r.raw.fallback_used,source_raw:r.raw.source_raw,quote:{current:r.value,change:r.raw.change,change_percent:r.change_percent},request_id:r.correlation_id.slice(0,8),correlation_id:r.correlation_id,immutable_snapshot_version:r.snapshot_version,immutable_checkpoint:r.checkpoint,checkpoint_batch_id:batch.batch_id,checkpoint_idempotency_key:batch.idempotency_key,checkpoint_contract_version:batch.provider_contract_version,checkpoint:r.checkpoint}})));
sql(commands+'commit;');
console.log(JSON.stringify({scope:'LOCAL_ISOLATION_ONLY',evidence_type:'REAL_EVIDENCE',prior_close_rows:rows.length,report_rows:sql('select count(*) from reports'),integrity:JSON.parse(sql("select market_checkpoint_batch_integrity_v1('2026-09-29','1430')"))}));
