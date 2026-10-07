import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as metrics from '../supabase/functions/_shared/recommendation-shadow-v2-summary.ts';
import {buildV2Capsule} from '../supabase/functions/_shared/recommendation-shadow-v2-runtime.ts';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
const result=(await buildV2Capsule(v2Fixture())).result;
const data={shadow_only:true,promotion_allowed:false,latest:result,forward_sample:0,forward_dates:[],outcome_sample:0,outcomes:[]};
const source=readFileSync(new URL('../src/pages/admin/analysis/RecommendationShadow.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props)=>({type,props});
const text=n=>n==null?'':Array.isArray(n)?n.map(text).join(' '):typeof n==='object'?typeof n.type==='function'?text(n.type(n.props)):text(n.props?.children):String(n);
function harness(mode='owner',fixture=data){
 let cursor=0,started=false,listener,release;const slots=[],gate=new Promise(r=>release=r),calls=[];
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>slots[i]=v];},useEffect(fn){if(!started){started=true;fn();}}};
 const supabase={auth:{onAuthStateChange(fn){listener=fn;return {data:{subscription:{unsubscribe(){}}}};}},async rpc(name){calls.push(name);await gate;return mode==='owner'?{data:fixture,error:null}:{data:null,error:{code:mode==='unavailable'?'network':'42501',message:'PRIVATE_ERROR'}};}};
 const exports={};vm.runInNewContext(code,{exports,require(n){if(n==='react')return hooks;if(n==='react/jsx-runtime')return {jsx,jsxs:jsx};if(n==='@/lib/supabase')return {supabase};if(n.endsWith('recommendation-shadow-v2-summary'))return metrics;throw Error(n);}});
 const render=()=>{cursor=0;return text(exports.default());};render();return {render,calls,logout:()=>listener('SIGNED_OUT'),async release(){release();await new Promise(r=>setImmediate(r));}};
}
test('Owner gets practical Shadow-only explanation and zero honest samples, no mutation RPC',async()=>{
 const h=harness();await h.release();const t=h.render().replace(/\s+/g,' ');for(const s of ['今天有哪些股票值得觀察','哪些訊號支持','哪些反對','什麼條件才進','INSUFFICIENT_SAMPLE'])assert(t.includes(s),s);
 assert(t.includes('Forward 日期 0'));assert(t.includes('不影響正式推薦或 LINE'));assert(t.includes('不是帳戶淨值'));assert(t.includes('不等於勝率'));
 assert.deepEqual(h.calls,['get_owner_recommendation_shadow_v2']);h.logout();assert(!h.render().includes('2330'));
});
for(const mode of ['anonymous','member','paid','expired','unavailable'])test(mode+' never displays research values',async()=>{const h=harness(mode);await h.release();assert(!h.render().includes('2330'));assert(!h.render().includes('PRIVATE_ERROR'));});
test('logout wins late read race and malformed/promotion-enabled contract is rejected',async()=>{
 const h=harness();h.logout();await h.release();assert(!h.render().includes('2330'));
 const bad=harness('owner',{...data,promotion_allowed:true});await bad.release();assert(!bad.render().includes('2330'));
});
