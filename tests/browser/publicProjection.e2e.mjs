// Candidate-built UI, an actual local handler, retained 10/2 input. Every
// non-loopback request is fulfilled or blocked before transport. No user profile.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCapturedContentOs} from '../helpers/coreContentOsCapturedReplay.mjs';
const {chromium}=await import(process.env.MA_PLAYWRIGHT_MODULE||'playwright');
assert.equal(process.env.MA_PUBLIC_PROJECTION_SCOPE,'public-projection-20261002');
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(root,'out');
const output=process.env.MA_E2E_OUTPUT;assert(output?.startsWith('/private/tmp/'));mkdirSync(output,{recursive:true});
const capture=JSON.parse(readFileSync(resolve(root,'tests/fixtures/public-projection/production-20261002.json')));
const tables=structuredClone(capture.tables);
for(const name of ['market_quotes','news_events','institutional_flows','earnings_events','sector_stock_map','catalyst_tw_mappings','research_catalysts','model_evaluations'])tables[name]=[];
const result=await runCapturedContentOs(tables,{entrypoint:'get-report-payload',method:'POST',headers:{'content-type':'application/json'},
 requestBody:{report_date:'2026-10-02'},now:'2026-10-02T12:30:00Z',rpc:async name=>{
  if(name==='public_market_checkpoint_inputs_v1')return {batches:tables.market_checkpoint_batches,proofs:capture.atomic_proofs.map(x=>x.proof)};
  assert.equal(name,'record_critical_contract_evidence_v1');return null;
 }});
assert.equal(result.status,200);assert(result.body.payload.public_market_read_model);
const server=createServer((req,res)=>{
 let path=resolve(out,'.'+new URL(req.url,'http://localhost').pathname);
 if(!path.startsWith(out+'/')||!existsSync(path)||!extname(path))path=resolve(out,'index.html');
 res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(path)]||'application/octet-stream');
 res.end(readFileSync(path));
});
const browser=await chromium.launch({executablePath:process.env.MA_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({timezoneId:'Asia/Taipei',viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.addInitScript(()=>{
 const OriginalDate=Date;class ReplayDate extends OriginalDate{
  constructor(...args){super(...(args.length?args:['2026-10-02T12:30:00Z']));}static now(){return OriginalDate.parse('2026-10-02T12:30:00Z');}
 }globalThis.Date=ReplayDate;
});
let externalDispatch=0,payloadReads=0;const errors=[],summaries=[];
await context.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.hostname==='127.0.0.1')return route.continue();
 if(u.pathname==='/functions/v1/get-report-payload'){payloadReads++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result.body)});}
 // Explicit inert external dependency double, not a real business result.
 if(u.pathname.startsWith('/rest/v1/')||u.pathname.startsWith('/auth/v1/'))return route.fulfill({status:200,contentType:'application/json',body:'[]'});
 return route.fulfill({status:204,body:''});
});
await context.routeWebSocket('**/*',route=>route.close());
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1'&&request.redirectedFrom())externalDispatch++;});
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 for(const path of ['/','/report/today','/war-room','/verification']){
  await page.goto('http://127.0.0.1:'+server.address().port+path);
  await page.waitForFunction(()=>document.body.innerText.includes('中性偏多')||document.body.innerText.includes('大致一致')||document.body.innerText.includes('今日節點已完成'));
  assert.equal(await page.locator('vite-error-overlay,[data-nextjs-dialog]').count(),0);
  const text=await page.locator('body').innerText();assert(text.length>100);assert(!text.includes('趨勢行情'));assert(!text.includes('沒有增加可用證據'));
  if(path==='/war-room'){for(const t of ['09:00','09:30','10:30','13:00','14:10','14:30'])assert(text.includes(t));assert(text.includes('新增市場證據'));assert(text.includes('今日節點已完成'));}
  if(path==='/report/today')assert(text.includes('震盪／盤整'));
  if(path==='/verification'){for(const v of ['0.25%','0.40%','0.06%','大致一致'])assert(text.includes(v));}
  const name=path==='/'?'home':path.replaceAll('/','-').slice(1);
  await page.screenshot({path:output+'/'+name+'.png',fullPage:true});
  writeFileSync(output+'/'+name+'.txt',text);
  summaries.push({path,status:'PASS',content:true,overlay:false});
 }
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(externalDispatch,0);assert(payloadReads>=4);
 const evidence={status:'PASS',screens:summaries,console_errors:errors,external_network_dispatch:0,production_writes:0,
  payload_revision:result.body.payload.public_market_read_model.projection_revision,fixture:'REAL_20261002_CANONICAL_INPUT_WITH_EMPTY_AUXILIARY_ASSESSMENT_CONTROL'};
 writeFileSync(output+'/results.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}catch(error){
 await page.screenshot({path:output+'/failed.png',fullPage:true});
 writeFileSync(output+'/failed.txt',await page.locator('body').innerText());
 console.error(JSON.stringify({path:new URL(page.url()).pathname,errors,payloadReads}));
 throw error;
}finally{await browser.close();server.close();}
