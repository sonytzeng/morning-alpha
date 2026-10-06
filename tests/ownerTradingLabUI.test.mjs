import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as lab from '../src/features/research/tradingLab.ts';
import {performance,discoverCandidates} from '../supabase/functions/_shared/owner-trading-lab.ts';
import {evidenceRows,IDENTITY} from './fixtures/decision-evidence-rows.mjs';
const canonical={report_date:IDENTITY.report_date,status:'READY',action:'WAIT',market_regime:'range',generated_text:{market_bias:'中性偏多',daily_sentence:'SYNTHETIC正式結論'}};
const fixture={version:'OWNER_TRADING_LAB_V1',public_product_approval:false,forward_enabled:false,business_date:IDENTITY.report_date,as_of:IDENTITY.generated_at,canonical,shadow:null,discovery:discoverCandidates(evidenceRows(),IDENTITY,canonical),trades:[],events:[],performance:{system:performance([]),sony:performance([]),market:{sample:0,direction_accuracy:null,forward_shadow_sample:0}}};
const source=readFileSync(new URL('../src/pages/admin/analysis/TradingLab.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props)=>({type,props});
function text(n){if(n==null)return '';if(Array.isArray(n))return n.map(text).join(' ');if(typeof n==='object')return typeof n.type==='function'?text(n.type(n.props)):text(n.props?.children);return String(n);}
function harness(mode='owner',data=fixture){
 let cursor=0,started=false,listener,release;const slots=[],gate=new Promise(r=>release=r),calls=[];
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>slots[i]=v];},useRef(initial){const i=cursor++;return slots[i]??= {current:initial};},useEffect(fn){if(!started){started=true;fn();}}};
 const supabase={auth:{onAuthStateChange(fn){listener=fn;return {data:{subscription:{unsubscribe(){}}}};}},functions:{async invoke(name,options){calls.push({name,body:options.body});await gate;return mode==='owner'?{data,error:null}:{data:null,error:{message:'PRIVATE_RAW_ERROR'}};}}};
 const exports={};vm.runInNewContext(code,{exports,crypto:{randomUUID:()=> 'synthetic'},require(n){if(n==='react')return hooks;if(n==='react/jsx-runtime')return {jsx,jsxs:jsx};if(n==='@/lib/supabase')return {supabase};if(n==='@/features/research/tradingLab')return lab;if(n==='@/features/research/intelligence')return {analysisLabel:x=>x};throw Error(n);}});
 const render=()=>{cursor=0;return text(exports.default());};render();return {render,calls,view:exports.TradingLabView,logout:()=>listener('SIGNED_OUT'),async release(){release();await new Promise(r=>setImmediate(r));}};
}
test('Owner view exposes decisions/reasons/funnel and separates journals from Forward',async()=>{
 const h=harness();await h.release();const t=h.render();for(const s of ['今天怎麼看','SYNTHETIC正式結論','不是全台股','支持判斷','反對／風險訊號','今天怎麼做','什麼情況代表看錯','我的交易','INSUFFICIENT_SAMPLE','未啟用','不是勝率'])assert(t.includes(s),s);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.operation,'READ');
 h.logout();assert(!h.render().includes('SYNTHETIC正式結論'));assert(h.render().includes('身分已變更'));
});
for(const mode of ['anonymous','member','paid','expired','unavailable'])test(mode+' cannot display Owner data',async()=>{const h=harness(mode);await h.release();assert(h.render().includes('無法讀取'));assert(!h.render().includes('SYNTHETIC正式結論'));assert(!h.render().includes('PRIVATE_RAW_ERROR'));});
test('late response after logout is discarded, not rendered',async()=>{const h=harness();h.logout();await h.release();assert(!h.render().includes('SYNTHETIC正式結論'));});
test('opening an existing journal performs one bounded outcome catch-up, never a Forward trigger',async()=>{const h=harness('owner',{...fixture,trades:[{id:'synthetic',symbol:'2330',kind:'SONY_LIVE_TRADE'}]});await h.release();assert.deepEqual(h.calls.map(c=>c.body.operation),['READ','REFRESH_OUTCOMES','READ']);h.render();assert.equal(h.calls.length,3);});
test('zero watchlist and samples remain honest, not fabricated success',()=>{const h=harness();const f=structuredClone(fixture);f.discovery.watchlist=[];f.discovery.first_blocked_gate='流動性';const t=text(h.view({data:f,busy:false,onCreate(){},onExit(){},onRefresh(){}}));assert(t.includes('目前沒有證據完整'));assert(t.includes('流動性'));assert(t.includes('樣本／證據不足'));assert(t.includes('不是帳戶淨值'));});
