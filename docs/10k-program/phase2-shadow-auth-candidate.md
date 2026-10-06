# Dedicated Shadow Worker Auth — candidate, NOT Production released

Base: PR193 merged main `8561f4cb78ccc7b5e49885dd18585a0cfe63f41c`.
Sony authorized candidate code, isolated tests, Commit / Push / PR / GitHub CI only.
No Production Secret creation, Function deploy, replay, UI publish or automatic caller.

## Identity and operation contract

`research-analysis-shadow-v1` alone references `SHADOW_ANALYSIS_WORKER_TOKEN`.
It must be an independently generated 32-byte-or-stronger random base64url token,
kept only in the approved Secret Store and the controlled caller's memory.
Never reuse CRON_SECRET, service-role, Owner or member credentials. The candidate
does not create, copy, persist or read a Production credential.

The dedicated headers are `x-shadow-worker-token`, `x-shadow-worker-version: 1`,
and `x-shadow-worker-issued-at` (epoch milliseconds). The latter limits accidental
delayed requests to five minutes, allowing 30 seconds of clock skew. It is not a
signed timestamp or a claim to prevent a token holder from issuing a new request.
The token comparison is constant-work SHA-256 digest comparison. No shared Core
validator is changed/imported. CRON, apikey, JWT role claims and Owner sessions do
not authenticate this worker. Gateway-added Authorization cannot mask the dedicated
header. Browser Origin/Referer/Sec-Fetch-Site requests are rejected; no CORS/preflight is
provided. RLS remains the unchanged final Owner read boundary.

HTTP 401 carries only AUTH_MISSING / AUTH_INVALID / AUTH_VERSION_MISMATCH /
AUTH_EXPIRED. Internal runtime logs retain a fixed event, stage and reason only;
never tokens, request headers, payloads, arbitrary exception text or identities.
No Recorder/table dependency is added to Auth or to the business pipeline.

Caller V1 (`scripts/research-shadow-caller.mjs`) has no public listener or browser
integration. It receives a Secret Store resolver callback, uses the fixed worker
URL, denies redirects and sanitizes receipts/errors. Production invocation must
wait for separate approval. It does not use a service-role credential. The default
batch is three calls followed by exactly one idempotency pass; any failure stops
the batch with no automatic retry or credential substitution.

Before constructing the privileged DB client the Function independently permits
only ANALYZE + HISTORICAL_REPLAY, dates 9/30, 10/1, 10/2 (2026), and each 07:30
Taipei cutoff. No arbitrary dates, JSON fields, RPC names, table names, Forward,
LINK_OUTCOME or OBSERVE_INVALIDATION are accepted by this manual V1 identity.
The only database paths are the fixed research lookup, research input RPC and
research store RPC. The existing service-role remains an implementation detail
inside the Function, not a caller identity or a database credential for the caller.
This is application allowlisting, not a claim that the DB service role itself
has become least-privileged. No Schema/RLS change or Migration is required.

## Production-equivalent test boundary

Controlled caller → real loopback HTTP → Deno loading the actual entrypoint →
dedicated validator → unchanged research engine → real isolated PostgreSQL
reader/writer → Owner RPC/RLS. Only the Supabase SDK database transport is mapped
to a local, allowlisted SQL bridge. Deno network permissions are loopback-only.
The server-binding shim only chooses an ephemeral loopback port; it does not
replace Auth, Handler, clock, engine or persistence. Test identities are generated
ephemerally, never saved as fixtures. Tests also cover gateway-added headers,
missing/wrong/CRON/service/member/Owner/browser identities, version and time
failure, and zero DB calls on rejected auth/operations. This is an equivalent
candidate HTTP contract test, NOT a claim that Production Secret configuration
or Supabase's deployed gateway has already passed a live smoke.

Retained immutable fixtures drive 9/30 UNAVAILABLE / PREVIOUS_COMPARISON_UNAVAILABLE
/ WAIT / 3.8821 and 10/2 range / BULLISH / HIGH / WAIT / 17.3047. 10/1 retains
missing evidence. Owner catalogue has 3 historical records, 0 Forward; second
pass preserves count, IDs and hashes. Append-only, anonymous/member/paid denial,
Owner reads and fixed business-fixture hashes are checked in the same isolation.
No cross-time Production table hash is used to claim the candidate caused changes.

## Release proposal (requires Sony approval)

1. Provision exactly SHADOW_ANALYSIS_WORKER_TOKEN in approved Secret Store, with
   a controlled server runtime able to resolve that same dedicated identity.
   Do not pass a secret via CLI argv, file, artifact, Git, browser or Readdy.
2. Deploy only research-analysis-shadow-v1 from the eventual approved HEAD.
3. Execute the controlled three-date batch, once plus one idempotency pass,
   then terminate the credential-holding process. Abort on any HTTP failure.
4. Verify scoped business no-write evidence and historical3/Forward0, then resume
   Owner UI acceptance using Sony's actual Owner session (not the worker token).

Migration: NONE. Cron: NONE. Public UI/Core Auth/Core Functions: NO CHANGE.
Forward design only: Core READY → asynchronous bounded dedicated dispatcher →
worker → immutable prediction, never a synchronous Core dependency. Not enabled
by this candidate; future operations require a separate reviewed capability.
