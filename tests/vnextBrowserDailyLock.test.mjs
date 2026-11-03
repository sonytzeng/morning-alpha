// Synthetic contract controls only; no market, performance or subscriber proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import ts from 'typescript';
import {browserLockPath,renderBrowserDailyLock} from '../scripts/vnext/build-browser-daily-lock.mjs';
import * as browser from '../src/features/vnext/browserDailyLock.ts';
import {verifyDailyLock as engineVerify} from '../src/features/vnext/dailyIntelligence.ts';
import {ENTRY_POLICY,ENTRY_VERSION,ENTRY_PREMARKET_VERSION,STRATEGIES} from '../research/entry-opportunity.ts';
import * as canonicalCalendar from '../supabase/functions/_shared/market-session-contract.mjs';
import {HORIZONS,snapshotHash} from '../src/features/vnext/contracts.ts';
import {RESEARCH_FUNNEL_VERSION} from '../src/features/vnext/researchFunnel.ts';

const root=new URL('../',import.meta.url);
test('committed browser checks are generated exactly from canonical declarations and calendar',()=>{
 assert.equal(readFileSync(new URL(browserLockPath,root),'utf8'),renderBrowserDailyLock());
 assert.deepEqual(browser.ENTRY_POLICY,ENTRY_POLICY);assert(Object.isFrozen(browser.ENTRY_POLICY));
 assert.deepEqual(browser.STRATEGIES,STRATEGIES);assert.equal(browser.ENTRY_VERSION,ENTRY_VERSION);
 assert.equal(browser.ENTRY_PREMARKET_VERSION,ENTRY_PREMARKET_VERSION);assert.equal(browser.RESEARCH_FUNNEL_VERSION,RESEARCH_FUNNEL_VERSION);
});
test('browser calendar matches canonical holidays, exceptional closures and coverage boundaries',()=>{
 for(const market of ['TW','US','UNKNOWN']){
  for(let ms=Date.parse('2024-12-30T12:00:00Z');ms<=Date.parse('2027-01-03T12:00:00Z');ms+=86400000){
   const date=new Date(ms).toISOString().slice(0,10);
   for(const method of ['coveredCalendarDate','isMarketTradingDate','previousMarketTradingDate'])
    assert.equal(browser[method](market,date),canonicalCalendar[method](market,date),method+':'+market+':'+date);
  }
  for(const date of ['', 'invalid','2026-02-30'])for(const method of ['coveredCalendarDate','isMarketTradingDate','previousMarketTradingDate'])
   assert.equal(browser[method](market,date),canonicalCalendar[method](market,date));
 }
 assert.equal(browser.isMarketTradingDate('TW','2026-10-23'),false);
 assert.equal(browser.previousMarketTradingDate('TW','2026-11-02'),'2026-10-30');
});
async function reseal(lock){const {lock_hash,...body}=lock;void lock_hash;return {...body,lock_hash:await snapshotHash(body)};}
async function control(version=ENTRY_VERSION,horizon='SHORT'){
 const date='2026-11-02',at=date+'T00:00:00.000Z',symbol='9000',confirmation='Synthetic confirmation',invalidation='Synthetic invalidation';
 return reseal({id:'synthetic:'+symbol+':'+horizon,business_date:date,mode:'FORWARD_SHADOW',provenance:'SYNTHETIC_CONTROL',symbol,
  company:'Synthetic contract control',horizon,strategy_version:RESEARCH_FUNNEL_VERSION,entry_version:version,
  generated_at:at,locked_at:at,evidence_cutoff:at,evidence_hash:'a'.repeat(64),actionable_at:date+'T01:00:00.000Z',
  target_sessions:HORIZONS[horizon].outcomes,research:{symbol,horizon,confirmation,invalidation},
  entry:version===ENTRY_PREMARKET_VERSION?STRATEGIES.map(strategy=>({symbol,strategy,strategy_version:strategy+'_1.1.0',status:'INSUFFICIENT_EVIDENCE',plan:null})):[],
  entry_gap:version===ENTRY_PREMARKET_VERSION?null:'MATCHING_ENTRY_SOURCE_UNAVAILABLE',confirmation,invalidation,next_review_at:date+'T05:30:00.000Z'});
}
const result=async(verify,lock)=>{try{return {valid:await verify(lock)};}catch(error){return {error:error.name};}};
async function parity(lock,valid){
 const expected=await result(engineVerify,lock),actual=await result(browser.verifyDailyLock,lock);
 assert.deepEqual(actual,expected);if(valid!==undefined)assert.equal(actual.valid,valid);
}
test('legacy and premarket locks retain identical verifier results for all three horizons',async()=>{
 for(const version of [ENTRY_VERSION,ENTRY_PREMARKET_VERSION])for(const horizon of Object.keys(HORIZONS))await parity(await control(version,horizon),true);
});
test('hash tampering and rehashed invalid identities, chronology, horizon or strategy remain rejected',async()=>{
 for(const version of [ENTRY_VERSION,ENTRY_PREMARKET_VERSION]){
  const original=await control(version);const tampered=structuredClone(original);tampered.company='mutated';await parity(tampered,false);
  const changes=[l=>l.strategy_version='UNKNOWN',l=>l.entry_version='UNKNOWN',l=>l.provenance='UNKNOWN',l=>l.symbol='9001',
   l=>l.confirmation='changed',l=>l.invalidation='changed',l=>l.evidence_hash='invalid',l=>l.horizon='UNKNOWN',l=>l.target_sessions=[1],
   l=>l.generated_at='invalid',l=>l.locked_at=l.actionable_at,l=>l.evidence_cutoff='2026-11-02T00:01:00.000Z',
   l=>l.actionable_at='2026-11-03T01:00:00.000Z',l=>l.mode='UNKNOWN'];
  for(const mutate of changes){const lock=structuredClone(original);mutate(lock);await parity(await reseal(lock),false);}
 }
 const original=await control(ENTRY_PREMARKET_VERSION);
 for(const mutate of [l=>l.entry.pop(),l=>l.entry[1].strategy=l.entry[0].strategy,l=>l.entry[0].strategy_version='OLD',
  l=>l.entry[0].symbol='9001',l=>l.entry[0].status='UNKNOWN',l=>l.entry_gap='MISSING',
  l=>l.evidence_cutoff='2026-11-01T15:59:00.000Z',l=>l.actionable_at='2026-11-02T02:00:00.000Z',
  l=>l.entry[0].plan={not_before:'2026-11-03',expires_on:'2026-11-02'}]){
  const lock=structuredClone(original);mutate(lock);await parity(await reseal(lock),false);
 }
});
test('malformed lock exception behavior stays aligned without accepting unverified data',async()=>{
 for(const lock of [null,{}, {lock_hash:'a'.repeat(64)},await reseal({...await control(),research:null})])await parity(lock);
});
test('Owner runtime graph stays inside src and does not import the research evaluator',()=>{
 const start=resolve(new URL('../src/features/vnext/ownerDailyResearch.ts',import.meta.url).pathname),src=resolve(new URL('../src',import.meta.url).pathname);
 const queue=[start],seen=new Set();
 while(queue.length){
  const path=queue.pop();if(seen.has(path))continue;seen.add(path);
  assert(!relative(src,path).startsWith('..'),'outside-src runtime import: '+path);
  assert(!/\/(dailyIntelligence|researchFunnel|stockResearch|realResearch)\.ts$/.test(path),'evaluator bundled: '+path);
  if(!/\.[cm]?[jt]sx?$/.test(path))continue;
  const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
  for(const node of ast.statements){
   if(!ts.isImportDeclaration(node)||!node.moduleSpecifier||node.importClause?.isTypeOnly)continue;
   const clause=node.importClause;
   if(clause&&!clause.name&&clause.namedBindings&&ts.isNamedImports(clause.namedBindings)&&clause.namedBindings.elements.every(e=>e.isTypeOnly))continue;
   const name=node.moduleSpecifier.text;if(!name.startsWith('.'))continue;
   const base=resolve(dirname(path),name),target=[base,base+'.ts',base+'.tsx',base+'.mjs',resolve(base,'index.ts')].find(existsSync);
   assert(target,'missing runtime import: '+name);queue.push(target);
  }
 }
 assert(seen.size>2);assert(seen.has(resolve(src,'features/vnext/browserDailyLock.ts')));
});
