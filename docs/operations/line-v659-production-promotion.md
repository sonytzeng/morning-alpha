# LINE V659 member-template promotion

Scope: only line-daily-push payload composition. Approved Owner Preview V659 / PR214 is the immutable copy authority at 8be2d3a575b9a3813eb1919b77a7e1f9a0755e53.

## Runtime
Existing internal auth → current report/publication proof → existing V1 subscriber projection → pure V659 composition → existing outbox/LINE transport.
No new endpoint, recipient selection, token, schedule, dispatch, retry or dedup behavior.
Owner-only V2 summaries remain exclusively in the UI wrapper; the shared member composer has no Shadow import.
The pure composer retains legacy preview metadata deliveryEnabled=false: it has no ability to send. The formal Sender's payload reference is LINE_DECISION_CARD_V2_V659.

## Evidence
Real saved Production market/publication inputs for 2026-10-05, 06, 07, 08 were captured read-only on 2026-10-08 and retained ONLY locally, never uploaded to this public repository.
The public receipt tests/fixtures/line-v659-real-replay-receipt.json contains dates, hashes and pass/fail aggregates only. It contains no report text, recipients, members, credentials or dispatch data.
Offline replay uses the captured business date clock, never sends a message and never changes a historical report.
The actual publication gate and Sender renderer run against these inputs. Each Flex tree must exactly equal the immutable approved V659 composer output.
Mandatory local real replay command: MA_LINE_REAL_REPLAY_FILE=/private/tmp/ma-line659-publication-replay.json node --test tests/lineProductionRealReplay.mjs .
This gate fails without its real capture input. GitHub checks the source-bound receipt plus synthetic regression, not a pretend raw Production replay.
Additional synthetic READY/NONE/BLOCKED controls are labeled tests, not Production incidents.
Historical Integrity manifests are immutable. A new exact-file/hash transition restores the PR214 predecessor before checking earlier chains.

## Flex
Validate the used box/text/button/bubble schema, one HTTPS CTA, altText <=400 and bubble <=30KB.
Official references: https://developers.line.biz/en/reference/messaging-api/#flex-message and https://developers.line.biz/en/reference/messaging-api/#flex-message-elements .
V659 typography, wrapping and branding are unchanged. No claim of real LINE app delivery before natural dispatch.

## Rollback
Prior Production line-daily-push V68 was read-only source-compared with the baseline SHA: all 27 bundled files identical.
Rollback reference: 8be2d3a575b9a3813eb1919b77a7e1f9a0755e53:line-daily-push@68.
Redeploy ONLY this baseline Function and its exact dependencies with existing verify_jwt=false/custom internal validator unchanged. Never reset outbox/dedup/history.
New deployment adds only the pure composer + adapter to this dependency bundle.
If deployed-source renderer validation fails, restore this baseline before permitting further new-template deliveries.

## Release acceptance
Tests → type-check/lint/build/Deno → GitHub required checks → merge → deploy ONLY line-daily-push → download deployed sources and run no-send renderer replay → compare aggregate business fingerprints.
No report generator, manual Fetch, manual LINE or resend.
LINE_TEMPLATE_PROMOTION and LINE_NATURAL_E2E are distinct gates.
Until a next legal natural dispatch is observed, NATURAL_LINE_DELIVERY=NOT_OBSERVED_YET.
Natural observation is read-only: business date, template payload fingerprint, V1 status, aggregate recipients, success/failure/dead letter/duplicate counts; never output recipient identity.
