// Single-process synthetic parse/render diagnostics. Not a concurrency/load test.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {isolatedFunction} from '../../../tests/helpers/isolatedEdgeLoader.mjs';
import {parseDailyAiMember} from '../../../src/features/vnext/dailyAiMember.ts';
import {parseDailyAiMemberDelta} from '../../../src/features/vnext/dailyAiMemberDelta.ts';
import {createServer} from '../../../node_modules/vite/dist/node/index.js';
import React from '../../../node_modules/react/index.js';
import {renderToStaticMarkup} from '../../../node_modules/react-dom/server.node.js';

const here=new URL('.',import.meta.url),root=new URL('../../../',here).pathname;
const now=Date.parse('2026-10-31T02:00:00Z'),day='2026-10-31';
const source=readFileSync(new URL('../../../tests/dailyAiMember.test.mjs',here),'utf8');
const fixture=isolatedFunction(source,'fixture')('premium');
for(const card of fixture.cards){
 card.reason.text='SYNTHETIC LOCAL RENDER TEXT '.repeat(45);
 card.confirmation='SYNTHETIC CONFIRMATION '.repeat(25);card.invalidation='SYNTHETIC INVALIDATION '.repeat(25);
 card.counter_evidence[0].text='SYNTHETIC COUNTER EVIDENCE '.repeat(45);
}
// Reach at least the measured 968,431-byte production cards text, without
// obtaining private production cards or implying source-acquisition evidence.
while(Buffer.byteLength(JSON.stringify(fixture))<968431)
 for(const card of fixture.cards)card.gaps.push('SYNTHETIC SIZE PADDING '.repeat(12));
const scope={identity:'00000000-0000-0000-0000-000000000001',generation:1,signal:new AbortController().signal,tier:'premium',requestDate:day};
const data=parseDailyAiMember(fixture,day,now),cache={scope,data};
const common={schema:'VNEXT_AI_MEMBER_DELTA_V1',user_id:scope.identity,tier:'premium',business_date:day,research_only:true,edition:fixture.edition};
const fullText=JSON.stringify({...common,mode:'FULL',payload:fixture}),unchangedText=JSON.stringify({...common,mode:'UNCHANGED'});
assert.equal(data.cards.length,216);assert.equal(parseDailyAiMemberDelta(JSON.parse(unchangedText),scope,cache,now),data);
const measure=(iterations,run)=>{
 for(let i=0;i<3;i++)run();
 const values=[];for(let i=0;i<iterations;i++){const start=performance.now();run();values.push(performance.now()-start);}
 values.sort((a,b)=>a-b);const at=q=>Number(values[Math.ceil(q*values.length)-1].toFixed(3));
 return {iterations,p50_ms:at(.5),p95_ms:at(.95),max_ms:Number(values.at(-1).toFixed(3))};
};
const timings={
 full_json_and_projection:measure(30,()=>parseDailyAiMemberDelta(JSON.parse(fullText),scope,null,now)),
 unchanged_json_and_cache_binding:measure(100,()=>assert.equal(parseDailyAiMemberDelta(JSON.parse(unchangedText),scope,cache,now),data)),
};
const server=await createServer({configFile:false,root,resolve:{alias:{'@':root+'src'}},server:{middlewareMode:true},appType:'custom'});
const originalNow=Date.now;
try{
 Date.now=()=>now;const {default:Page}=await server.ssrLoadModule('/src/pages/vnext/DailyAiMemberResearch.tsx');
 const render=props=>renderToStaticMarkup(React.createElement(Page,{data,...props}));
 const count=html=>(html.match(/class="vnext-card dam-card"/g)||[]).length;
 const initial=render({}),expanded=render({viewState:{filter:'ALL',query:'',limit:72}}),searched=render({viewState:{filter:'ALL',query:'1000',limit:72}});
 assert.equal(count(initial),9);assert.equal(count(expanded),72);assert.equal(count(searched),1);
 timings.initial_nine_cards_ssr=measure(10,()=>render({}));
 timings.expanded_72_cards_ssr=measure(5,()=>render({viewState:{filter:'ALL',query:'',limit:72}}));
 timings.search_one_card_ssr=measure(10,()=>render({viewState:{filter:'ALL',query:'1000',limit:72}}));
 Date.now=()=>Date.parse(data.edition.expires_at);const expired=render({});assert.equal(count(expired),0);assert(expired.includes('這個研究版本已到期'));
 const result={schema:'MEMBER_AI_DELTA_LOCAL_RENDER_DIAGNOSTIC_V1',result:'PASS',synthetic_data:true,node_version:process.version,
  measurement_scope:'Single local process; JSON parsing, strict client projection and server-side rendering only. No browser paint, network, Auth, DB or concurrency capacity measurement.',
  full_json_bytes:Buffer.byteLength(fullText),unchanged_json_bytes:Buffer.byteLength(unchangedText),cards_in_model:216,
  rendered_cards:{initial:9,expanded:72,searched:1,expired:0},timings,production_used:false,production_load_test:false,ten_thousand_member_capacity_proven:false};
 writeFileSync(new URL('local-render-smoke.result.json',here),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({result:'FAIL',message:error.message}));process.exitCode=1;}
finally{Date.now=originalNow;await server.close();}
