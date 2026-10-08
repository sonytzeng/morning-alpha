import assert from 'node:assert/strict';
const {chromium}=await import(process.env.MA_PLAYWRIGHT_MODULE||'playwright');
assert.equal(process.env.MA_ENTRY_UI_SCOPE,'LOCAL_ONLY');
const browser=await chromium.launch({executablePath:process.env.MA_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce'});let external=0;const errors=[];
await context.route('**/*',r=>{if(new URL(r.request().url()).origin==='http://127.0.0.1:3204')return r.continue();external++;return r.abort();});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
try{
 for(const width of [1440,375,390,430]){
  await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:3204/__entry_owner?role=owner');await page.getByLabel('進場研究股票').waitFor();
  for(const name of ['超跌反轉','趨勢回檔','突破延續']){await page.getByRole('button',{name,exact:true}).click();assert((await page.locator('body').innerText()).includes('什麼情況看錯'));}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);
  assert.equal(await page.locator('details[open]').count(),0);assert((await page.locator('body').innerText()).includes('INSUFFICIENT_SAMPLE'));
  const low=await page.locator('section[aria-labelledby="entry-title"]').evaluate(root=>{
   const rgb=s=>s.match(/[\d.]+/g)?.map(Number)||[];
   const luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
   return [...root.querySelectorAll('h2,h3,h4,p,li,button,a,summary,label')].filter(e=>e.getClientRects().length&&e.textContent.trim()).flatMap(e=>{
    let parent=e,bg=[];while(parent){bg=rgb(getComputedStyle(parent).backgroundColor);if(bg.length===3||bg[3]===1)break;parent=parent.parentElement;}
    if(!parent)return [];const style=getComputedStyle(e),fg=rgb(style.color),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700);
    return ratio<(large?3:4.5)?[{tag:e.tagName,ratio}]:[];
   });
  });assert.deepEqual(low,[],'WCAG AA visible text '+width);
  await page.screenshot({path:'/private/tmp/entry-opportunity-'+width+'.png',fullPage:true,animations:'disabled'});
 }
 await page.getByRole('button',{name:'模擬登出'}).click();await page.getByText('只有具名 Owner 可讀取').waitFor();assert.equal(await page.locator('select').count(),0);
 for(const role of ['anonymous','member','paid']){await page.goto('http://127.0.0.1:3204/__entry_owner?role='+role);await page.getByText('只有具名 Owner 可讀取').waitFor();assert.equal(await page.locator('select').count(),0);}
 assert.deepEqual(errors,[]);assert.equal(external,0);console.log(JSON.stringify({desktop:'PASS',mobile:[375,390,430],local_owner:'PASS',anonymous:'DENY',member:'DENY',paid:'DENY',logout:'DENY',external_dispatch:0,production_owner_used:false,sony_usability:'PENDING'}));
}finally{await browser.close();}
