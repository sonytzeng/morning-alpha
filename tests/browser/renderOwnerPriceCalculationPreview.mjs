// Offline visual fixture: server-render the actual production content component
// with real calculator output for explicitly synthetic inputs. No browser or
// network automation, authentication, production data or publication occurs.
import {readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import vm from 'node:vm';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as contracts from '../../src/features/vnext/contracts.ts';
import * as calculationParser from '../../src/features/vnext/dailyAiOwnerPriceCalculation.ts';
import {createOwnerCalculationFixture,SYNTHETIC_CALCULATION_OWNER} from '../helpers/dailyAiOwnerPriceCalculationFixture.mjs';

const destination=process.argv[2];if(!destination||!isAbsolute(destination)||!destination.endsWith('.html'))throw Error('ABSOLUTE_HTML_OUTPUT_REQUIRED');
const filename='src/pages/vnext/DailyAiOwnerPriceCalculation.tsx',script=ts.transpileModule(readFileSync(new URL('../../'+filename,import.meta.url),'utf8'),{
 fileName:filename,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const exports={};vm.runInNewContext(script,{exports,Date,Intl,URL,require(name){
 if(name==='react')return React;if(name==='react/jsx-runtime')return jsxRuntime;if(name==='@/features/vnext/contracts')return contracts;
 if(name==='@/features/vnext/dailyAiOwnerPriceCalculation')return calculationParser;
 if(name==='@/lib/supabase')return {supabase:{rpc(){throw Error('OFFLINE_PREVIEW_RPC_FORBIDDEN');}}};if(name.endsWith('.css'))return {};throw Error(name);
}});
const scenarios=[{name:'短期 ATR',horizon:'SHORT'},{name:'中期 EPS × PE',horizon:'MEDIUM',reportedEps:true},
 {name:'長期 FCFE',horizon:'LONG'},{name:'長期股利＋末期 PE',horizon:'LONG',dividendMethod:true,symbol:'1001'}];
const contents=[];
for(const [index,scenario]of scenarios.entries()){
 const f=await createOwnerCalculationFixture(scenario),parsed=await calculationParser.parseDailyAiOwnerPriceCalculation(f.response,f.row,SYNTHETIC_CALCULATION_OWNER);
 contents.push(`<section class="dac-panel" id="fixture-${index}" ${index?'hidden':''}><div class="dac-heading"><div><p>Owner 私人計算明細 · 合成版面驗證</p><h2>${scenario.name} · ${f.row.body.symbol}</h2></div></div><p>合成研究區間：NT$${f.row.body.entry_range[0]}～${f.row.body.entry_range[1]}。未核准，不作為買進訊號。</p>${renderToStaticMarkup(React.createElement(exports.OwnerPriceCalculationContent,{audit:parsed.audit}))}</section>`);
}
const css=['../../src/pages/vnext/vnext.css','../../src/pages/vnext/daily-ai-owner-calculation.css','./owner-price-calculation-preview.css'].map(path=>readFileSync(new URL(path,import.meta.url),'utf8')).join('\n');
const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src data:"><title>Morning Alpha · Owner 計算明細合成驗證</title><style>${css}\n.fixture-nav{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}.fixture-nav button{min-height:44px;padding:10px 14px;border:1px solid #8eac9d;background:#fff;border-radius:8px}.fixture-nav button[aria-pressed=true]{background:#dceee4;font-weight:700}.dac-panel[hidden]{display:none}</style></head><body><div class="vnext"><header class="fixture-banner"><strong>本地合成流程驗證 · 非真實股票推薦</strong><p>本檔使用實際計算器與實際 Owner 明細元件。公司、來源與數字均為合成測試；沒有連線正式服務、授權來源、建立審查或發布推薦。</p><p>本檔核對版面與展開內容；登入範圍、伺服器回覆與登出隱藏另由元件測試驗證。</p></header><main class="vnext-content"><h1>價格怎麼算出來？</h1><p>逐筆核對來源、假設、公式與時間。以下情境僅用於畫面驗證。</p><nav class="fixture-nav" aria-label="合成方法預覽">${scenarios.map((s,i)=>`<button type="button" data-fixture="${i}" aria-pressed="${i===0}">${s.name}</button>`).join('')}</nav>${contents.join('')}</main></div><script>document.querySelectorAll('[data-fixture]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-fixture]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[id^="fixture-"]').forEach(panel=>panel.hidden=panel.id!=='fixture-'+button.dataset.fixture);}));</script></body></html>`;
writeFileSync(destination,html);process.stdout.write(JSON.stringify({path:destination,bytes:Buffer.byteLength(html),synthetic_only:true,methods:scenarios.length,network_calls:0})+'\n');
