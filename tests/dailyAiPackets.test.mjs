import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDailyAiPackets} from '../research/daily-ai-packets.ts';
import {analyseStock,validateAnalysisPacket,validateAnalysisResult} from '../research/daily-ai-analysis.ts';
const cutoff='2026-10-30T14:00:00Z';
const trace=id=>({id,source:'https://www.twse.com.tw/',published_at:null,first_seen_at:'2026-10-30T12:00:00Z',available_at:'2026-10-30T12:00:00Z',as_of:'2026-10-30T05:30:00Z',evidence_hash:'a'.repeat(64)});
const inputs=()=>Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司',cutoff:'2026-10-30T12:00:00Z',through:'2026-10-30',next_session:'2026-11-02',v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},
 expected_sessions:Array.from({length:20},(_,d)=>`2026-10-${11+d}`),
 bars:Array.from({length:20},(_,d)=>({...trace('bar-'+d),date:`2026-10-${11+d}`,open:10,high:12,low:9,close:11,volume:1000,amount:11000,session_scope:'TEST_SESSION'})),
 facts:[{...trace('eps-ytd'),kind:'EPS_BASIC_CONTEXT',period:'2026-Q3',basis:'YEAR_TO_DATE',values:{eps:8}}]}));
const news=(symbol,id='news')=>({id,symbol,kind:'NEWS',source:'https://www.twse.com.tw/',published_at:'2026-10-30T13:00:00Z',available_at:'2026-10-30T13:01:00Z',content:'測試新聞'});
const market=()=>({...news(null,'market'),kind:'MARKET',content:'測試市場資料'});
test('all 72 retained packets preserve unknown publication, source hashes and financial basis',()=>{
 const originals=inputs(),before=JSON.stringify(originals),r=buildDailyAiPackets({inputs:originals,cutoff,news:[news('1000')],market:[market()]});
 assert.equal(r.packets.length,72);assert.equal(r.through,'2026-10-30');assert.equal(JSON.stringify(originals),before);
 const price=r.packets[0].evidence[0];assert.equal(price.published_at,null);assert.equal(price.time_basis,'OBSERVED_AFTER_RECEIPT');assert.equal(price.evidence_hash,'a'.repeat(64));assert.equal(price.first_seen_at,'2026-10-30T12:00:00Z');
 const eps=r.packets[0].evidence.find(e=>e.kind==='FINANCIAL');assert.equal(JSON.parse(eps.content).basis,'YEAR_TO_DATE');assert.equal(JSON.parse(eps.content).values.eps,8);
 assert(r.packets[0].data_gaps.includes('ORIGINAL_PUBLICATION_TIME_UNKNOWN_RECEIPT_REVIEW_ONLY'));
 assert(!r.packets[1].evidence.some(e=>e.id==='news'));assert(r.gaps['1001'].includes('COMPANY_NEWS_NOT_CAPTURED'));
 assert(r.packets.every(p=>p.evidence.find(e=>e.id==='market').symbol===null));
});
test('receipt-only inputs cannot replace unknown publication with an invented timestamp',()=>{
 const r=buildDailyAiPackets({inputs:inputs(),cutoff,news:[],market:[]});
 assert(r.packets.every(p=>p.evidence.every(e=>e.published_at===null)));
 const p=structuredClone(r.packets[0]);delete p.evidence[0].time_basis;assert.throws(()=>validateAnalysisPacket(p),/AI_ANALYSIS_RECEIPT_REQUIRED/);
 p.evidence[0].time_basis='OBSERVED_AFTER_RECEIPT';p.evidence[0].published_at=p.evidence[0].available_at;
 assert.throws(()=>validateAnalysisPacket(p),/AI_ANALYSIS_PUBLICATION/);
});
test('future receipts, invalid chronology, cross-universe news and duplicate sessions stop packet generation',()=>{
 let i=inputs();i[0].bars[19].available_at='2026-10-31T12:00:00Z';assert.throws(()=>buildDailyAiPackets({inputs:i,cutoff,news:[],market:[]}),/AI_ANALYSIS_EVIDENCE/);
 i=inputs();i[0].bars[19].first_seen_at='2026-10-30T13:00:00Z';assert.throws(()=>buildDailyAiPackets({inputs:i,cutoff,news:[],market:[]}),/AI_ANALYSIS_RECEIPT/);
 i=inputs();i[0].bars.push({...i[0].bars[0]});assert.throws(()=>buildDailyAiPackets({inputs:i,cutoff,news:[],market:[]}),/AI_PACKET_DUPLICATE_SESSION/);
 assert.throws(()=>buildDailyAiPackets({inputs:inputs(),cutoff,news:[news('9999')],market:[]}),/AI_PACKET_SUPPLEMENT_SCOPE/);
});
test('bounded selection records omitted and missing evidence in the hashed model input',()=>{
 const r=buildDailyAiPackets({inputs:inputs(),cutoff,news:Array.from({length:15},(_,i)=>news(null,'news-'+i)),market:[market()]});
 assert.equal(r.packets[0].evidence.filter(e=>e.kind==='NEWS').length,12);assert(r.packets[0].evidence.length<=100);
 assert(r.packets[0].data_gaps.includes('SUPPLEMENT_LIMIT_OLDER_ITEMS_NOT_INCLUDED'));
 assert(r.packets[0].data_gaps.includes('COMPANY_NEWS_NOT_CAPTURED'));
});
test('company-news coverage describes the retained packet after the headline cap',()=>{
 const older={...news('1000','older-company'),published_at:'2026-10-30T12:00:00Z'},newer=Array.from({length:12},(_,i)=>news(null,'newer-global-'+i));
 const r=buildDailyAiPackets({inputs:inputs(),cutoff,news:[older,...newer],market:[]}),p=r.packets[0];
 assert.equal(p.evidence.filter(e=>e.kind==='NEWS').length,12);assert(!p.evidence.some(e=>e.id==='older-company'));
 assert(p.data_gaps.includes('COMPANY_NEWS_NOT_CAPTURED'));assert(p.data_gaps.includes('SUPPLEMENT_LIMIT_OLDER_ITEMS_NOT_INCLUDED'));
});
test('persisted outputs must match exact packet, horizon states, citations, text and retained metadata',async()=>{
 const packet=buildDailyAiPackets({inputs:inputs(),cutoff,news:[news('1000')],market:[]}).packets[0];
 const answer={symbol:packet.symbol,horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'測試判讀',evidence_ids:[packet.evidence[0].id]},counter_evidence:[],confirmation:'等待新資料',invalidation:'新證據否定原判斷',gaps:[]}))};
 const r=await analyseStock(packet,async req=>{assert(req.system.includes('不能聲稱市場在當時已知'));assert.equal(JSON.parse(req.input).evidence[0].published_at,null);return answer;});
 await validateAnalysisResult(packet,r);assert.equal(r.sources[0].published_at,null);assert.equal(r.sources[0].time_basis,'OBSERVED_AFTER_RECEIPT');
 for(const mutate of [x=>x.horizons[0].horizon='INVALID',x=>x.horizons[0].status='READY',x=>x.horizons[0].reason.evidence_ids=['forged'],x=>x.horizons[0].confirmation='',x=>x.sources[0].published_at=x.sources[0].available_at,x=>x.input_hash='b'.repeat(64)]){
  const bad=structuredClone(r);mutate(bad);await assert.rejects(()=>validateAnalysisResult(packet,bad),/AI_ANALYSIS_/);
 }
});
