// Real isolated Auth, no production identities or transactions.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const {chromium}=await import(process.env.MA_PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:3221',out='/private/tmp/ma-vnext-member-release-qa';mkdirSync(out,{recursive:true,mode:0o700});
const browser=await chromium.launch({executablePath:process.env.MA_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
const errors=[],checks=[];
try{
 for(const role of ['public','free','premium','owner']){
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.name));
  await page.goto(origin+'/stocks');
  await page.getByRole('heading',{name:'先看市場，再決定要研究什麼',exact:true}).waitFor();
  if(role!=='public'){
   await page.getByText('驗收環境登入',{exact:true}).click();
   await page.getByLabel('電子郵件',{exact:true}).fill(role+'@academy.test');await page.getByLabel('密碼',{exact:true}).fill('Academy-local-only-2026!');
   await page.getByRole('button',{name:'登入',exact:true}).click();
   await page.getByRole('heading',{name:'今天有哪些股票值得觀察？',exact:true}).waitFor();
   await page.getByText('驗收環境登入',{exact:true}).click();
   assert.match(await page.locator('#stock-observations').innerText(),/今天沒有符合公開研究條件的股票/);
   assert.equal(await page.locator('.vm-card').count(),0,'unapproved or synthetic records not member content');
   assert.equal(await page.getByRole('button',{name:'我的觀察清單',exact:true}).count(),role==='free'?0:1);
  }
  for(const width of [1440,375,390,430]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   assert.equal(await page.locator('main details[open]').count(),0);
   await page.evaluate(async()=>{scrollTo(0,0);await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
   await page.screenshot({path:out+'/'+role+'-'+width+'.png',animations:'disabled'});
  }
  await page.reload();await page.getByRole('heading',{name:role==='public'?'先看市場，再決定要研究什麼':'今天有哪些股票值得觀察？',exact:true}).waitFor();
  if(role!=='public'){
   await page.goto(origin+'/vnext/publication');
   if(role==='owner')await page.getByText(/前置審查完成/).waitFor();else await page.getByText('此頁僅供正式 Owner 使用。',{exact:true}).waitFor();
   await page.goto(origin+'/stocks');await page.getByRole('heading',{name:'今天有哪些股票值得觀察？',exact:true}).waitFor();
   await page.getByText('驗收環境登入',{exact:true}).click();await page.getByRole('button',{name:'登出',exact:true}).click();
   await page.getByRole('heading',{name:'先看市場，再決定要研究什麼',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'我的觀察清單',exact:true}).count(),0);
  }
  checks.push({role,widths:[1440,375,390,430],overflow:0,restricted_stock_content:0,reload:'PASS',logout:role==='public'?'N/A':'PASS'});await ctx.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({identity:'ISOLATED_SUPABASE_AUTH_NOT_PRODUCTION',checks,page_errors:0,actual_research_visible:0,screenshots:out}));
}finally{await browser.close();}
