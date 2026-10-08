import {lineDecisionFixture} from './helpers/lineDecisionFixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {evaluatePublishedMarketDelivery} from '../supabase/functions/_shared/market-publication-contract.ts';
import {buildPublishedLineDecision,PRODUCTION_LINE_TEMPLATE,LINE_TEMPLATE_ROLLBACK} from '../supabase/functions/_shared/line-production-template.ts';
import {composeLineDecision,decisionCardFlex} from '../supabase/functions/_shared/line-decision-card-v659.ts';
import {declaration,isolatedFunction} from './helpers/isolatedEdgeLoader.mjs';
const base='8be2d3a575b9a3813eb1919b77a7e1f9a0755e53';
const prior=p=>execFileSync('git',['show',base+':'+p],{encoding:'utf8',maxBuffer:4*1024*1024});
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
// Synthetic adapter controls; NOT real publication proof. Real four-day replay is a separate mandatory local gate.
const r=lineDecisionFixture(),p=r.payload,projection=structuredClone(r.subscriber_projection);
projection.historical=false;
const captures=[{report:{id:'synthetic-report',report_date:r.report_date,ai_strategy_json:{revision_id:r.revision_id,market_report_gate:{recommendation_gate:p.recommendation_gate}}},
snapshot:{id:r.revision_id,report_id:'synthetic-report',report_date:r.report_date,status:'READY',action:'WAIT',
generated_text:{canonical_market_state:p.admin_source_report.ai_strategy_json.canonical_market_state}},
delivery:{eligible:true,projection,operational_market:p.admin_source_report.ai_strategy_json.operational_market}}];
const source=read('supabase/functions/line-daily-push/index.ts');
const sender=isolatedFunction(source,'buildLineMessage',{buildPublishedLineDecision});
const sha=s=>createHash('sha256').update(s).digest('hex');
const json=x=>JSON.parse(JSON.stringify(x));
function evaluated(f){
 const gate=f.report.ai_strategy_json.market_report_gate;
 const delivery=structuredClone(f.delivery);
 assert.equal(delivery.eligible,true,JSON.stringify(delivery.reason_codes));
 return {gate,delivery};
}
// Execute the immutable PR214 / approved V659 composer, not a hand-written expected template.
const oldModule={exports:{}};
vm.runInNewContext(ts.transpileModule(prior('src/features/line/decisionCard.ts'),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
 {module:oldModule,exports:oldModule.exports,require:()=>({}),URL});
function approved(f,d,g){
 const id=d.projection.identity,projection=structuredClone(d.projection),action=f.snapshot.action==='ACT'?'ENTER':f.snapshot.action==='STOP'?'AVOID':f.snapshot.action;
 const response={tier:'admin',authenticated:true,report_date:id.reportDate,revision_id:id.revisionId,generated_at:id.generatedAt,
  subscriber_projection:projection,payload:{revision_id:id.revisionId,canonical_decision:{id:id.revisionId,action},
   recommendation_gate:g.recommendation_gate,admin_source_report:{ai_strategy_json:{revision_id:id.revisionId,
    canonical_market_state:f.snapshot.generated_text.canonical_market_state,operational_market:d.operational_market}}}};
 return oldModule.exports.decisionCardFlex(oldModule.exports.composeDecisionCard(response));
}
export function validateFlex(message){
 // Local validation of the used LINE Flex subset, per official message/components reference.
 assert.equal(message.type,'flex');assert(message.altText.length>0&&message.altText.length<=400);
 const bubble=message.contents;assert.equal(bubble.type,'bubble');assert.equal(bubble.size,'mega');
 assert(Buffer.byteLength(JSON.stringify(bubble))<=30*1024);
 const buttons=[];
 function visit(c){
  assert(['box','text','button'].includes(c.type));
  if(c.type==='box'){assert.equal(c.layout,'vertical');assert(Array.isArray(c.contents)&&c.contents.length>0);c.contents.forEach(visit);}
  if(c.type==='text'){assert.equal(typeof c.text,'string');assert(c.text.length>0&&c.text.length<=2000);assert.equal(c.wrap,true);
   assert(['xs','sm','lg'].includes(c.size));assert.match(c.color,/^#[0-9A-Fa-f]{6}$/);}
  if(c.type==='button'){buttons.push(c);assert.equal(c.action.type,'uri');assert(c.action.label.length<=40);
   assert.equal(c.action.uri,'https://morningalphatw.com/report/today');}
 }
 visit(bubble.header);visit(bubble.body);visit(bubble.footer);assert.equal(buttons.length,1);
}
for(const f of captures)test('synthetic adapter → actual Sender → exact approved V659 Flex; real capture gate is separate',()=>{
 const before=JSON.stringify(f),{delivery,gate}=evaluated(f);
 const actual=sender(delivery,'https://morningalphatw.com',f.report,f.snapshot,gate);
 validateFlex(actual);assert.deepEqual(json(actual),json(approved(f,delivery,gate)));
 assert.equal(JSON.stringify(f),before);
 assert(!/PRODUCTION_V1|BLOCKED|WAIT|DEGRADED|NEAR_MISS|shadow_only|revision_id/.test(JSON.stringify(actual)));
 assert.equal(delivery.projection.recommendation.status,'BLOCKED');
});
test('current-day only, exact revision/action and valid HTTPS CTA remain fail closed',()=>{
 const f=structuredClone(captures[0]),{delivery,gate}=evaluated(f);
 for(const mutate of [d=>d.eligible=false,d=>d.projection.historical=true,d=>d.projection.identity.revisionId='other',d=>d.projection.marketDecision.action='STOP']){
  const d=structuredClone(delivery);mutate(d);assert.throws(()=>sender(d,'https://morningalphatw.com',f.report,f.snapshot,gate));
 }
 for(const url of ['http://morningalphatw.com','https://user:password@morningalphatw.com','https://morningalphatw.com?redirect=elsewhere'])
  assert.throws(()=>sender(delivery,url,f.report,f.snapshot,gate),/CTA_INVALID/);
});
test('READY / NONE / BLOCKED use only current admitted V1 gate; Shadow cannot supply member symbols',()=>{
 for(const status of ['QUALIFIED','NO_QUALIFIED_OPPORTUNITY','BLOCKED']){
  const f=structuredClone(captures[0]),{gate,delivery}=evaluated(f);
  const g=gate.recommendation_gate;
  Object.assign(g,{status,eligible:status==='QUALIFIED',universe_evaluation_complete:true,
   screening:{status:'COMPLETE',universe_count:72,evaluated_count:72,rejected:[]}});
  delivery.projection.recommendation={status,available:status==='QUALIFIED',items:status==='QUALIFIED'?
   [{symbol:'2330',name:'台積電',reasons:['合成狀態測試：正式條件通過']}]:[]};
  const expected=sender(delivery,'https://morningalphatw.com',f.report,f.snapshot,gate);
  f.report.ai_strategy_json.recommendation_v2={status:'READY',symbol:'V2_PRIVATE_CANARY'};
  f.snapshot.generated_text.shadow={status:'READY',symbol:'V2_PRIVATE_CANARY'};
  assert.deepEqual(sender(delivery,'https://morningalphatw.com',f.report,f.snapshot,gate),expected);
  const out=JSON.stringify(expected);validateFlex(expected);assert(!out.includes('V2_PRIVATE_CANARY'));
  assert(out.includes(status==='QUALIFIED'?'今日正式推薦｜台積電（2330）':status==='NO_QUALIFIED_OPPORTUNITY'?'今天已完成個股評估':'資料尚未完整'));
  if(status==='NO_QUALIFIED_OPPORTUNITY'){
   g.screening.evaluated_count=71;assert(!JSON.stringify(sender(delivery,'https://morningalphatw.com',f.report,f.snapshot,gate)).includes('今天已完成個股評估'));
  }
 }
});
test('extracting pure composition preserves approved code and all non-template Sender bytes',()=>{
 const old=prior('src/features/line/decisionCard.ts'),core=read('supabase/functions/_shared/line-decision-card-v659.ts');
 const composition=declaration(core,'composeLineDecision'),approvedComposition=declaration(old,'composeDecisionCard');
 assert.equal(composition.slice(composition.indexOf('  const knownIds')),approvedComposition.slice(approvedComposition.indexOf('  const knownIds')));
 assert.equal(declaration(core,'decisionCardFlex'),declaration(old,'decisionCardFlex'));
 const oldSender=prior('supabase/functions/line-daily-push/index.ts');
 const normalize=s=>s.replace(/^import .*line-(?:daily-flex-message.mjs|production-template.ts)';\n/m,'')
  .replace(/const message = buildLineMessage\([^;]+;/,'const message = TEMPLATE;')
  .replace(declaration(s,'buildLineMessage'),'TEMPLATE');
 assert.equal(normalize(source),normalize(oldSender),'Auth, recipient, dispatch, retry, dedup and all other Sender code are byte-identical');
 assert.equal(read('supabase/functions/_shared/line-daily-flex-message.mjs'),prior('supabase/functions/_shared/line-daily-flex-message.mjs'));
 assert.equal(PRODUCTION_LINE_TEMPLATE,'LINE_DECISION_CARD_V2_V659');
 assert.equal(LINE_TEMPLATE_ROLLBACK,base+':line-daily-push@68');
 assert(!/fetch\(|\.invoke\(|\.insert\(|Deno\.env|api\.line\.me/.test(core));
});

test('public real-replay receipt binds exact tested source without publishing raw Production evidence',()=>{
 const receipt=JSON.parse(read('tests/fixtures/line-v659-real-replay-receipt.json'));
 assert.equal(receipt.schema_version,'LINE_V659_LOCAL_REAL_REPLAY_RECEIPT_V1');
 assert.equal(receipt.raw_capture_location,'LOCAL_ONLY_NOT_COMMITTED');
 assert.match(receipt.raw_capture_sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(receipt.captures.map(r=>r.business_date),['2026-10-05','2026-10-06','2026-10-07','2026-10-08']);
 for(const r of receipt.captures){assert.equal(r.publication_gate,'PASS');assert.equal(r.approved_v659_parity,'PASS');assert.equal(r.line_sends,0);assert.equal(r.business_writes,0);assert.equal(r.v1_only,true);}
 for(const r of receipt.sources)assert.equal(sha(read(r.path)),r.sha256,'local real replay must be repeated after source drift: '+r.path);
 assert.equal(receipt.layout.overflow,0);assert.equal(receipt.line_app_delivery,'NOT_OBSERVED_YET');
});
