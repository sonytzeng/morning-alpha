# Signal Lab V1 — Data License Audit

Audit date: 2026-09-05
Purpose: distinguish technical accessibility from commercial rights. This document is an engineering inventory, not legal advice.

## Decision matrix

| Provider | Dataset | Storage | Derived analytics | Commercial use | Paid display | Redistribution | Attribution | Decision |
|---|---|---|---|---|---|---|---|---|
| Taiwan Government Open Data / TWSE | Listed daily trades (`dataset/11549`) | permitted under OGL v1, subject to dataset terms | permitted | permitted under OGL v1 | derived output appears permitted; raw redistribution still follows attribution/third-party rights | permitted by OGL v1 with obligations | required | `APPROVED_CANDIDATE_WITH_ATTRIBUTION` |
| Taiwan Government Open Data / TPEx | OTC daily closing quotes (`dataset/11371`) | permitted under OGL v1, subject to dataset terms | permitted | permitted under OGL v1 | derived output appears permitted; raw redistribution still follows attribution/third-party rights | permitted by OGL v1 with obligations | required | `APPROVED_CANDIDATE_WITH_ATTRIBUTION` |
| Taiwan Government Open Data / TPEx | Per-stock three-institution detail (`dataset/11856`) | permitted under OGL v1, subject to dataset terms | permitted | permitted under OGL v1 | derived output appears permitted; raw redistribution still follows attribution/third-party rights | permitted by OGL v1 with obligations | required | `APPROVED_CANDIDATE_WITH_ATTRIBUTION` |
| TWSE MIS | Real-time/basic quote fallback | unclear for persistent commercial research store | unclear | explicit information-use contract may be required | unclear | restricted without agreement | source notice may be required | `LEGAL_REVIEW_REQUIRED` |
| Fugle / sourced exchange data | Quote, historical candles, ownership/chip data | plan and upstream rights not established in repo | unclear | unclear; docs require compliance with exchange information rules | unclear | docs explicitly warn against transfer/resale/republication | upstream rules apply | `LEGAL_REVIEW_REQUIRED` |
| Finnhub | US quote data | subscription-specific; deletion required when subscription ends | unclear without written approval | personal plans explicitly exclude business use | not approved by current evidence | data and derived-result redistribution prohibited without written approval | contract-specific | `LEGAL_REVIEW_REQUIRED` |

## Primary-source evidence

### Government Open Data License v1

The [Government Open Data License v1](https://data.gov.tw/license) grants use, reproduction, distribution, public transmission, compilation, and adaptation for any purpose, including derived products and services. It requires the provider's attribution statement and excludes patent/trademark rights. Individual dataset metadata must still be retained because third-party rights or a dataset-specific notice can narrow practical use.

The relevant dataset pages explicitly identify OGL v1 and free access:

- [TWSE listed daily trades](https://data.gov.tw/dataset/11549)
- [TPEx closing quotes](https://data.gov.tw/dataset/11371)
- [TPEx three-institution per-stock detail](https://data.gov.tw/dataset/11856)

Required attribution for any future approved use must identify the exact dataset, provider, year/version when available, and link to OGL v1. Signal Lab stores `source_dataset` and `source_ref` so derived results retain lineage.

### TWSE market information

TWSE's [information-use page](https://www.twse.com.tw/zh/products/information/use.html) states that applicants for real-time or delayed trading information must follow the governing rules, execute an appropriate agreement, and pay applicable fees. The general [website terms](https://www.twse.com.tw/zh/terms/use.html) also restrict reproduction/distribution unless written permission or a government-open-data authorization applies.

Consequently, the open-data datasets listed above and the real-time MIS endpoint are not treated as the same license. MIS persistence or subscriber display remains `LEGAL_REVIEW_REQUIRED`.

### TPEx information shop

TPEx's [information shop terms](https://eshop.tpex.org.tw/zh/product/shoppingTerm) distinguish internal and external use, require authorization for external transmission, require attribution for authorized external use, and restrict onward transmission. This does not override the explicit OGL metadata on identified government-open-data datasets; it does mean non-OGL shop products cannot be assumed reusable.

### Fugle

The [Fugle market-data documentation](https://developer.fugle.tw/docs/data/intro/) states that exchange information rules apply and warns against unauthorized access, transfer, resale, sublicensing, derivative index/product creation, or third-party transmission. The [historical candle endpoint](https://developer.fugle.tw/docs/data/http-api/historical/candles/) technically supports adjusted history, but technical availability is not sufficient proof of commercial storage and paid-subscriber display rights.

Before Fugle data can feed Signal Lab beyond existing operational use, obtain written confirmation covering:

1. server-side historical storage duration;
2. internal derived analytics;
3. paid subscriber display of derived scores and reason codes;
4. whether raw values may be displayed;
5. retention after plan termination;
6. attribution requirements.

### Finnhub

Finnhub's [Terms of Service](https://finnhub.io/terms-of-service) state that using the service does not grant ownership/license in the data, subscription data must be deleted when the subscription ends, personal plans cannot be used by a business, and data or derived results cannot be redistributed without written approval.

Current repository evidence does not establish a business agreement or redistribution approval. Finnhub data is therefore not approved as a Signal Lab historical training/backtest source.

## Display and storage policy

Until legal review is complete:

- raw MIS, Fugle, or Finnhub payloads remain operational evidence only and are not copied into Signal Lab history;
- no paid page exposes raw data or provider-derived results from a source marked `LEGAL_REVIEW_REQUIRED`;
- Signal Lab UI exposes only internal statuses and deterministic outputs backed by an approved source;
- unknown rights produce `status = unavailable`, never a substituted value;
- an approved official OGL source must retain `provider`, `source_dataset`, `source_ref`, `available_at`, and `source_hash`.

## Cost assumptions (not a data license)

The V1 backtest cost contract uses official current rule references and versioned research assumptions:

- [TWSE investment guide](https://www.twse.com.tw/en/about/company/guide.html): broker commission is set by the broker; a rate above the published 0.1425% standard requires notification. Stock sell tax is 0.3%; qualifying day-trade sell tax is 0.15% through 2027-12-31.
- V1 assumes the full 0.1425% commission on both entry and exit and a separate 5 bps per-side slippage assumption. Slippage is not claimed to be an official fee and must be sensitivity-tested.

## Legal gate

```text
OFFICIAL_OGL_DATASETS = CONDITIONALLY_USABLE_WITH_ATTRIBUTION
FUGLE_SIGNAL_LAB_USE = LEGAL_REVIEW_REQUIRED
FINNHUB_SIGNAL_LAB_USE = LEGAL_REVIEW_REQUIRED
TWSE_MIS_SIGNAL_LAB_USE = LEGAL_REVIEW_REQUIRED
```

No new paid dataset has been purchased or activated by Signal Lab V1.

## Data and validation phase findings

The official OGL endpoints were queried directly on 2026-09-05 and retained only in an isolated `/tmp` research dataset. The current TWSE/TPEx OHLCV endpoints return the latest trading day, while the TAIEX dataset explicitly contains only the latest month. The TPEx metadata advertises dealer proprietary and hedge fields, but the actual OpenAPI response inspected exposed only aggregate dealer fields; the adapter therefore does not infer or fabricate the split.

Fugle currently documents historical daily candles for listed/OTC stocks from 2010 and indices from 2015, with adjusted-price support and daily completion by 16:30. Its published personal-plan pricing is free / NT$1,499 / NT$2,999 per month, but repository evidence does not identify the active plan or establish business storage and derived-commercial rights. The historical adapter is ready but remains blocked without a locally available credential and a license decision.

The official free sources remain approved for forward internal research with attribution. They do not supply the five-year historical institutional, universe and corporate-action ledger required by the V1 validity gate. No plan purchase, upgrade or license acceptance occurred.
