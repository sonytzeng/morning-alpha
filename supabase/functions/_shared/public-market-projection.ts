import { buildPublicMarketReadModel, PUBLIC_CHECKPOINTS, type PublicMarketInput } from '../../../shared/public-market-read-model.ts';
type Row = Record<string, unknown>;
const object = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
type Client = { rpc: (name: string, args: Row) => PromiseLike<{data: unknown; error: unknown}> };

/** The same immutable batch/proof read is used by every website page. No rank,
 * dispatch success, browser time, or mutable compatibility cache supplies PASS. */
export async function publicCheckpointInputs(client: Client, date: string): Promise<{batches: Row[]; proofs: Row[]}> {
  const result = await client.rpc('public_market_checkpoint_inputs_v1', {p_business_date:date});
  if (result.error) throw Error('PUBLIC_CHECKPOINT_READ_FAILED');
  const input=object(result.data);
  if (!Array.isArray(input.batches) || !Array.isArray(input.proofs)) throw Error('PUBLIC_CHECKPOINT_READ_INVALID');
  return {batches:input.batches.map(object),proofs:input.proofs.map(object)};
}

export function publicMarketInput(payload: Row, snapshot: Row, member: Row, learning: Row,
  evidence: {batches:Row[];proofs:Row[]}, observedAt:string): PublicMarketInput {
  const projection=object(payload.subscriber_projection), identity=object(projection.identity), closing=object(projection.closing);
  const recommendation=object(projection.recommendation), decision=object(projection.marketDecision), close=object(closing.result);
  const learningValid=learning.run_date===payload.report_date && ['completed','succeeded','COMPLETED','SUCCEEDED'].includes(String(learning.status))
    && Number.isFinite(Date.parse(String(learning.completed_at))) && Date.parse(String(learning.completed_at))<=Date.parse(observedAt);
  return {business_date:String(payload.report_date),canonical_revision:String(snapshot.id),decision_version:Number(snapshot.version),
    member_revision:String(member.id??''),member_version:Number(member.revision),member_snapshot_id:String(member.decision_snapshot_id??''),
    member_snapshot_version:Number(member.decision_snapshot_version),market_regime:String(snapshot.market_regime??''),
    market_direction:String(decision.bias??''),action:String(snapshot.action??''),generated_at:String(identity.generatedAt??''),observed_at:observedAt,
    publication_verified:projection.analysisAvailable===true,report_level:projection.reportLevel==='FULL'?'FULL':'DEGRADED',
    recommendation_status:recommendation.status==='QUALIFIED'?'READY':recommendation.status==='NO_QUALIFIED_OPPORTUNITY'?'NONE':'BLOCKED',
    closing_status:closing.complete===true?'PASS':'PENDING',closing_at:closing.complete===true?String(close.verified_at):null,
    learning_status:learningValid?'PASS':learning.status?'DEGRADED':'PENDING',learning_at:learningValid?String(learning.completed_at):null,...evidence};
}
export {buildPublicMarketReadModel,PUBLIC_CHECKPOINTS};
