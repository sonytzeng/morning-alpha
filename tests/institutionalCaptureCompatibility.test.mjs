import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesExistingInstitutionalCaptures} from '../research/institutional-daily-financial-replay.ts';
const at='2026-11-04T00:00:00.000Z';
const symbols=Array.from({length:72},(_,i)=>String(1000+i));
function fixture(){
 const inputs=symbols.map(symbol=>({symbol,facts:[]}));
 const registry=[];
 for(const [i,input] of inputs.entries())for(let j=0;j<2;j++){
  const f={id:`institution-${i}-${j}`,symbol:input.symbol,kind:'INSTITUTIONAL',period:j?'2026-10-30':'2026-10-29',
   source:'https://www.twse.com.tw/rwd/zh/fund/T86',evidence_hash:'a'.repeat(64),basis:'SHARES',values:{net_shares:10+i},
   published_at:null,as_of:'2026-10-29T05:30:00.000Z',first_seen_at:'2026-11-01T00:00:00.000Z',available_at:'2026-11-01T00:00:00.000Z'};
  registry.push({...f,unit:'SHARES',source_sha256:'b'.repeat(64)});
  input.facts.push({...structuredClone(f),first_seen_at:'2026-11-02T00:00:00.000Z',available_at:'2026-11-02T00:00:00.000Z'});
 }
 return {inputs,registry};
}
test('same values from separate receipts preserve later observed timestamps',async()=>{
 const {inputs,registry}=fixture(),before=structuredClone(inputs);
 assert.equal(await matchesExistingInstitutionalCaptures(inputs,registry,at),true);
 assert.deepEqual(inputs,before);
});
test('changed value, evidence, owner, period, future receipt and duplicate fail closed',async()=>{
 for(const change of [
  x=>x.inputs[0].facts[0].values.net_shares++, x=>x.inputs[0].facts[0].evidence_hash='c'.repeat(64),
  x=>x.inputs[0].facts[0].period='2026-10-30',x=>x.inputs[0].facts[0].source='https://other.invalid',
  x=>x.inputs[0].facts[0].source_admitted=true,x=>x.inputs[0].facts[0].member_publication_approved=true,
  x=>x.inputs[0].facts[0].unexpected='not part of verified capture',
  x=>x.inputs[1].facts.push(x.inputs[0].facts.shift()),x=>x.inputs[0].facts[0].available_at='2026-11-04T00:00:00.000001Z',
  x=>x.inputs[0].facts[0].first_seen_at='2026-11-03T00:00:00.000Z',
  x=>x.inputs[0].facts.push(structuredClone(x.inputs[0].facts[0])),x=>x.inputs[0].facts.pop(),
 ]){const x=fixture();change(x);assert.equal(await matchesExistingInstitutionalCaptures(x.inputs,x.registry,at),false);}
});
