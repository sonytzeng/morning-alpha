/** Frontend-owned wire DTOs. Types only; no evaluator, provider or backend import.
 * Equality against the actual backend exports is checked independently in tests. */
import type {Evidence,Score} from '../features/decision-v1/contract';

export type Strategy='OVERSOLD_REVERSAL'|'PULLBACK_ENTRY'|'BREAKOUT_CONTINUATION';
export type EntryState='ENTRY_READY'|'WAIT_CONFIRMATION'|'AVOID_ENTRY'|'INSUFFICIENT_EVIDENCE';
export type EntryResult={symbol:string;name:string|null;strategy:Strategy;strategy_version:string;
 status:EntryState;market_direction:string|null;market_regime:string|null;entry_environment:string;
 opportunity_quality:'CONFIRMED_RESEARCH_SETUP'|'CONDITIONAL'|'UNFAVORABLE'|'UNKNOWN';
 evidence_confidence:{completeness:number;probability:null;calibration:'INSUFFICIENT_SAMPLE'};
 reasons:string[];entry_trigger:string|null;invalidation:string|null;
 plan:null|{not_before:string;expires_on:string;reference_range:[number,number];trigger:number;stop:number;
  target:number;target_basis:string;risk_distance:number;reward_space:number;reward_risk:number;max_risk:number};
 metrics:Record<string,number>;evidence_refs:string[];v2_status:string|null;horizons:readonly number[]};
export type EntryPolicy=Readonly<{minAmount:50000000;minRewardRisk:2;maxRisk:0.08;
 oversoldATR:2;supportATR:1;extensionATR:2;breakoutVolume:1.5;rangeATR:0.25;
 costModel:'CONSERVATIVE_ILLUSTRATIVE_TW_CASH_1';buyFee:0.001425;sellFee:0.001425;
 sellTax:0.003;slippageEachSide:0.001;minimumFeeUnmodelled:true}>;
// These fields intentionally retain the backend's inferred string/boolean
// widening. A frontend declaration must not promise narrower wire values.
export type EntryEvaluation={version:string;source_revision:string;source_evidence_hash:string;evidence_hash:string;
 business_date:string;evaluation_time:string;mode:'HISTORICAL_REPLAY'|'FORWARD';provenance:'REAL_RETAINED'|'SYNTHETIC_TEST';
 policy:EntryPolicy;owner_only:boolean;shadow_only:boolean;production_eligible:boolean;market_direction_independent:boolean;
 universe:number;scanned:number;candidates:EntryResult[];counts:Record<string,number>;
 forward_sample:number;outcome_sample:number;analysis_value:string};

export type EvaluationPhase='PREMARKET'|'INTRADAY';
export type PhaseStatus='PREMARKET_WATCH'|'PREMARKET_READY'|'PREMARKET_NONE'|'READY'|'NONE'|'BLOCKED';
export type PhaseCandidate={symbol:string;status:'WATCH'|'READY'|'NONE'|'DROP'|'BLOCKED';reasons:string[];
 post_event_price:'NOT_YET_OBSERVABLE'|'PASS'|'FAIL'|'MISSING';post_event_volume:'NOT_YET_OBSERVABLE'|'PASS'|'FAIL'|'MISSING';
 evidence_ids:string[];relative_strength?:boolean;risk_pass?:boolean};
export type PhaseEvaluation={evaluation_phase:EvaluationPhase;status:PhaseStatus;universe_count:number;evaluated_count:number;
 watch_count:number;ready_count:number;none_count:number;blocked_count:number;not_yet_observable_count:number;
 reason_distribution:Record<string,number>;candidates:PhaseCandidate[]};
export type LabPhaseFunnel={
 premarket:{universe:number;scanned:number;liquidity:number;market_fit:number;sector_fit:number;evidence:number;
  watch:number;ready:number;none:number;blocked:number;not_yet_observable:number};
 intraday:{watch_input:number|null;price_confirmed:number|null;volume_confirmed:number|null;relative_strength:number|null;
  risk:number|null;entry:number|null;ready:number|null;drop:number|null};watch_lineage:string;liquidity_definition:string};
type LabStage='LIQUIDITY'|'MARKET_FIT'|'SECTOR_FIT'|'RELATIVE_MOMENTUM'|'EVIDENCE'|'RISK'|'ENTRY';
type LabStageLabel='流動性'|'市場配合'|'產業配合'|'相對強弱／動能'|'公司證據完整'|'風險通過'|'進場確認';
export type LabDiscovery={version:string;scope:string;scanned:number;phase_evaluation:PhaseEvaluation|null;phase_funnel:LabPhaseFunnel|null;
 premarket_watch:{symbol:string;name:string;status:string;entry_pending:boolean;formal_recommendation:boolean;
  post_event_price:PhaseCandidate['post_event_price'];post_event_volume:PhaseCandidate['post_event_volume'];reasons:string[]}[];
 universe_complete:boolean;failures:string[];funnel:{key:LabStage;label:LabStageLabel;before:number;passed:number;excluded:number;reasons:string[]}[];
 details:{symbol:string;reasons:string[]}[];
 watchlist:{symbol:string;name:string;status:string;why:string;score:Score;sector:string;market_fit:string;relative_strength:number;
  momentum:number|null;risk:Score|null;entry_condition:string;invalidation:string[];evidence:Evidence[]}[];
 formal_status:string;formal_reason:string;first_blocked_gate:LabStageLabel|null;
 availability:{price:string;volume:string;industry:string;institutional:string;chips:string;fundamentals:string;revenue:string;news:string;catalyst:string}};
// Preserve the actual two return branches, including the coupled null metrics.
export type LabPerformance=
 {win_rate:null;average_win:null;average_loss:null;expectancy:null;profit_factor:null;max_drawdown:null;
  sample:number;sample_label:string;kind:string;fees:string;mfe:null;mae:null}
 |{win_rate:number;average_win:number|null;average_loss:number|null;expectancy:number;profit_factor:number|null;max_drawdown:number;
  sample:number;sample_label:string;kind:string;fees:string;mfe:null;mae:null};
