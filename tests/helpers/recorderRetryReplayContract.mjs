// Offline identity contract. No network, persistence or business execution.
export const RECORDER_PROJECTION_VERSION = 'CRITICAL_SQL_RETRY_PROJECTION_V2';
export const RETRY_CHECKPOINTS = ['0740','0745','0750','0755','0800','0805','0810','0815','0820','0825','0830','0835','0845']
  .map(slot => 'premarket_readiness_retry_' + slot);

export function recorderReplayIdentity(row, replayExecutionId) {
  const cap = row.capsule;
  // Pure Publication validation has an args-only read-set. Only Lifecycle /
  // Acceptance depend on the state projection that previously lost Retry keys.
  const usesStateProjection = row.stage !== 'PUBLICATION';
  if (cap?.recorder_projection_version !== RECORDER_PROJECTION_VERSION
    || (usesStateProjection && cap?.database_inputs?.recorder_projection_version !== RECORDER_PROJECTION_VERSION)) {
    return {source_evidence_id:row.id, replay_status:'LEGACY_RECORDER_PROJECTION_INCOMPLETE', deterministic:false};
  }
  if (cap.recorder_projection_version !== RECORDER_PROJECTION_VERSION
    || !['PRODUCTION_CAPTURE','SHADOW_CAPTURE'].includes(cap.capture_origin)
    || cap.source_correlation_id !== (cap.args?.p_correlation_id ?? null)) {
    throw Error('RECORDER_SOURCE_IDENTITY_INVALID');
  }
  if (replayExecutionId === cap.source_correlation_id) throw Error('REPLAY_EXECUTION_ID_MUST_BE_SEPARATE');
  return {capture_origin:'REPLAY', source_evidence_id:row.id,
    source_correlation_id:cap.source_correlation_id, replay_correlation_id:cap.source_correlation_id,
    replay_execution_id:replayExecutionId, replay_status:'READY'};
}
