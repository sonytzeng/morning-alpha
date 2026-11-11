#!/usr/bin/env node
/** Exercise the actual exported JavaScript against a minimal DOM test double.
 * This is a functional unit check, not a browser or visual-layout check. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {resolve} from 'node:path';
import {URL} from 'node:url';
import process from 'node:process';
import console from 'node:console';
const args=process.argv.slice(2),file=resolve(args[0]??''),receipt=resolve(args[1]??'');
if(args.length!==2)throw Error('Usage: verify-taiwan-market-workbench.mjs <actual.html> <new-receipt.json>');
const html=await readFile(file,'utf8');
const raw=/<script type="application\/json" id="dataset">([\s\S]*?)<\/script>/.exec(html)?.[1];
assert.ok(raw);const data=JSON.parse(raw),program=/<\/script><script>([\s\S]*?)<\/script>/.exec(html)?.[1];
assert.ok(program);assert.equal(/<script[^>]+src\s*=/i.test(html),false);assert.match(html,/connect-src 'none'/);
const elements=new Map(),events=new Map();let document;
class Element{
 constructor(id){this.id=id;this.value=['market','status','reference'].includes(id)?'ALL':'';this.innerHTML='';this.textContent='';this.hidden=id==='overlay';this.dataset={};this.events=new Map();this.style={};}
 addEventListener(name,callback){this.events.set(name,callback);}
 setAttribute(name,value){this[name]=value;}
 focus(){document.activeElement=this;}
 querySelectorAll(){return [elements.get('close')];}
}
const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
const tabs=['SHORT','MEDIUM','LONG'].map(h=>{const e=new Element(h);e.dataset.horizon=h;return e;});
document={getElementById:get,querySelectorAll:selector=>{assert.equal(selector,'[data-horizon]');return tabs;},
 addEventListener:(name,callback)=>events.set(name,callback),body:{style:{}},activeElement:null};
get('dataset').textContent=raw;
runInNewContext(program,{document,Intl,URL,console},{timeout:5000});
assert.equal(data.stocks.length,data.coverage.security_count);
assert.equal(data.stocks.reduce((n,s)=>n+s.horizons.length,0),data.coverage.cards_analyzed);
assert.equal(new Set(data.stocks.map(s=>s.id)).size,data.stocks.length);
assert.equal((get('cards').innerHTML.match(/<article /g)??[]).length,Math.min(24,data.stocks.length));
if(data.stocks.length>24){const first=get('cards').innerHTML;get('next').onclick();assert.notEqual(get('cards').innerHTML,first);
 assert.match(get('page-label').textContent,/^2 \/ /);get('prev').onclick();assert.equal(get('cards').innerHTML,first);}
const tsmc=data.stocks.find(s=>s.symbol==='2330');assert.ok(tsmc);
for(const query of [tsmc.symbol,tsmc.name,tsmc.full_name]){
 get('query').value=query;get('query').events.get('input')();
 assert.equal((get('cards').innerHTML.match(/<article /g)??[]).length,1);
 assert.match(get('cards').innerHTML,/2330/);
}
tabs[1].events.get('click')();assert.match(get('method').textContent,/同業/);
get('cards').onclick({target:{closest:()=>({dataset:{id:tsmc.id}})}});
assert.equal(get('overlay').hidden,false);assert.match(get('detail-body').innerHTML,/https:\/\//);
assert.match(get('detail-body').innerHTML,/分析截點/);
events.get('keydown')({key:'Escape'});assert.equal(get('overlay').hidden,true);
const bvps=data.stocks.find(s=>s.references.MEDIUM?.method_version==='TAIWAN_REPORTED_BVPS_PEER_V1');
if(bvps){get('cards').onclick({target:{closest:()=>({dataset:{id:bvps.id}})}});
 assert.match(get('detail-body').innerHTML,/原季報每股參考淨值 × 同期同業計算 P\/B 分位數/);
 const action=bvps.sources.find(s=>s[3]?.length===3);assert.ok(action);
 for(const binding of action[3]){assert.equal(new URL(data.source_urls[binding[0]]).hostname,'www.tpex.org.tw');
  assert.match(binding[2],/^[a-f0-9]{64}$/);assert.ok(get('detail-body').innerHTML.includes(binding[2]));}
 assert.match(get('detail-body').innerHTML,/原件 hash/);get('close').onclick();}
get('query').value='NO_MATCH_20261111';get('query').events.get('input')();assert.match(get('cards').innerHTML,/沒有符合/);
get('query').value='';get('query').events.get('input')();
tabs[2].events.get('click')();get('reference').value='YES';get('reference').events.get('change')();
const longCount=data.stocks.filter(s=>s.references.LONG).length;
assert.ok(get('result-count').textContent.includes(longCount.toLocaleString()));
const result={state:'PASS',scope:'ACTUAL_EXPORTED_JAVASCRIPT_WITH_MINIMAL_DOM_UNIT_HARNESS',visual_browser_qa:false,file,
 sha256:createHash('sha256').update(html).digest('hex'),companies:data.stocks.length,cards:data.coverage.cards_analyzed,
 medium_references:data.stocks.filter(s=>s.references.MEDIUM).length,long_references:longCount,
 checks:['dataset_full_coverage','24_card_pagination','symbol_short_and_full_name_search','horizon_switch',
  'single_stock_detail_and_sources','escape_close','empty_results','reference_filter','no_network_dependencies',
  ...(bvps?['reported_bvps_formula','all_three_original_action_sources']:[])],provider_requests:0};
await writeFile(receipt,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
