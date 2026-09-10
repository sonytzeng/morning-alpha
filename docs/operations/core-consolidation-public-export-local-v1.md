# Core Consolidation: committed public-export boundary (local candidate)

## Scope and authority

This is the same Core Consolidation root cause, not a Sony Content OS change.
Only the Morning Alpha producer/export and their directly used read types are
changed. Production, accounts, Auth/RLS/ACL, Cron, historical market data, LINE
and existing immutable acceptance results are untouched. No Production release
or complete external delivery is authorized or proved by this document.

The repository root is `/Users/sonytzeng/Documents/GitHub/morning-alpha`;
`project-11164666` is its working subdirectory, not a second repository.
Base: `6469630795fb1215595306c026437d850b668801`, branch
`codex/core-pipeline-consolidation-20260909`. The 47 unrelated untracked files
remain excluded. Existing Consolidation edits are preserved, not reset.

## Read-only deployed-source reconciliation

Morning Alpha `content-os-morning-alpha-source`, ACTIVE deployment v19,
updated-at epoch `1788331714184`, already implements
`morning_alpha_public_contract_v1` with a non-stock `market_brief` topic.
Its runtime marker is `content_os_source_v12_abstention_market_brief`.
The exact retrieved entrypoint hash is
`8f3c4a9525804ef1beaf04b8eebdfd08b72e1ea488ebae0d99232fa86f7bd7e1`.
The repository predecessor is different, hash
`c4a2f7aa37c0e1ddb7437da340b43084f3e0be88040353988a0dce6dfcd0a105`.
Both preimages are retained in the additive review artifact; neither is silently
called the other version. Existing deployed JWT configuration is recorded, not
changed. This read-only source inspection is not a downstream consumer test.

Preserved from the existing wire: public stock topic, market-brief topic,
contract version, source references, premium locked state, private/no-store,
nosniff, one-megabyte response ceiling, GET-only and existing internal Auth.
Not copied from v19: `allow_missing_public_gate`, current private-QA selector,
raw confidence/summary fallbacks, permissive older quality helpers, or blanket
same-day incident resolution. Only an exact current publication incident may
be resolved, and only after the complete outgoing payload passes validation.

## Single dependency path

```text
Actual normalized evidence index
  -> market assembler / exact evidence ledger
  -> CanonicalMarketState / atomic publication
  -> frozen source_refs + decision/member/run identities
  -> fetchPublishedDeliveryEvidence
  -> evaluatePublishedMarketDelivery / SubscriberReportProjection
  -> existing public stock topic OR existing market_brief topic
```

The exporter does not select `is_current` private QA, the newest member view,
or a report by stock quality. Premium policy absence, errors, or higher current
thresholds can suppress recommendations, never revoke committed market output.
The exact published editorial and semantic receipts remain mandatory.
Malformed or missing frozen evidence is not repaired from mutable report/news.
Older snapshots without the required frozen outgoing evidence stay unavailable;
there is no historical backfill or implicit migration in this source repair.

The small database-read adapter preserves both callers' existing Supabase SDK
runtime versions. It checks the used method boundary, delegates with the proper
receiver, preserves filters/order/results/errors, and neither grants permissions
nor performs publication decisions. No SDK upgrade, `any`, or unchecked client
cast substitutes for the contract.

## Provenance repair, not synthetic evidence

`buildEvidenceIndex` already has NEWS title, original URL, and publication time.
The assembler previously retained only `(evidence_id, source, source_date,
freshness)`. The candidate also freezes the existing complete safe metadata and
preserves it in canonical source references. That four-tuple, claim IDs,
coverage, timestamps, and all publication/recommendation thresholds are unchanged.
Market-data evidence without a URL gains no invented URL.

The fresh 13-handler attempt exposed a second producer boundary defect: its
actual 17-row index (11 market data, 3 news, 3 sector context) contained three
complete verified news sources, but the old top-five presentation selection
chose only market data. Merely preserving metadata could not fix a fact that
never entered the factual claim ledger. The real export correctly returned 409;
neither that publication nor its OPEN incident has been rewritten.

The canonical market assembler now retains an eligible news item's original
title/summary as its own supporting fact with its unique explicit evidence ID.
It uses the existing supporting-fact builder, deduplication and unchanged final
validator. It does not attach unrelated news to a market-price claim, promote
conditional validation nodes, change the private assembler/top-five ranking,
alter stock quality thresholds or repair evidence in the export consumer.
Missing provenance, unverified/stale/future/conditional news and duplicate IDs
cannot enter this additional factual path. The new 23-case regression includes
the exact observed index shape and verifies unchanged private research output.
These unit results are not a substitute for a new persisted 13-handler replay.

Only original HTTPS metadata with a valid timestamp is exported. Credentials,
query strings (including ordinary tracking queries), fragments, missing titles,
and malformed dates are deliberately unsupported; the original ledger is still
retained. No URL is stripped or rewritten into a fabricated citation. This
conservative limitation can make an export unavailable and is not a claim of
universal provider URL compatibility.

## Evidence boundaries and retained failures

The prior real 12-handler local run remains 96/96 for its sealed source and
scope, including terminal reconciliation and final Acceptance. It did not run
the 13th exporter and cannot prove this candidate's complete handoff.
The captured 2026-09-21 output has no frozen HTTPS citation metadata: its actual
export correctly returns 409. The new isolated database test records the real
incident and produces a real FAIL Acceptance, `CONTENT_HANDOFF_INCIDENT`, without
changing the valid market publication, Closing, Learning or LINE receipts.
This is a passing negative-control test, not a successful external delivery.

Counterfactual NEWS-only citation tests are explicitly synthetic and separate
from captured rows. Original capture bytes and original failure rows remain
unchanged. The immutable 9/7, 9/8 and 9/9 Production failures remain failures.
Manually driven local replay is never a natural automatic stability day.

## Integrity and release boundary

The proposed Eighth registration has NOT been applied. Normal safety review
rejected both complete submissions; the second requires trusted exact per-file
authorization for the artifact, append-only registry and guard seal. No third
submission, split application or indirect write has been attempted. The old
23-file proposal remains preserved; the new producer fact repair and its test
require a newly reviewed, unexecuted 24-file proposal. Its draft is not approval.

If explicitly authorized and applied, that registration would append reviewed
file/preimage/diff/declaration/test successors to the seven unchanged historical
layers. Until then, Integrity fails closed and Commit/Push/CI are not complete.
The original Production
hashes and exact earlier registry bytes are preserved. Every predecessor guard
remains required, and current-candidate drift must be checked independently. Exactly two
source-assertion cases change to the actual committed-reader contract; all other
case bodies and historical negative controls remain intact. Two additional
source-shape assertions retain their original semantic checks after the local
variable rename and checked read-adapter delegation; no assertion is removed.

Rollback is source-only to the artifact's exact predecessor bytes. No business
RPC is invoked, no historical incident is erased, and no runtime is redeployed.
Full final regression, fresh full-stack evidence, exact-head CI, and actual
Readdy host preview remain separate release gates. Local Readdy-compatible
packaging must not be reported as a successful Readdy host build.
