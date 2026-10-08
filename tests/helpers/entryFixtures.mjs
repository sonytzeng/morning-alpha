import {v2Fixture} from './recommendationV2Fixtures.mjs';
import {entryInputFromV2} from '../../research/entry-v2-adapter.ts';
import {v2Hash} from '../../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
export async function entryFixture(){
 const v=v2Fixture(),at=v.identity.generated_at;
 const input=await entryInputFromV2(v,await v2Hash(v),{value:{direction:'偏空',regime:'range',change_percent:-4},source_ref:'SYNTHETIC_CANONICAL',observed_at:at,available_at:at},'HISTORICAL_REPLAY','SYNTHETIC_TEST');
 input.stocks=input.stocks.slice(0,1);
 input.stocks[0].events_reviewed={value:true,source_ref:'SYNTHETIC_EVENT_FEED',observed_at:at,available_at:at};
 return input;
}
export function setup(input,type){
 const c=input.stocks[0];
 // Explicit synthetic model boundary inputs, never historical investment proof.
 c.bars.forEach((b,i)=>Object.assign(b,{open:100,close:100,high:102,low:98,volume:1000000,amount:100000000}));
 if(type==='breakout'){
  c.bars.slice(0,19).forEach(b=>Object.assign(b,{low:99,high:102}));
  c.bars[0].low=80;
  Object.assign(c.bars[19],{open:101,close:103,low:101,high:104,volume:2000000});
 }else if(type==='reversal'){
  c.bars.slice(0,14).forEach(b=>Object.assign(b,{open:120,close:119,high:121,low:118}));
  c.bars.slice(14,17).forEach((b,i)=>Object.assign(b,{open:110-i*3,close:107-i*3,high:111-i*3,low:106-i*3,volume:3000000}));
  Object.assign(c.bars[17],{open:100,close:99,high:101,low:98,volume:2000000});
  Object.assign(c.bars[18],{open:99,close:99,high:100,low:98,volume:1000000});
  Object.assign(c.bars[19],{open:99,close:101,high:101.1,low:98.5,volume:1000000});
 }else if(type==='pullback'){
  c.bars.slice(0,10).forEach((b,i)=>Object.assign(b,{open:90+i,close:90+i,high:92+i,low:89+i}));
  c.bars.slice(10,15).forEach(b=>Object.assign(b,{open:110,close:110,high:112,low:109}));c.bars[10].high=120;
  [106,104,103,102,102.5].forEach((close,i)=>Object.assign(c.bars[15+i],{open:close-.1,close,high:close+1,low:close-1}));
  c.bars[19].volume=500000;
 }else if(type==='false-breakout'){c.bars[19].high=105;c.bars[19].close=101;}
 return input;
}
