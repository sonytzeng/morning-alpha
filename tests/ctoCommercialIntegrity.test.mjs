import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {ctoTransition,ctoPrior,ctoChangedPaths,CTO_PATHS,CTO_MANIFEST} from './helpers/ctoCommercialIntegrity.mjs';
const raw=path=>readFileSync(new URL('../'+path,import.meta.url));
test('CTO exact UI/test candidate preserves every other byte and has no Production authority',()=>{
 const t=ctoTransition();assert.deepEqual(t.manifest.migrations,[]);assert.deepEqual(t.manifest.functions,[]);
 for(const path of CTO_PATHS){const prior=ctoPrior(path);if(prior===null)assert.throws(()=>t.predecessorRead(path),{code:'ENOENT'});else assert.deepEqual(t.predecessorRead(path),prior);}
});
test('unknown file, omitted file, changed candidate or protected business source fails closed',()=>{
 assert.throws(()=>ctoTransition(raw,[...ctoChangedPaths(),'unknown.sql']));assert.throws(()=>ctoTransition(raw,ctoChangedPaths().slice(1)));
 for(const path of CTO_PATHS)assert.throws(()=>ctoTransition(p=>p===path?Buffer.concat([raw(p),Buffer.from('\nUNREVIEWED')]):raw(p)));
 for(const path of ['supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/line-daily-push/index.ts','supabase/functions/get-report-payload/index.ts','supabase/functions/generate-daily-report-v7/index.ts'])assert.throws(()=>ctoTransition(p=>p===path?Buffer.concat([raw(p),Buffer.from('\nDRIFT')]):raw(p)),/historical CTO baseline/);
});
test('manifest cannot authorize a migration, worker, strategy, secret or publication',()=>{
 const m=JSON.parse(raw(CTO_MANIFEST));for(const patch of [{production_authorized:true},{migrations:['new.sql']},{functions:['worker']},{strategy_change:true},{secret_change:true},{cron_change:true},{member_publication_authorized:true}])assert.throws(()=>ctoTransition(p=>p===CTO_MANIFEST?Buffer.from(JSON.stringify({...m,...patch})):raw(p)));
});
