-- Foreign-key indexes required for predictable JOIN and DELETE/UPDATE checks as
-- subscriber and learning-history volumes grow. Additive only; no existing
-- indexes are removed because short production history is not enough evidence
-- to classify the advisor's "unused" indexes as redundant.

create index if not exists editorial_reviews_decision_snapshot_id_idx
  on public.editorial_reviews (decision_snapshot_id);
create index if not exists futures_snapshots_market_quote_id_idx
  on public.futures_snapshots (market_quote_id);
create index if not exists growth_events_v2_actor_id_idx
  on public.growth_events_v2 (actor_id);
create index if not exists historical_replay_results_decision_snapshot_id_idx
  on public.historical_replay_results (decision_snapshot_id);
create index if not exists historical_replay_results_prediction_id_idx
  on public.historical_replay_results (prediction_id);
create index if not exists historical_similarity_results_similar_snapshot_id_idx
  on public.historical_similarity_results (similar_snapshot_id);
create index if not exists ma_ops_recovery_actions_check_id_idx
  on public.ma_ops_recovery_actions (check_id);
create index if not exists ma_ops_recovery_actions_run_id_idx
  on public.ma_ops_recovery_actions (run_id);
create index if not exists market_indices_market_quote_id_idx
  on public.market_indices (market_quote_id);
create index if not exists pipeline_runs_cost_usage_id_idx
  on public.pipeline_runs (cost_usage_id);
create index if not exists pipeline_runs_research_session_id_idx
  on public.pipeline_runs (research_session_id);
create index if not exists push_logs_report_id_idx
  on public.push_logs (report_id);
create index if not exists push_logs_subscriber_id_idx
  on public.push_logs (subscriber_id);
create index if not exists strategy_registry_parent_strategy_id_idx
  on public.strategy_registry (parent_strategy_id);
create index if not exists strategy_registry_promoted_by_idx
  on public.strategy_registry (promoted_by);
create index if not exists strategy_registry_rollback_target_id_idx
  on public.strategy_registry (rollback_target_id);
create index if not exists strategy_registry_audit_actor_id_idx
  on public.strategy_registry_audit (actor_id);
;
