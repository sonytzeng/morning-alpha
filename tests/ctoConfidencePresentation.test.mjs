import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ACTION_LABEL,actionTone,emptyDecision} from '../src/features/decision-v1/engine.ts';
import {opportunitySummary} from '../src/features/decision-v1/presentation.ts';
import {getSubscriberReportProjection,SUBSCRIBER_ANALYSIS_INCOMPLETE} from '../src/lib/subscriberReportContract.ts';
import {PUBLIC_REGIMES} from '../src/lib/publicMarketReadModel.ts';
import {subscriberProjectionFixture} from './fixtures/subscriber-projection-v1.mjs';
const source=readFileSync(new URL('../src/features/decision-v1/DecisionBrief.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const exports={};
vm.runInNewContext(compiled,{exports,React,require:name=>{
 if(name==='react')return React;
 if(name==='./engine')return {ACTION_LABEL,actionTone};
 if(name==='./presentation')return {opportunitySummary};
 if(name.endsWith('GlossarySheet'))return {__esModule:true,default:()=>null};
 if(name.endsWith('subscriberReportContract'))return {SUBSCRIBER_ANALYSIS_INCOMPLETE};
 if(name.endsWith('publicMarketReadModel'))return {PUBLIC_REGIMES};
 if(name.endsWith('.css'))return {};
 throw Error('UNREVIEWED_RENDER_IMPORT:'+name);
}});
const render=(confidence,unavailable=false)=>{
 const decision={...emptyDecision(),model_confidence:{value:48,meaning:'quality_index',score_version:'ma-decision-v1.0',evidence_ids:['isolated-evidence'],calculation:'quality coverage',inputs:{completeness:.48}}};
 return renderToStaticMarkup(React.createElement(exports.DecisionBrief,{decision,date:'2026-10-13',marketBias:'偏弱觀察',marketConfidence:confidence,legacyInstruction:'等待確認',legacyReason:'沿用正式判斷',legacyCount:0,analysisUnavailable:unavailable}));
};
test('observed 65 market confidence and 48 evidence quality remain separate in real component rendering',()=>{
 // Values observed from the real 10/13 Owner browser. The surrounding wire shape
 // is an isolated contract control, not a Production payload or identity.
 const wire=subscriberProjectionFixture('MARKET_READY_RECOMMENDATION_BLOCKED',{todayDate:'2026-10-13'});
 wire.subscriber_state.confidence.value=65;wire.canonical_decision.confidence_score=65;
 const projection=getSubscriberReportProjection(wire),html=render(projection.confidence);
 assert.match(html,/<dt>判斷信心<\/dt><dd>65 \/ 100<\/dd>/);
 assert.doesNotMatch(html,/<dt>模型信心<\/dt>/);
 assert.match(html,/<details[^>]*><summary>查看證據品質與校準說明<\/summary>/);
 assert.match(html,/資料支持程度：48\/100/);
 assert.equal(projection.confidence.value,wire.canonical_decision.confidence_score);
});
test('unknown formal confidence never borrows the evidence score, zero stays zero and unavailable suppresses both',()=>{
 const missing=render({value:null,label:'證據不足，暫不提供把握度'});
 assert.match(missing,/<dt>判斷信心<\/dt><dd>證據不足，暫不提供把握度<\/dd>/);
 assert.match(render({value:0,label:'0 / 100'}),/<dt>判斷信心<\/dt><dd>0 \/ 100<\/dd>/);
 const unavailable=render({value:65,label:'65 / 100'},true);
 assert.doesNotMatch(unavailable,/65 \/ 100|資料支持程度：48/);
});
test('a different formal revision or score is respected, without hardcoded 65',()=>{
 assert.match(render({value:82,label:'82 / 100'}),/<dt>判斷信心<\/dt><dd>82 \/ 100<\/dd>/);
 assert.doesNotMatch(render({value:82,label:'82 / 100'}),/65 \/ 100/);
});
test('completed timeline does not prefix a missing time, while a real checkpoint keeps its time',()=>{
 const file=readFileSync(new URL('../src/pages/report/TodayReport.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('TodayReport.tsx',file,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression;
 const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='nextDecisionTime')expression=node.initializer.getText(ast);ts.forEachChild(node,visit);};visit(ast);assert.ok(expression);
 assert.equal(vm.runInNewContext(expression,{nextRuntimeNode:{time:'',label:'今日節點已完成'}}),'今日節點已完成');
 assert.equal(vm.runInNewContext(expression,{nextRuntimeNode:{time:'09:30',label:'開盤確認'}}),'09:30｜開盤確認');
 assert.match(file,/marketConfidence=\{projection\.confidence\}/);
});
