import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
const {chromium}=await import(process.env.MA_PLAYWRIGHT_MODULE || 'playwright');
if(process.env.MA_LOCAL_SCOPE!=='ma-core-final-20260907')throw Error('Explicit isolated preview scope required');
const output=process.env.MA_E2E_OUTPUT;
if(!output?.startsWith('/private/tmp/'))throw Error('Temporary evidence directory required');
mkdirSync(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.MA_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage(), errors=[], network=[], results=[];
await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1')return route.abort();return route.continue();});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text())});
page.on('response',r=>network.push({path:new URL(r.url()).pathname,status:r.status()}));
try{
 await page.goto('http://127.0.0.1:4313/tests/browser/productDecision.html');
 for(const [scenario,copy] of [['EXTENDED','價格已偏熱，先不追高'],['MISSING','評估尚未完成，先等待'],['NO_QUALIFIED','今天沒有符合標準的新增機會'],['DAMAGED','避開已受損的劇本'],['MISPRICING','等待證據確認']]){
  await page.getByRole('combobox',{name:'測試情境'}).selectOption(scenario);
  await page.getByText(copy,{exact:true}).first().waitFor();
  if(scenario==='MISSING')assert.equal(await page.locator('.ma-subscriber-opportunity').count(),0);
  if(scenario==='MISPRICING')assert.match(await page.locator('main').innerText(),/錯殺觀察/);
  for(const width of [375,390,430,1440]){
   await page.setViewportSize({width,height:width===1440?1000:844});
   const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.equal(overflow,0);
   results.push({scenario,width,overflow});await page.screenshot({path:`${output}/decision-${scenario}-${width}.png`,fullPage:true});
  }
 }
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(network.filter(r=>r.status>=400).length,0);
 writeFileSync(output+'/decision-browser-results.json',JSON.stringify({status:'PASS',results,errors,network},null,2));
 console.log(JSON.stringify({status:'PASS',cases:results.length,console_errors:errors.length}));
}finally{await browser.close()}
