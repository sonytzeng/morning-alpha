# Owner Trading Lab V1 — bounded release candidate

Base: `c7a13e2ef1d3d4232617dcf4b9bc541b5a975a9d`.
Sony authorization: Owner Trading Lab V1, 2026-10-06. Owner-only research;
PUBLIC_PRODUCT_APPROVAL=NO; SONY_USABILITY=PENDING until Sony answers A–H.

## Named deployment scope

- One migration: `20261006082157_owner_trading_lab_v1.sql`.
- One NEW Owner-only Edge Function: `owner-trading-lab-v1`.
- Readdy: next minimal Owner Analysis Center version after published 650,
  exact candidate version to be recorded before publication.
- No changes to existing functions, Auth identity, existing RLS, secrets, Cron,
  Forward activation, providers, decisions, recommendations, reports or LINE.
- New journal tables use the existing `is_research_owner_v1` identity; no
  member writes or browser service-role. Built-in Edge service identity is
  used only after Supabase `getUser` and existing Owner RPC both pass.

## Read-only Production audit (2026-10-06)

`sector_stock_map`: 72 active symbols, not an exchange-wide universe.
`market_quotes`: 245 TW numeric-symbol rows, 14 symbols historically; one
symbol on the latest session 2026-10-06. No retained documented
`source_raw.total.tradeVolume`. `market_data` has 26 numeric symbols, but
does not establish equivalent audited quote lineage and is not substituted.
`institutional_flows`: 0. `earnings_events`: 0. `company_events`: 0.
`catalyst_tw_mappings`: 0. `news_events`: 231, latest 2026-09-30.
Price PARTIAL, industry AVAILABLE for the explicit 72-symbol universe;
volume/institutional/chip/fundamentals/revenue/company catalyst MISSING.
News PARTIAL historically, not current qualified company evidence.

No provider collection is added. Missing evidence cannot be assigned a score.
Discovery reuses the unchanged `buildEvidenceDecision` evaluator, with an
Owner-only funnel explaining actual rejection reasons. WATCHLIST is not a
formal recommendation. Formal status is read from canonical publication gate.

## Immutable trading and outcomes

Long-only V1: no brokerage execution. Paper entry is prospectively locked at
server time, requires a current accepted WATCHLIST/formal candidate and a
traceable quote. Sony live transactions are explicitly self-reported, not
broker verified; late journal entries retain a current recording snapshot,
never pretend it was the historical entry-time system decision.
Entry, stop, invalidation and snapshot are immutable. One full exit is append
only; partial exits and corrections are out of scope and never silently edited.
Idempotency compares original request identity; retries do not append twice.
Close/1D/3D/5D use the existing official TW calendar and retained verified
close quotes; missing target-session quotes stay unavailable, never advance
to a later available bar. MFE/MAE require intraperiod extremes; close-only
data is not presented as MFE/MAE. CLE is read-only for Market Decision quality.

Forward remains disabled. A future enablement must separately name the
pre-result trigger, immutable methodology, activation timestamp and sample
eligibility; historical replay and live journals never count as Forward.

## Local validation and remaining release gates

Fresh isolated DB and real HTTP Handler: PASS (see owner-trading-lab-validation.json).
Owner/non-Owner matrix, immutable entry/exit, concurrency, idempotency,
tampered lineage, future data and denied direct writes: PASS.
Desktop 1440 and mobile 375/390/430, paper/live/exit forms, error/logout race:
PASS using synthetic identities and loopback-only isolated DB, not Production.
Discovery/outcome/performance and Phase 2 regression: PASS.
Integrity preserves every predecessor hash and all 142 sealed Core files.
Deno, type-check, lint and build: PASS. Full public suite and GitHub statuses
must be read from the final commit's checks, not inferred from this document.

Full local public release suite: 2490/2490 PASS, no skips (Node 22.23.1).
GitHub Release Gate remains a separate required commit-specific check.

Opening an existing Owner journal performs one bounded outcome catch-up, then
re-reads saved results. Manual catch-up is also available. No Cron, daemon,
Core lifecycle hook or Forward activation; no background execution when the
Owner is absent. The 200-trade/1000-event bounds fail explicitly, not truncate
performance silently. Full exit only; no shorting, partial exits or fees model.

Latest recovery instruction requires Production NO CHANGE. This deliverable
ends at a Release Candidate; deployment and Sony A–H usability remain pending.
No invented Production trades as smoke. Sony usability is a human gate.

## Forward trigger design — NOT ACTIVATED

Proposed event is a committed canonical PREMARKET revision, before any outcome
becomes observable. An async research dispatcher would consume its immutable
business_date / checkpoint / batch_id / canonical_revision / observation_time;
Core would not wait on it. The unique lock key would include methodology version,
business_date, checkpoint and source revision. The dedicated Shadow identity
would be used server-side, never an Owner browser service credential.

Activation requires a separately reviewed dispatcher and explicit FORWARD_SHADOW
allowlist in the existing dedicated worker (currently historical-replay-only),
an immutable activation timestamp/methodology, retry deduplication, and a read-only
Core diff proof. Outcome linkage must run after the target session; observations
created after an outcome became knowable are excluded, not reclassified.
No dispatcher, worker allowlist change, schedule or activation is included here.
Historical Replay, paper journal and Sony live records stay outside Forward counts.
