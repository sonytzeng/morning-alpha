CREATE UNIQUE INDEX editorial_reviews_snapshot_gate_uidx ON public.editorial_reviews USING btree (decision_snapshot_id) WHERE (decision_snapshot_id IS NOT NULL);
CREATE UNIQUE INDEX decision_snapshots_content_fingerprint_uidx ON public.decision_snapshots USING btree (report_date, session_type, snapshot_fingerprint) WHERE (snapshot_fingerprint IS NOT NULL);
CREATE UNIQUE INDEX idx_reports_report_date ON public.reports USING btree (report_date);
CREATE UNIQUE INDEX decision_snapshots_idempotency_uidx ON public.decision_snapshots USING btree (idempotency_key);
CREATE UNIQUE INDEX decision_snapshots_current_session_uidx ON public.decision_snapshots USING btree (report_date, session_type) WHERE is_current;
CREATE UNIQUE INDEX runtime_quality_policies_one_active_uidx ON public.runtime_quality_policies USING btree (active) WHERE (active = true);
CREATE UNIQUE INDEX reports_report_date_unique ON public.reports USING btree (report_date);
