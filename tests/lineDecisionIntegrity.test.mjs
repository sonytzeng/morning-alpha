import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LINE_CARD_PATHS,LINE_CARD_MANIFEST,lineCardTransition,lineCardPrior,lineCardChangedPaths} from './helpers/lineDecisionIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('LINE preview exact reviewed file set, hashes, immutable predecessors and no delivery promotion',()=>{
 const t=lineCardTransition();assert.deepEqual(lineCardChangedPaths(),[...LINE_CARD_PATHS,LINE_CARD_MANIFEST].sort());
 for(const r of t.manifest.files){if(r.operation==='ADD')assert.throws(()=>t.predecessorRead(r.path),{code:'ENOENT'});else assert.deepEqual(t.predecessorRead(r.path),lineCardPrior(r.path));}
 for(const p of ['supabase/functions/line-daily-push/index.ts','supabase/functions/_shared/line-daily-flex-message.mjs','supabase/functions/_shared/market-publication-contract.ts',
  'supabase/functions/_shared/recommendation-shadow-v2-engine.ts','supabase/functions/get-report-payload/index.ts','supabase/config.toml'])assert.deepEqual(t.predecessorRead(p),lineCardPrior(p),p);
});
test('unknown bytes/files, history edits and sensitive promotion never silently pass',()=>{
 for(const p of LINE_CARD_PATHS)assert.throws(()=>lineCardTransition(path=>path===p?Buffer.concat([read(path),Buffer.from('DRIFT')]):read(path)),/unreviewed candidate drift/);
 for(const change of [m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.files.push({...m.files[0],path:'unknown'}),m=>m.member_template_promotion=true,m=>m.v2_promotion=true,m=>m.predecessor_sha256='bad']){
  const m=JSON.parse(read(LINE_CARD_MANIFEST));change(m);assert.throws(()=>lineCardTransition(p=>p===LINE_CARD_MANIFEST?Buffer.from(JSON.stringify(m)):read(p)));
 }
 assert.throws(()=>lineCardTransition(p=>p==='docs/10k-program/recommendation-v2-forward-transition.json'?Buffer.from('{}'):read(p)));
});
