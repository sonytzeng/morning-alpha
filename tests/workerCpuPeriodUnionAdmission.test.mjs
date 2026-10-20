import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {assemble} from '../scripts/operations/worker-cpu-period-union-20261021/materialize.mjs';

const base='7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3';
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const changed=[
 'src/features/vnext/contracts.ts',
 'src/features/vnext/dailyAdapter.ts',
 'src/features/vnext/dailyParsers.mjs',
 'src/features/vnext/dailyIntelligence.ts',
 'src/features/vnext/dailyRuntime.ts',
];

test('exact CPU and response-period union has a fixed Worker4 recovery',()=>{
 const candidate=assemble(),recovery=assemble('recovery');
 assert.equal(candidate.payload.files.length,78);
 assert.equal(candidate.sha256,'5c3d739892daf0109eeb3089c68a1577bb895d4e00fc9cfba84255ab348ec16b');
 assert.equal(recovery.sha256,'34a0fe4a0b17dc56a72c43d7687738047b59d695ae1bbda676b85f321d9c0762');
 assert.deepEqual(candidate.payload.files.filter((file,index)=>file.content!==recovery.payload.files[index].content).map(file=>file.name).sort(),changed.toSorted());
 assert.throws(()=>assemble('../recovery'),/UNION_FIXED_VARIANT/);
 for(const variant of ['candidate','recovery'])assert.throws(()=>assemble(variant,path=>Buffer.concat([read(path),Buffer.from('DRIFT')])),/UNION_CURRENT_DRIFT/);
});

test('union excludes business, identity, publication, policy and source-admission changes',()=>{
 const catalog=JSON.parse(read('scripts/operations/worker-cpu-period-union-20261021/release-catalog.json'));
 assert.deepEqual(catalog.changed_runtime,changed);
 for(const field of ['production_authorized','sql','auth_rls_change','cron_change','caller_change','member_rights_change','payment_change','line_change','manual_business_invocation','source_admission','research_publication','threshold_change'])assert.equal(catalog[field],false,field);
 for(const path of [
  'src/features/vnext/engine.ts','src/features/vnext/researchFunnel.ts',
  'supabase/functions/vnext-daily-research-v1/index.ts','supabase/functions/vnext-daily-research-v1/handler.ts',
  'supabase/functions/_shared/vnext-daily-hook.ts','supabase/config.toml',
  'supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql',
  'supabase/functions/recommendation-stock-evidence-v1/index.ts',
  'supabase/functions/member-access/index.ts','supabase/functions/line-daily-push/index.ts',
 ])assert.deepEqual(read(path),execFileSync('git',['show',base+':'+path],{maxBuffer:8e6}),path);
});
