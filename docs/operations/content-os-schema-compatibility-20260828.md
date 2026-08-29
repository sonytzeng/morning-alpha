# Content OS Text/Social Schema Compatibility — 2026-08-28

Production project: `ayajzjtjzgtipcucppsl`.

The legacy `content-os-pipeline` deployment was built against an unpublished schema. The Morning Alpha public-social path is therefore isolated in `content-os-morning-alpha-social` and writes only to the current canonical tables. It consumes an allowlisted public projection from a verified `source_snapshots` row and never reads the locked premium payload.

The function keeps Supabase JWT verification enabled and also requires the existing scheduler token in `x-content-os-scheduler-token`. The scheduler token is verified by hash through the existing RPC; no credential is embedded in source or logs.

| Function / stage | Legacy expected table or column | Production actual | Status | Required forward fix |
|---|---|---|---|---|
| `content-os-pipeline` regeneration | `content_regeneration_requests` | Table absent | Deprecated | Do not run legacy regeneration for Morning Alpha; use immutable job/revision idempotency. |
| Brand context | `content_os_settings.voice_*`, `render_*` | `brand_automation_settings` contains generation/approval/publishing policy only | Drift | Text/social path has no renderer dependency; video reports `SKIPPED_NOT_CONFIGURED`. |
| Source evidence | `content_claims` | `source_snapshots.payload`, `provenance`, `content_hash`, `verification_status`, `data_quality` | Drift | Require verified, complete, unexpired snapshot and public gate fields. |
| Planning | `content_jobs.public_topic`, `content_score`, `package_date` | `content_jobs.topic_id`, `source_snapshot_id`, `selection_run_id`; topic data is in snapshot/selection tables | Drift | Lock one verified public selection through `content_os_lock_verified_public_selection`; do not fabricate scores. |
| Script generation | `content_scripts.structured_script`, `voice_locale`, `estimated_duration_seconds`, `subtitle_timestamps` | `content_scripts.title`, `script_text`, `language`, `content_hash`, `public_story_id`, `selection_run_id` | Drift | Persist the canonical public script using actual columns and DB-derived content hash. |
| Social adaptation | Video asset required before captions | `platform_contents` supports direct text captions and unique `(content_job_id, revision, platform)` | Drift | Generate Threads, Instagram and Facebook drafts directly from public fields; video is optional. |
| Artifact metadata | `content_assets.revision`, `asset_metadata` | Columns absent; manifests and generation runs are canonical | Deprecated for text-only | Use `generation_runs`, `content_scripts`, `platform_contents`; do not create empty assets. |
| Pipeline gates | `content_os_record_pipeline_gate`, `content_os_record_release_gate`, `content_os_finalize_content_asset` | RPCs absent; transition/firewall functions and review tables exist | Drift | Stop at `manual_review/audit_required`; do not fabricate editorial/leakage scores or bypass review. |
| Selection | Legacy inline `public_topic` JSON | `content_selection_runs`, `daily_public_exposure_budgets`, `content_os_private.content_selection_premium` | Canonical | New service-role-only RPC atomically locks a one-story public projection with zero premium stories. |
| Idempotency | Mutable job summary columns | Unique job, script and platform keys plus generation-run idempotency keys | Canonical | Replays verify identical content and reuse rows; conflicts fail closed. |

No duplicated business table is introduced. Existing RLS and FORCE RLS settings are unchanged. The only database change is a service-role-only transactional RPC over existing canonical tables.
