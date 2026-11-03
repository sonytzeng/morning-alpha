import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {MemoryRouter,useLocation,Link} from 'react-router-dom';
const source=readFileSync(new URL('../src/pages/pricing/Pricing.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,exports={};
vm.runInNewContext(compiled,{exports,React,require:name=>{
 if(name==='react')return React;if(name==='react-router-dom')return {useLocation,Link};
 if(name.startsWith('@/components/feature/'))return {__esModule:true,default:()=>null};
 if(name==='@/config/brand')return {LINE_ADD_FRIEND_URL:'https://line.me/'};
 if(name==='@/utils/analytics')return {trackEvent:()=>{},trackPageView:()=>{}};throw Error('UNREVIEWED_PRICE_IMPORT:'+name);
}});
test('actual pricing UI discloses disabled payment, preserves planned price and does not start a trial',()=>{
 const html=renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:['/pricing']},React.createElement(exports.default)));
 assert.match(html,/目前為公開測試，尚未開放付款/);assert.match(html,/NT\$199/);assert.match(html,/不會開始計算正式付費試用/);assert.match(html,/既有會員權益保持不變/);
 assert.match(html,/登入查看目前內容/);assert.doesNotMatch(html,/>開始.{0,8}試用<|checkout|lemonsqueezy/);
 assert.match(html,/href="\/stocks"/);assert.match(html,/href="\/login\?next=\/stocks"/);
 assert.match(html,/短、中、長期精選摘要/);assert.match(html,/完整已核准個股研究、反面證據與資料來源/);
});
