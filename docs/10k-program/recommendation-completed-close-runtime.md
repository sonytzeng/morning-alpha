# Recommendation completed-close Runtime correction

Production observation after PR204 (2026-10-07): transport completed with HTTP200,
inner422; requested72, success71, partial1, failed0. OHLC20, volume20 and amount20
were72/72. No429/timeout failures. Latest price71/72: only1760 failed freshness.
Its source timestamp was2026-10-07T05:24:57.065Z, session2026-10-07, phaseclose,
observed_at2026-10-07T08:18:37.841Z. isClose is the only adapter path to phaseclose.

Exact cause: recommendationQuoteCurrent incorrectly required a completed-session
last execution to occur after13:25. Official Fugle quote documentation distinguishes
lastTrade.time (last execution) from isClose (session close signal):
https://developer.fugle.tw/docs/data/http-api/intraday/quote/

The fix retains explicit provider_is_close in normalized evidence and its hash.
Only a Fugle acquisition quote with that proof, completed regular session, receipt
on the same trading day after13:30, last execution09:00–13:30, no future receipt,
and the existing expected-session predicate gets completed-close semantics.
Actual source_timestamp is never replaced by13:30. Intraday20minute freshness,
Core/TAIEX, V1 scoring/thresholds, Auth, Cron, Secrets and Atomic are unchanged.

Tests use the real failure timestamp/shape with explicitly synthetic numeric
values, not an invented archived response. Live72 reacquisition is still required.
PR204 also observed72 institutional-TWD and72 consensus blockers; source-traceable
TWSE/TPEx events9 across8 symbols, impactunassessed, not fabricatedbullishmappings.
No migration, business writes, Forward or methodology promotion.
