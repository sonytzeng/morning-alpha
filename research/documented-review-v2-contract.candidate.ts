/** Fixed newly received review seal. No admission/publication grant. */
export const DOCUMENTED_REVIEW_V2_CONTRACT:Readonly<{source_seal_sha256:string;facts_sha256:string;source_review_sha256:string;review_receipt_sha256:string;review_valid_until:string;review_price_basis:Readonly<{symbol:string;session_date:string;close_twd:number;unit:string;scope:string}>;review_fact_ids:readonly string[]}>=Object.freeze({
  "source_seal_sha256": "6b3cfccff75a1960196a2edd9685290f7eb66b0bd7f0dd396c84de597ca12526",
  "facts_sha256": "53765d515cc65a5deec0514fcf8c4cae8873010f54d016cfecfec7b039c1ad94",
  "source_review_sha256": "278fc4e6bf28e819ff6b46769883889d00f9580dcf05298dc20ef3b271435398",
  "review_receipt_sha256": "6936b55fa1162caf05bb54f642559695d407b54137643e8cf09f1361a88d2cf8",
  "review_valid_until": "2026-11-02T13:30:00+08:00",
  "review_price_basis": {
    "symbol": "2330",
    "session_date": "2026-10-30",
    "close_twd": 2370,
    "unit": "TWD_PER_COMMON_SHARE",
    "scope": "RETAINED_CLOSE_AS_OF_REVIEW_NOT_CURRENT_QUOTE"
  },
  "review_fact_ids": [
    "own-documented-review:2330:DEMAND:fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72",
    "own-documented-review:2330:MOAT:fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72",
    "own-documented-review:2330:VALUATION:fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72"
  ]
});
