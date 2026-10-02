# 10/2 Public Projection candidate

Core market execution is frozen. The candidate corrects two independent read/export defects: the website re-derived the market regime and checkpoint progress from legacy fields; the Content OS export required HTTPS news metadata even for a legitimate immutable market-ledger report. The consumer is the separate Sony Content OS pipeline, not the Morning Alpha website.

The service-role-only checkpoint RPC reads the existing Atomic integrity proof without modifying it. A single canonical read model binds the report date, snapshot version, member revision and seven authoritative batch identities. Every UI consumer fails closed when this model is malformed or mismatched. No browser clock, lifecycle rank or compatibility row creates completion.

Canonical regime, direction and action are independent. Six intraday checkpoints derive from the authoritative batch/proof pair. The last completed node is never returned as the next node. Closing data is displayed, not recalculated.

The handoff accepts either exact frozen HTTPS references or, only for a verified operational market-only publication, exact frozen ledger references. Ledger references are explicitly typed; no URL is fabricated. Recommendation BLOCKED does not block market publication. Actual research, publication, semantic coherence, editorial and leakage gates remain in force.

The existing immutable 90-day critical Recorder stores a whitelisted model input/result and the actual handoff selector measurements/result. It does not store requests, credentials, actor identities or private prose, and remains fail-open. SQL isolation exercises real persistence and offline reconstruction rather than only a mocked successful record call.

Acceptance adds REPORT and PUBLIC_PROJECTION dimensions. A verified core with only export/enhancement blockers is DEGRADED and service-available, not CORE_FAIL. Original blockers remain visible. Existing stored Acceptance rows are not recalculated or updated.

## Release scope

- One forward-only candidate migration: 20261002130000_public_market_projection_v1.sql.
- Two read/export Functions: get-report-payload and content-os-morning-alpha-source.
- Four existing UI pages and their shared mapping only.
- No Cron, Auth, existing RLS, secrets, Provider, Atomic, Retry, strategy or business-generation change.
- No Production mutation is authorized in this task.

## Explicit external limitations

The producer now returns 200 for the 10/2 legal state. A deterministic conflict exposes NON_RETRYABLE/max_attempts=1 and repeated identical incident recording is idempotent. This does not cancel independent polling in Sony Content OS. Its deployed generic providerFetch does not inspect retry_classification; guaranteeing an external caller stops all requests requires a separately scoped consumer change. It is not silently claimed as fixed here.

The official UI has Readdy asset references, but neither repository deployment metadata nor the accessible Readdy project list identifies the writable Morning Alpha publishing project. The source candidate and local built UI are verified; the Production UI deployment entry point remains unverified. No unrelated Readdy project is selected.

## Retained evidence and cost

The real 10/2 canonical market inputs and anonymous public response are retained with no member identity or secret. SQL replay uses the original Recorder's consistently deidentified readset; it does not mix plaintext and hashed narratives. Historical-preservation sentinels and FULL/READY/negative controls are explicitly tests, not Production captures. No large Chaos run was repeated.
