/** New isolated browser + real local Auth. Never the Production Owner session. */
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const {chromium}=await import(process.env.MA_PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:3225',out=process.env.MA_DAILY_SCREENSHOTS;
assert(out&&/^\/(?:private\/)?tmp\/ma-daily-qa[-a-zA-Z0-9]*$/.test(out));mkdirSync(out,{recursive:true,mode:0o700});
const browser=await chromium.launch({executablePath:process.env.MA_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[],external=[],checks=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin&&!['data:','blob:'].includes(u.protocol)){external.push(u.origin);return route.abort();}return route.continue();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));
 await page.goto(origin+'/vnext/research');await page.getByText('驗收環境登入',{exact:true}).click();
 await page.getByLabel('電子郵件',{exact:true}).fill('owner@academy.test');await page.getByLabel('密碼',{exact:true}).fill('Academy-local-only-2026!');
 await page.getByRole('button',{name:'登入',exact:true}).click();
 await page.getByRole('heading',{name:'今天有哪些值得研究的股票？',exact:true}).waitFor();
 const section=page.locator('#daily-intelligence');
 for(const width of [1440,375,390,430]){
  await page.setViewportSize({width,height:1000});await section.getByRole('button',{name:/短期/}).click();
  assert.match(await section.innerText(),/符合研究條件 1 檔/);assert.match(await section.innerText(),/健策/);
  assert.equal(await section.locator('details[open]').count(),0);
  const size=await page.evaluate(()=>({inner:innerWidth,scroll:document.documentElement.scrollWidth}));assert.equal(size.scroll,size.inner);
  await section.screenshot({path:out+'/short-'+width+'.png'});
  await section.getByRole('button',{name:/中期/}).click();assert.match(await section.innerText(),/符合研究條件 28 檔/);
  await section.getByRole('button',{name:/長期/}).click();assert.match(await section.innerText(),/資料不足 72 檔/);
  await section.getByRole('combobox').selectOption('INSUFFICIENT');assert.equal(await section.locator('article').count(),6);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  await section.screenshot({path:out+'/long-'+width+'.png'});
  await section.getByRole('combobox').selectOption('QUALIFIED');checks.push({width,short:1,medium:28,long_insufficient:72,overflow:false,technical_details:'COLLAPSED'});
 }
 await page.reload();await page.getByRole('heading',{name:'今天有哪些值得研究的股票？',exact:true}).waitFor();
 await page.getByText('驗收環境登入',{exact:true}).click();await page.getByRole('button',{name:'登出',exact:true}).click();
 await page.locator('#daily-intelligence').waitFor({state:'detached'});await page.reload();assert.equal(await page.locator('#daily-intelligence').count(),0);
 assert.equal((await page.request.get(origin+'/__vnext_owner_research')).status(),401);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log(JSON.stringify({identity:'REAL_LOCAL_SUPABASE_AUTH_NOT_PRODUCTION',checks,reload:'PASS',logout:'PASS',anonymous:'DENY',page_errors:0,external_requests:0,production_operations:0,screenshots:out}));
}finally{await browser.close();}
