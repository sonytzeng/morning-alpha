# Owner Trading Cockpit V1

## Authorized release manifest
One additive migration: `20261008213105_owner_trading_cockpit_ledger_v1.sql`.
One existing Function: `owner-trading-lab-v1`. Existing verified-user + research Owner enrollment remain the only user entry. No other Function, secret, Cron, policy, strategy or historical mutation.
Owner UI: `OwnerCockpit.tsx`, `CockpitJournal.tsx`, `cockpit.css`, `features/research/cockpit.ts`, and existing analysis page mounting. GitHub is source of truth; only these source files go to Readdy, never personal journal data.

## Accounting contract
MOVING_AVERAGE_V1 uses PostgreSQL numeric, per Owner/book/symbol, chronological execution time then immutable insertion sequence. Buy cost includes fee+tax+other costs. Sell allocates the current average cost to quantity and subtracts sale costs from proceeds. Every fee is either explicitly known (including zero) or NULL/UNKNOWN. Unknown net cost/profit remains unknown; no invented zeros. Fully closed inventory cost resets to zero; unknown past realized profit stays unknown. UI rounding is display only.

An Owner-wide transaction advisory lock serializes writes and duplicate request keys, including competing sells. Reprocessing the full effective history prevents negative stock at ANY historical point. Original rows cannot update/delete/truncate. A correction appends a same-book/symbol replacement referencing the original; cancellation appends VOID. Existing references are unique; canceling a cancellation is not supported. Replacement and full history validation are one atomic transaction. Invalid correction rolls back entirely. A lost-response retry retains request identity AND cancellation time.

The new LIVE and PAPER books are self-reported journals, not broker execution, system recommendations or prospective predictions. Tests only use isolated data. The previous immutable owner_lab_trades/events remain separately visible with UNKNOWN fees; they are neither migrated nor included in the new average-cost/net-P&L series. Legacy open trades are not sold against the new book. This boundary is visible before recording; original legacy read/exit contracts remain unchanged.

Unrealized P&L uses only verified saved quotes on the latest legal session, known cost, nonfuture ingestion/capture, with timestamp shown. Missing/conflicting quote means unknown. It is a valuation before future sale costs, never a guaranteed executable quote. Corporate-action inconsistencies require manual journal audit; no fabricated adjusted fills.

## UI and evidence
Three views: Today, stock research, journal/results. No same-day historical replay becomes today's opportunity. First view requires current-day canonical READY; entries require same-day FORWARD. Historical10/7+10/8 are date-selected and conspicuously historical. Existing engine outputs are translated, not rescored. INSUFFICIENT suppresses price plans. Research, market direction hit rate, manual paper and actual journals stay distinct. No false performance or sample counts. Technical tools remain collapsed.

Natural Entry Forward and Outcome writer remain NOT_ENABLED. Existing V2 durable lifecycle was audited in entry-worker-auth-release.md. Only a future separate manifest can add the Entry dispatch/outcome path. No Prediction is created by UI access.

## Acceptance and rollback
Fresh PostgreSQL + real current Handler source (synthetic local auth only), multi-buy/partial-sell/rebuy, fees, NULL fees, idempotency, concurrent oversell, immutable correction and negative authorization. UI1440/375/390/430, logout race, date/search/wait/avoid/missing states and real retained research in local isolation. These never substitute for Sony Production Owner session acceptance.
Read-only Production acceptance: existing business fingerprints, source hashes, new object ACL/trigger/ledger empty, then real Owner UI. No production test trade, replay, report or LINE. Rollback only Function/UI to previous reference; additive journal objects and any real user entries are retained, never erased. Sony usability remains PENDING, public approval NO.
