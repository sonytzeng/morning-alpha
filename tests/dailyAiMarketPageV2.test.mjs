// Entirely synthetic contract and lifecycle inputs. No RPC, credentials,
// live market data, browser, database writes or recommendation approvals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {hashDailyAiPricePlanBody} from '../src/features/vnext/dailyAiPricePlan.ts';
import {parseDailyAiMember} from '../src/features/vnext/dailyAiMember.ts';
import {DAILY_AI_MARKETS,createDailyAiMarketPageRequestV2,parseDailyAiMarketPageV2,cacheDailyAiMarketPageV2,
 nextDailyAiMarketPageRequestV2,adaptDailyAiMarketPageV2,eligibleDailyAiMarketPageCacheV2} from '../src/features/vnext/dailyAiMarketPageV2.ts';

const NOW=Date.parse('2026-11-11T08:00:00Z'),USER='00000000-0000-0000-0000-000000000001';
const H={edition:'a'.repeat(64),research:'b'.repeat(64),price:'c'.repeat(64),universe:'d'.repeat(64)};
const query=(extra={})=>({horizon:'MEDIUM',market:'ALL',status:'ALL',search:'',sort:'STATUS_MARKET_SYMBOL_ASC',page_size:9,...extra});
const scope=(tier='premium')=>({identity:USER,generation:1,signal:new AbortController().signal,tier,requestDate:'2026-11-11'});
const source={id:'P1',kind:'PRICE',source:'https://www.twse.com.tw/synthetic-only',published_at:'2026-11-10T06:00:00Z',available_at:'2026-11-10T06:00:00Z',time_basis:'PUBLISHED',first_seen_at:null,as_of:null,evidence_hash:null};
const card=(market,i,tier,horizon='MEDIUM')=>({market,symbol:String(1000+DAILY_AI_MARKETS.indexOf(market)*3000+i),company:'合成公司'+i,horizon,status:'WAIT',
 reason:{text:'合成測試理由，不是真實研究。',evidence_ids:['P1']},counter_evidence:tier==='free'?null:[],confirmation:'合成確認條件',invalidation:'合成重評條件',gaps:[],
 sources:tier==='free'?null:[source],classification:'INFERENCE',price:null});
async function cursorFor(wire,position){
 const body={schema:'VNEXT_AI_MARKET_CURSOR_V2',edition_id:wire.edition.id,research_revision:wire.research_revision,price_revision:wire.price_revision,
  subject_user_id:wire.subject_user_id,tier:wire.tier,business_date:wire.business_date,query_hash:wire.query_hash,position,expires_at:wire.edition.expires_at};
 return {...body,binding_hash:await snapshotHash(body)};
}
async function refreshCursorHash(cursor){const {binding_hash,...body}=cursor;cursor.binding_hash=await snapshotHash(body);return cursor;}
async function fixture({totals={TWSE:25,TPEX:0,EMERGING:0},pageSize=9,start=0,tier='premium',q={}}={}){
 const auth=scope(tier),request=await createDailyAiMarketPageRequestV2(auth,query({page_size:pageSize,...q}),{now:NOW});
 const all=DAILY_AI_MARKETS.flatMap(market=>Array.from({length:totals[market]},(_,i)=>card(market,i,tier,request.query.horizon)));
 const marketRows=all.filter(c=>request.query.market==='ALL'||c.market===request.query.market),found=marketRows.filter(c=>`${c.symbol} ${c.company}`.toLowerCase().includes(request.query.search.toLowerCase()));
 const matching=found.filter(c=>request.query.status==='ALL'||c.status===request.query.status),cards=matching.slice(start,start+pageSize);
 const wire={schema:'VNEXT_AI_MARKET_PAGE_V2',mode:'FULL',subject_user_id:USER,tier,business_date:'2026-11-11',research_only:true,checked_at:new Date(NOW).toISOString(),
  query:request.query,query_hash:request.query_hash,
  edition:{id:H.edition,edition_date:'2026-11-11',evidence_cutoff:'2026-11-11T07:00:00Z',prepared_at:'2026-11-11T07:30:00Z',expires_at:'2026-11-11T10:00:00Z',analysis_origin:'OFFLINE_REVIEWED',mode:'AS_OF_RESEARCH',forecast:false,performance_available:false},
  research_revision:H.research,price_revision:H.price,
  universe:{snapshot_id:H.universe,snapshot_date:'2026-11-11',markets:DAILY_AI_MARKETS.map((market,i)=>({market,universe_count:totals[market]+100,published_count:totals[market],coverage:'PARTIAL',
   roster_as_of:i===2?null:i===1?'2026-11-10':'2026-11-11',data_as_of:{price_date:i===2?null:i===1?'2026-11-09':'2026-11-10',financial_available_at:i===2?null:'2026-11-10T06:00:00Z',news_available_at:null}}))},
  counts:{available_total:marketRows.length,matching_total:matching.length,by_status:{WATCH:0,WAIT:found.length,AVOID:0,INSUFFICIENT:0}},
  page:{start,returned:cards.length,has_more:start+cards.length<matching.length,next_cursor:null},cards};
 if(wire.page.has_more){const last=cards.at(-1);wire.page.next_cursor=await cursorFor(wire,{seen:start+cards.length,after:{status:last.status,market:last.market,symbol:last.symbol}});}
 return {wire,auth,request,all,matching};
}
const parse=f=>parseDailyAiMarketPageV2(f.wire,f.auth,f.request,null,NOW);
const reject=(f,pattern)=>assert.rejects(()=>parse(f),pattern??/AI_MARKET_PAGE_V2/);
const unchanged=wire=>{const {cards,...value}=structuredClone(wire);return {...value,mode:'UNCHANGED'};};
async function withPrice(f,expiry='2026-11-11T08:00:01Z'){
 const card=f.wire.cards[0],body={schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:f.wire.edition.id,symbol:card.symbol,horizon:card.horizon,status:'VERIFIED',currency:'TWD',
  method:'SYNTHETIC_V2_CONTRACT_TEST',basis:'合成價格只驗證解析，不是已驗證投資方法。',entry_range:[100,105],wait_above:105,stop_kind:'PRICE',stop:95,stop_evidence_ids:['P1'],
  invalidation:'合成事件發生時重評',evidence_ids:['P1'],as_of:'2026-11-11T07:30:00Z',expires_at:expiry,buy_ready:false};
 const plan_hash=await hashDailyAiPricePlanBody(body);
 card.price={plan:{...body,plan_hash,review:{status:'PASS',plan_hash,reviewed_at:'2026-11-11T07:40:00Z',document_hash:'e'.repeat(64)}},sources:[source]};
 return f;
}
function referenceFor(card,method){
 const short=card.horizon==='SHORT',long=card.horizon==='LONG';
 return {schema:'DAILY_AI_MARKET_RESEARCH_REFERENCE_V1',status:'CALCULATED_RESEARCH_ONLY',symbol:card.symbol,horizon:card.horizon,
  method_id:method??(short?'OBSERVED_UNADJUSTED_20_SESSION_RANGE':long?'CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB':'CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE'),
  method_version:method?.startsWith('CURRENT_REPORTED_BVPS_')?'TAIWAN_REPORTED_BVPS_PEER_V1':short?'TAIWAN_OBSERVED_RANGE_V1':long?'TAIWAN_LONG_QUALITY_PEER_PB_V1':'TAIWAN_PEER_RERATING_V1',
  quote_date:'2026-11-10',current_price:120,lower:80.123456,median:short?null:100.987654,upper:150.123456,peer_count:short?null:7,
  reference_hash:'e'.repeat(64),input_pool_hash:'f'.repeat(64),forecast:false,buy_ready:false,methodology_approved:false};
}

test('more than 72 stocks across all three markets use bounded pages and retain different source dates',async()=>{
 const f=await fixture({totals:{TWSE:1200,TPEX:800,EMERGING:300},pageSize:60}),data=await parse(f),cache=cacheDailyAiMarketPageV2(data,f.auth,f.request);
 assert.equal(data.counts.available_total,2300);assert.equal(data.cards.length,60);assert(Object.isFrozen(data.cards[0].reason));
 assert.deepEqual(data.universe.markets.map(m=>m.roster_as_of),['2026-11-11','2026-11-10',null]);
 assert.deepEqual(data.universe.markets.map(m=>m.data_as_of.price_date),['2026-11-10','2026-11-09',null]);
 assert.equal(adaptDailyAiMarketPageV2(cache,f.auth,9,NOW).cards.length,9);
 assert.equal(adaptDailyAiMarketPageV2(cache,f.auth,18,NOW).cards.length,18);
 assert.throws(()=>adaptDailyAiMarketPageV2(cache,f.auth,6000,NOW),/QUERY/);
 assert.throws(()=>parseDailyAiMember({...f.wire,schema:'VNEXT_AI_MEMBER_EDITION_V1'},'2026-11-11',NOW),'V1 was not widened');
});

test('a next request binds the exact edition, user, tier, query, revisions and last position',async()=>{
 const f=await fixture(),first=await parse(f),cache=cacheDailyAiMarketPageV2(first,f.auth,f.request),request=await nextDailyAiMarketPageRequestV2(cache,f.auth,NOW);
 assert.equal(request.cursor.position.seen,9);assert.equal(request.known,null);
 const next=await fixture({start:9});next.auth=f.auth;next.request=request;
 const data=await parse(next),view=adaptDailyAiMarketPageV2(cacheDailyAiMarketPageV2(data,f.auth,request),f.auth,9,NOW);
 assert.equal(data.page.start,9);assert.equal(view.cards[0].symbol,'1009');assert.equal(view.cards.length,9);
 assert(!view.cards.some(c=>c.symbol==='1000'),'adapter replaces the page, not an accumulating 2,000-stock array');
 for(const field of ['edition_id','research_revision','price_revision']){
  const bad=structuredClone(request);bad.cursor[field]='f'.repeat(64);await refreshCursorHash(bad.cursor);next.request=bad;
  await reject(next,/CURSOR_STALE/);
 }
});

test('cursor tampering, wrong query, cross-user and tier scope cannot be used even with a recomputed binding hash',async()=>{
 const f=await fixture();
 for(const [key,value] of [['subject_user_id','00000000-0000-0000-0000-000000000002'],['tier','owner'],['business_date','2026-11-10'],['query_hash','f'.repeat(64)]]){
  const cursor=structuredClone(f.wire.page.next_cursor);cursor[key]=value;await refreshCursorHash(cursor);
  await assert.rejects(()=>createDailyAiMarketPageRequestV2(f.auth,f.request.query,{cursor,now:NOW}),/CURSOR/);
 }
 const cursor=structuredClone(f.wire.page.next_cursor);cursor.position.after.symbol='9999';
 await assert.rejects(()=>createDailyAiMarketPageRequestV2(f.auth,f.request.query,{cursor,now:NOW}),/CURSOR/);
 const wrong=structuredClone(f.wire);wrong.page.next_cursor.position.after.symbol='9999';await refreshCursorHash(wrong.page.next_cursor);
 await reject({...f,wire:wrong},/CURSOR/);
});

test('UNCHANGED reuses only a parsed page with both independent revisions and exact metadata',async()=>{
 const f=await fixture(),data=await parse(f),cache=cacheDailyAiMarketPageV2(data,f.auth,f.request);
 const request=await createDailyAiMarketPageRequestV2(f.auth,f.request.query,{cache,now:NOW});assert.equal(request.known.price_revision,H.price);
 const response=unchanged(f.wire);response.checked_at=new Date(NOW+10).toISOString();
 const next=await parseDailyAiMarketPageV2(response,f.auth,request,cache,NOW+10);assert.equal(next.cards,data.cards);
 for(const field of ['research_revision','price_revision']){
  const changed=structuredClone(response);changed[field]='f'.repeat(64);changed.page.next_cursor[field]='f'.repeat(64);await refreshCursorHash(changed.page.next_cursor);
  await assert.rejects(()=>parseDailyAiMarketPageV2(changed,f.auth,request,cache,NOW+10),/CACHE_MISS/);
 }
 const forged={...cache,data:structuredClone(data)};
 await assert.rejects(()=>parseDailyAiMarketPageV2(response,f.auth,request,forged,NOW+10),/CACHE_MISS/);
 const different={...response,universe:structuredClone(response.universe)};different.universe.markets[0].data_as_of.price_date='2026-11-09';
 await assert.rejects(()=>parseDailyAiMarketPageV2(different,f.auth,request,cache,NOW+10),/CACHE_MISS/);
});

test('FULL price-only revision replaces a cached page without retaining its previous price',async()=>{
 const f=await withPrice(await fixture()),data=await parse(f),cache=cacheDailyAiMarketPageV2(data,f.auth,f.request);
 assert.equal(adaptDailyAiMarketPageV2(cache,f.auth,9,NOW).cards[0].price.plan.entry_range[0],100);
 const request=await createDailyAiMarketPageRequestV2(f.auth,f.request.query,{cache,now:NOW});
 const wire=structuredClone(f.wire);wire.price_revision='f'.repeat(64);wire.cards[0].price=null;wire.page.next_cursor.price_revision=wire.price_revision;await refreshCursorHash(wire.page.next_cursor);
 const replaced=await parseDailyAiMarketPageV2(wire,f.auth,request,cache,NOW);
 assert.equal(adaptDailyAiMarketPageV2(cacheDailyAiMarketPageV2(replaced,f.auth,request),f.auth,9,NOW).cards[0].price,null);
});

test('optional verified price requires exact hash, matching sources, PASS and eligible card state',async()=>{
 const original=await withPrice(await fixture());await parse(original);
 for(const mutate of [f=>f.wire.cards[0].price.plan.entry_range[0]=101,
  f=>f.wire.cards[0].price.plan.review.status='PENDING',f=>f.wire.cards[0].price.plan.buy_ready=true,
  f=>f.wire.cards[0].price.sources[0]={...f.wire.cards[0].price.sources[0],source:'https://www.twse.com.tw/different'},
  f=>f.wire.cards[0].price.sources.push({...source,id:'ORPHAN'}),
  f=>f.wire.cards[0].price.plan.symbol='9999']){
  const f={...original,wire:structuredClone(original.wire)};mutate(f);await reject(f,/PRICE/);
 }
 const insufficient=await fixture({totals:{TWSE:1,TPEX:0,EMERGING:0}});await withPrice(insufficient);
 insufficient.wire.cards[0].status='INSUFFICIENT';insufficient.wire.cards[0].gaps=['SYNTHETIC_MISSING'];
 insufficient.wire.counts.by_status={WATCH:0,WAIT:0,AVOID:0,INSUFFICIENT:1};await reject(insufficient,/PRICE/);
});

test('free summaries never contain full evidence or prices and never produce known full-tier cache state',async()=>{
 const f=await fixture({tier:'free',totals:{TWSE:3,TPEX:0,EMERGING:0}}),data=await parse(f),cache=cacheDailyAiMarketPageV2(data,f.auth,f.request);
 assert.equal(adaptDailyAiMarketPageV2(cache,f.auth,9,NOW).cards[0].price_state,'NOT_INCLUDED');
 for(const mutate of [f=>f.wire.cards[0].sources=[source],f=>f.wire.cards[0].counter_evidence=[],f=>f.wire.cards[0].price={}]){
  const bad={...f,wire:structuredClone(f.wire)};mutate(bad);await reject(bad,/SCOPE/);
 }
 assert.equal(eligibleDailyAiMarketPageCacheV2(cache,{...f.auth,tier:'premium'},NOW),false);
 await reject(await fixture({tier:'free',totals:{TWSE:4,TPEX:0,EMERGING:0}}),/SCOPE/);
});

test('unknown coverage is explicit and incomplete coverage never implies a negative stock conclusion',async()=>{
 const f=await fixture(),m=f.wire.universe.markets[2];m.published_count=null;m.coverage='UNKNOWN';
 const data=await parse(f);assert.equal(data.universe.markets[2].published_count,null);assert.equal(data.universe.markets[2].data_as_of.price_date,null);
 assert(data.cards.every(card=>card.status==='WAIT'));
 for(const mutate of [m=>m.coverage='COMPLETE',m=>m.published_count=500,m=>m.roster_as_of='2026-11-12',m=>m.data_as_of.financial_available_at='2026-11-11T08:01:00Z']){
  const bad={...f,wire:structuredClone(f.wire)};mutate(bad.wire.universe.markets[2]);await reject(bad,/COVERAGE|CHRONOLOGY/);
 }
});

test('null edition returns a bounded empty readable state without draft cards or invented revisions',async()=>{
 const f=await fixture({totals:{TWSE:0,TPEX:0,EMERGING:0}});
 f.wire.edition=null;f.wire.research_revision=null;f.wire.price_revision=null;
 const data=await parse(f),cache=cacheDailyAiMarketPageV2(data,f.auth,f.request),view=adaptDailyAiMarketPageV2(cache,f.auth,9,NOW);
 assert.equal(view.edition,null);assert.deepEqual(view.cards,[]);assert.equal(view.counts.available_total,0);
 assert.equal((await createDailyAiMarketPageRequestV2(f.auth,f.request.query,{cache,now:NOW})).known,null);
 await assert.rejects(()=>nextDailyAiMarketPageRequestV2(cache,f.auth,NOW),/NO_NEXT_PAGE/);
 const bad={...f,wire:structuredClone(f.wire)};bad.wire.research_revision=H.research;await reject(bad,/CONTRACT/);
});

test('source identity, page totals, ordering, search, markets and page-size bounds are strict',async()=>{
 for(const q of [{page_size:0},{page_size:61},{page_size:1.5},{market:'OTC'},{horizon:['MEDIUM']},{search:' 2330'},{search:'x\n'},{sort:'RANDOM'}])
  await assert.rejects(()=>createDailyAiMarketPageRequestV2(scope(),query(q),{now:NOW}));
 const original=await fixture();
 for(const mutate of [f=>f.wire.page.returned++,f=>f.wire.counts.by_status.WATCH++,f=>f.wire.cards.reverse(),f=>f.wire.cards[0].market='EMERGING',
  f=>f.wire.cards[0].sources[0].available_at='2026-11-11T09:00:00Z',f=>f.wire.cards[0].reason.evidence_ids=['UNBOUND'],
  f=>f.wire.cards[0].raw_packet={private:'forbidden'},f=>f.wire.cards[0].sources[0].source='https://www.twse.com.tw/?api_key=secret',
  f=>f.wire.cards[0].status=['WAIT']]){
  const bad={...original,wire:structuredClone(original.wire)};mutate(bad);await reject(bad);
 }
 const searched=await fixture({q:{search:'1001'}});assert.equal((await parse(searched)).cards.length,1);
 searched.wire.cards[0].company='changed';searched.wire.cards[0].symbol='9999';await reject(searched,/CARD/);
 const three=await fixture({totals:{TWSE:3,TPEX:3,EMERGING:3}});assert.equal(new Set((await parse(three)).cards.map(c=>c.market)).size,3);
});

test('price expiry, edition expiry, logout, new generation and Taipei date changes hide cached content',async()=>{
 const f=await withPrice(await fixture()),data=await parse(f),cache=cacheDailyAiMarketPageV2(data,f.auth,f.request);
 assert.equal(adaptDailyAiMarketPageV2(cache,f.auth,9,NOW+999).cards[0].price_state,'AVAILABLE');
 const expired=adaptDailyAiMarketPageV2(cache,f.auth,9,NOW+1000);assert.equal(expired.cards[0].price,null);assert.equal(expired.cards[0].price_state,'EXPIRED');
 assert.equal(adaptDailyAiMarketPageV2(cache,f.auth,9,Date.parse(data.edition.expires_at)),null);
 for(const auth of [{...f.auth,generation:2},{...f.auth,signal:new AbortController().signal},{...f.auth,identity:'00000000-0000-0000-0000-000000000002'}])assert.equal(adaptDailyAiMarketPageV2(cache,auth,9,NOW),null);
 assert.equal(adaptDailyAiMarketPageV2(cache,f.auth,9,Date.parse('2026-11-11T16:00:00Z')),null);
 const controller=new AbortController(),auth={...f.auth,signal:controller.signal},fresh=await parseDailyAiMarketPageV2(f.wire,auth,f.request,null,NOW),bound=cacheDailyAiMarketPageV2(fresh,auth,f.request);
 controller.abort();assert.equal(adaptDailyAiMarketPageV2(bound,auth,9,NOW),null);
});

test('parser owns input before hashing and rejects an aborted in-flight scope',async()=>{
 const f=await fixture(),pending=parse(f);f.wire.cards[0].company='CALLER_MUTATED';assert.notEqual((await pending).cards[0].company,'CALLER_MUTATED');
 const g=await fixture(),controller=new AbortController();g.auth={...g.auth,signal:controller.signal};
 const aborted=parse(g);controller.abort();await assert.rejects(aborted,/SCOPE/);
});

test('deterministic screening keeps its own origin and is never relabeled AI or a completed independent review',async()=>{
 const f=await fixture();f.wire.edition.analysis_origin='DETERMINISTIC_SCREENING';
 const data=await parse(f),view=adaptDailyAiMarketPageV2(cacheDailyAiMarketPageV2(data,f.auth,f.request),f.auth,9,NOW);
 assert.equal(data.edition.analysis_origin,'DETERMINISTIC_SCREENING');assert.equal(view.analysis_label,'規則式資料篩選');
 assert(!view.analysis_label.includes('AI'));assert(!view.analysis_label.includes('審核'));
});

test('optional research references keep each method meaning and never enter the formal price-plan contract',async()=>{
 for(const [horizon,method]of [['SHORT',undefined],['MEDIUM',undefined],['MEDIUM','CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'],['LONG',undefined],
  ['MEDIUM','CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB'],['LONG','CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB']]){
  const f=await fixture({q:{horizon}}),expected=referenceFor(f.wire.cards[0],method);f.wire.cards[0].research_reference=expected;
  const parsed=await parse(f),card=parsed.cards[0];assert.deepEqual(card.research_reference,expected);assert.equal(card.price,null);
  assert(Object.isFrozen(card.research_reference));assert.equal(card.research_reference.buy_ready,false);assert.equal(card.research_reference.methodology_approved,false);
  const view=adaptDailyAiMarketPageV2(cacheDailyAiMarketPageV2(parsed,f.auth,f.request),f.auth,9,NOW);assert.equal(view.cards[0].price_state,'NONE');
 }
 const old=await fixture();assert.equal((await parse(old)).cards[0].research_reference,null);
 old.wire.cards[0].research_reference=null;assert.equal((await parse(old)).cards[0].research_reference,null);
});

test('research-reference identities, method versions, ranges, peer sample sizes and truthful flags are strict',async()=>{
 const f=await fixture();f.wire.cards[0].research_reference=referenceFor(f.wire.cards[0]);
 const changes=[r=>r.symbol='9999',r=>r.horizon='LONG',r=>r.schema='OTHER',r=>r.status='VERIFIED',r=>r.method_id='INTRINSIC_VALUE',
  r=>r.method_version='TAIWAN_LONG_QUALITY_PEER_PB_V1',r=>r.lower=0,r=>r.upper=Number.POSITIVE_INFINITY,r=>r.current_price=-1,
  r=>r.lower=200,r=>r.median=null,r=>r.median=200,r=>r.peer_count=4,r=>r.peer_count=5.5,
  r=>r.reference_hash='not-a-hash',r=>r.input_pool_hash=null,r=>r.quote_date='2026-11-12',
  r=>r.forecast=true,r=>r.buy_ready=true,r=>r.methodology_approved=true,r=>r.entry_range=[80,100]];
 for(const change of changes){const bad={...f,wire:structuredClone(f.wire)};change(bad.wire.cards[0].research_reference);await reject(bad);}
 const short=await fixture({q:{horizon:'SHORT'}});short.wire.cards[0].research_reference=referenceFor(short.wire.cards[0]);
 for(const field of ['median','peer_count']){const bad={...short,wire:structuredClone(short.wire)};bad.wire.cards[0].research_reference[field]=7;await reject(bad,/REFERENCE/);}
 const long=await fixture({q:{horizon:'LONG'}});long.wire.cards[0].research_reference=referenceFor(long.wire.cards[0],'CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB');
 await reject(long,/REFERENCE/);
 const wrongQuality=await fixture({q:{horizon:'LONG'}});
 wrongQuality.wire.cards[0].research_reference=referenceFor(wrongQuality.wire.cards[0],'CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB');
 await reject(wrongQuality,/REFERENCE/);
});

test('free members cannot receive non-null research references and unavailable editions cannot expose them',async()=>{
 const f=await fixture({tier:'free',totals:{TWSE:3,TPEX:0,EMERGING:0}});assert.equal((await parse(f)).cards[0].research_reference,null);
 f.wire.cards[0].research_reference=null;assert.equal((await parse(f)).cards[0].research_reference,null);
 f.wire.cards[0].research_reference=referenceFor(f.wire.cards[0]);await reject(f,/SCOPE/);
 const absent=await fixture();absent.wire.cards[0].research_reference=referenceFor(absent.wire.cards[0]);absent.wire.edition=null;
 await reject(absent);
});

test('reference refresh, expiry and scope changes use the existing immutable edition lifecycle without extra reads',async()=>{
 const f=await fixture();f.wire.cards[0].research_reference=referenceFor(f.wire.cards[0]);
 const data=await parse(f),cache=cacheDailyAiMarketPageV2(data,f.auth,f.request),request=await createDailyAiMarketPageRequestV2(f.auth,f.request.query,{cache,now:NOW});
 const reuse=unchanged(f.wire);reuse.checked_at=new Date(NOW+10).toISOString();
 const parsed=await parseDailyAiMarketPageV2(reuse,f.auth,request,cache,NOW+10);assert.equal(parsed.cards[0].research_reference,data.cards[0].research_reference);
 const next=structuredClone(f.wire);next.research_revision='9'.repeat(64);next.cards[0].research_reference=null;
 next.page.next_cursor.research_revision=next.research_revision;await refreshCursorHash(next.page.next_cursor);
 const updated=await parseDailyAiMarketPageV2(next,f.auth,request,cache,NOW);assert.equal(updated.cards[0].research_reference,null);
 assert.equal(adaptDailyAiMarketPageV2(cache,f.auth,9,Date.parse(data.edition.expires_at)),null);
 assert.equal(adaptDailyAiMarketPageV2(cache,{...f.auth,tier:'free'},9,NOW),null);
});
