import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDailyAiMember} from '../src/features/vnext/dailyAiMember.ts';

const now=Date.parse('2026-10-31T02:00:00Z');
function fixture(tier='premium'){
 const full=tier!=='free';return {schema:'VNEXT_AI_MEMBER_EDITION_V1',tier,business_date:'2026-10-31',research_only:true,
  edition:{id:'a'.repeat(64),edition_date:'2026-10-31',data_through:'2026-10-30',evidence_cutoff:'2026-10-31T01:00:00Z',prepared_at:'2026-10-31T01:05:00Z',expires_at:'2026-11-02T00:00:00Z',mode:'AS_OF_RESEARCH',forecast:false,performance_available:false},
  cards:Array.from({length:full?72:3},(_,i)=>['SHORT','MEDIUM','LONG'].map(horizon=>({symbol:String(1000+i),company:'測試公司'+i,horizon,status:'WAIT',
   reason:{text:horizon+'期間測試判斷',evidence_ids:['E1']},confirmation:horizon+'期間等待新資料確認',invalidation:horizon+'期間新證據否定時重評',gaps:['測試資料缺口'],classification:'INFERENCE',
   ...(full?{counter_evidence:[{text:horizon+'期間反面證據',evidence_ids:['E1']}],sources:[{id:'E1',source:'https://www.twse.com.tw/test',kind:'NEWS',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',time_basis:'PUBLISHED',first_seen_at:null,as_of:null,evidence_hash:null}]}:{})}))).flat()};
}
test('member projection keeps actual version/data dates, all horizons and approved tier scope',()=>{
 for(const tier of ['free','premium','owner']){
  const r=parseDailyAiMember(fixture(tier),'2026-10-31',now);assert.equal(r.cards.length,tier==='free'?9:216);assert.equal(r.edition.data_through,'2026-10-30');
  for(const h of ['SHORT','MEDIUM','LONG'])assert.equal(r.cards.filter(c=>c.horizon===h).length,tier==='free'?3:72);
  if(tier==='free'){assert.equal(r.cards[0].sources,null);assert.equal(r.cards[0].counter_evidence,null);}
 }
 const p=fixture();p.edition=null;p.cards=[];assert.equal(parseDailyAiMember(p,'2026-10-31',now).edition,null);
});
test('null edition with cards, partial universe, duplicate horizons and mismatched names fail closed',()=>{
 for(const change of [p=>p.edition=null,p=>p.cards.pop(),p=>p.cards[1]={...p.cards[0]},p=>p.cards[1].company='不同公司']){
  const p=fixture();change(p);assert.throws(()=>parseDailyAiMember(p,'2026-10-31',now),/AI_MEMBER_(EMPTY_EDITION|UNIVERSE)/);
 }
});
test('free projection rejects detailed source or counter evidence keys, including null placeholders',()=>{
 for(const [key,value] of [['sources',[]],['sources',null],['counter_evidence',[]],['counter_evidence',null]]){
  const p=fixture('free');p.cards[0][key]=value;assert.throws(()=>parseDailyAiMember(p,'2026-10-31',now),/AI_MEMBER_FREE_SCOPE/);
 }
 assert.throws(()=>parseDailyAiMember({...fixture(),tier:'free'},'2026-10-31',now),/AI_MEMBER_FREE_SCOPE/);
});
test('unapproved job output, forecast/performance flags, invalid statuses and unexplained insufficiency are rejected',()=>{
 for(const change of [p=>p.schema='DAILY_AI_STOCK_ANALYSIS_V1',p=>p.research_only=false,p=>p.edition.forecast=true,p=>p.edition.performance_available=true,
  p=>p.edition.mode='FORWARD_SHADOW',p=>p.cards[0].status='BUY',p=>p.cards[0].classification='CONFIRMED_FACT',p=>{p.cards[0].status='INSUFFICIENT';p.cards[0].gaps=[];}]){
  const p=fixture();change(p);assert.throws(()=>parseDailyAiMember(p,'2026-10-31',now),/AI_MEMBER_/);
 }
});
test('request date, evidence chronology, expiry and source citation integrity are checked',()=>{
 assert.throws(()=>parseDailyAiMember(fixture(),'2026-11-01',now),/AI_MEMBER_REQUEST_DATE/);
 for(const change of [p=>p.edition.prepared_at='2026-11-01T00:00:00Z',p=>p.edition.expires_at='2026-10-31T02:00:00Z',p=>p.edition.edition_date='2026-10-30',
  p=>p.edition.data_through='2026-11-01',p=>p.cards[0].sources[0].available_at='2026-11-01T00:00:00Z',p=>p.cards[0].sources[0].source='javascript:alert(1)',
  p=>p.cards[0].reason.evidence_ids=['invented'],p=>p.cards[0].counter_evidence[0].evidence_ids=['invented'],p=>p.cards[0].sources.push({...p.cards[0].sources[0]})]){
  const p=fixture();change(p);assert.throws(()=>parseDailyAiMember(p,'2026-10-31',now),/AI_MEMBER_/);
 }
});
test('receipt-only sources retain unknown publication time without pretending an original timestamp',()=>{
 const p=fixture(),s=p.cards[0].sources[0];Object.assign(s,{published_at:null,time_basis:'OBSERVED_AFTER_RECEIPT',first_seen_at:'2026-10-30T10:30:00Z',as_of:'2026-10-30T10:00:00Z',evidence_hash:'b'.repeat(64)});
 const r=parseDailyAiMember(p,'2026-10-31',now);assert.equal(r.cards[0].sources[0].published_at,null);assert.equal(r.cards[0].sources[0].time_basis,'OBSERVED_AFTER_RECEIPT');
 s.first_seen_at=null;assert.throws(()=>parseDailyAiMember(p,'2026-10-31',now),/AI_MEMBER_SOURCE/);
});
test('unknown provider receipts and raw input fields are excluded from browser output',()=>{
 const p=fixture();p.receipt={secret:'private'};p.cards[0].raw_payload={content:'private'};p.cards[0].sources[0].content='private';
 const r=parseDailyAiMember(p,'2026-10-31',now);assert(!JSON.stringify(r).includes('private'));
});
test('combined packet and model gaps retain all 130 permitted limitations',()=>{
 const p=fixture();p.cards[0].gaps=Array.from({length:130},(_,i)=>'資料缺口'+i);
 assert.deepEqual(parseDailyAiMember(p,'2026-10-31',now).cards[0].gaps,p.cards[0].gaps);
 p.cards[0].gaps.push('超過契約上限');assert.throws(()=>parseDailyAiMember(p,'2026-10-31',now),/AI_MEMBER_ARRAY/);
});
test('actual component starts in a single horizon, shows gaps and source dates, and invents no price range',async()=>{
 const {createServer}=await import('../node_modules/vite/dist/node/index.js'),React=await import('../node_modules/react/index.js'),{renderToStaticMarkup}=await import('../node_modules/react-dom/server.node.js');
 const root=new URL('../',import.meta.url).pathname,server=await createServer({configFile:false,root,resolve:{alias:{'@':root+'src'}},server:{middlewareMode:true},appType:'custom'});
 const originalNow=Date.now;
 try{
  Date.now=()=>now;const {default:Page}=await server.ssrLoadModule('/src/pages/vnext/DailyAiMemberResearch.tsx');
  const data=parseDailyAiMember(fixture(),'2026-10-31',now),html=renderToStaticMarkup(React.createElement(Page,{data}));
  assert(html.includes('目前查看：短期觀察'));assert(html.includes('SHORT期間測試判斷'));assert(!html.includes('MEDIUM期間測試判斷'));assert(!html.includes('LONG期間測試判斷'));
  assert(html.includes('2026-10-30'));assert(html.includes('還缺哪些資料'));assert(html.includes('本版未提供已驗證的買進區間'));
  assert(html.includes('https://www.twse.com.tw/test'));assert(!html.includes('目標價'));
  const medium=renderToStaticMarkup(React.createElement(Page,{data,selectedHorizon:'MEDIUM'}));
  assert(medium.includes('MEDIUM期間測試判斷'));assert(!medium.includes('SHORT期間測試判斷'));assert(!medium.includes('LONG期間測試判斷'));
  Date.now=()=>Date.parse(data.edition.expires_at);const expired=renderToStaticMarkup(React.createElement(Page,{data}));
  assert(expired.includes('這個研究版本已到期'));assert(!expired.includes('SHORT期間測試判斷'));
 }finally{Date.now=originalNow;await server.close();}
});
