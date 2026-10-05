# Phase 2 — Owner-only Analysis Intelligence candidate

Base: `1fcf24a7a2d7d7a602e555639a200f3b002a31ce` (Phase 1 COMPLETE).
Production changes in this task: **NONE**. Historical FAILs are not changed.

## Candidate scope and release boundary

- One additive migration: `20261005083437_analysis_intelligence_shadow_v1.sql`.
- One NEW independent worker: `research-analysis-shadow-v1`.
- Owner UI: existing `/admin/analysis` only. No member navigation or account truth change.
- Existing Provider / Atomic / Retry / Decision / Recommendation / Report / LINE / Closing / Learning functions remain byte-identical to the Phase 1 core freeze.
- No Production migration, deployment, UI publish, secrets or Cron changes are authorized by this candidate task.
- A separate release approval must identify the migration, worker, Owner UI and an independent daily dispatcher. The candidate creates **no scheduler** and does not connect to any business handler. Future daily dispatch must be asynchronous, bounded before 09:00, reuse the first locked artifact, and must not become a business dependency. Intraday observations and CLE linkage are separate worker operations after their authentic source exists. Do not modify existing business Cron to call this synchronously.

## Source and temporal contract

Morning input is selected from immutable PREMARKET `market_checkpoint_batches` + `market_checkpoint_snapshots` and the real `market_checkpoint_batch_integrity_v1` proof. The unchanged `evaluateOperationalCore` and `validateAtomicCheckpointEvidenceRows` validate the same formal session contract. There is no second Provider implementation.

Both source timestamps and **database availability (`created_at`)** must be at or before the cutoff. The request-start `captured_at` is not assumed to be the time an intraday HTTP response arrived. Morning cutoff is before 09:00 Taipei; no closing input is accepted. Research and official comparison metadata must also have existed at cutoff. Missing context stays unavailable.

All input rows, proof, registry/feature/methodology/signal versions and previous valid-day input are frozen in the research artifact. Writer reconstructs the bounded DB readset and rejects a caller-modified readset. The result is canonical-JSON SHA-256 locked and append-only. A single canonical artifact exists per date/methodology, not per member.

Prior comparison uses the most recent **valid committed PREMARKET** day, bounded to 45 calendar days; no weekend/date-equality guess. If none exists, changes are explicitly unavailable, not invented. A prior morning uses the retained premarket batch, not that day's close.

## Experimental deterministic methodology V1

11 providers × 3 explicitly versioned registry definitions = 33 feature slots:

1. Session confirmation: inherited committed formal contract, **not** bullish confirmation.
2. Observed return in percentage points. Reference-only Taiwan cash prices have **null** return, not fake 0%.
3. Risk impulse: clip(signed return / 2, -1, 1).

Instrument labels are truthful: SPX/SPY, IXIC/QQQ, SOX/SOXX, VIX/VXX, DXY/UUP, US10Y/IEF. IEF is a Treasury **price** proxy; positive IEF price has inverse yield-pressure meaning, never a measured yield. UUP/VXX return signs are reversed for risk-asset support. No gap, momentum or realized volatility is fabricated.

Signal direction uses ±0.1 percentage points; strength is absolute impulse ×100. Evidence confidence is experimental 65 for proxy instruments and 80 for direct instruments, **not an empirically calibrated probability**. Individual vote conflict = 2×minority/total directional signals; cross signals are confirmation gates, not double-counted independent votes.

Confidence = clamp(0.2×evidence + 0.3×agreement + 0.2×strength + 0.3×data-quality − 0.4×conflict − missing penalty). Missing penalty is 5 per disclosed item, capped at 40. All formula and threshold changes require a new methodology/feature version; old captures remain immutable.

Supporting/contradicting camps are both retained, including for neutral interpretations. Global/local disagreement reduces confidence. Action ENTER requires local bullish confirmation, a positive cross-confirmation, confidence ≥65 and conflict <30. A bearish interpretation with confidence ≥40 can AVOID; otherwise WAIT. These are **Shadow-only research rules**, not changes to the Production strategy.

Typed graph: Evidence → Feature → Signal → CrossSignal/Decision → Invalidation. Invalidation is observable directional reversal, evaluated only against a later authentic committed same-day checkpoint. Results append separately; no morning prediction mutation. Structured results only, no model private reasoning.

## Genuine historical evidence and limitations

`production-cores.json` is an allowlisted read-only capture on 2026-10-05. Immutable row IDs, batch/correlation/payload lineage and official integrity proof are retained. No auth material, member data, HTTP headers or raw response payload are included.

| Date | Permitted replay result |
| --- | --- |
| 9/21, 9/22, 9/23, 9/24, 9/29 | No committed PREMARKET batch; safe rejection. Not successful analysis. |
| 9/30 | Real 11-row committed core; missing research context disclosed. |
| 10/1 | Real core + retained failed-research attempt metadata; missing news penalized. No synthetic news. |
| 10/2 | Real core + research session metadata + official comparison existing by cutoff; independent Shadow analysis. |

The prior 10/2 public fixture omitted research session creation timestamps. `research-context.json` supplies only the real, read-only metadata needed to enforce availability; dates were not guessed. The retained 10/1 incident fixture can replay its known missing-news attempt; the runtime reader honestly reports generic unavailable research context when that metadata is not available through research_sessions.

10/2 CLE prediction was materialized at 14:40 even though its prediction_at references 07:05. It is **not** allowed into morning input or used as proof of a Forward sample. Later Outcome linkage reuses this existing CLE row and its existing close outcome, with historical exclusion. Shadow correctness is measured against the preserved return, not copied from Production's direction_correct. Neutral is not falsely scored as directionally correct.

Historical Replay always remains historical. Forward requires this migration's activation timestamp, same-day server clock before 09:00, cutoff no more than five minutes old, locked hash, and unknown market outcome. Explicit private pure-clock predicate has boundary tests; the writer supplies the actual server clock (no caller-controlled override).

## Security and cost

New research tables use FORCE RLS and the existing Phase 1 `is_research_owner_v1()` truth. Owner may SELECT; anonymous/member/paid/unlisted admin cannot read; service-only writers are explicitly revoked from public/authenticated. Existing Auth and public/business RLS are not changed. No Realtime publication or research cache in browser storage.

Owner page clears both result sets on sign-in identity change and sign-out and discards late RPC responses. A sidecar outage displays unavailable and cannot affect market service. UI can read only; it cannot promote rules or run analysis.

AI calls = 0, tokens = 0, AI cost = $0. Runtime is instrumented per artifact. Infrastructure compute cost is explicitly **not measured**, not falsely zero. Bounded input (11 providers), bounded historical lookup, bounded artifact (<512 KiB), and per-day uniqueness avoid per-subscriber recomputation.

## Validation

- Engine historical/counterfactual controls, future/stale/unknown-instrument rejection, independent Production comparison, typed lineage, exact replay, missingness/conflict/changes, sidecar failure isolation.
- Fresh isolated PostgreSQL 17 scaffold matches consumed columns; real saved integrity proofs are supplied explicitly, not synthesized. The unchanged real JS validator validates rows. This is a candidate dependency-compatibility test, **not** a claim to re-run the entire Production schema history.
- Database gate runs actual migration + source reader + writer + six real 10/2 intraday checkpoint observations + existing CLE close linkage, Owner RLS, append-only, idempotency, readset tamper rejection and business hash zero-diff.
- Local browser: actual Owner page/view, isolated mocked identities, preserved historical market output. Desktop, 390×844, inspector, logout, logout race, nonowner, unavailable and empty states. No Production session or network used.
- Required CI: existing Validate release, Research foundation gate, new Analysis intelligence gate. No skips or reduced assertions.

Forward Sample = **0**. Analysis Value = **INSUFFICIENT_SAMPLE**. Engineering validation does not establish investment value or predict future returns.
