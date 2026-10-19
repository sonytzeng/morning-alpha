# Producer15 monthly response delivery artifact

This package preserves the actual Production15 runtime and adds the reviewed
same-bundle monthly-response transport. It does not replace the repository's
current Producer entry, which contains other separately staged work.

The fresh read-only baseline returned Version15 ACTIVE, JWT verification enabled,
no import map, and20/20 source hashes matching the retained original archive.
Its entry already uses `@supabase/supabase-js@2.57.4`; a carried-over summary's
unversioned-`@2` blocker was incorrect for this Function. The existing63-module
SDK evidence remains historical. No new SDK, source probe or SDK-equivalence
claim is introduced here.

## Exact artifacts

Run from the repository root:

```sh
node --test tests/producer15MonthlyRelease.test.mjs
node scripts/operations/producer15-monthly-release-20261019/materialize.mjs candidate
node scripts/operations/producer15-monthly-release-20261019/materialize.mjs recovery
deno check --no-lock build/producer15-monthly-release-20261019/candidate/supabase/functions/recommendation-stock-evidence-v1/index.ts
deno check --no-lock build/producer15-monthly-release-20261019/recovery/supabase/functions/recommendation-stock-evidence-v1/index.ts
```

The candidate has22 source files:21 runtime inputs and one type-only contract.
Only the Producer entry changes among the20 original runtime files, and one
monthly-sharing helper is added. The19 other original runtime sources, original
normalizers, evaluators, SDK import, Auth, cache reservations and output contracts
remain byte-identical. The five exact entry edits are sealed in the catalog.

The recovery has21 files: the20 exact original runtime inputs and the same
type-only support. Both artifacts add only the explicit `.ts` extension to one
historical type import. A test proves identical erased JavaScript. The untouched
original type and exact original rollback payload are also reconstructed and
fingerprinted; each materialization saves that payload separately.

Outputs are fixed beneath `build/producer15-monthly-release-20261019/`. The
materializer refuses to overwrite files, follow source/output symlinks, use a
different source set, or substitute current main modules for original15 bytes.
Materialization does not deploy or invoke a Function.

## Validation boundary

The tests compare the actual original15 parsers and normalized results with the
artifact's parsers. Healthy requests for these source paths fall from10 to8;
each fixed monthly URL is fetched once instead of twice. Bad JSON, HTTP refusal
and body failure preserve original refusals and the other exchange's success.
Actual acquisition-body tests verify nonmonthly transports and cleanup ordering.
These are synthetic transport tests with no Provider or database request.

A previous attempt to run the newer main parser's focused tests against the
original15 parser produced2 PASS and3 FAIL. That record and its three assertions
are preserved in the catalog: original15 lacks the newer raw-byte hash field,
uses the original timeout classification, and lacks the newer4096-read cap.
This release does not claim to install those newer parser protections or erase
the failed comparison. Current main's tests retain their original assertions.

No quarterly capsule, retained financial data, private capture, source admission,
membership policy, payment, LINE, Cron, RLS or Auth change is included. Caller is
outside this artifact and remains untouched. A real result must come from the
next legally scheduled natural acquisition; the package cannot repair invalid
upstream JSON, invent missing financial evidence, reset a consumed batch or
guarantee a READY stock.
