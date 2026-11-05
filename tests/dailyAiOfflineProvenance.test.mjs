/** Tests the actual repository parsers and rendered pages with synthetic data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDailyAiMember,dailyAiAnalysisOrigin} from '../src/features/vnext/dailyAiMember.ts';
import {parseDailyAiOwner} from '../src/features/vnext/dailyAiOwner.ts';
const repo=new URL('../',import.meta.url).pathname;
const now=Date.parse('2026-11-01T13:30:00Z');
function memberFixture(origin,free=false){
 return {schema:'VNEXT_AI_MEMBER_EDITION_V1',tier:free?'free':'premium',business_date:'2026-11-01',research_only:true,
  edition:{id:'a'.repeat(64),edition_date:'2026-11-01',data_through:'2026-10-30',evidence_cutoff:'2026-11-01T12:00:00Z',prepared_at:'2026-11-01T13:00:00Z',expires_at:'2026-11-02T12:00:00Z',mode:'AS_OF_RESEARCH',forecast:false,performance_available:false,...(origin===undefined?{}:{analysis_origin:origin})},
  cards:Array.from({length:free?3:72},(_,i)=>['SHORT','MEDIUM','LONG'].map(horizon=>({symbol:String(1000+i),company:'合成公司'+i,horizon,status:'WAIT',reason:{text:'隔離測試判斷',evidence_ids:['E'+i]},confirmation:'等待確認',invalidation:'來源否定即重評',gaps:[],classification:'INFERENCE',...(free?{}:{counter_evidence:[],sources:[{id:'E'+i,source:'https://www.twse.com.tw/synthetic',kind:'NEWS',published_at:'2026-11-01T10:00:00Z',available_at:'2026-11-01T11:00:00Z',time_basis:'PUBLISHED',first_seen_at:null,as_of:null,evidence_hash:null}]})}))).flat()};
}
function ownerFixture(origin,jobs){
 const member=memberFixture(origin);return {schema:'VNEXT_AI_OWNER_EDITION_V1',preview_only:true,edition:{...member.edition,batch_id:'b'.repeat(64),jobs,periods:216},cards:member.cards,source_urls:['https://www.twse.com.tw/synthetic'],rights_ready:false,integrity_ready:true,review_ready:false,publish_ready:false,review:null,publication:null};
}
test('legacy missing origin retains its old projection and defaults semantically to model generation',()=>{
 const parsed=parseDailyAiMember(memberFixture(undefined),undefined,now);assert.equal(Object.hasOwn(parsed.edition,'analysis_origin'),false);assert.equal(dailyAiAnalysisOrigin(parsed.edition),'MODEL_GENERATED');assert.equal(parsed.cards.length,216);assert.equal(parseDailyAiOwner(ownerFixture(undefined,72),now).edition.jobs,72);
});
test('explicit model and offline origins are preserved for Premium and Free scope',()=>{
 for(const origin of ['MODEL_GENERATED','OFFLINE_REVIEWED'])for(const free of [false,true]){const parsed=parseDailyAiMember(memberFixture(origin,free),undefined,now);assert.equal(parsed.edition.analysis_origin,origin);assert.equal(parsed.cards.length,free?9:216);if(free)assert.equal(parsed.cards[0].sources,null);}
});
test('unknown, null and wrong-type origin flags fail closed',()=>{
 for(const origin of ['HUMAN_REVIEWED','UNKNOWN',null,false,0])assert.throws(()=>parseDailyAiMember(memberFixture(origin),undefined,now),/AI_MEMBER_ENUM/);
});
test('only explicit offline analysis can have zero model jobs; model output still requires 72',()=>{
 assert.equal(parseDailyAiOwner(ownerFixture('OFFLINE_REVIEWED',0),now).edition.jobs,0);
 for(const [origin,jobs]of[[undefined,0],['MODEL_GENERATED',0],['OFFLINE_REVIEWED',72],['OFFLINE_REVIEWED',71],['MODEL_GENERATED',71]])assert.throws(()=>parseDailyAiOwner(ownerFixture(origin,jobs),now),/AI_OWNER_UNIVERSE/);
});
test('offline zero-job origin never bypasses the original 72-stock/216-period card scope',()=>{
 const p=ownerFixture('OFFLINE_REVIEWED',0);p.cards.pop();assert.throws(()=>parseDailyAiOwner(p,now),/AI_MEMBER_UNIVERSE/);
});
test('member and Owner render honest offline labels and count 72 actual stocks',async()=>{
 const {createServer}=await import('vite'),React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const server=await createServer({configFile:false,root:repo,resolve:{alias:{'@':repo+'src'}},server:{middlewareMode:true,hmr:false},appType:'custom'}),originalNow=Date.now;
 try{
  Date.now=()=>now;
  const {default:Member}=await server.ssrLoadModule('/src/pages/vnext/DailyAiMemberResearch.tsx'),{OwnerAiEditionReview}=await server.ssrLoadModule('/src/pages/vnext/OwnerAiPublication.tsx');
  const member=renderToStaticMarkup(React.createElement(Member,{data:parseDailyAiMember(memberFixture('OFFLINE_REVIEWED'),undefined,now)}));
  assert(member.includes('離線審核分析'));assert(!member.includes('AI 證據分析'));assert(!member.includes('AI 判讀'));
  const owner=renderToStaticMarkup(React.createElement(OwnerAiEditionReview,{data:parseDailyAiOwner(ownerFixture('OFFLINE_REVIEWED',0),now),onReview:()=>{throw Error('SSR must never write');}}));
  assert(owner.includes('72 檔 / 216 個期間分析'));assert(!owner.includes('0 檔 /'));assert(owner.includes('離線審核分析與理由'));assert(!owner.includes('AI 判斷與理由'));assert.match(owner,/<button disabled="">核准本版會員閱讀<\/button>/);
  const legacy=renderToStaticMarkup(React.createElement(Member,{data:parseDailyAiMember(memberFixture(undefined),undefined,now)}));assert(legacy.includes('AI 證據分析'));assert(legacy.includes('AI 判讀'));
 }finally{Date.now=originalNow;await server.close();}
});
