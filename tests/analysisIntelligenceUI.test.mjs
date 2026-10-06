import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { realInput } from './helpers/phase2AnalysisFixtures.mjs';
import { analyzeIntelligence } from '../supabase/functions/_shared/analysis-intelligence-v1.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props)=>({type,props});
const modules={};
function load(path,extra={}){
  const exports={};
  vm.runInNewContext(compile(read(path)),{exports,require(name){
    if(name in extra)return extra[name];
    if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
    if(name==='@/features/research/intelligence')return modules.intelligence;
    if(name==='@/features/research/foundation')return modules.foundation;
    if(name==='./IntelligenceView')return modules.view;
    if(name==='./TradingLab')return {default:()=>null}; // independently covered by Owner Lab Handler/UI suite
    if(name==='./analysis.css')return {};
    throw Error('UNEXPECTED_IMPORT:'+name);
  }});return exports;
}
modules.intelligence=load('src/features/research/intelligence.ts');
modules.foundation=load('src/features/research/foundation.ts');
modules.view=load('src/pages/admin/analysis/IntelligenceView.tsx');
const real=analyzeIntelligence(realInput('2026-10-02'),realInput('2026-10-01'));
const envelope={schema_version:'OWNER_ANALYSIS_V1',mode:'SHADOW_ONLY',production_eligible:false,forward_sample:0,analysis_value:'INSUFFICIENT_SAMPLE',
  latest:{id:'fixture',created_at:'2026-10-05T00:00:00Z',compute_ms:1,analysis:real},invalidations:[]};
const foundation={schema_version:'RESEARCH_FOUNDATION_V1',mode:'SHADOW',production_eligible:false,features:[],method_versions:0,graphs:0,observations:0};
function textTree(node){
  if(node==null)return'';if(Array.isArray(node))return node.map(textTree).join(' ');
  if(typeof node==='object'){if(typeof node.type==='function')return textTree(node.type(node.props));return textTree(node.props?.children);}
  return String(node);
}
test('real historical analysis is honestly rendered with supporting, contradicting, proxy and missing states',()=>{
  const text=textTree(modules.view.default({data:modules.intelligence.readOwnerAnalysis(envelope)}));
  for(const expected of ['今日分析','歷史重播','Forward Sample：','INSUFFICIENT_SAMPLE','反對主要判斷','Evidence Inspector','IEF','不可用，沒有補零','尚未完成Forward結果校準，不代表上漲機率','市場分歧','正式決策對照','WAIT／等待確認'])assert(text.includes(expected),expected);
  assert(!text.includes('[object Object]'));
});
test('empty and unavailable inputs never display fabricated metrics',()=>{
  const text=textTree(modules.view.default({data:{...envelope,latest:null}}));assert(text.includes('尚無已鎖定'));assert(text.includes('INSUFFICIENT_SAMPLE'));
  for(const patch of [{production_eligible:true},{mode:'PRODUCTION'},{forward_sample:-1},{analysis_value:'PROVEN'}])assert.throws(()=>modules.intelligence.readOwnerAnalysis({...envelope,...patch}));
  assert.throws(()=>modules.intelligence.readOwnerAnalysis({...envelope,latest:{...envelope.latest,analysis:{...real,quality:{}}}}));
  assert.throws(()=>modules.intelligence.readOwnerAnalysis({...envelope,invalidations:[{invalidation_id:'x',status:'UNKNOWN'}]}));
});
test('unavailable previous comparison never renders a fake unchanged or percentage result',()=>{
  const missing=analyzeIntelligence(realInput('2026-10-02'));
  const text=textTree(modules.view.default({data:{...envelope,latest:{...envelope.latest,analysis:missing}}}));
  assert(text.includes('缺少可比較的前一有效交易日證據，本日分析仍依當日完整市場證據成立。'));
  assert(text.includes('無可比較前日資料'));
  assert(!text.includes('沒有新增方向變化'));assert(!text.includes('分析失敗'));
});
async function harness(mode){
  let state={kind:'loading'},listener,resolve,initialized=false;const gate=new Promise(r=>resolve=r);
  const requests=[];
  const hooks={useState:()=>[state,v=>state=v],useEffect:fn=>{if(!initialized){initialized=true;fn();}}};
  const supabase={auth:{onAuthStateChange:fn=>{listener=fn;return{data:{subscription:{unsubscribe(){}}}};}},
    rpc:async name=>{requests.push(name);await gate;
      if(mode!=='owner')return{data:null,error:{code:mode==='unavailable'?'PGRST202':'42501'}};
      return{data:name==='get_research_foundation_v1'?foundation:envelope,error:null};}};
  const page=load('src/pages/admin/analysis/page.tsx',{'react':hooks,'@/lib/supabase':{supabase}}).default;
  page();return{render:()=>textTree(page()),release:async()=>{resolve();await new Promise(r=>setImmediate(r));},logout:()=>listener('SIGNED_OUT'),requests};
}
for(const mode of ['anonymous','normal member','paid member'])test(mode+' cannot render owner analysis',async()=>{
  const h=await harness(mode);await h.release();assert(h.render().includes('具名授權 Owner'));assert(!h.render().includes('市場分歧'));
});
test('owner loads both readonly RPCs; logout immediately removes data',async()=>{
  const h=await harness('owner');await h.release();assert(h.render().includes('市场分歧')||h.render().includes('市場分歧'));
  assert(h.render().includes('Phase 2 Analysis Intelligence'));assert(h.render().includes('尚未開始Forward驗證'));
  assert.deepEqual(h.requests.sort(),['get_owner_analysis_v2','get_research_foundation_v1']);h.logout();assert(!h.render().includes('市場分歧'));
});
test('logout race rejects both late RPC replies',async()=>{
  const h=await harness('owner');h.logout();await h.release();assert(!h.render().includes('市場分歧'));assert(h.render().includes('具名授權 Owner'));
});
test('unavailable sidecar does not claim success or expose raw errors',async()=>{
  const h=await harness('unavailable');await h.release();assert(h.render().includes('正式市場服務不受影響'));assert(!h.render().includes('PGRST202'));
});
test('Owner catalogue separates historical records from Forward and rejects mixed-mode responses',()=>{
  const replay={...envelope,selected_mode:'HISTORICAL_REPLAY',historical_replay_count:3,
    catalog:[{business_date:'2026-10-02'},{business_date:'2026-10-01'},{business_date:'2026-09-30'}]};
  assert.equal(modules.intelligence.readOwnerAnalysis(replay).forward_sample,0);
  for(const patch of [{selected_mode:'FORWARD_SHADOW'},{historical_replay_count:-1},
    {catalog:[{business_date:'invalid'}]},{catalog:Array(91).fill({business_date:'2026-10-02'})}])
    assert.throws(()=>modules.intelligence.readOwnerAnalysis({...replay,...patch}));
  const forward=modules.intelligence.readOwnerAnalysis({...replay,selected_mode:'FORWARD_SHADOW',latest:null,catalog:[]});
  assert.equal(forward.forward_sample,0);assert.equal(forward.historical_replay_count,3);
});
