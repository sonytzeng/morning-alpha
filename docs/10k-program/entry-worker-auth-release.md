# Entry Worker Auth P0 — bounded Owner Shadow release

## Exact scope
Predecessor PR219/039250b0601eb731e4f4dac03c55b43ba3b4aba3 remains immutable. Only the new Entry worker replaces its CRON dependency with ENTRY_OPPORTUNITY_WORKER_TOKEN. No other validator, Gateway setting, policy, migration, Cron, strategy, outcome or business producer changes.

The secret is cryptographically random and stored only in the Production Secret Store. Controlled server memory signs a five-minute HMAC over the worker audience, POST method, issued-at and exact request-body SHA256. Only a signature is sent. Missing/wrong/expired/future signatures, modified bodies, browser Origin/Referer/Sec-Fetch-Site and unrelated Core/Owner/member credentials are denied. Gateway JWT remains required separately. There is no service-role or CRON fallback. Exact same accepted replay is safe through the existing immutable idempotency contract; this is not a new nonce table.

Deployment: one new Secret, one existing Function entry-opportunity-shadow-v1, its local auth module, and minimal Owner research date selector. No Migration. Controlled caller only permits the previously approved two retained source IDs and HISTORICAL_REPLAY. One first pass plus one idempotency pass; stop on failure; no credential fallbacks. Never put credentials in stdout, logs, argv, files, artifacts, Git, Readdy or browser. No manual Report/LINE/business invocation.

Owner dates are read via the existing entry_opportunity_runs SELECT grant and existing Owner RLS. RPC counts remain authoritative. Latest and historical dates are visibly distinguished. Unavailable/denied requests never render a fabricated result. Auth identity changes clear data. UI selection does not generate research or transactions.

## Next-stage integration candidate (design only, NOT enabled)
The existing recommendation-v2-forward-worker-v1 claims a durable job, requests stock evidence, stores a V2 run through persistV2Sidecar/store_recommendation_shadow_v2, and finishes the job before scheduling outcomes with EdgeRuntime.waitUntil. Its internal validator uses the existing Core internal credentials plus Gateway JWT, not the new Entry identity. This supplies a potential post-commit integration location, not an existing Entry caller. Entry Forward additionally requires the same Taipei date and <=5-minute source freshness, and an after-close source cannot become a morning prediction. Do not alter V2 or its existing locked predictions.

Proposed next gate: a fail-open async Entry dispatch after a successfully committed, still-fresh V2 source, with its own dedicated signature and exact source ID. No re-evaluation with newer evidence. The existing unique(source,version,mode) key provides idempotency. This requires a separately reviewed precise caller Function manifest, runtime latency/failure-isolation tests and natural-checkpoint proof before deployment. No Cron is added by this release.

Outcome is NOT_ENABLED: the Entry outcome table intentionally has no writer or INSERT grant. The V2 outcome logic cannot establish Entry-specific trigger/fill/stop-target ordering, corporate-action clearance, costs, and 1/3/5/10/20-session horizons. A future writer requires a separately approved migration/function manifest and trustworthy executable-price/adjustment evidence. Daily OHLC ambiguity remains unverified, never best-case performance.

Historical Replay is not Forward. Analysis value remains INSUFFICIENT_SAMPLE. No strategy effectiveness or natural execution claim follows from CI/deployment.

CI fixture correction: the unchanged pre-existing V2 handler test built a synthetic trading day from wall-clock time. CI on the 2026-10-09 Taiwan holiday correctly failed V2_COMPARISON_IDENTITY_INVALID. Pin only the test clock and fixture to the existing legal 2026-10-07 premaket session; no calendar, production Handler, strategy, or assertion change.
