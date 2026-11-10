/** Deterministic private drafting. Existing model, review and member contracts stay separate. */
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';

export const AUTHOR_VERSION='ZERO_PAID_DAILY_AUTHOR_1.0.0';
const HORIZONS=['SHORT','MEDIUM','LONG'];
const sha=text=>createHash('sha256').update(text).digest('hex');
const fail=code=>{throw Error(code);};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const distinct=xs=>[...new Set(xs)];
const compare=(a,b)=>a>b?'高於':a<b?'低於':'等於';
const project=e=>Object.fromEntries(['id','source','kind','published_at','available_at','time_basis','first_seen_at','as_of','evidence_hash'].map(k=>[k,e[k]??(k==='time_basis'?'PUBLISHED':null)]));
const claim=(text,rows)=>({text,evidence_ids:distinct(rows.map(x=>x.e.id))});
const field=row=>({period:row.period??row.date,basis:row.basis??null,values:row.values??null,evidence_id:row.e.id,source:row.e.source,
 available_at:row.e.available_at,as_of:row.e.as_of??null,published_at:row.e.published_at});
const record=e=>{let data;try{data=JSON.parse(e.content);}catch{fail('AUTHOR_EVIDENCE_JSON');}
 if(!data||typeof data!=='object'||Array.isArray(data))fail('AUTHOR_EVIDENCE_OBJECT');return {...data,e};};

/** Dependencies are the pinned existing validators, calendar and observation model.
 * No network, SQL, credentials, model invocation, publication or buy-price method. */
export async function authorDailyResearch({batchText,prepared_at,expires_at,previous=null,now=Date.now()},deps){
 if(typeof batchText!=='string'||Buffer.byteLength(batchText)>12_000_000)fail('AUTHOR_BATCH_SIZE');
 const {canonical,snapshotHash,validateAnalysisPacket,evaluateResearch,previousMarketTradingDate,nextEntrySession,validateSnapshot}=deps;
 const batch=JSON.parse(batchText),batchId=sha(batchText),prepared=Date.parse(prepared_at),expiry=Date.parse(expires_at);
 if(batch.schema!=='DAILY_AI_BATCH_INPUT_V1'||!batch.packet_texts||!batch.packet_hashes
  ||Object.keys(batch.packet_texts).length!==72||Object.keys(batch.packet_hashes).length!==72)fail('AUTHOR_BATCH_SCOPE');
 // The deadline is anchored to source cutoff, so another run cannot revive old research.
 if(!Number.isFinite(now)||!Number.isFinite(prepared)||!Number.isFinite(expiry)||prepared>now||prepared<Date.parse(batch.cutoff)||expiry<=now
  ||expiry>Date.parse(batch.cutoff)+72*3600000)fail('AUTHOR_DEADLINE');
 const symbols=Object.keys(batch.packet_texts).sort(),cards=[],stocks=[],diagnostics=[];
 const expected=[];let date=batch.through;
 for(let i=0;i<20;i++){expected.unshift(date);date=previousMarketTradingDate('TW',date);if(!date)fail('AUTHOR_CALENDAR');}
 const nextSession=nextEntrySession(batch.through);
 for(const symbol of symbols){
  const packetText=batch.packet_texts[symbol];
  if(!/^\d{4,6}$/.test(symbol)||typeof packetText!=='string'||sha(packetText)!==batch.packet_hashes[symbol])fail('AUTHOR_PACKET_HASH');
  const p=JSON.parse(packetText);validateAnalysisPacket(p);
  if(p.symbol!==symbol||p.cutoff!==batch.cutoff||p.data_through!==batch.through
   ||await snapshotHash(p)!==batch.packet_hashes[symbol])fail('AUTHOR_PACKET_SCOPE');
  const decoded=p.evidence.map(record),bars=decoded.filter(r=>r.e.kind==='PRICE').sort((a,b)=>a.date.localeCompare(b.date));
  const facts=decoded.filter(r=>r.e.kind==='FINANCIAL'),financial=kind=>facts.filter(r=>r.kind===kind).sort((a,b)=>(a.period??'').localeCompare(b.period??''));
  const revenues=financial('REVENUE').slice(-3),flows=financial('INSTITUTIONAL').slice(-10),eps=financial('EPS').slice(-4),
   margins=financial('MARGIN').slice(-4),capex=financial('CAPEX').slice(-4),reported=financial('EPS_AS_REPORTED').at(-1),valuation=financial('VALUATION_AS_REPORTED').at(-1);
  const trace=r=>({...r,...project(r.e),id:r.e.id,kind:r.kind});
  const input={symbol,company:p.company,cutoff:batch.cutoff,through:batch.through,next_session:nextSession,expected_sessions:expected,
   bars:bars.map(trace),facts:facts.map(trace),v1_missing:Object.fromEntries(HORIZONS.map(h=>[h,['FORMAL_V1_NOT_EVALUATED_BY_DRAFT_AUTHOR']]))};
  const evaluations=Object.fromEntries(HORIZONS.map(h=>[h,evaluateResearch(input,h)]));
  diagnostics.push(...Object.values(evaluations));
  const latest=bars.at(-1),ownEvidence=decoded.filter(r=>r.e.symbol===symbol),fallback=latest??ownEvidence[0];
  if(!fallback)fail('AUTHOR_COMPANY_EVIDENCE_REQUIRED');
  const counters=[],lastMargin=margins.at(-1),priorMargin=margins.at(-2);
  if(lastMargin&&priorMargin&&lastMargin.basis==='SINGLE_QUARTER'&&priorMargin.basis==='SINGLE_QUARTER'
   &&lastMargin.values?.unit===priorMargin.values?.unit&&finite(lastMargin.values?.value)&&finite(priorMargin.values?.value))
   counters.push(claim(`最新保留的單季毛利率${compare(lastMargin.values.value,priorMargin.values.value)}前季；仍須核對產品組合、成本與後續修訂。`,[lastMargin,priorMargin]));
  if(valuation)counters.push(claim('官方原報本益比只供資料比較，未據此認定股價便宜，也未換算成合理買價。',[valuation]));
  if(!counters.length)counters.push(claim('目前引用的資料不涵蓋完整公司事件與公司行動，不能據此確認適合進場。',[fallback]));
  let shortReason;
  if(evaluations.SHORT.state==='INSUFFICIENT')shortReason=claim('完整交易日量價或來源條件仍有缺漏，短期先保留判斷；最後取得的報價不代表本次目標交易日已更新。',[fallback]);
  else{
   const location=latest.high===latest.low?0:(latest.close-latest.low)/(latest.high-latest.low);
   // This prose describes only the cited session. Full twenty-session activity
   // calculations and their source sets remain in the separate diagnostics.
   shortReason=claim(`當日收盤${compare(latest.close,latest.open)}開盤，收盤位置${location>=.7?'靠近日內區間上緣':location<=.3?'靠近日內區間下緣':'落在日內區間中段'}；後續仍須核對成交參與、公司事件與原始價量口徑，再判斷是否續列觀察。`,[latest]);
  }
  let mediumReason;
  if(evaluations.MEDIUM.state==='INSUFFICIENT')mediumReason=claim('營收期間、法人股數連續性或來源條件尚未備齊，不能把局部資料當作已確認的中期趨勢。',revenues.length?revenues:[fallback]);
  else{
   const net=flows.reduce((s,r)=>s+r.values.net_shares,0),growth=revenues.every(r=>r.values.yoy_percent>0);
   mediumReason=claim(`${growth?'最近已報月營收皆維持年增':'最近已報月營收未能全部維持年增'}；對齊交易日後，法人累計${net>0?'為買超':net<0?'為賣超':'買賣相抵'}，${evaluations.MEDIUM.state==='QUALIFIED'?'列入中期研究觀察，等待下一次營收與法人資料確認':'先等待營收與法人方向共同支持'}。`,[...revenues,...flows]);
  }
  let longReason;
  const comparableEps=eps.length===4&&new Set(eps.map(r=>r.values?.unit)).size===1
   &&new Set(eps.map(r=>r.values?.measurement_basis??null)).size===1&&new Set(eps.map(r=>r.values?.consolidation??null)).size===1
   &&eps.every((r,i)=>{const m=/^(\d{4})-Q([1-4])$/.exec(r.period??''),p=i?/^(\d{4})-Q([1-4])$/.exec(eps[i-1].period??''):null;
    return m&&(!i||p&&Number(m[1])*4+Number(m[2])===Number(p[1])*4+Number(p[2])+1)
     &&r.basis==='SINGLE_QUARTER'&&['TWD_PER_SHARE','TWD_PER_COMMON_SHARE'].includes(r.values?.unit)&&finite(r.values?.value);});
  if(comparableEps)longReason=claim(`保留的同口徑單季每股盈餘${eps.every(r=>r.values.value>0)?'皆為正，提供持續檢查獲利品質的基礎':'包含虧損，必須先釐清獲利波動'}；${evaluations.LONG.state==='QUALIFIED'?'既有長期觀察條件具備，仍須當次價格及完整品質審查':'需求、競爭優勢、資本投入與估值的完整證據仍須逐項核對'}。`,eps);
  else if(reported)longReason=claim('目前保留的是來源原報每股盈餘；單季或累計口徑未證明，不能直接相加為全年獲利，長期先保留判斷。',[reported]);
  else if(margins.length)longReason=claim('已有保留的毛利率觀測，但同口徑每股盈餘、資本支出與完整長期證據尚未備齊，先保留長期判斷。',margins);
  else longReason=claim('必要的長期公司證據尚未備齊，現有資料不足以確認長期研究假設。',[fallback]);
  const reasons={SHORT:shortReason,MEDIUM:mediumReason,LONG:longReason};
  for(const horizon of HORIZONS){
   const ev=evaluations[horizon],status=ev.state==='QUALIFIED'?'WATCH':ev.state==='REJECTED'?'WAIT':'INSUFFICIENT';
   const cited=new Set([reasons[horizon],...counters].flatMap(c=>c.evidence_ids));
   cards.push({symbol,company:p.company,horizon,status,reason:reasons[horizon],counter_evidence:counters,
    confirmation:ev.confirmation,invalidation:ev.invalidation,
    gaps:distinct([...(p.data_gaps??[]),...ev.reasons.map(r=>'RESEARCH_DIAGNOSTIC:'+r)]),
    sources:p.evidence.filter(e=>cited.has(e.id)).map(project),classification:'INFERENCE'});
  }
  const flowComplete=flows.length===10&&flows.every((r,i)=>r.period===expected.slice(-10)[i]&&r.basis==='SHARES'&&Number.isSafeInteger(r.values?.net_shares));
  const news=decoded.filter(r=>r.e.kind==='NEWS'&&r.e.symbol===symbol).map(r=>({id:r.e.id,
   title:typeof r.title==='string'?r.title.slice(0,180):'保留的公司來源背景，需開啟原件核對',source:r.e.source,
   published_at:r.e.published_at,received_at:r.e.available_at,retained_background:r.scope==='RETAINED_BACKGROUND_NOT_FRESH_SOURCE_CAPTURE',
   excerpt:typeof r.excerpt==='string'?r.excerpt.slice(0,500):null}));
  stocks.push({symbol,company:p.company,quote:latest?{date:latest.date,open:latest.open,high:latest.high,low:latest.low,close:latest.close,
    volume:latest.volume,amount:latest.amount,source:latest.e.source,available_at:latest.e.available_at,
    is_target_session:latest.date===batch.through,range_is_buy_zone:false}:null,
   revenues:revenues.map(field),institutional:{from:flows[0]?.period??null,through:flows.at(-1)?.period??null,
    net_shares:flowComplete?flows.reduce((s,r)=>s+r.values.net_shares,0):null,complete:flowComplete,unit:'SHARES',is_currency:false,rows:flows.map(field)},
   eps:eps.map(field),margins:margins.map(field),capex:capex.map(field),reported_eps:reported?field(reported):null,
   valuation:valuation?field(valuation):null,news,news_complete:false,diagnostic:evaluations,
   price_readiness:Object.fromEntries(HORIZONS.map(h=>[h,{status:'BLOCKED_REVIEW_REQUIRED',entry_range:null,wait_above:null,stop:null,target:null,
    reasons:distinct(['CURRENT_PRICE_METHOD_REVIEW_REQUIRED','CURRENT_SOURCE_USE_REVIEW_REQUIRED','CURRENT_EDITION_AND_INDEPENDENT_REVIEW_REQUIRED',
     ...(h==='LONG'?evaluations.LONG.reasons:['COMPANY_EVENTS_AND_CORPORATE_ACTIONS_REVIEW_REQUIRED']),
     ...(latest?.date===batch.through?[]:['TARGET_SESSION_PRICE_MISSING'])]),buy_ready:false}])),data_gaps:p.data_gaps??[]});
 }
 const body={schema:'DAILY_OFFLINE_REVIEWED_ANALYSIS_V1',provenance:'OFFLINE_REVIEWED',author_ref:AUTHOR_VERSION+'; deterministic author only; independent review pending',
  batch_id:batchId,cutoff:batch.cutoff,through:batch.through,prepared_at,expires_at,packet_hashes:batch.packet_hashes,cards,numeric_assertions:[],
  reference_jobs:[],model_generated:false,model_calls:0,member_published:false,publication_ready:false};
 const validation=await validateSnapshot(batchText,body,{now,expected_batch_id:batchId});
 if(validation.numeric_review_required||validation.counts.uncovered_numeric_literals)fail('AUTHOR_UNSUPPORTED_NUMERIC_CLAIM');
 const counts=Object.fromEntries(HORIZONS.map(h=>[h,Object.fromEntries(['WATCH','WAIT','AVOID','INSUFFICIENT'].map(s=>[s,cards.filter(c=>c.horizon===h&&c.status===s).length]))]));
 const artifact={schema:'ZERO_PAID_DAILY_DRAFT_V1',author_version:AUTHOR_VERSION,batch_id:batchId,data_through:batch.through,cutoff:batch.cutoff,
  prepared_at,expires_at,snapshot_hash:validation.snapshot_hash,packet_hashes:batch.packet_hashes,owner_only:true,model_generated:false,model_calls:0,production_writes:0,
  member_published:false,full_product_ready:false,counts,cards,symbols:stocks};
 const changes=await compareDrafts(previous,artifact,deps);
 const snapshotText=canonical(body),validationText=JSON.stringify(validation,null,2)+'\n';
 if(Buffer.byteLength(snapshotText)>2_000_000)fail('AUTHOR_PRIVATE_STAGE_BODY_LIMIT');
 return {body,artifact,diagnostics,changes,validation,
  prepared_request:{schema:'OFFLINE_REVIEWED_SNAPSHOT_PREPARED_REQUEST_V1',status:'PRIVATE_STAGE_INPUT_FULL_REVIEW_REQUIRED',
   rpc:'stage_offline_reviewed_analysis_snapshot_v1',args:{p_body_text:snapshotText,p_snapshot_hash:sha(snapshotText),p_validator_document_hash:sha(validationText)},
   model_calls:0,production_writes:0,member_published:false}};
}

export async function compareDrafts(previous,current,{snapshotHash}){
 if(!previous)return {schema:'ZERO_PAID_DRAFT_CHANGES_V1',state:'BASELINE',previous_batch_id:null,current_batch_id:current.batch_id,rows:[],ranking:false};
 if(!previous||previous.schema!=='ZERO_PAID_DAILY_DRAFT_V1'||previous.author_version!==current.author_version
  ||previous.owner_only!==true||previous.member_published!==false||!Array.isArray(previous.cards)||previous.cards.length!==216
  ||!previous.packet_hashes||Object.keys(previous.packet_hashes).length!==72
  ||!Array.isArray(previous.symbols)||previous.symbols.length!==72||Date.parse(previous.cutoff)>Date.parse(current.cutoff))fail('AUTHOR_PREVIOUS_SCOPE');
 const keys=previous.cards.map(c=>c.symbol+':'+c.horizon),currentKeys=current.cards.map(c=>c.symbol+':'+c.horizon);
 if(new Set(keys).size!==216||keys.slice().sort().join('|')!==currentKeys.slice().sort().join('|'))fail('AUTHOR_PREVIOUS_UNIVERSE');
 const rows=[];
 for(const c of current.cards){
  const before=previous.cards.find(p=>p.symbol===c.symbol&&p.horizon===c.horizon),oldStock=previous.symbols.find(s=>s.symbol===c.symbol),stock=current.symbols.find(s=>s.symbol===c.symbol);
  if(!oldStock)fail('AUTHOR_PREVIOUS_UNIVERSE');
  const fields=[];
  if(previous.packet_hashes[c.symbol]!==current.packet_hashes[c.symbol])fields.push('SOURCE_INPUT');
  if(before.status!==c.status)fields.push('STATUS');
  if(await snapshotHash(before.reason)!==await snapshotHash(c.reason))fields.push('REASON_OR_SOURCE');
  if(await snapshotHash(before.gaps)!==await snapshotHash(c.gaps))fields.push('DATA_GAPS');
  if(await snapshotHash(oldStock.quote)!==await snapshotHash(stock.quote))fields.push('PRICE_OBSERVATION');
  if(await snapshotHash(oldStock.news)!==await snapshotHash(stock.news))fields.push('NEWS');
  if(fields.length)rows.push({symbol:c.symbol,company:c.company,horizon:c.horizon,before:before.status,after:c.status,fields});
 }
 return {schema:'ZERO_PAID_DRAFT_CHANGES_V1',state:rows.length?'CHANGED':'UNCHANGED',previous_batch_id:previous.batch_id,current_batch_id:current.batch_id,rows,ranking:false};
}
