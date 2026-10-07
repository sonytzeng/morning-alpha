# Recommendation phase-aware candidate

Base: `6c5ae5a5a760d8c3135cd7ccc94ce17e1cd394c6`. Candidate only; no Production writes, deployments, Cron, Auth/RLS or secret changes.

## Root cause and semantics

The previous 07:00 contract required an overnight event AND the subsequent TW price/volume reaction AND only the prior completed cash session. That conjunction was impossible. PREMARKET now identifies that reaction as NOT_YET_OBSERVABLE; it does not waive company earnings/consensus, three institutional TWD flows, sourced catalyst mapping, market inputs, risk, or universe completeness. Complete knowable evidence permits PREMARKET_WATCH, not READY and not a trade. Missing prerequisites remain BLOCKED. Complete rejected quality is NONE. INTRADAY reruns the same evaluator with current-session evidence and original score thresholds, producing READY or DROP/NONE rather than a hanging WATCH.

The reader replaces a universal 20-hour quote age with TW expected completed session/current session, existing TXF session mapping and latest completed US session. Intraday TW quotes remain bounded to 20 minutes unless an actual completed close. Daily institutional totals use the most recent completed TW day, including at intraday cutoffs; units remain TWD and no shares-to-TWD invention is allowed.

## Acquisition and caller

`recommendation-stock-evidence-v1` is the sole new named Function. It reads the exact existing 72-stock registry, bounded Fugle daily candles/intraday quotes and existing DB company evidence. Daily volume is shares; quote volume is lots converted to shares; turnover is TWD. Historical candles newly fetched are available at actual receipt time, never retroactively. It does not write Core quote tables or create events/fundamentals.

The report generator calls it using the existing server service-role JWT for the default gateway check plus existing CRON_SECRET/internal version for the unchanged internal validator. No auth bypass or new secret. An opaque key or failed auth safely yields recommendation BLOCKED, never a false complete proof. Local transport tests do not claim Production Auth smoke; credential class/endpoint activation must be checked before a separately authorized deployment.

The generator persists the returned decision_v1 complete proof and acquisition with its report. Owner READ reuses this saved evidence without fetching providers or changing receipt times. The named producer can evaluate any natural intraday cutoff when called, but this candidate adds **no Cron or new automatic intraday dispatcher**. Prior WATCH lineage missing from retained history is explicitly unavailable, not reconstructed from the present universe.

## Retained evidence and known data limitations

The committed compressed fixture is a deidentified retained Production **DB read model**, not retained raw provider HTTP responses. It contains quotes, the 72-stock registry and news available at original 10/2, 10/5 and 10/6 cutoffs. The three replays do not use new acquisition. All remain safely BLOCKED: 71 lack session-valid stock quotes, all lack complete institutional/fundamental/catalyst evidence and required volume coverage. A legal older 2330 completed session now survives Monday's freshness check. See the exact per-stock replay JSON and fixture SHA test.

WATCH→READY/DROP tests use explicitly synthetic audited test rows. No retained real intraday WATCH→READY evidence exists in this readset; no real transition is claimed. PREMARKET_READY remains conditional, never forced. The legacy formal report candidate metadata intersects 60 of the active 72; the remaining 12 cannot become formal recommendations without legitimate metadata/eligibility proof. No data is invented to close that gap. Consensus, institutional amounts, fundamental history and company catalyst gaps may require an independently approved source decision; no purchase is made here.

## Candidate migration

`20261006235430_recommendation_phase_contract_v1.sql`: forward-only exact predecessor hashes, additive PREMARKET_WATCH publication semantics, recommendation-only Acceptance dimension and critical Recorder projection keys. No historical replay/backfill, business DML, cron, auth or RLS change. Fresh isolation verifies unchanged unrelated function/catalog/ACL definitions and rejects incomplete/wrong-time/false-READY proofs. Historical Integrity seals are preserved byte-for-byte; a separately pinned exact successor validates this candidate's file set and hashes.

## Release boundary

Validation includes explicit synthetic 72-stock PREMARKET WATCH and INTRADAY READY proofs (963 / 2116 referenced evidence records), in addition to the three retained negative cutoffs. Recorder's generic 1000-element array bound is unchanged; only the named decision-evidence-v1 proof evidence array has a bounded 4096-item projection, with unchanged sanitization, recursion and 1 MiB capsule limits. Fresh DB verifies deterministic phase proof projection, positive publication, missing/wrong-time proof rejection and both array-limit negative controls.

The legacy Owner Handler test shifted historical clocks into the current wall time, which could produce impossible pre-open intraday data or wrong sessions. Its CI now uses the existing no-network libfaketime PostgreSQL image and the same fixed synthetic Monday intraday clock in Node/Deno. Original live-journal and close fixtures are moved to actual earlier synthetic dates; access, paper/live idempotency, immutable lineage and future rejection assertions remain mandatory. This is a test-environment repair, not a Production time/Auth change.

Candidate Function scope: new recommendation-stock-evidence-v1; existing generate-daily-report-v7 and owner-trading-lab-v1 for producer/Owner read wiring. Owner TradingLab UI is additive. No LINE code, Provider/Atomic or Forward change. Any Production migration/function/UI release requires the user's subsequent approval. Passing engineering gates does not mean historical data gaps, live acquisition entitlement or ongoing recommendation availability have been proven resolved.

Deployment dependency caution: the shared recommendation reader also belongs to get-report-payload; the shared report gate is imported by daily-delivery-orchestrator, ma-ops-health-check, line-daily-push and content-os-morning-alpha-source. These existing bundle consumers must be considered explicitly in the subsequent release scope; editing shared source does not update any deployed Function. No deployment (including LINE) is authorized or performed by this candidate task. The new named Function is still only recommendation-stock-evidence-v1.
