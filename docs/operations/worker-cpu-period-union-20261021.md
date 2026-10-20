# Worker CPU and response-period union — 2026-10-21

## Observed production failure

The 2026-10-21 natural run acquired all 1,358 planned source items but was terminated for CPU time before it could durably persist the acquired-input checkpoint. The safe aggregate evidence was one `CPUTime` shutdown at 07:13:40 Asia/Taipei, 37 boots, 36 early drops, zero predictions, and no acquired-input/source-revision checkpoint. No manual business invocation, reset, replay, rearm, backfill, or cache clear was used.

## Candidate boundary

This candidate combines only the already isolated staged CPU-yield/checkpoint repair with the bounded financial-response period parser and existing forward-cutoff/Outcome-cache recovery behavior. Its deploy payload differs from active Worker4 in exactly five runtime files:

- `src/features/vnext/contracts.ts`
- `src/features/vnext/dailyAdapter.ts`
- `src/features/vnext/dailyParsers.mjs`
- `src/features/vnext/dailyIntelligence.ts`
- `src/features/vnext/dailyRuntime.ts`

The fixed recovery payload is the exact active Worker4 closure. The candidate does not change SQL, Auth/RLS, Cron, Caller, member rights, payment, LINE, thresholds, source admission, research publication, or any manual business invocation. It excludes the concurrently edited engine, continuous-learning, SQL, LINE, and source-admission work from PR #284.

## Status and stop condition

The package is a not-deployed candidate. Functional regression and immutable-source admission must pass, followed by an independent security diff review of the exact committed patch. If that review is unavailable or finds an unresolved issue, deployment stops. A successful natural run is still required after any deployment and does not by itself establish qualified or published short-, medium-, or long-horizon recommendations.
