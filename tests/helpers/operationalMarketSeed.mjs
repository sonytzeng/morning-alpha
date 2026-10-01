// Only the named fresh isolation DB. Input rows, no synthesized reports/results.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=new URL('../../',import.meta.url);
assert.equal(process.env.MA_OPERATIONAL_SCOPE,'operational-market-20261001');
const db=process.env.MA_ISOLATED_TEST_DB;assert.match(db||'',/^ma_six_bug_test5\d\d$/);
const read=p=>readFileSync(new URL(p,root),'utf8');
const sql=input=>execFileSync('docker',['exec','-i','ma-six-bug-shadow-db','psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,maxBuffer:3e6,stdio:['pipe','pipe','pipe']}).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`;
assert.equal(sql('select scope from ma_isolated_guard.identity'),'ma-six-bug-preventive-20260930');
assert.equal(sql('select count(*) from reports'),'0');assert.equal(sql('select count(*) from market_checkpoint_snapshots'),'0');
if(sql("select to_regprocedure('public.ma_local_take_dispatch()') is not null")!=='t')sql(read('tests/fixtures/six-bug-loopback-transport.sql'));
const policy=JSON.parse(read('tests/fixtures/production-parity-v4/research-cross-day-20260930.json')).runtime_policy;
const columns=Object.keys(policy);assert(columns.every(k=>/^[a-z_]+$/.test(k)));
sql(`insert into runtime_quality_policies(${columns.join(',')}) select ${columns.join(',')} from jsonb_populate_record(null::runtime_quality_policies,${q(JSON.stringify(policy))}::jsonb) on conflict do nothing;`);
const fixture=JSON.parse(read('tests/fixtures/operational-market-core-20261001.json'));
const previous=JSON.parse(read('tests/fixtures/operational-market-lifecycle-20261001.json')).rows.filter(r=>r.trading_date==='2026-09-30');
for(const retained of process.argv.includes('--core-fatal')?[previous]:[previous,fixture.core.rows]){
 // SQL connector exposes numeric columns as text. The production Atomic RPC
 // accepts JSON numbers; decode the same finite values without changing them.
 const rows=retained.map(row=>({...row,value:Number(row.value),change_percent:Number(row.change_percent)}));
 assert(rows.every(row=>Number.isFinite(row.value)&&Number.isFinite(row.change_percent)));
 const first=rows[0], observed=new Date(Math.max(...rows.flatMap(r=>[Date.parse(r.captured_at),Date.parse(r.source_timestamp)]))+1000).toISOString();
 writeFileSync(new URL('node_modules/.ma-six-clock',root),observed.replace('T',' ').slice(0,19)+'\n');
 const result=JSON.parse(sql(`select commit_market_checkpoint_batch_v1(${[first.trading_date,first.checkpoint,first.market_session,first.correlation_id,first.idempotency_key].map(q).join(',')},${q(JSON.stringify(rows))}::jsonb)`));
 assert.equal(result.row_count,11);assert.equal(result.status,'COMMITTED');
 if(first.checkpoint==='PREMARKET'){
  const metadata={canonical_complete:true,core_batch_complete:true,required_core_complete:true,immutable_evidence_complete:true,
   atomic_checkpoint_complete:true,atomic_batch_id:result.batch_id,atomic_idempotency_key:first.idempotency_key,
   atomic_checkpoint_row_count:11,evidence_correlation_id:first.correlation_id};
  sql(`select advance_trading_day_state_v1(${q(first.trading_date)},'PREMARKET_CAPTURED','premarket','SUCCEEDED',${q(first.correlation_id)},${q(JSON.stringify(metadata))}::jsonb);`);
 }
}
console.log(JSON.stringify({input_type:'REAL_PRODUCTION_RETAINED_PROJECTION',committed_local_input_rows:Number(sql('select count(*) from market_checkpoint_snapshots')),
 reports:sql('select count(*) from reports'),production_writes:0}));
