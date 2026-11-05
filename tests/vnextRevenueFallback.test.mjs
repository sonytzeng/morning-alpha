/** Isolated source-window controls. No production writes or publication. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {acquisitionPlan,assembleDaily,sessionsBefore,REVENUE_ACQUISITION_MONTHS} from '../src/features/vnext/dailyAdapter.ts';
import {evaluateResearch,RESEARCH_RULES} from '../src/features/vnext/researchFunnel.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const companies=RECOMMENDATION_UNIVERSE.map((symbol,i)=>({symbol,company:symbol,exchange:i<61?'TWSE':'TPEX',industry:'24'}));
const date='2026-11-04',cutoff='2026-11-04T00:30:00.000Z',source='https://www.twse.com.tw/isolated-control';
const periods=['2026-07','2026-08','2026-09','2026-10'];
const dates=sessionsBefore(date,10);
const end=p=>new Date(Date.UTC(Number(p.slice(0,4)),Number(p.slice(5)),0)).toISOString().slice(0,10);
const fact=(symbol,kind,period,as_of,values,basis)=>({symbol,kind,period,as_of,values,basis,id:kind+'-'+symbol+'-'+period,source,published_at:null,first_seen_at:cutoff,available_at:cutoff,evidence_hash:'a'.repeat(64)});
async function receipt(kind,rows){const payload={rows};return {task:{key:await snapshotHash({kind,rows}),kind,url:source,format:'json',scope:date,symbols:companies.map(c=>c.symbol),max_age_days:1},first_seen_at:cutoff,available_at:cutoff,published_at:null,as_of:cutoff,version:'VNEXT_DAILY_OFFICIAL_1',raw_hash:'c'.repeat(64),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null};}
async function receipts({july=true,august=true,october=true}={}){
 const r=[];for(const p of periods){const rows=(p==='2026-07'&&!july||p==='2026-08'&&!august?[]:p==='2026-10'?(october?[companies[0]]:[]):companies).map(c=>fact(c.symbol,'REVENUE',p,end(p)+'T12:00:00+08:00',{yoy_percent:10,mom_percent:2},'MONTHLY'));r.push(await receipt('REVENUE',rows));}
 const institutions=companies.flatMap(c=>dates.map(d=>fact(c.symbol,'INSTITUTIONAL',d,d+'T13:30:00+08:00',{net_shares:10},'SHARES')));
 r.push(await receipt('INSTITUTIONAL',institutions));return r;
}
test('monthly source acquisition reserves one fallback month at the beginning and end of consecutive months',async()=>{
 assert.equal(RESEARCH_RULES.medium_months,3);assert.equal(REVENUE_ACQUISITION_MONTHS,4);
 for(const [d,expected] of [['2026-11-04',['2026-07','2026-08','2026-09','2026-10']],['2026-11-30',['2026-07','2026-08','2026-09','2026-10']],['2026-12-01',['2026-08','2026-09','2026-10','2026-11']]]){
  const p=await acquisitionPlan(d,companies),firstColdRevenue=p.findIndex(x=>x.kind==='REVENUE'&&!expected.includes(x.period));
  const warm=p.slice(0,firstColdRevenue).filter(x=>x.kind==='REVENUE');
  assert.deepEqual([...new Set(warm.map(x=>x.period))].sort(),expected);assert.equal(warm.length,8);
 }
});
test('one unpublished latest month does not hide older real reports; each stock selects latest three observed',async()=>{
 const r=await receipts(),a=await assembleDaily(date,companies,r,cutoff);
 const partial=a.inputs.find(i=>i.symbol===companies[1].symbol),newest=a.inputs.find(i=>i.symbol===companies[0].symbol);
 assert.deepEqual(partial.facts.filter(f=>f.kind==='REVENUE').map(f=>f.period),periods.slice(0,3));
 assert.deepEqual(newest.facts.filter(f=>f.kind==='REVENUE').map(f=>f.period),periods.slice(1));
 assert.equal(evaluateResearch(partial,'MEDIUM').state,'QUALIFIED');
 assert.equal(evaluateResearch(newest,'MEDIUM').state,'QUALIFIED');
 const noFallback=await assembleDaily(date,companies,r.filter(x=>!x.payload.rows.some(row=>row.kind==='REVENUE'&&row.period==='2026-07')),cutoff);
 assert(evaluateResearch(noFallback.inputs.find(i=>i.symbol===companies[1].symbol),'MEDIUM').reasons.includes('MISSING_REVENUE_3'));
});
test('missing actual month, future receipt and altered payload remain rejected',async()=>{
 const r=await receipts({august:false}),a=await assembleDaily(date,companies,r,cutoff),x=evaluateResearch(a.inputs[0],'MEDIUM');
 assert.equal(x.state,'INSUFFICIENT');assert(x.reasons.includes('REVENUE_PERIOD_GAPS'));
 const future=structuredClone(r);future[0].available_at='2026-11-04T00:30:01.000Z';await assert.rejects(()=>assembleDaily(date,companies,future,cutoff),/SOURCE_REVISION_INVALID/);
 const altered=structuredClone(r);altered[0].payload.rows.pop();await assert.rejects(()=>assembleDaily(date,companies,altered,cutoff),/SOURCE_REVISION_INVALID/);
});
