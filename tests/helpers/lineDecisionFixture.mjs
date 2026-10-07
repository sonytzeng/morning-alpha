/** Synthetic copy-contract examples, never Production evidence or a prediction. */
export function lineDecisionFixture() {
 const date='2026-10-07',revision='SYNTHETIC-REVISION',generated='2026-10-06T23:05:00Z';
 const section={executive_summary:{text:'市場偏多，台積電仍待量價確認，未確認前不追價。',evidence_refs:['MD001']},
  supporting_evidence:[{statement:'TSM ADR UP 1.25%',evidence_refs:['MD001']},{statement:'SOX DOWN -0.70%',evidence_refs:['MD002']}],
  counter_evidence:[{statement:'台指期仍待確認。',evidence_refs:['MD003']}],
  timeline:[{time:'08:30',question:'資料不足',success_condition:'資料不足',failure_condition:'資料不足'},
   {time:'09:00',question:'先看2330與台指期是否同向。',success_condition:'候選族群多數站上平盤且成交量放大。',failure_condition:'開盤反向跳空超過 1% 或 2330/台指期同步轉弱。'}],
  failure_scenario:{triggers:[{condition:'候選族群只有單一權值股表態。',evidence_required:['MD003']}]}};
 const state={schema_version:'CANONICAL_MARKET_STATE_V1',status:'READY',report_date:date,generated_at:generated,evidence_ids:['MD001','MD002','MD003'],
  document:{report_date:date,provenance:{generated_at:generated},sections:section,quality:{coverage_audit:{claims:['MD001','MD002','MD003'].map(id=>({supported:true,scope:'market',evidence_ids:[id]}))}}}};
 const gate={contract_version:'STOCK_RECOMMENDATION_GATE_V1',status:'BLOCKED',eligible:false,reason_codes:['recommendation_evaluation_evidence_insufficient'],screening:{status:'INCOMPLETE',universe_count:null,evaluated_count:null,rejected:[]},universe_evaluation_complete:false};
 return {tier:'admin',authenticated:true,report_date:date,revision_id:revision,generated_at:generated,
  subscriber_projection:{analysisAvailable:true,evidence:{status:'SUFFICIENT'},identity:{reportDate:date,revisionId:revision,generatedAt:generated},
   marketDecision:{bias:'偏多觀察',action:'WAIT'},recommendation:{status:'BLOCKED',available:false,items:[]}},
  payload:{revision_id:revision,canonical_decision:{id:revision,action:'WAIT'},recommendation_gate:gate,
   admin_source_report:{ai_strategy_json:{revision_id:revision,canonical_market_state:state,operational_market:{report_level:'DEGRADED',missing_evidence:['NEWS_CONTEXT']}}}}};
}
