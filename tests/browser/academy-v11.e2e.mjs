import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const {chromium}=await import(process.env.MA_PLAYWRIGHT_MODULE||'playwright');
assert.equal(process.env.MA_ACADEMY_PREVIEW,'ISOLATED_DATABASE');
const root='http://127.0.0.1:3218',out=process.env.MA_ACADEMY_QA_DIR||'/private/tmp/ma-academy-v11-browser';mkdirSync(out,{recursive:true});
const manifest=JSON.parse(readFileSync(new URL('../../docs/academy/v11/content-manifest.json',import.meta.url)));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:true});
const external=[],errors=[],httpErrors=[],checks=[];
await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===root||url.protocol==='blob:')return route.continue();external.push(url.origin);return route.abort();});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)httpErrors.push([r.url().replace(root,''),r.status()]);});
const role=async name=>{await page.getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name:name==='anonymous'?'登入後，開始你的學習旅程':/看懂市場，\s*從理解開始。/,exact:true}).waitFor();};
const lesson=async id=>{await page.goto(root+'/academy?lesson='+id);await page.locator('.academy-reading').waitFor();};
try{
 await page.goto(root+'/academy?role=owner&tier=premium');await page.getByRole('heading',{name:'登入後，開始你的學習旅程'}).waitFor();assert.equal(await page.locator('.academy-reading').count(),0);checks.push('query cannot grant Owner/Premium');
 await role('free');await page.locator('.academy-reading').waitFor();
 await page.goto(root+'/academy?lesson=trend-advanced&role=owner');await page.getByRole('heading',{name:'這是 Premium 進階章節'}).waitFor();assert.equal(await page.locator('.academy-reading').count(),0);
 assert(await page.getByRole('button',{name:'取得 Premium PDF',exact:true}).isDisabled());checks.push('free locked route and PDF');
 await lesson('stock-basics');
 const questions=page.locator('.academy-quiz');
 await questions.nth(0).getByRole('radio').nth(0).check();await questions.nth(0).getByRole('button',{name:'提交答案並儲存'}).click();await questions.nth(0).getByText('已答對 · 伺服器已記錄').waitFor();
 await questions.nth(1).getByRole('radio').nth(0).check();await questions.nth(1).getByRole('button',{name:'提交答案並儲存'}).click();await questions.nth(1).getByText('再觀察一次 · 本次作答已記錄').waitFor();assert(await page.getByRole('button',{name:'標記本章完成',exact:true}).isDisabled());
 await questions.nth(1).getByRole('radio').nth(1).check();await questions.nth(1).getByRole('button',{name:'提交答案並儲存'}).click();await questions.nth(1).getByText('已答對 · 伺服器已記錄').waitFor();await page.getByRole('button',{name:'標記本章完成',exact:true}).click();await page.getByRole('button',{name:'已完成',exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'已完成',exact:true}).waitFor();checks.push('wrong+correct server grading, reload completion and answers');
 await role('other');await lesson('stock-basics');assert.equal(await page.getByRole('button',{name:'已完成',exact:true}).count(),0);checks.push('user B has no user A completion');
 await role('premium');
 for(const width of [375,390,430,768,1440]){
  await page.setViewportSize({width,height:1000});
  for(const chapter of manifest.chapters){
   await lesson(chapter.id);
   assert.equal(await page.locator('.academy-quiz').count(),chapter.questions);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width+' '+chapter.id);
   assert.equal(await page.locator('[role=alert]').count(),0);
   await page.screenshot({path:out+`/${width}-${chapter.id}.png`,fullPage:true});
  }
  checks.push('all original chapters at '+width+'px');
 }
 await page.getByRole('button',{name:'取得 Premium PDF',exact:true}).click();await page.getByRole('link',{name:/PDF 已就緒/}).waitFor();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:/PDF 已就緒/}).click()]);await download.saveAs(out+'/premium-download.pdf');checks.push('authenticated original Premium PDF download');
 await role('owner');await lesson('trend-advanced');checks.push('synthetic Owner database truth access, NOT Production Owner proof');
 await role('anonymous');assert.equal(await page.locator('.academy-reading,.academy-quiz,a[download]').count(),0);await page.reload();await page.getByRole('heading',{name:'登入後，開始你的學習旅程'}).waitFor();checks.push('logout clears restricted content and PDF');
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
 const result={identity:'SYNTHETIC_ISOLATED_DATABASE_NOT_PRODUCTION_OWNER',course:'REVIEWED_ORIGINAL_ARTIFACT',checks,externalRequests:external.length,pageErrors:errors.length,unexpectedHttp:httpErrors,productionChanged:false};
 writeFileSync(out+'/qa.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
