import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMemberResearch,memberMarketSummary,MEMBER_NAVIGATION,STOCK_OBSERVATION_NAV} from '../src/features/vnext/member.ts';
import {buildPublicMarketReadModel} from '../src/lib/publicMarketReadModel.ts';
import {publicMarketInput} from '../supabase/functions/_shared/public-market-projection.ts';
const stamp='2026-10-10T00:00:00Z';
const card=()=>({id:'SYNTHETIC',symbol:'TEST',company:'隔離測試公司',horizon:'SHORT',status:'WATCHING',reason:'示範研究，並非真實股票。',risk:'示範風險',
 created_at:stamp,as_of:stamp,next_review_at:'2026-10-11T00:00:00Z',confirmation:['確認條件'],invalidation:['失效條件'],details:null});
const data=()=>({schema:'VNEXT_MEMBER_V1',research_only:true,tier:'free',business_date:'2026-10-10',observations:[card()],history:[],watchlist:[]});
const detail=()=>({evidence:[{summary:'示範資料',source:'SYNTHETIC',url:'https://example.com/test',available_at:stamp,classification:'CONFIRMED_FACT',stance:'SUPPORTS'}],events:[],relations:[],outcomes:[]});
test('free brief whitelists fields, never passes raw payload / hash / metadata',()=>{
 const p=data();p.observations[0].raw={secret:'SYNTHETIC_NOT_A_SECRET'};p.observations[0].snapshot_hash='x';
 const parsed=parseMemberResearch(p);assert.equal(parsed.observations[0].raw,undefined);assert.equal(parsed.observations[0].snapshot_hash,undefined);assert.equal(parsed.observations[0].details,null);
});
test('max 3 distinct symbols, not merely 3 horizon cards',()=>{
 const p=data();p.observations=['SHORT','MEDIUM','LONG'].map(h=>({...card(),horizon:h,id:h}));assert.equal(parseMemberResearch(p).observations.length,3);
 p.observations=Array.from({length:4},(_,i)=>({...card(),id:String(i),symbol:String(i)}));assert.throws(()=>parseMemberResearch(p),/FREE_SCOPE/);
});
test('free direct data leakage rejected, including history and watchlist',()=>{
 for(const mutate of [p=>p.observations[0].details=detail(),p=>p.history=[{...card(),id:'past'}],p=>p.watchlist=['SYNTHETIC']]){const p=data();mutate(p);assert.throws(()=>parseMemberResearch(p));}
});
test('premium details do not leak unexpected source fields',()=>{
 const p=data();p.tier='premium';p.observations[0].details=detail();p.observations[0].details.evidence[0].raw='NOT_ALLOWED';
 assert.equal(parseMemberResearch(p).observations[0].details.evidence[0].raw,undefined);
 p.observations[0].details=null;assert.throws(()=>parseMemberResearch(p),/PREMIUM_DETAILS_MISSING/);
});
test('PIT rejects evidence later than locked observation',()=>{
 const p=data();p.tier='premium';p.observations[0].details=detail();p.observations[0].details.evidence[0].available_at='2026-10-11T00:00:00Z';assert.throws(()=>parseMemberResearch(p),/FUTURE/);
});
test('unverified event / inferred relationship cannot enter public contract',()=>{
 const p=data();p.tier='premium';p.observations[0].details=detail();p.observations[0].details.relations=[{from:'A',to:'B',type:'INDUSTRY',source:'TEST',available_at:stamp,urls:['https://example.com']}];assert.throws(()=>parseMemberResearch(p),/ENUM/);
});
test('source URLs disallow secrets and unsafe protocols',()=>{
 for(const url of ['javascript:alert(1)','https://example.com/?token=example','http://example.com/']){const p=data();p.tier='premium';p.observations[0].details=detail();p.observations[0].details.evidence[0].url=url;assert.throws(()=>parseMemberResearch(p),/SOURCE/);}
});
test('outcomes cannot manufacture measured wins or returns without a producer',()=>{
 const p=data();p.tier='premium';p.observations[0].details=detail();p.observations[0].details.outcomes=[{horizon_days:1,state:'MEASURED',observed_at:stamp,return:0.5}];assert.throws(()=>parseMemberResearch(p),/ENUM/);
});
test('empty publication is valid but malformed/unknown is never an empty success',()=>{
 const p=data();p.observations=[];assert.deepEqual(parseMemberResearch(p).observations,[]);
 for(const patch of [{research_only:false},{schema:'unknown'},{business_date:'2026-02-30'},{tier:'admin'},{observations:null}])assert.throws(()=>parseMemberResearch({...p,...patch}));
});
test('duplicate identity or orphan watchlist cannot confuse cards',()=>{
 const p=data();p.observations.push(card());assert.throws(()=>parseMemberResearch(p),/IDENTITY/);
 p.observations=[{...card(),details:detail()}];p.tier='premium';p.watchlist=['other'];assert.throws(()=>parseMemberResearch(p),/IDENTITY/);
 p.observations=Array.from({length:200},(_,i)=>({...card(),id:String(i),details:detail()}));p.watchlist=p.observations.map(o=>o.id);
 assert.equal(parseMemberResearch(p).watchlist.length,200);
 p.watchlist.push('201');assert.throws(()=>parseMemberResearch(p),/MEMBER_ARRAY/);
});
test('navigation shared by desktop/mobile/account, no query-string role',()=>{
 assert.equal(MEMBER_NAVIGATION.filter(x=>x.to===STOCK_OBSERVATION_NAV.to).length,1);assert.equal(STOCK_OBSERVATION_NAV.to,'/stocks');
 const nav=readFileSync(new URL('../src/pages/vnext/MemberNavigation.tsx',import.meta.url),'utf8');assert(nav.includes('MEMBER_NAVIGATION.map'));assert(nav.includes('STOCK_OBSERVATION_NAV.to'));
});
test('auth race clears state and renders only matching identity/generation',()=>{
 const page=readFileSync(new URL('../src/pages/vnext/MemberPage.tsx',import.meta.url),'utf8');
 for(const fragment of ['setState(null)','state?.identity===access.id','state.generation===access.generation','access.signal.aborted',"data.tier!==access.catalog.tier","supabase.rpc('get_vnext_member_v1')"] )assert(page.includes(fragment));
 assert(!/localStorage|user_metadata|URLSearchParams/.test(page));
 assert(page.includes('.catch(()=>({data:null,error:true}))'),'public market transport error must not discard authorized research');
});
test('missing or mixed canonical payload never creates daily market direction',()=>{
 for(const value of [null,{}, {report_date:'2026-10-10',payload:{report_date:'2026-10-09',public_market_read_model:{market_direction:'偏多'}}}])assert.equal(memberMarketSummary(value),null);
});
test('retained public canonical fixture preserves original date/direction, never today or research scoring',()=>{
 const c=JSON.parse(readFileSync(new URL('./fixtures/public-projection/production-20261002.json',import.meta.url)));
 const model=buildPublicMarketReadModel(publicMarketInput(c.public_response.payload,c.tables.decision_snapshots.find(x=>x.session_type==='PREMARKET'),c.tables.member_content_revisions[0],c.tables.learning_runs[0],
  {batches:c.tables.market_checkpoint_batches,proofs:c.atomic_proofs.map(x=>x.proof)},'2026-10-02T12:30:00Z'));
 const value={...c.public_response,payload:{...c.public_response.payload,public_market_read_model:model}};
 assert.deepEqual(memberMarketSummary(value),{date:'2026-10-02',direction:'中性偏多',regime:'震盪／盤整',action:'先等確認'});
 assert.equal(memberMarketSummary({...value,report_date:'2026-10-10'}),null);
});
test('candidate remains disconnected from Production router and preserves protected features',()=>{
 const router=readFileSync(new URL('../src/router/config.tsx',import.meta.url),'utf8');assert(!router.includes('MemberPage'));assert(!router.includes("path: '/stocks'"));
 const sql=readFileSync(new URL('../supabase/migrations/20261010061630_vnext_research_projection_candidate.sql',import.meta.url),'utf8');
 assert(sql.includes('tier:=academy_private.access_v11()'));assert(!sql.includes('user_metadata'));assert(sql.includes("if tier <> 'owner' or tier is null"));assert(sql.includes('member_daily_edition'));assert(sql.includes('p_history'));
 assert(!/alter table public\.|update public\.|insert into public\.|cron\./i.test(sql));
});
