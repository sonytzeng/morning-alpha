# LINE Decision Card V2 — Owner preview, not template promotion

Baseline: `9fba2d6ea5caa06046b76ba10eaab79d5a3f5088` (PR209).

## Scope and authority

Only `/admin/analysis`, behind the unchanged `get_research_foundation_v1`
Owner authority. Preview opens on demand. Existing `get-report-payload` supplies
the V1 publication projection; date, revision and canonical document identities
must agree. No new database object, auth rule, secret, Function or schedule.
The existing LINE renderer and sender are byte-identical. There is no send button.

The Owner diagnostic namespace supplies only published, identity-bound canonical
market prose. It never supplies recommendation stocks or overrides V1 gating.
Supporting/contradicting factual statements require existing ledger evidence IDs.
Timeline rules are exact canonical conditions, not observations, and carry field
paths rather than invented Evidence IDs. Missing fields are omitted; unknown
recommendation reasons explicitly say the exact detail is not recorded.

V1 READY, WATCH, NONE and BLOCKED remain distinct. NONE requires a complete,
positive-sized, same-universe evaluation. V2 uses a separate Owner panel and is
never passed to the member card composer. Near-miss is at most three and explicitly
not a recommendation. A different-date V2 result cannot populate the selected day.

## Presentation

Navy header, teal labels/CTA, white card, dark body. Market direction plus a plain
action comes first. Then action, reasons (max four), observations (max three),
actual confirmation conditions, invalidation, formal recommendation status.
Numbers, signs, negations and logical conjunctions are preserved by dictionary
substitution; no LLM, no mid-sentence truncation. Engineering lineage stays in
Owner-only details, not the Flex card. News-only degradation is secondary.
Confidence is omitted, not reinterpreted as a probability. Single CTA:
`https://morningalphatw.com/report/today`.

The browser renders the same Flex tree. This is a fixed-width browser preview,
not a claim that a real LINE application received it. LINE's official bubble
limit is 30KB; tested cards are below that bound. Reference:
https://developers.line.biz/en/reference/messaging-api/#bubble

## Verification boundaries

Synthetic fixtures are explicitly marked. The local browser harness has loopback
only CSP and mocked identity: it tests rendering and stale-response cleanup,
not Production authentication. Production Owner access is checked separately with
Sony's existing session. No token/cookie extraction, no fresh sample or trade.

10/5, 10/6, 10/7 canonical copies were read from existing published reports and
confirmed byte-equal to their pinned decision snapshot. Offline copy replays use
those captured fields in a clearly labeled replay envelope, not an invented
authenticated HTTP response. Original dates, WAIT and V1 BLOCKED stay unchanged.
No raw Production payload is committed or sent to Readdy.

Integrity appends an exact successor file inventory and hashes, restoring prior
bytes only after checking every new byte. The prior Forward manifest is immutable.

## Release and stop

Commit → CI → merge → minimal Readdy Owner UI synchronization/publication.
No backend deployment. No actual LINE call. No member template change.
`SONY_LINE_USABILITY = PENDING`; Sony must inspect Preview and approve a separate
formal LINE template promotion. V2 recommendation promotion remains NO.
