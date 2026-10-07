import assert from 'node:assert/strict';
const {chromium}=await import(process.env.MA_PLAYWRIGHT_MODULE||'playwright');
assert.equal(process.env.MA_V2_UI_SCOPE,'LOCAL_ONLY');
const browser=await chromium.launch({executablePath:process.env.MA_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({serviceWorkers:'block'}),errors=[];let external=0;
await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin==='http://127.0.0.1:3195')return route.continue();external++;return route.abort();});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
try{
 for(const width of [1440,375,390,430]){
  await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:3195/__v2_owner?role=owner');await page.getByText('查看股票').waitFor();
  await page.locator('select').selectOption('2330');for(const s of ['哪些訊號支持','哪些反對','INSUFFICIENT_SAMPLE','研究達標不是正式推薦'])assert((await page.locator('body').innerText()).includes(s));
  await page.locator('summary').filter({hasText:'證據狀態'}).click();await page.locator('summary').filter({hasText:'各觀察期間'}).click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow '+width);
  if(process.env.MA_V2_SCREENSHOTS==='YES')await page.screenshot({path:'/private/tmp/ma-v2-shadow-'+width+'.png',fullPage:true});
 }
 await page.getByRole('button',{name:'模擬登出'}).click();assert(!(await page.locator('body').innerText()).includes('查看股票'));
 for(const role of ['anonymous','member','paid']){await page.goto('http://127.0.0.1:3195/__v2_owner?role='+role);await page.getByText('只有具名授權 Owner').waitFor();assert.equal(await page.locator('select').count(),0);}
 assert.deepEqual(errors,[]);assert.equal(external,0);console.log(JSON.stringify({desktop:'PASS',mobile_widths:[375,390,430],local_owner_rls:'PASS',anonymous:'DENY',member:'DENY',paid:'DENY',logout:'DENY',external_dispatch:0,production_used:false,sony_usability:'PENDING'}));
}finally{await browser.close();}
