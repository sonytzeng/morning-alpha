// Commit retained intraday/close inputs through the unmodified Atomic RPC.
// This seeds no Report, LINE, Closing, Learning or Acceptance outcome.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {stateForSnapshotCheckpoint} from '../../supabase/functions/_shared/runtime-checkpoint-core.mjs';
const root=new URL('../../',import.meta.url);
assert.equal(process.env.MA_OPERATIONAL_SCOPE,'operational-market-20261001');
const db=process.env.MA_ISOLATED_TEST_DB;assert.match(db||'',/^ma_six_bug_test5\d\d$/);
const sql=input=>execFileSync('docker',['exec','-i','ma-six-bug-shadow-db','psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,maxBuffer:3e6,stdio:['pipe','pipe','pipe']}).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`;
assert.equal(sql('select scope from ma_isolated_guard.identity'),'ma-six-bug-preventive-20260930');
const all=JSON.parse(readFileSync(new URL('tests/fixtures/operational-market-lifecycle-20261001.json',root),'utf8')).rows.filter(r=>r.trading_date==='2026-10-01');
const results=[];
for(const checkpoint of ['0900','0930','1030','1300','1410','1430']){
 const rows=all.filter(r=>r.checkpoint===checkpoint).map(r=>({...r,value:Number(r.value),change_percent:Number(r.change_percent)}));
 assert.equal(rows.length,11);assert(rows.every(r=>Number.isFinite(r.value)&&Number.isFinite(r.change_percent)));
 const first=rows[0],observed=new Date(Math.max(...rows.flatMap(r=>[Date.parse(r.captured_at),Date.parse(r.source_timestamp)]))+1000).toISOString();
 writeFileSync(new URL('node_modules/.ma-six-clock',root),observed.replace('T',' ').slice(0,19)+'\n');
 const result=JSON.parse(sql(`select commit_market_checkpoint_batch_v1(${[first.trading_date,checkpoint,first.market_session,first.correlation_id,first.idempotency_key].map(q).join(',')},${q(JSON.stringify(rows))}::jsonb)`));
 assert.equal(result.row_count,11);assert(['COMMITTED','ALREADY_COMMITTED'].includes(result.status));
 const metadata={canonical_complete:true,core_batch_complete:true,required_core_complete:true,immutable_evidence_complete:true,
  atomic_checkpoint_complete:true,atomic_batch_id:result.batch_id,atomic_idempotency_key:first.idempotency_key,
  atomic_checkpoint_row_count:11,evidence_correlation_id:first.correlation_id};
 const state=JSON.parse(sql(`select to_jsonb(advance_trading_day_state_v1(${q(first.trading_date)},${q(stateForSnapshotCheckpoint(checkpoint))},${q(checkpoint)},'SUCCEEDED',${q(first.correlation_id)},${q(JSON.stringify(metadata))}::jsonb))`));
 assert.equal(state.checkpoint_status[checkpoint].status,'SUCCEEDED');
 results.push({checkpoint,atomic:11,state:state.current_state});
}
console.log(JSON.stringify({input_type:'REAL_PRODUCTION_RETAINED_PROJECTION',results,production_writes:0}));
