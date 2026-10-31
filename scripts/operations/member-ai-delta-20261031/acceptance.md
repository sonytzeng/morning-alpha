This is a bounded release smoke check. It proves the targeted request, cache and rendering behavior; it does not certify 10,000-subscriber production capacity.

1. Run `production-preflight.readonly.sql` immediately before installing this exact candidate. It returns one metadata JSON object and must have `ready_for_this_candidate=true`. After installation, use `production-postflight.readonly.sql`; require `postdeploy_metadata_pass=true`, the expected wrapper hash, unchanged original readers, authenticated execution, and denied anon/service-role execution. These queries neither invoke member research nor manufacture JWT claims.

2. Retain the disposable PostgreSQL result for the actual captured reader/rights/access definitions. Its 97 checks cover invoker execution rights, user/tier changes, publication withdrawal, expired/failed reviews, changed edition, FULL replacement and exact rollback. These synthetic SQL roles are not real Auth end-to-end evidence.

3. Run the local render diagnostic once:

   ```bash
   node scripts/operations/member-ai-delta-20261031/payload-render-smoke.mjs
   ```

   It creates a synthetic payload at least as large as the observed 968,431-byte production cards text. It records actual JSON/projection and SSR timings, checks 216 validated model cards, nine initial rendered cards, 72 explicitly expanded cards, one search result, zero expired cards, and a scoped UNCHANGED cache hit. Timing values describe this local process; they are not browser-paint, network, Auth, database or concurrency measurements.

4. With one existing, genuinely authenticated account in the site UI, capture a small network trace without tokens or response content:

   - Initial research read: one Delta FULL response, exact current edition/tier, nine initial cards. A valid AI edition must avoid the unused legacy research/Owner snapshot calls.
   - Two ordinary visible 30-second checks: one Delta request per check, UNCHANGED metadata under 2 KB of JSON, and no new full cards payload. Record the actual payload bytes; do not substitute the local synthetic byte count.
   - Keep a horizon, search text, expanded detail and focused control through UNCHANGED checks. Confirm that cards stay mounted and those choices remain usable.
   - Hide the tab for at least 65 seconds: no application polling for Delta, academy catalog or auth/user. Record any SDK token refresh separately from application polling. A foreground focus/visibility burst should coalesce into one research check.
   - Sign out of that own account: private cards and cache clear. Do not use SQL JWT impersonation or change production membership/review records to manufacture a passing role test.

5. Record the exact source commit, reviewed application-file hashes, deployed source version, SQL candidate hash and postflight result. Real Free/Premium/Owner Auth paths must be listed separately as tested or untested; an Owner smoke or local role fixture must not stand in for an untested account type.

For a later capacity decision, specify simultaneous visible sessions and refresh/foreground rates independently of paid account count. Record measured request rate, latency distribution, errors, Auth activity, DB CPU/connection use and egress under an explicitly authorized staging workload. The present wrapper still executes the original complete reader, so its smaller wire response is not a DB CPU or 10,000-member capacity result.
