# Full-Day Reachability Map — isolated synthetic counterfactual

`FIXTURE_TYPE=SYNTHETIC_COUNTERFACTUAL`

`COMPANY_EVIDENCE_TYPE=SYNTHETIC_AUDITED_FIXTURE`

`REAL_PRODUCTION_COMPANY_RESPONSE=NO`

`REAL_PRODUCTION_5_DAY_REPLAY=NO`

`PRODUCTION_CHANGE=NO`

This is a business-outcome reachability audit, not a claim of real five-day Production success or statement coverage. The persistent isolated five-day sequence is 2026-11-16–20; additional isolated cross-day cases are 2026-10-12–23, 2026-11-23, and 2026-12-01–02. Earlier historical Production FAIL records are not modified. The source-verified scheduled Report Handler emits `market_only`, `recommendations`, or `blocked`; legacy `no_trade` is a compatibility/DB branch, not reachable from that scheduled generator.

The final qualified case used the existing audited `NEWS001` company-evidence fixture from `tests/consolidationCurrentPayloadAuthority.test.mjs` (SHA-256 `42bafb9d427032f235dfcd7ade1e37c5a1ce9a4add997c052a95da7cb0276691`) adapted only as an explicitly synthetic provider news input. The isolated 2026-12-02 fixture SHA-256 was `1f019c3b6db05f30a4af473a1b6cbcd779dad2c5492f41a3517479393371acd4`. Its URL was `fixture.example.invalid`; no true company response was used. The first draft failed the real news selection score (38, not selected); the audited synthetic scenario with separate synthetic macro context scored 85 and was selected by the unchanged news Handler. No final Recommendation, Report, LINE, Closing, Learning, or Acceptance row was seeded.

The 2026-12-02 actual isolated Handler path was: 06:50 Preflight 11/11 and zero business writes → 07:00 Orchestrator/Provider/Atomic `PREMARKET` 11 rows in one batch → real news canonicalization and catalyst tag → Report Handler `recommendations`, one admitted 2330, `research_evidence_admission=PASSED`, recommendation gate `QUALIFIED`, market report gate `READY` → one Report and one published READY decision → one local-sink LINE outbox `SENT` → repeat Orchestrator delivery `SKIPPED` → 09:00/09:30/10:30/13:00/14:10/14:30 checkpoints → one Closing review → Learning `succeeded` → actual Acceptance evaluator `PASS` with no blocking checks. A separate `FINAL` decision snapshot is an expected lifecycle revision, not a duplicate authoritative market batch. The company-evidence source in the generated report remained `Synthetic Audited Company IR Fixture`.

The test Edge carried only a synthetic LINE token and fake recipient. Its global fetch interceptor redirected vendor and LINE URLs to the local receiver. Before LINE delivery, IPv4 and IPv6 namespace firewall guards were installed to accept only loopback and the isolated `172.19.0.0/16` service network. Public-egress REJECT counters remained zero after delivery; 2026-12-02 local LINE sink receipts = 1; real LINE network calls = 0. No Production secret, member, or subscriber was used.

| ID | Reachable scheduled business branch | Evidence | Result |
| --- | --- | --- | --- |
| PF-01 | 06:50 READY | Five-day Handlers and 12/02 11/11 preflight | E2E |
| PF-02 | 06:50 WAITING_FOR_MARKET_DATA | Day 2 and 11/23 receipts | E2E |
| PF-03 | 06:50 provider/contract BLOCKED | `tests/premarketReadinessRetry.test.mjs`; prior 47/47 Chaos | test |
| PF-04 | 06:50 expected market phase | Preflight parity tests | test |
| PF-05 | 06:50 nontrading-day skip | `tests/runtimeDecisionTimeline.test.ts`; `tests/productionReliability.test.mjs` | test |
| AT-01 | 07:00 complete 11-provider Atomic commit | Five-day SQL and 12/02 one 11-row `PREMARKET` batch | E2E |
| AT-02 | Previous-session data rejected, Atomic 0 | Day 2 and 11/23 | E2E |
| AT-03 | Invalid/partial/concurrent batch rejected | Prior 47/47 Chaos; `tests/checkpointAtomicity.test.mjs` | test |
| RT-01 | Late 11/11 recovery without mixed attempts | Day 2 07:40 | E2E |
| RT-02 | Subsequent retry has no duplicate | Day 2 07:45 | E2E |
| RT-03 | Twelve bounded unsuccessful retries | 11/23 07:40–08:35 | E2E |
| RT-04 | 08:45 failure, zero batch/report | 11/23 Handler and SQL | E2E |
| RT-05 | Final incident LINE once | 11/23 local sink and one outbox row | E2E |
| RT-06 | Late success keeps 07:30 SLA MISS | Day 2 durable run | E2E |
| RS-01 | Current research with prior-day sector | Day 1/2/5 reports | E2E |
| RS-02 | Quality failure after valid Atomic | Day 3 zero report/LINE/Acceptance | E2E |
| RS-03 | Prior close reconstructs research | Day 4 references Day 3 raw | E2E |
| RS-04 | Insufficient prior raw rejects reconstruction | 10/22→10/23 zero fake report | E2E |
| RS-05 | Company evidence insufficient → Recommendation BLOCKED; market report published | Day 1/2/4/5; `tests/marketPublicationDelivery.test.mjs` | E2E |
| RS-06 | Audited synthetic company evidence → qualified Recommendation through all Handlers | 12/02 gate `QUALIFIED`, one Report/LINE, Closing/Learning/Acceptance `PASS` | E2E |
| RS-07 | Legacy genuine no-trade decision | Scheduled generator's gate cannot emit this mode; compatibility only | OUT_OF_CURRENT_HANDLER_SCOPE |
| PB-01 | Eligible Report published once | Day 1/2/4/5 and 12/02 one Report | E2E |
| PB-02 | Blocked Research cannot publish | Day 3 and 10/23 | E2E |
| LN-01 | Normal LINE once to local sink | Day 1/2/4/5 and 12/02 one local receipt | E2E |
| LN-02 | LINE transport failure safe | 10/21 local sink 503; pending outbox | E2E |
| LN-03 | Failed LINE not resent next day | 10/21→10/22 | E2E |
| LN-04 | No active subscriber | 12/01 Orchestrator/LINE path; zero outbox/sink | E2E |
| CP-01 | Intraday 09:00–14:10 | Four successful days and 12/02 receipts | E2E |
| CP-02 | 14:30 complete Closing chain | Day 1/2/4/5 and 12/02 | E2E |
| CP-03 | 14:30 provider failure Atomic 0 | 10/22 TXF synthetic 404 | E2E |
| CP-04 | Raw close but no Report blocks downstream | Day 3 | E2E |
| CP-05 | Incomplete Closing retry is not skipped | Isolated retry; `tests/dailyDeliveryRecovery.test.mjs` | E2E/test |
| CL-01 | Market-only Closing without fictitious stock | Day 1/2/4/5; direct regression | E2E |
| CL-02 | Atomic cannot upgrade failed Closing | Day 3 and 10/14 | E2E |
| LE-01 | Learning against same published opening | Day 1/2/4/5 and 12/02 | E2E |
| LE-02 | Learning read failure retained; next day starts | 10/19→10/20 | E2E |
| AC-01 | Acceptance after real Handler receipts | Day 1/2/4/5 and 12/02 `PASS` | E2E |
| AC-02 | Acceptance failure retained; next day starts | 10/20→10/21 | E2E |
| NX-01 | Prior Closing FAIL does not kill next day | 10/14→10/15; Day 3→4 | E2E |
| NX-02 | Prior Recommendation BLOCKED does not block next market report | 10/12→10/13 | E2E |
| NX-03 | Prior raw missing never creates fake research | 10/22→10/23 | E2E |
| NX-04 | Prior Report FAIL with raw complete recovers | Day 3→4 | E2E |
| XS-01 | Cross-day wrong-date joins rejected | Five-day SQL zero mismatches; `tests/closingLearningContract.test.mjs` | E2E/test |
| XS-02 | Wrong-revision Closing/Learning rejected | `tests/closingLearningContract.test.mjs` | test |
| XS-03 | Stale Taiwan source rejected | Day 2 and 11/23 | E2E |

`FULL_DAY_REACHABLE_BUSINESS_BRANCHES=44`

`FULL_DAY_REACHABLE_BUSINESS_BRANCHES_COVERED=44`

`UNTESTED_REACHABLE_FULL_DAY_BRANCH=0`

`OUT_OF_CURRENT_HANDLER_SCOPE=1`

The two locally corrected Product Bugs remain limited to valid market-only Closing completion and 14:30 unfinished-Closing retry. This map does not authorize Production release, historical recovery, or any Migration.
