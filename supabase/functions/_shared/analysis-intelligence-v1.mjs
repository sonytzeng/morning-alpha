// Owner-only research. No I/O, AI, production decision imports, writes or promotion.
import { evaluateOperationalCore } from './operational-market-contract.mjs';
import { validateAtomicCheckpointEvidenceRows } from './fetch-checkpoint-evidence.mjs';
import { previousMarketTradingDate, MARKET_CALENDAR_VERSION } from './market-session-contract.mjs';

export const ANALYSIS_VERSION = 'ANALYSIS_INTELLIGENCE_V1';
export const PROVIDERS = Object.freeze(['TAIEX','2330','TXF','SPX','IXIC','SOX','NVDA','TSM','VIX','DXY','US10Y']);
export const FEATURE_NORMALIZATION = Object.freeze({
  session_confirmation:'Boolean 1: inherited committed formal session contract; not directional confirmation.',
  return:'Observed percentage points; reference-only prices are null, never 0-filled.',
  risk_impulse:'clip(return percentage points × instrument risk sign / 2, -1, 1); experimental, uncalibrated.',
});
export const FEATURE_DEFINITIONS = Object.freeze(PROVIDERS.flatMap(provider => Object.entries(FEATURE_NORMALIZATION).map(([kind,normalization]) => ({
  feature_key:provider+':'+kind+':v1',version:1,normalization,
}))));
export const SIGNAL_RULES = Object.freeze({
  TAIEX:['TAIWAN_MARKET_STRUCTURE','台股大盤結構','IX0001',1],
  '2330':['TAIWAN_WEIGHTED_CONFIRMATION','台積電權值確認','2330',1],
  TXF:['TXF_CONFIRMATION','台指期確認','TXF1!',1],
  SPX:['US_RISK_ENVIRONMENT','美股廣泛風險（SPY 代理）','SPY',1],
  IXIC:['TECH_GROWTH_ENVIRONMENT','科技成長（QQQ 代理）','QQQ',1],
  SOX:['SEMICONDUCTOR_ENVIRONMENT','半導體（SOXX 代理）','SOXX',1],
  NVDA:['AI_SEMICONDUCTOR_CONFIRMATION','AI 半導體確認','NVDA',1],
  TSM:['SEMICONDUCTOR_ENVIRONMENT','台積電 ADR 確認','TSM',1],
  VIX:['VOLATILITY_RISK','波動風險（VXX 代理）','VXX',-1],
  DXY:['USD_PRESSURE','美元壓力（UUP 代理）','UUP',-1],
  // IEF is a Treasury bond PRICE proxy, not a yield. Positive price is inverse yield pressure.
  US10Y:['YIELD_PRESSURE','債券價格／反向利率壓力（IEF 代理）','IEF',1],
});
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const round = value => Math.round(value * 10000) / 10000;
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const direction = value => value > 0.1 ? 'BULLISH' : value < -0.1 ? 'BEARISH' : 'NEUTRAL';
const directionText = { BULLISH:'偏多', BEARISH:'偏空', NEUTRAL:'中性' };
const uniq = values => [...new Set(values)].sort();
export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+stableJson(value[k])).join(',') + '}';
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('NONFINITE_RESEARCH_VALUE');
  if (value === undefined) throw new Error('UNDEFINED_RESEARCH_VALUE');
  return JSON.stringify(value);
}
export async function predictionHash(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)));
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

function validateInput(input) {
  if (input?.schema_version !== 'ANALYSIS_INPUT_V1' || !['FORWARD','HISTORICAL_REPLAY'].includes(input.observation_kind)) throw new Error('RESEARCH_INPUT_CONTRACT');
  const cutoff=time(input.analysis_cutoff_at), day=input.core?.business_date;
  if (!Number.isFinite(cutoff) || new Date(cutoff+8*3600000).toISOString().slice(0,10)!==day
    || cutoff >= time(day+'T09:00:00+08:00')) throw new Error('RESEARCH_MORNING_CUTOFF');
  const gate=evaluateOperationalCore({...input.core,observed_at:input.analysis_cutoff_at});
  if (gate.status !== 'READY') throw new Error('RESEARCH_CORE_UNAVAILABLE:'+gate.reason_codes.join(','));
  for (const row of input.core.rows) {
    if (!row.id || !Number.isFinite(time(row.created_at)) || time(row.created_at)>cutoff
      || time(row.captured_at)>cutoff || time(row.source_timestamp)>cutoff) throw new Error('RESEARCH_LOOKAHEAD');
  }
  if (input.enhancements?.observed_at && (!Number.isFinite(time(input.enhancements.observed_at)) || time(input.enhancements.observed_at)>cutoff)) throw new Error('RESEARCH_ENHANCEMENT_LATE');
  if (input.production && (!Number.isFinite(time(input.production.created_at)) || time(input.production.created_at)>cutoff
    || input.production.business_date!==day)) throw new Error('RESEARCH_PRODUCTION_COMPARISON_LATE');
  if (!Array.isArray(input.registry) || PROVIDERS.some(k=>!input.registry.some(f=>f.feature_key===k && f.version===1))) throw new Error('RESEARCH_REGISTRY_MISMATCH');
  if(FEATURE_DEFINITIONS.some(def=>!input.registry.some(f=>f.feature_key===def.feature_key && f.version===def.version && f.normalization===def.normalization))) throw new Error('RESEARCH_FEATURE_VERSION_DRIFT');
}

function compute(input) {
  validateInput(input);
  const day=input.core.business_date, cutoff=input.analysis_cutoff_at;
  const features=[], signals=[];
  for (const key of PROVIDERS) {
    const row=input.core.rows.find(r=>r.provider_key===key), rule=SIGNAL_RULES[key];
    if(row.raw.source_symbol!==rule[2]) throw new Error('RESEARCH_UNREVIEWED_INSTRUMENT:'+key);
    const reference=/REFERENCE/.test(row.raw.source_raw?.price_basis || '')
      || (['TAIEX','2330'].includes(key) && !row.raw.source_raw?.price_basis);
    // Reference-only premarket prices cannot prove a 0% market return.
    const available=!reference;
    const change=available ? Number(row.change_percent) : null;
    const impulse=available ? round(clamp(change*rule[3]/2,-1,1)) : null;
    const base={feature_version:1,registry_key:key,registry_version:1,source_evidence_id:row.id,
      observed_at:row.created_at,business_date:day,source_instrument:rule[2],quality:available?'AVAILABLE':'UNAVAILABLE',
      reason:available?'COMMITTED_CONTRACT_VALID':'REFERENCE_PRICE_IS_NOT_OBSERVED_RETURN'};
    features.push({...base,feature_id:key+':session_confirmation:v1',value:1,quality:'AVAILABLE',reason:'COMMITTED_CONTRACT_VALID',normalization:FEATURE_NORMALIZATION.session_confirmation});
    features.push({...base,feature_id:key+':return:v1',value:change,normalization:FEATURE_NORMALIZATION.return});
    features.push({...base,feature_id:key+':risk_impulse:v1',value:impulse,normalization:FEATURE_NORMALIZATION.risk_impulse});
    const proxy=!['TAIEX','2330','TXF','NVDA','TSM'].includes(key);
    signals.push({signal_id:key+':signal:v1',signal_version:1,provider:key,signal_type:rule[0],label:rule[1],
      status:available?'AVAILABLE':'UNAVAILABLE',direction:available?direction(change*rule[3]):null,
      strength:available?round(Math.abs(impulse)*100):null,confidence:available?(proxy?65:80):null,
      evidence_ids:[row.id],feature_ids:[key+':return:v1',key+':risk_impulse:v1'],
      regime_dependency:['EXPERIMENTAL_ALL_REGIMES_UNCALIBRATED'],analysis_cutoff_at:cutoff,
      reason:available?'INSTRUMENT_SIGNED_RETURN_RULE_V1':'REFERENCE_PRICE_IS_NOT_OBSERVED_RETURN',
      signed_impulse:impulse,interpretation_type:'DETERMINISTIC_RULE'});
  }
  const get=key=>signals.find(s=>s.provider===key);
  const cross=(id,label,keys,expected)=>{
    const parts=keys.map(get), ready=parts.every(s=>s.status==='AVAILABLE');
    const matches=ready && parts.every((s,i)=>s.direction===expected[i]);
    return {signal_id:id,signal_version:1,label,signal_type:id,status:ready?'AVAILABLE':'UNAVAILABLE',
      direction:matches ? expected[0] : ready?'NEUTRAL':null,
      strength:ready?(matches?Math.min(...parts.map(s=>s.strength)):0):null,
      confidence:ready?Math.min(...parts.map(s=>s.confidence)):null,
      constituent_signal_ids:parts.map(s=>s.signal_id),evidence_ids:uniq(parts.flatMap(s=>s.evidence_ids)),
      feature_ids:uniq(parts.flatMap(s=>s.feature_ids)),analysis_cutoff_at:cutoff,reason:matches?'ALL_COMPONENTS_CONFIRM':ready?'COMPONENTS_DO_NOT_CONFIRM':'COMPONENT_UNAVAILABLE'};
  };
  const cross_signals=[cross('SEMICONDUCTOR_RISK_ON_CONFIRMATION','半導體與波動風險共同確認',['SOX','TSM','VIX'],['BULLISH','BULLISH','BULLISH']),
    cross('TAIWAN_CONFIRMATION_MISSING','期貨與權值股轉弱',['TXF','2330'],['BEARISH','BEARISH']),
    cross('GLOBAL_RISK_CONFIRMATION','全球風險共同確認',['SPX','IXIC','VIX'],['BULLISH','BULLISH','BULLISH'])];
  const available=signals.filter(s=>s.status==='AVAILABLE'), directional=available.filter(s=>s.direction!=='NEUTRAL');
  const bull=directional.filter(s=>s.direction==='BULLISH').length, bear=directional.filter(s=>s.direction==='BEARISH').length;
  const conflict=directional.length ? round(200*Math.min(bull,bear)/directional.length):0;
  const mean=available.reduce((n,s)=>n+s.signed_impulse,0)/Math.max(1,available.length);
  const mainDirection=direction(mean*2);
  const enhancements=input.enhancements || {};
  const missing=uniq([...(enhancements.missing_evidence || ['RESEARCH_CONTEXT']),
    ...signals.filter(s=>s.status!=='AVAILABLE').map(s=>s.provider+':RETURN_UNAVAILABLE')]);
  const knownEnhancement=enhancements.observed_at && enhancements.evidence_ids?.length>0;
  if(!knownEnhancement && !missing.includes('RESEARCH_CONTEXT')) missing.push('RESEARCH_CONTEXT');
  const evidenceScore=100, agreement=directional.length?round(100*Math.max(bull,bear)/directional.length):0;
  const strength=round(available.reduce((n,s)=>n+s.strength,0)/Math.max(1,available.length));
  const quality=round(available.reduce((n,s)=>n+s.confidence,0)/11);
  const components={evidence_score:evidenceScore,agreement_score:agreement,strength_score:strength,data_quality_score:quality,
    conflict_penalty:round(conflict*0.4),missing_penalty:Math.min(40,missing.length*5)};
  const confidence=round(clamp(0.2*evidenceScore+0.3*agreement+0.2*strength+0.3*quality-components.conflict_penalty-components.missing_penalty));
  const localConfirmed=['TAIEX','2330','TXF'].every(k=>get(k).direction==='BULLISH');
  const highRisk=get('VIX').direction==='BEARISH' || get('DXY').direction==='BEARISH' || conflict>=60
    || cross_signals.find(s=>s.signal_id==='TAIWAN_CONFIRMATION_MISSING').direction==='BEARISH';
  const crossConfirmed=cross_signals.some(s=>['SEMICONDUCTOR_RISK_ON_CONFIRMATION','GLOBAL_RISK_CONFIRMATION'].includes(s.signal_id) && s.direction==='BULLISH');
  const decision={shadow_regime:conflict>=50 || mainDirection==='NEUTRAL'?'range':mainDirection==='BULLISH'?'risk_on':'risk_off',
    shadow_direction:mainDirection,shadow_risk:highRisk?'HIGH':missing.length?'ELEVATED':'NORMAL',
    shadow_action:mainDirection==='BEARISH' && confidence>=40?'AVOID':localConfirmed && crossConfirmed && mainDirection==='BULLISH' && confidence>=65 && conflict<30?'ENTER':'WAIT',
    shadow_confidence:confidence,confidence_kind:'EVIDENCE_CONFIDENCE_UNCALIBRATED',confidence_components:components};
  const ranked=available.map(s=>({...s,contribution:round(s.strength*s.confidence/100)})).sort((a,b)=>b.contribution-a.contribution || b.strength-a.strength || b.confidence-a.confidence || a.signal_id.localeCompare(b.signal_id));
  // For a neutral decision show BOTH directional camps; do not silently discard contradictions.
  const referenceDirection=mainDirection==='NEUTRAL'?(bull>=bear?'BULLISH':'BEARISH'):mainDirection;
  const supporting=ranked.filter(s=>s.direction===referenceDirection);
  const contradicting=ranked.filter(s=>s.direction!=='NEUTRAL' && s.direction!==referenceDirection);
  const invalidation_conditions=['TAIEX','2330','TXF','VIX','SOX'].map(key=>({
    invalidation_id:key+':invalidation:v1',provider:key,signal_id:get(key).signal_id,
    rule:mainDirection==='NEUTRAL'?'DIRECTION_BECOMES_NON_NEUTRAL':'DIRECTION_BECOMES_OPPOSITE',
    original_direction:mainDirection,threshold_percentage_points:0.1,
    description:mainDirection==='NEUTRAL'?`${SIGNAL_RULES[key][1]}出現超過 0.1 個百分點的方向訊號，重新評估等待判斷。`
      :`${SIGNAL_RULES[key][1]}的風險調整漲跌幅越過反向 0.1 個百分點，原${directionText[mainDirection]}判斷失效。`,
    status:'NOT_EVALUATED',evidence_ids:get(key).evidence_ids,
  }));
  const nodes=[...input.core.rows.map(r=>({id:r.id,type:'EVIDENCE',version:1})),...features.map(f=>({id:f.feature_id,type:'FEATURE',version:1})),
    ...signals.map(s=>({id:s.signal_id,type:'SIGNAL',version:1})),...cross_signals.map(s=>({id:s.signal_id,type:'CROSS_SIGNAL',version:1})),
    {id:'shadow-decision',type:'DECISION',version:1},...invalidation_conditions.map(i=>({id:i.invalidation_id,type:'INVALIDATION',version:1}))];
  const edges=[...features.map(f=>({from:f.source_evidence_id,to:f.feature_id,type:'DERIVES',version:1})),
    ...signals.flatMap(s=>s.feature_ids.map(id=>({from:id,to:s.signal_id,type:'SUPPORTS_RULE',version:1}))),
    ...cross_signals.flatMap(s=>s.constituent_signal_ids.map(id=>({from:id,to:s.signal_id,type:'COMBINES',version:1}))),
    ...cross_signals.map(s=>({from:s.signal_id,to:'shadow-decision',type:'CONFIRMATION_GATE',version:1})),
    ...signals.map(s=>({from:s.signal_id,to:'shadow-decision',type:s.status!=='AVAILABLE'?'MISSING':contradicting.some(c=>c.signal_id===s.signal_id)?'CONTRADICTS':'INFORMS',version:1})),
    ...invalidation_conditions.map(i=>({from:'shadow-decision',to:i.invalidation_id,type:'INVALIDATED_BY',version:1}))];
  return {schema_version:ANALYSIS_VERSION,methodology_version:1,mode:'SHADOW_ONLY',production_eligible:false,
    business_date:day,analysis_cutoff_at:cutoff,observation_kind:input.observation_kind,
    report_level:enhancements.report_level || 'UNAVAILABLE',features,signals,cross_signals,
    supporting_signals:supporting.map(s=>s.signal_id),contradicting_signals:contradicting.map(s=>s.signal_id),
    contradiction_reference_direction:referenceDirection,signal_conflict_score:conflict,missing_signals:missing.sort(),
    decision,invalidation_conditions,graph:{version:1,nodes,edges},
    quality:{evidence_coverage:100,signal_coverage:round(available.length/11*100),contradiction_coverage:100,
      change_detection:'UNAVAILABLE',invalidation_presence:invalidation_conditions.length,traceability:100,analysis_value:'INSUFFICIENT_SAMPLE'},
    // Comparison is downstream-only; this object is never read above to compute the Shadow decision.
    production_comparison:input.production || null,
    unavailable_features:['GAP','MOMENTUM','REALIZED_VOLATILITY'],
    cost:{ai_call_count:0,input_tokens:0,output_tokens:0,ai_cost_usd:0,compute_cost_usd:null,compute_cost_status:'INFRASTRUCTURE_BILLING_NOT_MEASURED'},
  };
}

// One resolver for the worker and offline replay. No nearest-row/report/lifecycle
// fallback: only the actual preceding TW trading day can be comparable in V1.
export function resolvePreviousValidComparison(input, previousInput = null) {
  const expected=previousMarketTradingDate('TW',input.core.business_date);
  const metadata={contract:'PREVIOUS_VALID_COMPARISON_V1',calendar_version:MARKET_CALENDAR_VERSION,
    previous_trading_day:expected,previous_comparable_evidence_day:null,status:'UNAVAILABLE',
    reason:'PREVIOUS_COMPARISON_UNAVAILABLE',missing_component:'PREVIOUS_DAY_COMPARISON',detail:'EVIDENCE_MISSING'};
  const unavailable=detail=>({metadata:{...metadata,detail},previous:null});
  if(!expected) return unavailable('CALENDAR_COVERAGE_MISSING');
  if(!previousInput) return unavailable('EVIDENCE_MISSING');
  if(previousInput.core?.business_date!==expected) return unavailable('NOT_PREVIOUS_TRADING_DAY');
  if(!Number.isFinite(time(previousInput.analysis_cutoff_at)) || time(previousInput.analysis_cutoff_at)>=time(input.analysis_cutoff_at))
    return unavailable('COMPARISON_CUTOFF_INVALID');
  let previous;
  try { previous=compute(previousInput); }
  catch(error) {
    if(!(error instanceof Error) || !error.message.startsWith('RESEARCH_')) throw error;
    return unavailable('PREVIOUS_EVIDENCE_CONTRACT_INVALID');
  }
  return {metadata:{...metadata,previous_comparable_evidence_day:expected,status:'AVAILABLE',reason:null,missing_component:null,detail:null},previous};
}

export function analyzeIntelligence(input, previousInput = null) {
  // Current core is deliberately outside the enhancement failure boundary.
  const result=compute(input);
  const {metadata,previous}=resolvePreviousValidComparison(input,previousInput);
  result.previous_comparison=metadata;
  result.previous_trading_day=metadata.previous_trading_day;
  result.previous_comparable_evidence_day=metadata.previous_comparable_evidence_day;
  result.previous_valid_business_date=metadata.previous_comparable_evidence_day;
  result.quality.core_evidence_coverage=100;
  result.quality.missing_components=previous?[]:['PREVIOUS_DAY_COMPARISON'];
  result.quality.analysis_quality=previous?'CURRENT_AND_COMPARISON_VALID':'CURRENT_VALID_COMPARISON_UNAVAILABLE';
  if(!previous) {
    result.what_changed=[];
    result.missing_signals=uniq([...result.missing_signals,'PREVIOUS_DAY_COMPARISON']);
    result.quality.evidence_coverage=round(100*11/12);
    const c=result.decision.confidence_components;
    c.previous_comparison_penalty=5;
    c.evidence_score=result.quality.evidence_coverage;
    result.decision.shadow_confidence=round(clamp(result.decision.shadow_confidence-5-0.2*(100-c.evidence_score)));
    if((result.decision.shadow_action==='ENTER' && result.decision.shadow_confidence<65)
      || (result.decision.shadow_action==='AVOID' && result.decision.shadow_confidence<40)) result.decision.shadow_action='WAIT';
    return result;
  }
  const changes=[];
  for(const current of result.signals) {
    const old=previous?.signals.find(s=>s.provider===current.provider);
    const type=current.status!=='AVAILABLE'?(old?.status==='AVAILABLE'?'DISAPPEARED':'UNCHANGED')
      :!old || old.status!=='AVAILABLE'?'NEW_SIGNAL':old.direction!==current.direction?'REVERSED'
      :current.strength>old.strength?'STRENGTHENED':current.strength<old.strength?'WEAKENED':'UNCHANGED';
    const meanings={NEW_SIGNAL:'首次取得可解讀的訊號',
      STRENGTHENED:current.direction==='BEARISH'?'偏空證據增強，風險壓力上升':'偏多證據增強，風險資產支持增加',
      WEAKENED:current.direction==='BEARISH'?'偏空證據減弱，風險壓力下降':'偏多證據減弱，支持力道下降',
      REVERSED:`由${directionText[old?.direction] || '不可用'}轉為${directionText[current.direction] || '不可用'}，需重新確認`,
      UNCHANGED:current.status!=='AVAILABLE'?'兩日方向資料皆不足，無法判斷變化':'沒有新增方向變化',DISAPPEARED:'訊號不可用，不沿用舊值'};
    changes.push({key:current.provider,type,meaning:`${current.label}：${previous?meanings[type]:'缺少上一個有效交易日對照；不推斷改善或惡化'}。`,
      previous_business_date:previous?.business_date || null,previous_direction:old?.direction || null,direction:current.direction,
      evidence_ids:current.evidence_ids,previous_evidence_ids:old?.evidence_ids || [],feature_ids:current.feature_ids,signal_ids:[current.signal_id]});
  }
  for(const [key,value,old] of [
    ['REGIME',result.decision.shadow_regime,previous?.decision.shadow_regime],
    ['DIRECTION',result.decision.shadow_direction,previous?.decision.shadow_direction],
    ['RISK',result.decision.shadow_risk,previous?.decision.shadow_risk],
    ['EVIDENCE_COMPLETENESS',result.missing_signals.join(','),previous?.missing_signals.join(',')],
    ...result.cross_signals.map(s=>[s.signal_type,s.direction,previous?.cross_signals.find(p=>p.signal_type===s.signal_type)?.direction])]) {
    const changeLabel={REGIME:'市場型態',DIRECTION:'市場方向',RISK:'風險',EVIDENCE_COMPLETENESS:'證據完整度',
      GLOBAL_RISK_CONFIRMATION:'全球風險確認',SEMICONDUCTOR_RISK_ON_CONFIRMATION:'半導體風險確認',TAIWAN_CONFIRMATION_MISSING:'台灣確認條件'}[key];
    changes.push({key,type:!previous?'NEW_SIGNAL':value===old?'UNCHANGED':'REVERSED',meaning:changeLabel+'：'+(!previous?'無前一有效交易日對照':value===old?'判斷維持不變':'結構化條件已改變，需重新確認'),
      previous_business_date:previous?.business_date || null,previous_value:old ?? null,value,
      evidence_ids:uniq(result.signals.flatMap(s=>s.evidence_ids)),previous_evidence_ids:previous?uniq(previous.signals.flatMap(s=>s.evidence_ids)):[],
      feature_ids:result.features.map(f=>f.feature_id),signal_ids:result.signals.map(s=>s.signal_id)});
  }
  result.what_changed=changes;
  result.previous_valid_business_date=previous?.business_date || null;
  result.quality.change_detection=previous?'AVAILABLE':'UNAVAILABLE';
  return result;
}

// Later observations are separate and append-only; never rewrite the morning graph.
export function evaluateInvalidations(analysis, laterAnalysis) {
  if(laterAnalysis.business_date!==analysis.business_date || time(laterAnalysis.analysis_cutoff_at)<=time(analysis.analysis_cutoff_at)) throw new Error('INVALIDATION_OBSERVATION_TIME');
  return analysis.invalidation_conditions.map(condition=>{
    const signal=laterAnalysis.signals.find(s=>s.provider===condition.provider);
    const available=signal?.status==='AVAILABLE';
    const triggered=condition.original_direction==='NEUTRAL'?signal?.direction!=='NEUTRAL'
      :signal?.direction!==condition.original_direction && signal?.direction!=='NEUTRAL';
    return {...condition,status:!available?'UNAVAILABLE':triggered?'TRIGGERED':'NOT_TRIGGERED',
      observed_at:laterAnalysis.analysis_cutoff_at,observation_evidence_ids:signal?.evidence_ids || []};
  });
}

export function observeInvalidations(analysis, observation) {
  const core=observation.core,proof=core?.integrity,batch=core?.batch,rows=core?.rows;
  if (!core || core.business_date!==analysis.business_date || !['0900','0930','1030','1300','1410','1430'].includes(batch?.checkpoint)
    || proof?.status!=='PASS' || proof.contract!=='MARKET_CHECKPOINT_ATOMICITY_V1'
    || proof.batch_id!==batch.batch_id || proof.correlation_id!==batch.correlation_id
    || proof.checkpoint!==batch.checkpoint || proof.business_date!==core.business_date
    || proof.payload_hash!==batch.payload_hash || batch.status!=='COMMITTED'
    || batch.expected_provider_count!==11 || batch.committed_provider_count!==11
    || !Number.isFinite(time(observation.observed_at)) || time(batch.committed_at)>time(observation.observed_at)
    || !validateAtomicCheckpointEvidenceRows(rows).valid) throw Error('INVALIDATION_CORE_CONTRACT');
  for(const [key,n] of Object.entries({canonical_row_count:11,unbatched_row_count:0,committed_batch_count:1,distinct_batch_id_count:1,
    distinct_provider_count:11,duplicate_authoritative_provider_count:0,compatibility_row_count:11,compatibility_provider_count:11,
    compatibility_mismatch_count:0,mixed_batch_revision_count:0})) if(proof[key]!==n)throw Error('INVALIDATION_INTEGRITY');
  if(rows.some(r=>r.batch_id!==batch.batch_id || r.correlation_id!==batch.correlation_id || r.trading_date!==analysis.business_date
    || r.checkpoint!==batch.checkpoint || r.idempotency_key!==batch.idempotency_key || !r.id
    || !Number.isFinite(time(r.created_at)) || time(r.created_at)>time(observation.observed_at)
    || time(r.captured_at)>time(batch.committed_at) || time(r.source_timestamp)>time(r.created_at))) throw Error('INVALIDATION_ASOF_LINEAGE');
  const signals=PROVIDERS.map(key=>{
    const row=rows.find(r=>r.provider_key===key),rule=SIGNAL_RULES[key];
    if(row.raw.source_symbol!==rule[2])throw Error('INVALIDATION_INSTRUMENT');
    return {provider:key,status:/REFERENCE/.test(row.raw.source_raw?.price_basis || '')?'UNAVAILABLE':'AVAILABLE',
      direction:direction(Number(row.change_percent)*rule[3]),evidence_ids:[row.id]};
  });
  return evaluateInvalidations(analysis,{business_date:core.business_date,analysis_cutoff_at:observation.observed_at,signals});
}
