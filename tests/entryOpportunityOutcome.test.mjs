import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEntry,entryHash,ENTRY_POLICY,nextEntrySession} from '../research/entry-opportunity.ts';
import {evaluateEntryOutcome,summarizeEntryOutcomes,entryLockHash,firstTradableWindowAfterSignal} from '../research/entry-outcomes.ts';
import {entryFixture,setup} from './helpers/entryFixtures.mjs';
async function reseal(lock){lock.lock_sha256=await entryLockHash(lock);return lock;}
async function sealCoverage(c){const {content_sha256:_,...p}=c;c.content_sha256=await entryHash(p);return c;}
async function fixture(){
 const i=setup(await entryFixture(),'breakout'),r=await evaluateEntry(i),p=r.candidates[2];
 const dates=[p.plan.not_before];while(dates.length<20)dates.push(nextEntrySession(dates.at(-1)));
 const bars=dates.map(date=>({date,open:p.plan.trigger+.1,high:p.plan.trigger+1,low:p.plan.trigger-.1,close:p.plan.trigger+.5,volume:1e6,amount:1e8,source_ref:'SYNTHETIC_OUTCOME:'+date,available_at:date+'T14:00:00+08:00'}));
 const lock=await reseal({id:'SYNTHETIC_LOCK',symbol:p.symbol,strategy_version:p.strategy_version,mode:'FORWARD',provenance:'SYNTHETIC_TEST',locked_at:i.evaluation_time,evaluation_time:i.evaluation_time,evidence_cutoff:i.evaluation_time,evidence_hash:r.evidence_hash,prediction:p,
  costs:{version:'ILLUSTRATIVE_TW_CASH_LOCKED_V1',quantity:1000,minimum_fee_twd:20,buy_fee:ENTRY_POLICY.buyFee,sell_fee:ENTRY_POLICY.sellFee,sell_tax:ENTRY_POLICY.sellTax,slippage:ENTRY_POLICY.slippageEachSide,rounding:'CEIL_TWD',account_costs_verified:false}});
 const observed_at=dates.at(-1)+'T15:00:00+08:00';
 const corporate_actions=await Promise.all([p.symbol,'TAIEX'].map(symbol=>sealCoverage({symbol,from:i.business_date,through:dates.at(-1),available_at:observed_at,source_ref:'SYNTHETIC_COMPLETE_ACTION_FEED',coverage:'COMPLETE_SOURCE_WINDOW',events:[]})));
 return {lock,e:{bars,benchmark:structuredClone(bars),observed_at,price_basis:'UNADJUSTED',corporate_actions,benchmark_symbol:'TAIEX',source_ref:'SYNTHETIC_DAILY_BARS'}};
}
test('all five horizons are costs-included models, never observed fills or premature outcomes',async()=>{
 const {lock,e}=await fixture();
 for(const h of [1,3,5,10,20]){const r=await evaluateEntryOutcome(lock,e,h);assert.equal(r.state,'MODELLED');assert(r.net_return<r.gross_return);assert.equal(r.horizon,h);assert.equal(r.performance_eligible,false);assert.equal(r.minimum_fee_included,true);assert.equal(r.maximum_drawdown,null);}
 assert.equal((await evaluateEntryOutcome(lock,{...e,observed_at:lock.locked_at},20)).reason,'NOT_MATURED');
 assert.equal((await evaluateEntryOutcome(lock,{...e,corporate_actions:[]},1)).reason,'ADJUSTMENT_COVERAGE_MISSING_OR_DUPLICATE');
});
test('same daily candle stop and target is explicitly unconfirmed, not favorable OR assumed stop first',async()=>{
 const {lock,e}=await fixture();e.bars[0].high=lock.prediction.plan.target+1;e.bars[0].low=lock.prediction.plan.stop-1;
 const r=await evaluateEntryOutcome(lock,e,1);assert.equal(r.state,'UNCONFIRMED');assert.equal(r.reason,'SAME_DAY_STOP_TARGET_ORDER_UNCONFIRMED');assert.equal(r.net_return,null);assert.equal(r.mfe,null);
});
test('historical, synthetic and modeled returns cannot become Forward win rates; duplicate outcomes conflict',async()=>{
 const {lock,e}=await fixture();const historical=await evaluateEntryOutcome(await reseal({...lock,mode:'HISTORICAL_REPLAY'}),e,1);
 assert.equal(historical.state,'MODELLED');assert(summarizeEntryOutcomes([historical]).every(s=>s.entered_samples===0&&s.win_rate===null&&s.modelled_samples===0));
 const r=await evaluateEntryOutcome(lock,e,1);assert.equal(summarizeEntryOutcomes([r,r])[0].entered_samples,0);
 const model=summarizeEntryOutcomes([{...r,provenance:'REAL_RETAINED'}])[0];assert.equal(model.modelled_samples,1);assert.equal(model.win_rate,null);assert.equal(model.entered_samples,0);
 assert.equal(summarizeEntryOutcomes([{...r,provenance:undefined}])[0].entered_samples,0);
 assert.throws(()=>summarizeEntryOutcomes([r,{...r,net_return:1}]),/CONFLICT/);
});
test('prospective identity, strategy, prediction, cutoff, horizons and costs are all hash-bound',async()=>{
 const {lock,e}=await fixture();
 for(const mutate of [l=>l.prediction.plan.trigger++,l=>l.strategy_version='OTHER',l=>l.evidence_hash='a'.repeat(64),l=>l.costs.quantity++,l=>l.prediction.horizons=[1],l=>l.evidence_cutoff='2099-01-01']){
  const changed=structuredClone(lock);mutate(changed);assert.equal((await evaluateEntryOutcome(changed,e,1)).reason,'LOCK_INVALID');
 }
 const future=await reseal({...lock,locked_at:lock.prediction.plan.not_before+'T09:00:00+08:00'});
 assert.equal((await evaluateEntryOutcome(future,e,1)).reason,'NOT_PROSPECTIVE');
 const changed=structuredClone(lock);changed.costs.sell_tax=0;await reseal(changed);assert.equal((await evaluateEntryOutcome(changed,e,1)).reason,'LOCK_INVALID');
 const horizon=structuredClone(lock);horizon.prediction.horizons=[1];await reseal(horizon);assert.equal((await evaluateEntryOutcome(horizon,e,3)).reason,'LOCK_INVALID');
});
test('daily intraday trigger is not a fill; no trigger, expiry, invalidation and no chase are explicit',async()=>{
 const {lock,e}=await fixture(),p=lock.prediction.plan;
 const intraday=structuredClone(e);intraday.bars[0].open=p.trigger-.1;
 assert.equal((await evaluateEntryOutcome(lock,intraday,1)).reason,'INTRADAY_TRIGGER_PRICE_AND_ORDER_UNCONFIRMED');
 const missed=structuredClone(e);Object.assign(missed.bars[0],{open:p.trigger-.2,close:p.trigger-.1,high:p.trigger,low:p.trigger-.3});
 assert.equal((await evaluateEntryOutcome(lock,missed,1)).reason,'TRIGGER_NOT_REACHED_BEFORE_EXPIRY');
 const invalid=structuredClone(e);invalid.bars[0].open=p.stop;invalid.bars[0].low=p.stop-1;
 assert.equal((await evaluateEntryOutcome(lock,invalid,1)).reason,'INVALIDATED_BEFORE_ENTRY');
 const jump=structuredClone(e);jump.bars[0].open=p.reference_range[1]+1;jump.bars[0].high=jump.bars[0].open+1;
 assert.equal((await evaluateEntryOutcome(lock,jump,1)).reason,'OPENING_GAP_OUTSIDE_LOCKED_RANGE_NO_CHASE');
 const halt=structuredClone(e);halt.bars[0].volume=0;
 assert.equal((await evaluateEntryOutcome(lock,halt,1)).reason,'SESSION_OR_AVAILABILITY_GAP');
});
test('dividends/splits/rights need actual total-return lineage, never a boolean or later adjusted price',async()=>{
 const {lock,e}=await fixture();
 assert.equal((await evaluateEntryOutcome(lock,{...e,price_basis:'ADJUSTED'},1)).reason,'ADJUSTMENT_SOURCE_MISSING');
 const broken=structuredClone(e);broken.corporate_actions[0].through='2099-01-01';
 assert.equal((await evaluateEntryOutcome(lock,broken,1)).reason,'ADJUSTMENT_LINEAGE_INVALID');
 for(const kind of ['CASH_DIVIDEND','SPLIT','RIGHTS','CAPITAL_REDUCTION']){
  const a=structuredClone(e),c=a.corporate_actions[0];c.events=[{symbol:lock.symbol,effective_date:a.bars[0].date,kind,source_ref:'SYNTHETIC_ACTION',available_at:a.observed_at,cash_per_share:null,new_shares_per_old_share:null}];await sealCoverage(c);
  assert.equal((await evaluateEntryOutcome(lock,a,1)).reason,'CORPORATE_ACTION_TOTAL_RETURN_LEDGER_REQUIRED');
 }
 const a=structuredClone(e);a.corporate_actions[0].available_at='2999-01-01';await sealCoverage(a.corporate_actions[0]);
 assert.equal((await evaluateEntryOutcome(lock,a,1)).reason,'ADJUSTMENT_LINEAGE_INVALID');
});
test('minimum fees, missing benchmarks, timestamp validation and later opening gaps',async()=>{
 const {lock,e}=await fixture();const small=structuredClone(lock);small.costs.quantity=1;await reseal(small);
 const r=await evaluateEntryOutcome(small,e,1);assert.equal(r.fee_twd,40);assert.equal(r.mfe,null);assert.equal(r.mae,null);
 assert.equal((await evaluateEntryOutcome(lock,{...e,benchmark:[]},1)).reason,'SESSION_OR_AVAILABILITY_GAP');
 const late=structuredClone(e);late.bars[0].available_at='2999-01-01';assert.equal((await evaluateEntryOutcome(lock,late,1)).state,'UNAVAILABLE');
 const gap=structuredClone(e);Object.assign(gap.bars[1],{open:lock.prediction.plan.stop-1,low:lock.prediction.plan.stop-2,high:lock.prediction.plan.target+1});
 const g=await evaluateEntryOutcome(lock,gap,3);assert.equal(g.state,'MODELLED');assert.equal(g.exit_price,gap.bars[1].open);assert(g.stop_hit);assert.equal(g.mfe_daily_bound,null);assert.equal(g.benchmark_return,null);assert.equal(g.excess_return,null);
 const duplicate=structuredClone(e);duplicate.bars.push(duplicate.bars[0]);assert.equal((await evaluateEntryOutcome(lock,duplicate,1)).state,'UNAVAILABLE');
});
test('first tradable session distinguishes premarket, intraday, after-close and holidays without inventing an execution timestamp',()=>{
 assert.equal(firstTradableWindowAfterSignal('2026-10-08T07:00:00+08:00').not_before,'2026-10-08T09:00:00+08:00');
 const intraday=firstTradableWindowAfterSignal('2026-10-08T10:30:00+08:00');assert.equal(intraday.basis,'NEXT_TRADE_AFTER_SIGNAL_UNVERIFIED');assert.equal(intraday.first_execution_time,null);
 assert.equal(firstTradableWindowAfterSignal('2026-10-08T14:33:01+08:00').session,'2026-10-12');
 assert.equal(firstTradableWindowAfterSignal('2026-10-10T08:00:00+08:00').session,'2026-10-12');
 assert.equal(firstTradableWindowAfterSignal('invalid'),null);
});
