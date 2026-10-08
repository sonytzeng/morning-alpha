// Explicit local-only gate. Private fixtures must NEVER enter the public repo or
// public CI. CI tests the same adapter with labelled synthetic inputs separately.
import assert from 'node:assert/strict';
import {readFileSync,statSync,realpathSync} from 'node:fs';
import {resolve,relative,join,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {replayEntryProjection} from './helpers/entryRetainedProjection.mjs';
import {evaluateEntry} from '../research/entry-opportunity.ts';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
export const APPROVED_PROJECTIONS={
 '2026-10-07':'b9b7b4a991de35fda898e9429a9c15b112465a0a35fd0f2cf98d697579053b4a',
 '2026-10-08':'cd1f38272c43a78d51a87b87cb993a04796c40fdcd24467db8d858ceb2f2fb24',
};
export function entryPrivatePathOutsideRepository(path){
 const rel=relative(root,resolve(path));return rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel);
}
export async function readPrivateEntryReplay(dir,date){
 assert(date in APPROVED_PROJECTIONS,'DATE_NOT_AUTHORIZED');
 const path=realpathSync(resolve(dir));assert(entryPrivatePathOutsideRepository(path),'PRIVATE_FIXTURE_INSIDE_REPOSITORY');
 assert.equal(statSync(path).mode&0o077,0,'PRIVATE_DIRECTORY_PERMISSIONS');
 const file=join(path,date+'.json');assert.equal(realpathSync(file),file,'SYMLINK_NOT_ALLOWED');
 assert.equal(statSync(file).mode&0o077,0,'PRIVATE_FIXTURE_PERMISSIONS');
 assert(statSync(file).size<3_000_000,'FIXTURE_LIMIT');
 const p=JSON.parse(readFileSync(file,'utf8'));
 assert.equal(p.input.identity.report_date,date);
 return replayEntryProjection(p,{projectionSha256:APPROVED_PROJECTIONS[date],provenance:'REAL_RETAINED'});
}
async function main(){
 assert(!process.env.CI,'PRIVATE_REAL_EVIDENCE_NOT_FOR_PUBLIC_CI');
 assert(process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR,'EXPLICIT_PRIVATE_FIXTURE_DIR_REQUIRED');
 globalThis.fetch=()=>{throw Error('OFFLINE_REPLAY_NETWORK_FORBIDDEN');};
 for(const date of Object.keys(APPROVED_PROJECTIONS)){
  const {result,normalized,summary,history}=await readPrivateEntryReplay(process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR,date);
  assert.deepEqual(history.coverage,{'20':72,'60':0,'120':0});
  assert.equal(history.valid_sector_comparison,66);
  assert(history.stocks.every(s=>s.retained_bars===45));
  assert(history.stocks.filter(s=>s.sector_peers.reason==='UNIVERSE_COVERAGE_GAP').every(s=>s.sector_peers.mapped===2));
  assert.equal(result.scanned,72);assert.equal(result.candidates.length,216);
  assert.equal(result.counts.ENTRY_READY,0);assert.equal(result.counts.INSUFFICIENT_EVIDENCE,18);
  const expected=date==='2026-10-07'?[11,187]:[15,183];
  assert.equal(result.counts.WAIT_CONFIRMATION,expected[0]);assert.equal(result.counts.AVOID_ENTRY,expected[1]);
  // Counterfactual negative controls are explicitly mutations, NOT real history.
  for(const mutate of [i=>i.market=null,i=>i.market.available_at='2999-01-01T00:00:00Z',
   i=>i.stocks.forEach(s=>s.bars.forEach(b=>b.available_at='2999-01-01T00:00:00Z')),
   i=>i.stocks.forEach(s=>s.fundamental=null)]){
   const control=structuredClone(normalized);control.provenance='SYNTHETIC_TEST';mutate(control);
   assert((await evaluateEntry(control)).candidates.every(c=>c.status==='INSUFFICIENT_EVIDENCE'&&c.plan===null));
  }
  const labelControl=structuredClone(normalized);labelControl.provenance='SYNTHETIC_TEST';labelControl.market.value.direction='偏多';
  assert.deepEqual((await evaluateEntry(labelControl)).candidates.map(c=>c.status),result.candidates.map(c=>c.status),'DIRECTION_LABEL_MUST_NOT_AUTHORIZE_ENTRY');
  const {missing,...publicSummary}=summary;
  console.log(JSON.stringify({...publicSummary,history_coverage:history.coverage,valid_sector_comparison:history.valid_sector_comparison,missing_symbols:missing.length,private_fixture_exported_to_git:false,negative_controls:'PASS'}));
 }
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))await main();
