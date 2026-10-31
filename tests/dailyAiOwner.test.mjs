import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyAiOwnerCanApprove,dailyAiOwnerCanRevoke,dailyAiOwnerReviewRequest,parseDailyAiOwner,parseDailyAiOwnerReviewResult} from '../src/features/vnext/dailyAiOwner.ts';

const now=Date.parse('2026-10-31T02:00:00Z'),reviewId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',oldReviewId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',requestId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function fixture(){return {schema:'VNEXT_AI_OWNER_EDITION_V1',preview_only:true,
 edition:{id:'a'.repeat(64),batch_id:'b'.repeat(64),edition_date:'2026-10-31',data_through:'2026-10-30',evidence_cutoff:'2026-10-31T01:00:00Z',prepared_at:'2026-10-31T01:05:00Z',expires_at:'2026-11-02T00:00:00Z',mode:'AS_OF_RESEARCH',forecast:false,performance_available:false,jobs:72,periods:216},
 cards:Array.from({length:72},(_,i)=>['SHORT','MEDIUM','LONG'].map(horizon=>({symbol:String(1000+i),company:'隔離測試'+i,horizon,status:'WAIT',reason:{text:horizon+' 真實欄位測試判斷',evidence_ids:['E1']},counter_evidence:[{text:horizon+' 反面證據',evidence_ids:['E1']}],confirmation:horizon+' 確認條件',invalidation:horizon+' 失效條件',gaps:['測試資料缺口'],classification:'INFERENCE',sources:[{id:'E1',source:'https://www.twse.com.tw/test',kind:'NEWS',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',time_basis:'PUBLISHED',first_seen_at:null,as_of:null,evidence_hash:null}]}))).flat(),
 source_urls:['https://www.twse.com.tw/test','https://www.twse.com.tw/uncited-original'],rights_ready:true,integrity_ready:true,review_ready:true,publish_ready:true,
 review:{id:reviewId,snapshot_hash:'a'.repeat(64),reviewer_ref:'獨立測試審查者',quality:'PASS',time_status:'PASS',licensing:'PASS',reason:'隔離測試審查理由',recorded_at:'2026-10-31T01:10:00Z',expires_at:'2026-11-01T00:00:00Z',quality_document_hash:'c'.repeat(64),time_document_hash:'d'.repeat(64),license_document_hash:'e'.repeat(64)},publication:null};}
test('owner parses 72/216 actual projections and all-source license scope without copying private output',()=>{
 const p=fixture();p.raw_receipt='secret';p.cards[0].raw_input='secret';p.cards[0].sources[0].content='secret';
 const data=parseDailyAiOwner(p,now);assert.equal(data.cards.length,216);assert.equal(data.source_urls.length,2);assert.equal(data.edition.batch_id,p.edition.batch_id);assert(!JSON.stringify(data).includes('secret'));assert.equal(dailyAiOwnerCanApprove(data,now),true);
});
test('empty edition cannot fabricate readiness, review, source or card records',()=>{
 const p={schema:'VNEXT_AI_OWNER_EDITION_V1',preview_only:true,edition:null,cards:[],source_urls:[],review:null,publication:null,rights_ready:false,integrity_ready:false,review_ready:false,publish_ready:false};
 assert.equal(parseDailyAiOwner(p,now).edition,null);
 for(const change of [r=>r.publish_ready=true,r=>r.rights_ready=true,r=>r.cards=[{}],r=>r.source_urls=['https://www.twse.com.tw/test'],r=>r.review={}]){const r=structuredClone(p);change(r);assert.throws(()=>parseDailyAiOwner(r,now),/AI_OWNER_EMPTY/);}
});
test('owner rejects partial periods, unsafe/missing source coverage, contradictory readiness and future records',()=>{
 for(const change of [p=>p.edition.jobs=71,p=>p.edition.periods=215,p=>p.cards.pop(),p=>p.cards[1]={...p.cards[0]},p=>p.source_urls=[],p=>p.source_urls[0]='javascript:alert(1)',p=>p.source_urls.push(p.source_urls[0]),p=>p.publish_ready='true',p=>p.rights_ready=false,p=>p.review.quality='FAIL',p=>p.review.snapshot_hash='f'.repeat(64),p=>p.review.recorded_at='2026-11-01T00:00:00Z',p=>p.edition.prepared_at='2026-11-01T00:00:00Z']){
  const p=fixture();change(p);assert.throws(()=>parseDailyAiOwner(p,now),/AI_(OWNER|MEMBER)_/);
 }
});
test('expired research remains an honest dated owner preview but cannot be approved',()=>{
 const p=fixture(),later=Date.parse('2026-11-03T00:00:00Z');p.publish_ready=false;p.review_ready=false;
 const data=parseDailyAiOwner(p,later);assert.equal(data.edition.expires_at,p.edition.expires_at);assert.equal(data.cards.length,216);assert.equal(dailyAiOwnerCanApprove(data,later),false);
 assert.throws(()=>dailyAiOwnerReviewRequest(data,'APPROVE','premium',requestId,later),/AI_OWNER_NOT_READY/);
 // An approval response can expire in transit. Recheck the current clock even
 // if all flags were true when the server constructed that response.
 const fresh=parseDailyAiOwner(fixture(),now);assert.equal(dailyAiOwnerCanApprove(fresh,Date.parse(fresh.review.expires_at)),false);assert.equal(dailyAiOwnerCanApprove(fresh,NaN),false);
});
test('superseding failed review blocks old approval and revocation uses latest actual review id',()=>{
 const p=fixture();p.review.quality='FAIL';p.review_ready=false;p.publish_ready=false;p.publication={id:7,review_id:oldReviewId,actor:oldReviewId,action:'APPROVE',audience:'premium',occurred_at:'2026-10-31T01:09:00Z'};
 const data=parseDailyAiOwner(p,now);assert.equal(dailyAiOwnerCanApprove(data,now),false);assert.equal(dailyAiOwnerCanRevoke(data),true);
 assert.deepEqual(dailyAiOwnerReviewRequest(data,'REVOKE','premium',requestId,now),{p_edition_id:p.edition.id,p_review_id:reviewId,p_action:'REVOKE',p_audience:'premium',p_request_key:requestId});
});
test('approval binds exact edition/review/audience/request UUID and validates actual action receipt',()=>{
 const data=parseDailyAiOwner(fixture(),now),args=dailyAiOwnerReviewRequest(data,'APPROVE','free',requestId,now);assert.equal(args.p_review_id,reviewId);assert.equal(args.p_audience,'free');assert.equal(args.p_edition_id,data.edition.id);
 assert.throws(()=>dailyAiOwnerReviewRequest(data,'APPROVE','premium','invented',now),/AI_OWNER_UUID/);assert.throws(()=>dailyAiOwnerReviewRequest(data,'BUY','premium',requestId,now),/AI_OWNER_ENUM/);assert.throws(()=>dailyAiOwnerReviewRequest(data,'REVOKE','premium',requestId,now),/AI_OWNER_NOT_READY/);
 assert.deepEqual(parseDailyAiOwnerReviewResult({event_id:9,action:'APPROVE',replayed:true},'APPROVE'),{event_id:9,action:'APPROVE',replayed:true});
 for(const result of [{event_id:9,action:'REVOKE',replayed:false},{event_id:'9',action:'APPROVE',replayed:false},{event_id:9,action:'APPROVE',replayed:'true'}])assert.throws(()=>parseDailyAiOwnerReviewResult(result,'APPROVE'),/AI_OWNER_/);
});
test('actual owner preview separates horizons, shows true gates, and disables approval without independent review',async()=>{
 const {createServer}=await import('../node_modules/vite/dist/node/index.js'),React=await import('../node_modules/react/index.js'),{renderToStaticMarkup}=await import('../node_modules/react-dom/server.node.js');
 const root=new URL('../',import.meta.url).pathname,server=await createServer({configFile:false,root,resolve:{alias:{'@':root+'src'}},server:{middlewareMode:true,hmr:false},appType:'custom'}),originalNow=Date.now;
 try{Date.now=()=>now;const {default:Owner,OwnerAiEditionReview:Preview}=await server.ssrLoadModule('/src/pages/vnext/OwnerAiPublication.tsx');
  for(const access of [{kind:'denied'},{kind:'loading'},{kind:'member',id:oldReviewId,generation:1,signal:new AbortController().signal,catalog:{tier:'premium'}}])assert.equal(renderToStaticMarkup(React.createElement(Owner,{access})), '');
  const p=fixture();p.review=null;p.review_ready=false;p.publish_ready=false;p.rights_ready=false;
  const html=renderToStaticMarkup(React.createElement(Preview,{data:parseDailyAiOwner(p,now),onReview:()=>{throw Error('SSR must not mutate');}}));
  assert(html.includes('72 檔 / 216 個期間分析'));assert(html.includes('目前預覽：短期觀察'));assert(html.includes('SHORT 真實欄位測試判斷'));assert(!html.includes('MEDIUM 真實欄位測試判斷'));assert(!html.includes('LONG 真實欄位測試判斷'));assert(html.includes('尚未收到獨立審查'));assert(html.includes('來源的會員使用權：尚未通過'));assert.match(html,/<button disabled="">核准本版會員閱讀<\/button>/);assert(!html.includes('已保存你的核准'));
 }finally{Date.now=originalNow;await server.close();}
});
