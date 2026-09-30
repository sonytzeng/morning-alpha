# Six-Bug Preventive Closure — candidate only

Base: `2e530bc0db49bf76d6188642b79e112b339872aa`. Production is unchanged.
No natural-day PASS is claimed. Commit/Push/PR/CI are authorized; Merge,
Production migration, deployment, Cron, credentials and history changes are not.

## Scope and evidence

1. Downstream consumers use the same canonical reconstructed-sector validator.
   The prior deployed LINE v60 409 reproduction is preserved in the Failure
   Hunt evidence. One pinned dependency inventory describes all affected bundles.
2. TW official calendar adds the six missing 2026 closures: February 12/13,
   May 1, September 28, October 26 and December 25. Edge, frontend mirror and SQL
   share an exact versioned data set; unknown calendar coverage fails closed.
3. Global 8 use their real cash-market proxy symbols and latest completed US
   session, including DST, weekends, holidays and early close. Age/future checks
   remain in force. Arbitrary timestamps within seven days are not sufficient.
4. One failure taxonomy preserves transport/adapter root causes separately from
   assembly and Atomic consequences. Entitlement is not a transient retry.
5. Provider Recorder V2 retains adapter identity, bounded response traces,
   calendar/taxonomy versions and exact failure decisions. The thirteen old V1
   failures remain unchanged and are explicitly LEGACY_EVIDENCE_INSUFFICIENT,
   not falsely reported as historical deterministic replay. New Research,
   Publication, Lifecycle, Closing, Learning and Acceptance capsules execute
   actual validators. Acceptance records the final post-trigger decision.
6. Retry admission consumes the shared retry classification. A successful full
   refetch continues to the real Report and local LINE path within the same
   bounded window. Later retries cannot duplicate a delivered result. At 08:45
   the final incident path cannot become another market refetch. The original
   07:30 delivery SLA remains MISS when recovery is late.

Only migration candidate:
`20260930043122_six_bug_preventive_closure_v1.sql`.
It pins exact predecessor function hashes and preserves owner, ACL, security,
defaults and search_path. No historical migration/hash is edited. Critical
evidence is service-role-only, append-only, bounded to 90 days and fail-open.
No business backfill, Cron modification or historical acceptance invocation.

## Isolated validation

All lifecycle execution uses the actual candidate handlers and SQL gates, a
fresh schema-only controlled baseline, loopback PostgREST and an internal Docker
network. Deno permits native network only to loopback. LINE dispatch terminates
in an in-memory sink with fake credentials and recipient. Real LINE calls = 0.
No final Report, Recommendation, LINE result or lifecycle PASS is seeded.

The positive chain ran monotonically from 06:50 through 07:00, Research,
Publication, LINE, 09:00/09:30/10:30/13:00/14:10/14:30, Closing, Learning and
Acceptance PASS. The next-day chain consumes the preceding generated close
batch and reconstructs Research, publishes a Report and sends once to the sink.
Next-day Provider/news and missing close responses are AUDITED_FIXTURE; retained
09/30 Provider and 09/29 close evidence remain REAL_EVIDENCE. This is a mixed
evidence Shadow test, never a claim that those future responses were captured.

Negative handlers cover TXF 403, stale US session, 429/500/timeout/temporary
malformed recovery, deadline rejection, Atomic 10/11, wrong lifecycle correlation,
missing news and missing close. The 07:40/08:00/08:30/08:35 recoveries preserve
SLA MISS and one Report/normal LINE. The deadline produces no Report and only
one local incident delivery. Official holiday mapping is checked with identical
Edge/SQL inputs. Recorder capsules are separately replayed into a fresh DB with
all original constraints/triggers enabled; expected output never drives a gate.

Test-environment corrections, not product patches: use actual retained capture
time rather than the nominal Cron second; supply required proxy symbol mapping
in old synthetic fixture builders; inject correlation conflict at the actual
Lifecycle identity boundary; preserve required read-set columns in SQL capsules.

## Guarded differences and rollout

All fourteen duplicate groups have explicit dispositions and permanent gates.
The isolated legacy Closing helper has minute precision at 18:00; the actual
14:10/14:30 collection guard rejects all three 18:00-boundary probes. This stays
NON_REACHABLE_GUARDED_RISK, with no boundary business patch. The special 09:00
state shortcut stays guarded by the actual Fetch Atomic receipt identity check.

Required candidate dependency closure: eleven functions in
`evidence/six-bug-release-bundles-20260930.json`. The existing deployed News v56
429 cooldown is retained verbatim so a shared taxonomy rollout cannot undo it.
This is not a new news strategy or a deployment authorization.

Production configuration drift cannot be zero before Sony separately authorizes
deployment. This candidate prepares the exact bundle/hash closure; no claim is
made that deployed bundles have already changed. Production smoke must later
compare every named bundle to this exact dependency inventory.

The public/Integrity/Release CI results are the actual gate outputs, not static
PASS constants in this document. No prior 47-scenario/1000-fault/5-day campaign
is restarted. Existing 9/18, 9/21–24, 9/29 and 9/30 corpus is retained with its
original evidence labels; absent historical raw responses remain absent.
