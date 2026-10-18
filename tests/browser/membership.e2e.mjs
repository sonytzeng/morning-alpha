// UI QA uses real local Auth. Never uses Production identities or payment UI.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const {chromium}=await import(process.env.MA_PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:3225',out=process.env.MA_MEMBERSHIP_QA_DIR||'/private/tmp/ma-membership-policy-qa';
mkdirSync(out,{recursive:true,mode:0o700});
const browser=await chromium.launch({executablePath:process.env.MA_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
const errors=[],network=[],checks=[];
try{
 for(const [name,heading] of [['public','登入後確認自己的會員權益'],['free','免費會員'],['premium','正式會員'],['other','既有會員權益保留中'],['owner','永久 Owner']]){
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('net::ERR_FAILED'))errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)network.push({path:new URL(r.url()).pathname,status:r.status()});});
  await page.goto(origin+'/membership');
  if(name!=='public'){
   await page.getByText('驗收環境登入',{exact:true}).click();
   await page.getByLabel('電子郵件',{exact:true}).fill(name+'@academy.test');await page.getByLabel('密碼',{exact:true}).fill('Academy-local-only-2026!');
   await page.getByRole('button',{name:'登入',exact:true}).click();await page.getByRole('heading',{name:heading,exact:true}).waitFor();
   await page.getByText('驗收環境登入',{exact:true}).click();
  }else await page.getByRole('heading',{name:heading,exact:true}).waitFor();
  for(const width of [1440,375,390,430]){
   await page.setViewportSize({width,height:1000});
   await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('main h1,main h2,main p')].some(e=>e.scrollWidth>e.clientWidth+1)),false);
   await page.screenshot({path:out+'/'+name+'-'+width+'.png',animations:'disabled'});
  }
  await page.reload();await page.getByRole('heading',{name:heading,exact:true}).waitFor();
  await page.goto(origin+'/stocks');await page.getByRole('heading',{name:name==='public'?'先看市場，再決定要研究什麼':'今天有哪些股票值得觀察？',exact:true}).waitFor();
  assert.equal(await page.locator('.vm-card').count(),0);
  if(name!=='public'){
   assert.equal(await page.getByRole('button',{name:'我的觀察清單',exact:true}).count(),name==='free'?0:1);
   await page.goto(origin+'/membership');await page.getByRole('heading',{name:heading,exact:true}).waitFor();
   await page.getByRole('button',{name:'登出',exact:true}).click();await page.getByRole('heading',{name:'登入後確認自己的會員權益',exact:true}).waitFor();
   assert(!await page.locator('main').innerText().then(s=>s.includes('@academy.test')));
  }
  await page.goto(origin+'/pricing');await page.getByRole('heading',{name:'先了解免費內容，再確認自己的完整會員權益',exact:true}).waitFor();
  assert(!(await page.locator('nav').allTextContents()).join(' ').includes('14 天完整試用'));
  for(const width of [1440,375,390,430]){
   await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(name==='public')await page.screenshot({path:out+'/pricing-'+width+'.png',animations:'disabled'});
  }
  checks.push({identity:name,viewports:[1440,375,390,430],reload:'PASS',logout:name==='public'?'N/A':'PASS',research_visible:0});await ctx.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 console.log(JSON.stringify({checks,page_errors:errors.length,unexpected_http:network.length,identity:'REAL_ISOLATED_AUTH_NOT_PRODUCTION',payment_provider_e2e:'NOT_PERFORMED',screenshots:out}));
}finally{await browser.close();}
