/** Offline copy replay envelope. Captured market fields are real; this envelope
 * is NOT an authenticated HTTP capture or an Owner/RLS test. No network writes. */
export function lineReplayEnvelope(c) {
 if(c.snapshot_matches!==true||c.publication!=='PUBLISHED')throw Error('CAPTURE_NOT_CANONICAL');
 const {report_date:date,revision_id:revision,generated_at:generated}=c;
 return {tier:'admin',authenticated:true,report_date:date,revision_id:revision,generated_at:generated,
  subscriber_projection:{analysisAvailable:true,evidence:{status:'SUFFICIENT'},identity:{reportDate:date,revisionId:revision,generatedAt:generated},
   marketDecision:{bias:c.bias,action:c.action},recommendation:{status:c.recommendation_gate.status,available:c.recommendation_gate.eligible,items:[]}},
  payload:{revision_id:revision,canonical_decision:{id:revision,action:c.action},recommendation_gate:c.recommendation_gate,
   admin_source_report:{ai_strategy_json:{revision_id:revision,canonical_market_state:c.canonical_market_state,operational_market:c.operational_market}}}};
}
