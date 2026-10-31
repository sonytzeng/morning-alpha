import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonical} from '../research/entry-opportunity.ts';
import {collectDailyAiOfficialNews,DAILY_AI_OFFICIAL_NEWS_URLS as URLS} from '../research/daily-ai-official-news.ts';
const sha=value=>createHash('sha256').update(value).digest('hex');
const clock=()=> '2026-10-31T08:00:00Z',inputs=()=>['2330','2454','3363',...Array.from({length:69},(_,i)=>String(1000+i))].map(symbol=>({symbol}));
const twse=(more={})=>({'出表日期':'1151031','發言日期':'1151030','發言時間':'70003','公司代號':'2454','公司名稱':'聯發科','主旨 ':'公告本公司第3季合併財務報告','符合條款':'第31款','事實發生日':'1151030','說明':'本季EPS17.50元。前一季15.28元。第4季展望為預測，不是已實現獲利。',...more});
const tpex=()=>({'Date':'1151031','發言日期':'1151030','發言時間':'133249','SecuritiesCompanyCode':'3363','CompanyName':'上詮','主旨':'公告董事會決議','符合條款':'第31款','事實發生日':'1151030','說明':'董事會決議事項。'});
const item=({title='Federal Reserve Board announces approval of application',link='https://www.federalreserve.gov/newsevents/pressreleases/orders20261029a.htm',description=title,pubDate='Thu, 29 Oct 2026 20:30:00 GMT'}={})=>`<item><title>${title}</title><link><![CDATA[${link}]]></link><description><![CDATA[${description}]]></description><pubDate><![CDATA[${pubDate}]]></pubDate></item>`;
const rss=items=>'\ufeff<?xml version="1.0"?><rss version="2.0"><channel>'+items+'</channel></rss>';
const bodies=()=>({[URLS.TWSE]:JSON.stringify([twse()]),[URLS.TPEX]:JSON.stringify([tpex()]),[URLS.FED]:rss(item()+item({title:'Federal Reserve issues FOMC statement',link:'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm',pubDate:'Wed, 28 Oct 2026 18:00:00 GMT'}))});
const options=(fetcher,more={})=>({inputs:inputs(),businessDate:'2026-10-31',fetcher,clock,signal:new AbortController().signal,...more});
const fetcher=(modify=()=>{})=>async(url,init)=>{assert(Object.values(URLS).includes(url));assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert(!new Headers(init.headers).has('Authorization'));const source=bodies();modify(source,url);return new Response(source[url]);};
test('three fixed official feeds capture matched issuers and explicit GMT Fed publication with exact private provenance',async()=>{
 const r=await collectDailyAiOfficialNews(options(fetcher()));assert.equal(r.complete,true);assert.equal(r.news.length,3);assert.equal(r.proof.additions.length,3);assert.equal(r.receipts.length,3);
 assert.equal(r.proof.window_start,'2026-10-29T08:00:00.000Z');
 for(const p of r.proof.responses){assert.equal(p.state,'CAPTURED');assert.equal(p.source_sha256,sha(p.response_text));assert.equal(p.source_bytes,Buffer.byteLength(p.response_text));assert.equal(p.received_at,clock());}
 const company=r.news.find(n=>n.symbol==='2454'),content=JSON.parse(company.content);assert.equal(company.published_at,null);assert.equal(company.time_basis,'OBSERVED_AFTER_RECEIPT');assert.equal(content.source_metadata.spoken_time_coordinate,'07:00:03');assert.equal(content.source_metadata.publication_timezone,'NOT_DECLARED_BY_SOURCE');assert(content.excerpt.includes('17.50'));
 const fed=r.news.find(n=>n.symbol===null);assert.equal(fed.published_at,'2026-10-29T20:30:00.000Z');assert.equal(fed.time_basis,'PUBLISHED');assert(!r.news.some(n=>n.source.includes('monetary20261028a')));
 for(const added of r.proof.additions){const e=added.evidence,c=JSON.parse(e.content);assert.equal(e.evidence_hash,sha(e.content));assert.equal(e.content,canonical(c));assert.equal(e.available_at,clock());assert.equal(e.first_seen_at,clock());assert.equal(e.as_of,clock());assert.equal(e.id,'official-news:'+c.provider+':'+sha(added.row_text));assert(!Object.hasOwn(e,'member_publication_approved'));}
 assert(r.additionalGaps.includes('OFFICIAL_NEWS_OLDER_SOURCE_ITEMS_OUTSIDE_DECLARED_WINDOW_OMITTED'));
});
test('MOPS issuer identity comes from official code, not title matching; old/future and malformed source clocks cannot become fresh events',async()=>{
 const r=await collectDailyAiOfficialNews(options(fetcher((b,u)=>{if(u===URLS.TWSE)b[u]=JSON.stringify([twse({'公司代號':'9999'}),twse({'發言日期':'1151028'}),twse({'發言日期':'1151101'}),twse({'發言時間':'256099'}),twse({'公司代號':'2330','主旨 ':'原公司代號真實標題'})]);})));
 assert.equal(r.news.filter(n=>n.source===URLS.TWSE).length,1);assert.equal(r.news.find(n=>n.source===URLS.TWSE).symbol,'2330');assert(r.additionalGaps.includes('OFFICIAL_NEWS_INVALID_OR_FUTURE_SOURCE_ITEMS_EXCLUDED'));
});
test('official disclosure excerpts use2000 Unicode codepoints and preserve explicit truncation without redistributing entire disclosure in news',async()=>{
 const detail='😀'.repeat(2001),r=await collectDailyAiOfficialNews(options(fetcher((b,u)=>{if(u===URLS.TWSE)b[u]=JSON.stringify([twse({'說明':detail})]);}))),n=r.news.find(n=>n.symbol==='2454'),c=JSON.parse(n.content);
 assert.equal(Array.from(c.excerpt).length,2000);assert.equal(c.excerpt_truncated,true);assert(!c.excerpt.includes('\ufffd'));assert(r.proof.responses.find(p=>p.source===URLS.TWSE).response_text.includes(detail));assert(r.additionalGaps.includes('OFFICIAL_NEWS_LONG_DISCLOSURES_EXCERPT_TRUNCATED'));
});
test('RSS has XML text semantics: builtin/numeric entities decode once, CDATA remains literal, no external entity expansion',async()=>{
 const r=await collectDailyAiOfficialNews(options(fetcher((b,u)=>{if(u===URLS.FED)b[u]=rss(item({title:'Board&#39;s &amp;lt; decision',description:'literal &amp; text'}));}))),n=r.news.find(n=>n.symbol===null),c=JSON.parse(n.content);
 assert.equal(c.title,"Board's &lt; decision");assert.equal(c.excerpt,'literal &amp; text');
 const bad=await collectDailyAiOfficialNews(options(fetcher((b,u)=>{if(u===URLS.FED)b[u]='<!DOCTYPE rss [<!ENTITY external SYSTEM "https://secret.test/">]>'+rss(item());})));
 assert.equal(bad.proof.responses.find(p=>p.source===URLS.FED).state,'UNAVAILABLE');assert(!bad.news.some(n=>n.symbol===null));
});
test('Fed nonofficial links, duplicate XML fields, invalid GMT dates and future releases cannot be frozen',async()=>{
 for(const feed of [rss(item({link:'https://evil.test/article'})),rss(item({pubDate:'Wed, 29 Oct 2026 20:30:00 GMT'})),rss(item({pubDate:'Sun, 01 Nov 2026 20:30:00 GMT'})),rss(item().replace('</title>','</title><title>second</title>'))]){
  const r=await collectDailyAiOfficialNews(options(fetcher((b,u)=>{if(u===URLS.FED)b[u]=feed;})));assert(!r.news.some(n=>n.symbol===null));
 }
});
test('all failures are bounded explicit gaps and cannot reuse GNews, substitute retained news, or stamp fake new publication times',async()=>{
 const r=await collectDailyAiOfficialNews(options(async()=>new Response('secret provider response',{status:503})));assert.equal(r.complete,false);assert.deepEqual(r.news,[]);assert.equal(r.proof.additions.length,0);assert(!JSON.stringify(r).includes('secret provider response'));assert(r.proof.responses.every(p=>p.state==='UNAVAILABLE'&&p.received_at===null&&p.source_sha256===null&&p.source_bytes===null&&p.response_text===null));assert(r.additionalGaps.includes('OFFICIAL_NEWS_PARTIAL_ACQUISITION'));
});
test('capture validates byte cap, JSON schema, clock and72-symbol scope before admission',async()=>{
 const large=await collectDailyAiOfficialNews(options(async()=>new Response('x'.repeat(2000001))));assert.equal(large.news.length,0);
 const malformed=await collectDailyAiOfficialNews(options(async()=>Response.json({items:[]})));assert.equal(malformed.news.length,0);
 let calls=0;await assert.rejects(()=>collectDailyAiOfficialNews(options(async()=>{calls++;return new Response('[]');},{inputs:inputs().slice(1)})),/SCOPE/);assert.equal(calls,0);
 let ticks=0;await assert.rejects(()=>collectDailyAiOfficialNews(options(fetcher(),{clock:()=>ticks++?'2026-10-31T07:00:00Z':clock()})),/CLOCK/);
 const abort=new AbortController();abort.abort();await assert.rejects(()=>collectDailyAiOfficialNews(options(fetcher(),{signal:abort.signal})),/ABORTED/);
});
test('three shared requests use concurrency2; stalled sources expire in two6-second waves',async t=>{
 let active=0,peak=0,calls=0;await collectDailyAiOfficialNews(options(async(u,i)=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));const r=await fetcher()(u,i);active--;return r;}));assert.equal(calls,3);assert.equal(peak,2);
 t.mock.timers.enable({apis:['setTimeout']});try{let stalled=0;const pending=collectDailyAiOfficialNews(options(async()=>{stalled++;return new Promise(()=>{});}));await new Promise(resolve=>setImmediate(resolve));assert.equal(stalled,2);t.mock.timers.tick(6000);await new Promise(resolve=>setImmediate(resolve));assert.equal(stalled,3);t.mock.timers.tick(6000);const r=await pending;assert(r.proof.responses.every(p=>p.error==='AI_OFFICIAL_NEWS_TIMEOUT'));}finally{t.mock.timers.reset();}
});
test('retained actual3official feed bodies yield30company announcements plus1Fed item without changing source timestamps or adding provider articles',async t=>{
 if(!process.env.MA_OFFICIAL_NEWS_PRIMARY_DIR||!process.env.MA_OFFICIAL_NEWS_INPUTS){t.skip('Actual source body/input fixture paths not supplied');return;}
 const {readFileSync}=await import('node:fs'),names={[URLS.TWSE]:'twse-major-announcements.json',[URLS.TPEX]:'tpex-major-announcements.json',[URLS.FED]:'fed-press-all.xml'},actual=jsonParse(readFileSync(process.env.MA_OFFICIAL_NEWS_INPUTS,'utf8'));
 const r=await collectDailyAiOfficialNews(options(async u=>new Response(readFileSync(process.env.MA_OFFICIAL_NEWS_PRIMARY_DIR+'/'+names[u])),{inputs:actual.inputs}));assert.equal(r.news.length,31);assert.equal(r.news.filter(n=>n.symbol!==null).length,30);assert.equal(new Set(r.news.filter(n=>n.symbol!==null).map(n=>n.symbol)).size,14);assert.equal(r.news.filter(n=>n.symbol===null).length,1);assert(r.news.some(n=>n.symbol==='2454'&&JSON.parse(n.content).excerpt.includes('17.50')));assert(!r.news.some(n=>/gnews|udn|naturalnews/.test(n.source)));
});
function jsonParse(value){return JSON.parse(value);}
