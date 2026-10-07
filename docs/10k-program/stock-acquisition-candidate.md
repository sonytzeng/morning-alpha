# Stock Evidence bounded acquisition candidate

Base: `63e1a167a03bc39fa2cce3b4979f7e6a398a81b0` (released PR199).

## Exact release scope

- Function: `recommendation-stock-evidence-v1` only.
- Shared acquisition: strict `SMOKE_2330` / default `UNIVERSE_72`, six workers,
  at most three attempts, request-wide deadline, shared 429 cooldown.
- Migration: NONE. Cron / Auth / RLS / Secrets / Core / thresholds: NO CHANGE.
- Current persistence remains the existing report's recommendation acquisition
  snapshot. Smoke does not produce or backfill a report or any business row.
- No UI release in this acquisition transport candidate.
- TWSE/TPEx six official public actual-data sources are acquired only in full
  universe mode, with at most two parallel requests under the same22s deadline.
  Exact canonical symbols + exchange are preserved, contact/PII fields dropped,
  actual source dates/periods and availability retained. Revenue values remain
  in source-reported units; no unsupported currency conversion is performed.
  These supplemental actuals are persisted through the existing acquisition
  envelope, not written to historical earnings rows, and do not satisfy missing
  consensus/guidance or silently replace the strategy's sector taxonomy.

## Guarantees and limits

The one-stock response is explicitly not a complete universe decision proof.
Provider HTTP, parser, session and transport failures retain sanitized codes;
provider error bodies and credentials never enter returned evidence.
Receipt/availability are the real acquisition time, not historical candle time.
Daily bars cannot claim that a missing current-session quote is available.
Missing evidence is not zero-filled. Shares are not converted into actual TWD
institutional flow, actual EPS is not consensus, and broad news is not a company
catalyst. Existing Recommendation requirements remain unchanged.

Transport regression fixtures are SYNTHETIC, not Production responses.
Production2330 smoke and72-stock acquisition are NOT YET VERIFIED. The live run
requires the correctly authorized existing internal identity, the deployed
single-symbol guard, and a successful2330 contract before expanding to72.
No real coverage or complete daily evaluation is claimed by these unit tests.

Read-only public-source probe: TWSE company/revenue/EPS each cover61/72; TPEx
equivalents cover all11 remaining symbols. This is current official source
coverage, not four-quarter evidence completeness or Production Function smoke.
Independent synthetic full-price controls prove each missing required gate
(institutional, consensus, catalyst) can still block all72. No threshold changed.

Credential source is confirmed as the Supabase project Function Secret Store,
injected into `Deno.env.get('CRON_SECRET')`. The available management API returns
only its digest; current local runtime has no CRON_SECRET, and no configured
local env file exists. The unrelated daily-delivery Vault token was proven
different and will not be reused. No auth bypass/secret export endpoint is added.

The released predecessor inventory/hashes are preserved byte-for-byte. A
separate exact successor manifest verifies this candidate and its lineage.
