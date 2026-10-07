# Dedicated Recommendation Smoke Worker — 2026-10-07

Base: merged PR201 `f4c2542f5917f73d9d31eb0bf1170a3e31c061f4`.

## Authorization and isolation

Sony named the single new `RECOMMENDATION_SMOKE_WORKER_TOKEN`, dedicated to the
smoke endpoint only. A256-bit CSPRNG credential was created in controlled
server-process memory and set through the official bundled Go CLI. The newer
CLI failed to read memory pipes; no secret was created by those failed attempts.
The successful channel was a mode0600 kernel-memory FIFO, not a regular data
file. No credential value is retained here, in source, command arguments, logs,
artifacts or the browser. No second Secret, Migration or Cron was created.

Gateway JWT remains enabled. Dedicated token/version/fresh issued-at validation
is additional to it, not a replacement. Browser headers reject. Core token,
service-role or Owner/member JWT alone do not grant smoke access. The dedicated
credential is never forwarded to the downstream stock producer. Its validator
and all RLS are unchanged.

## Actual Production observations (not fixtures)

- Missing worker:401; wrong worker:401; browser:403; missing gateway JWT:401.
- Runtime service key class was NON_JWT. V1 smoke's JWT-shaped-key requirement
  returned503 before any provider call. Fixed by forwarding the already gateway-
  validated inbound JWT and keeping opaque Runtime key in `apikey` and the
  original internal token in `x-cron-secret`. No JWT bypass.
- Real2330: HTTP200, latest/20D OHLC/20D volume/20D amount each1/1, session/freshness
  PASS, business_writes empty.
- Real72 after official-event integration: downstreamHTTP200, smokeHTTP422.
  Latest60/72, OHLC59/72, volume59/72, amount59/72. Complete58,partial3,failed11.
  Source429 was observed, then the old22-second acquisition bound stopped tasks.
-1760 close quote: source timestamp2026-10-07T05:24:57.065Z, observed
  2026-10-07T06:09:30.768Z, same-day close phase. Existing13:25 lower bound rejected
  it. No freshness relaxation was applied. Additional provider close-signal/time
  evidence is required before changing its contract.
- TWSE and TPEx eachHTTP200;9source-traceable announcements across8universe
  symbols. Event type is official material announcement, impact UNASSESSED,
  bullishness not inferred. These are NOT invented V1 catalyst/news/consensus
  mappings, and not Recommendation persistence.

## Actual evaluator outcome

V1 ran over72candidates:WATCH0,READY0,NONE0,BLOCKED72. Existing liquidity
completeness57,market-fit0,sector-fit0,evidence0. Score stages did not execute
because their required evidence was absent; NOT_REACHED72, not72market rejects.
Institutional missing72;four-quarter fundamental/consensus missing72;
company catalyst mapping missing72;event-aligned reaction missing72.
Required market regime/risk/position/breadth/institutional/catalyst each missing72.
Fresh quote missing12,sector peers missing6,20D volume missing14,20D closes missing13.
Prior WATCH lineage is unavailable, not an invented zero-input proof.

## Remaining candidate vs deployed state

The candidate adds conservative50requests/minute pacing and a bounded240-second
full-universe acquisition budget (single2330 remains22seconds). Synthetic rate
tests cover pacing and retry bounds. This adjustment has NOT yet passed a new
real72smoke. It does not change the Core Retry Window or its07:30/08:45semantics.

The controller's initial65-second client bound must be raised for paced144-call
intraday acquisition. Its dedicated credential was released. Adding automatic
rotation of this already-created Secret was rejected by safety review as beyond
create-only authorization; no rotation was performed. Resumption requires an
explicitly approved credential lifecycle, not recovering it from process memory
or deploying a secret-revealing endpoint.

Natural reporting remains a separately proven runtime wiring gap: deployed
`recommendation-producer.ts` requires Runtime service key to be JWT-shaped before
dispatch; Production Runtime key is NON_JWT. Runtime anon key is also NON_JWT.
The observed07:05natural report usedV236;V237 deployed09:04, so the earlier report
is not a failed V237 execution. No manual report was run. Resolving gateway JWT
configuration without touching downstream JWT rules may need a separately
approved existing-public-key reference; do not create another Secret implicitly.

V2 remains unchanged offline Shadow. Retained same-input V1/V2 tests still reject
missing evidence; synthetic researchWATCH is not Production WATCH or performance.
No Promotion/Forward activation. Required TWD and consensus gaps remain. No claim
that new paid data is necessary, no claim that the market has no qualified stocks.

Business writes from these invocations:0. No report/LINE/recommendation creation,
historical edit, or formal threshold change. Product DoD INCOMPLETE; Sony
usability PENDING; public product approval NO.

## References

- Fugle rate-limit plans: https://developer.fugle.tw/docs/pricing/
- Fugle last-trade vs close signal: https://developer.fugle.tw/docs/data/http-api/intraday/quote/
- Supabase gateway vs handler auth: https://supabase.com/docs/guides/functions/auth-headers
