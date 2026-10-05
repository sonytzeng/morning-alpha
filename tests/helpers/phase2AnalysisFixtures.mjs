import { readFileSync } from 'node:fs';
import { FEATURE_DEFINITIONS } from '../../supabase/functions/_shared/analysis-intelligence-v1.mjs';
const json=path=>JSON.parse(readFileSync(new URL('../fixtures/'+path,import.meta.url),'utf8'));
export const retained=json('phase2-analysis/production-cores.json');
export const publicDay=json('public-projection/production-20261002.json');
export const researchContexts=json('phase2-analysis/research-context.json').rows;
const registry=[...['TAIEX','2330','TXF','SPX','IXIC','SOX','NVDA','TSM','VIX','DXY','US10Y'].map(feature_key=>({feature_key,version:1})),...FEATURE_DEFINITIONS];
export function realInput(day) {
  const core=structuredClone(retained.days.find(d=>d.business_date===day));
  const cutoff=day+'T07:30:00+08:00';
  let enhancements={observed_at:null,evidence_ids:[],report_level:'UNAVAILABLE',missing_evidence:['RESEARCH_CONTEXT']};
  let production=null;
  if(day==='2026-10-01') {
    const r=json('operational-market-core-20261001.json').research_attempts[0];
    enhancements={observed_at:r.at,evidence_ids:[r.evidence_id],report_level:'DEGRADED',missing_evidence:['NEWS_CONTEXT']};
  }
  if(day==='2026-10-02') {
    const s=publicDay.tables.decision_snapshots.find(s=>s.generated_text.market_report_gate);
    const r=researchContexts.find(r=>r.trading_date===day);
    const op=s.generated_text.market_report_gate.operational_market;
    enhancements={observed_at:r.created_at,evidence_ids:[r.id],report_level:op.report_level,missing_evidence:op.missing_evidence};
    production={id:s.id,business_date:day,created_at:s.created_at,market_regime:s.market_regime,
      direction:s.generated_text.market_bias,action:s.action,confidence:s.confidence_score};
  }
  return {schema_version:'ANALYSIS_INPUT_V1',observation_kind:'HISTORICAL_REPLAY',analysis_cutoff_at:cutoff,
    core:{...core,observed_at:cutoff},registry,enhancements,production,
    previous_valid_business_date:day==='2026-10-02'?'2026-10-01':day==='2026-10-01'?'2026-09-30':null};
}
