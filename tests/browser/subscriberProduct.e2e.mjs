// Requires the existing isolated Supabase stack. Never accepts a remote origin.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.MA_PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:4313', api = 'http://127.0.0.1:54371', mail = 'http://127.0.0.1:54374';
if (process.env.MA_LOCAL_SCOPE !== 'ma-core-final-20260907') throw Error('Explicit isolated runtime required');
const output = process.env.MA_E2E_OUTPUT;
if (!output?.startsWith('/private/tmp/')) throw Error('Use a private temporary evidence directory');
const sql = (query) => execFileSync('docker', ['--context','colima-ma-core-20260907','exec','supabase_db_ma-core-final-20260907','psql','-X','-U','postgres','-d','postgres','-At','-c',query], {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
assert.equal(sql('select scope from ma_isolated_guard.identity'), 'ma-core-final-20260907');
assert.equal(sql("select count(*) from auth.users where email='core-admin-content-final-v3@local.test'"), '1');
mkdirSync(output,{recursive:true});
const clean = url => { const u = new URL(url); return u.origin + u.pathname; };
const browser = await chromium.launch({executablePath:process.env.MA_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const evidence = {scope:'ISOLATED_LOCAL_SUPABASE',production_requests:[],network:[],console:[],routes:[],auth:null,glossary:null,reload:null};
await context.route('**/*', route => {
  const u = new URL(route.request().url());
  const staticHost = ['storage.readdy-site.link','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname);
  if (['http:','https:'].includes(u.protocol) && !['127.0.0.1','localhost'].includes(u.hostname) && !staticHost) {
    evidence.production_requests.push(clean(u.href)); return route.abort('blockedbyclient');
  }
  return route.continue();
});
const page = await context.newPage();
page.on('response', response => {
  const path = clean(response.url());
  if (path.startsWith(api) || response.request().isNavigationRequest()) evidence.network.push({path,status:response.status(),method:response.request().method()});
});
page.on('console', message => {
  if (['error','warning'].includes(message.type())) evidence.console.push({type:message.type(),text:message.text().replace(/https?:\S+/g, s => {try{return clean(s)}catch{return '[URL]'}}).replace(/eyJ[\w.-]+/g,'[REDACTED]')});
});
page.on('pageerror', error => evidence.console.push({type:'pageerror',text:error.message.replace(/eyJ[\w.-]+/g,'[REDACTED]')}));
try {
  await page.goto(origin+'/login?next=%2Freport%2Ftoday');
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('core-admin-content-final-v3@local.test');
  const prior = new Set((await (await fetch(mail+'/api/v1/messages')).json()).messages?.map(m=>m.ID));
  await page.getByRole('button',{name:'寄送登入連結',exact:true}).click();
  await page.getByRole('heading',{name:'登入信已寄出',exact:true}).waitFor();
  // Exactly one local email. Read only the local SMTP mailbox; never log the link.
  let message;
  for(let i=0;i<10;i++){
    const data = await (await fetch(mail+'/api/v1/messages')).json();
    message = data.messages?.find(m=>!prior.has(m.ID) && m.To?.some(to=>to.Address==='core-admin-content-final-v3@local.test'));
    if(message) break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(message,'Local SMTP delivery missing; do not resend');
  const body = await (await fetch(mail+'/api/v1/message/'+message.ID)).json();
  const link = (body.HTML || '').match(/href="([^"]+)"/i)?.[1]?.replaceAll('&amp;','&');
  assert.ok(link); const verify = new URL(link); assert.equal(verify.origin,api); assert.equal(verify.pathname,'/auth/v1/verify');
  assert.equal(verify.searchParams.get('redirect_to'),origin+'/auth/callback?next=%2Freport%2Ftoday');
  await page.goto(link); await page.waitForURL(origin+'/report/today',{timeout:20000});
  await page.getByRole('heading',{level:1}).waitFor();
  evidence.auth = await page.evaluate(async()=>{
    const { supabase } = await import('/src/lib/supabase.ts');
    const { getCurrentEntitlement } = await import('/src/services/entitlementService.ts');
    const result = await getCurrentEntitlement();
    const profile = await supabase.from('profiles').select('role').single();
    return {authenticated:result.isLoggedIn,admin:result.isAdmin,tier:result.tier,server_role:profile.data?.role,code_removed:!location.search.includes('code=')};
  });
  assert.deepEqual(evidence.auth,{authenticated:true,admin:true,tier:'admin',server_role:'admin',code_removed:true});
  const routes = ['/report/today','/war-room','/verification','/performance','/learn','/learn/price-earnings-ratio'];
  for (const path of routes) {
    const response = await page.goto(origin+path); await page.waitForLoadState('networkidle');
    const title = await page.getByRole('heading',{level:1}).innerText();
    assert.equal(response.status(),200); assert.ok(title.trim());
    const text = await page.locator('main').innerText(); assert.doesNotMatch(text,/\b(?:undefined|null|NaN)\b|Cannot read properties/);
    const record = {path,status:200,title,sizes:[]};
    for (const [width,height] of [[375,812],[390,844],[430,932],[1440,1000]]) {
      await page.setViewportSize({width,height});
      const layout = await page.evaluate(()=>({overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),heroBottom:Math.round(document.querySelector('h1').getBoundingClientRect().bottom),width:innerWidth}));
      assert.equal(layout.overflow,0,`${path} at ${width}`);
      assert.ok(layout.heroBottom<height,`${path}: main answer must be on the first screen`);
      if (path === '/report/today') {
        const answersBottom = await page.locator('.ma-subscriber-three-answers').evaluate(el => el.getBoundingClientRect().bottom);
        assert.ok(answersBottom < height, `All three Today answers must fit at ${width}`);
      }
      record.sizes.push({...layout,height});
      await page.screenshot({path:`${output}/${path.replaceAll('/','-').slice(1)}-${width}.png`,fullPage:true});
    }
    evidence.routes.push(record);
  }
  await page.goto(origin+'/report/today'); await page.getByRole('button',{name:'為什麼看多還不追？'}).click();
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  for (const label of ['白話先懂','生活化例子','Morning Alpha 為什麼看','今天怎麼用','常見誤解','風險提醒']) assert.ok((await dialog.innerText()).includes(label));
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')),true);
  await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'為什麼看多還不追？'}).evaluate(el=>el===document.activeElement),true);
  assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');
  await page.goto(origin+'/learn'); await page.getByRole('textbox',{name:'搜尋投資名詞'}).fill('本益比');
  await page.getByRole('link',{name:/本益比/}).click(); await page.getByRole('heading',{name:'白話先懂'}).waitFor();
  await page.goto(origin+'/learn'); await page.getByRole('button',{name:'籌碼市場',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'籌碼市場',exact:true}).getAttribute('aria-pressed'),'true');
  evidence.glossary = 'PASS';
  await page.goto(origin+'/report/today'); await page.getByRole('button',{name:'切換小白模式'}).click();
  await page.reload(); await page.waitForLoadState('networkidle');
  assert.equal(await page.getByRole('button',{name:/專業/}).count(),1);
  evidence.reload = 'PASS';
  await page.getByRole('button',{name:/專業/}).click();
  await page.goto(origin+'/alpha-coach'); await page.getByRole('heading',{level:1}).waitFor();
  assert.match(await page.locator('main').innerText(),/404|找不到|不存在/);
  evidence.alpha_coach = 'DISABLED';
  assert.equal(evidence.production_requests.length,0);
  assert.equal(evidence.network.filter(r=>r.status>=400 && !r.path.endsWith('/alpha-coach')).length,0);
  assert.equal(evidence.console.length,0);
  evidence.status='PASS';
} catch(error) {
  evidence.status='FAIL'; evidence.failure=String(error.message).replace(/https?:\S+/g,s=>{try{return clean(s)}catch{return '[URL]'}}).replace(/eyJ[\w.-]+/g,'[REDACTED]'); process.exitCode=1;
} finally {
  await browser.close(); writeFileSync(output+'/browser-results.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({status:evidence.status,auth:evidence.auth,routes:evidence.routes.length,console:evidence.console,production_requests:evidence.production_requests,glossary:evidence.glossary,reload:evidence.reload,failure:evidence.failure}));
}
