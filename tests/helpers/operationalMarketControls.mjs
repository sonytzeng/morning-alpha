// Explicit synthetic INPUTS only. Never label this as a Production response.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {reviewPremiumNewsEvidence} from '../../supabase/functions/_shared/premium-evidence.ts';
const root=new URL('../../',import.meta.url);
assert.equal(process.env.MA_OPERATIONAL_SCOPE,'operational-market-20261001');
const db=process.env.MA_ISOLATED_TEST_DB;assert.match(db||'',/^ma_six_bug_test5\d\d$/);
const sql=input=>execFileSync('docker',['exec','-i','ma-six-bug-shadow-db','psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,maxBuffer:3e6,stdio:['pipe','pipe','pipe']}).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
assert.equal(sql('select scope from ma_isolated_guard.identity'),'ma-six-bug-preventive-20260930');
if(process.argv.includes('--late-news')){
 const fixture=read('tests/fixtures/production-parity-v4/research-cross-day-20260930.json');
 const original=fixture.news_events.find(n=>reviewPremiumNewsEvidence({title:n.title,source:n.source_name,url:n.source_url,published_at:n.published_at,taiwan_impact_summary:n.raw_payload?.taiwan_impact_summary||n.summary},Date.parse(fixture.replay_at)).eligible);
 assert(original,'AUDITED_QUALIFIED_NEWS_REQUIRED');
 const news={...original,id:randomUUID(),title:'SYNTHETIC_AUDITED_CONTROL '+original.title,
  published_at:'2026-09-30T22:55:00Z',created_at:'2026-09-30T23:14:00Z',
  fingerprint:createHash('sha256').update('OPERATIONAL_SYNTHETIC:'+original.fingerprint).digest('hex'),
  source_url:'https://fixture.invalid/operational-late-news',source_name:'SYNTHETIC_AUDITED_CONTROL',provider:'SYNTHETIC_AUDITED_CONTROL'};
 const insert=(table,row)=>{const keys=Object.keys(row);assert(keys.every(k=>/^[a-z_]+$/.test(k)));sql(`insert into ${table}(${keys.join(',')}) select ${keys.join(',')} from jsonb_populate_record(null::${table},${q(JSON.stringify(row))}::jsonb) on conflict do nothing`);};
 insert('news_events',news);
 for(const tag of fixture.news_event_tags.filter(t=>t.news_key===original.fingerprint))insert('news_event_tags',{...tag,news_key:news.fingerprint});
 console.log(JSON.stringify({input_type:'SYNTHETIC_AUDITED_NEWS_CONTROL',real_production_response:false}));
}else if(process.argv.includes('--next-day')){
 // Date-shift a copy of the reviewed shape, not the immutable saved fixture.
 const shifted=JSON.stringify(read('tests/fixtures/operational-market-core-20261001.json').core.rows)
  .replace(/2026-\d{2}-\d{2}/g,day=>new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10));
 const correlation=randomUUID(); // New synthetic execution, never original capture identity.
 const rows=JSON.parse(shifted).map(r=>({...r,correlation_id:correlation,value:Number(r.value),change_percent:Number(r.change_percent)}));
 const first=rows[0];assert.equal(first.trading_date,'2026-10-02');
 const observed=new Date(Math.max(...rows.flatMap(r=>[Date.parse(r.captured_at),Date.parse(r.source_timestamp)]))+1000).toISOString();
 writeFileSync(new URL('node_modules/.ma-six-clock',root),observed.replace('T',' ').slice(0,19)+'\n');
 const result=JSON.parse(sql(`select commit_market_checkpoint_batch_v1(${[first.trading_date,first.checkpoint,first.market_session,first.correlation_id,first.idempotency_key].map(q).join(',')},${q(JSON.stringify(rows))}::jsonb)`));
 assert.equal(result.status,'COMMITTED');assert.equal(result.row_count,11);
 const metadata={canonical_complete:true,core_batch_complete:true,required_core_complete:true,immutable_evidence_complete:true,
  atomic_checkpoint_complete:true,atomic_batch_id:result.batch_id,atomic_idempotency_key:first.idempotency_key,
  atomic_checkpoint_row_count:11,evidence_correlation_id:first.correlation_id};
 sql(`select advance_trading_day_state_v1(${q(first.trading_date)},'PREMARKET_CAPTURED','premarket','SUCCEEDED',${q(first.correlation_id)},${q(JSON.stringify(metadata))}::jsonb)`);
 console.log(JSON.stringify({input_type:'SYNTHETIC_NEXT_DAY_CONTROL',real_production_response:false,atomic:11}));
}else throw Error('CONTROL_REQUIRED');
