import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LINE_USABILITY_PATHS,LINE_USABILITY_MANIFEST,lineUsabilityTransition,lineUsabilityPrior,lineUsabilityChangedPaths} from './helpers/lineFinalUsabilityIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('final usability exact set + hashes + immutable predecessor; no business mutation',()=>{
 const t=lineUsabilityTransition();assert.deepEqual(lineUsabilityChangedPaths(),[...LINE_USABILITY_PATHS,LINE_USABILITY_MANIFEST].sort());
 for(const r of t.manifest.files){if(r.operation==='ADD')assert.throws(()=>t.predecessorRead(r.path),{code:'ENOENT'});else assert.deepEqual(t.predecessorRead(r.path),lineUsabilityPrior(r.path));}
 for(const p of ['supabase/functions/line-daily-push/index.ts','supabase/functions/_shared/line-daily-flex-message.mjs','supabase/functions/_shared/market-publication-contract.ts',
 'supabase/functions/_shared/recommendation-shadow-v2-engine.ts','supabase/functions/get-report-payload/index.ts','supabase/config.toml','src/pages/admin/analysis/page.tsx'])assert.deepEqual(t.predecessorRead(p),lineUsabilityPrior(p),p);
});
test('unknown bytes/files, rewritten history or promotion fail closed',()=>{
 for(const p of LINE_USABILITY_PATHS)assert.throws(()=>lineUsabilityTransition(path=>path===p?Buffer.concat([read(path),Buffer.from('DRIFT')]):read(path)),/unreviewed candidate drift/);
 for(const change of [m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.files.push({...m.files[0],path:'unknown'}),m=>m.member_template_promotion=true,m=>m.line_send=true,m=>m.v2_promotion=true,m=>m.predecessor_sha256='bad']){
 const m=JSON.parse(read(LINE_USABILITY_MANIFEST));change(m);assert.throws(()=>lineUsabilityTransition(p=>p===LINE_USABILITY_MANIFEST?Buffer.from(JSON.stringify(m)):read(p)));}
 assert.throws(()=>lineUsabilityTransition(p=>p==='docs/operations/evidence/line-final-copy-transition.json'?Buffer.from('{}'):read(p)));
});
