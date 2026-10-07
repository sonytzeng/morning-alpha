# Recommendation Gateway Runtime Candidate — 2026-10-07

Predecessor: PR202 merged at db5f1ec285a2cb98df05aa6b1edb30450906f62a.

Sony explicitly authorized the existing public anon JWT reference
RECOMMENDATION_GATEWAY_ANON_JWT. It is not a new role or internal worker identity.
The downstream gateway still verifies JWT and the downstream handler still
requires its existing internal CRON identity. Opaque Runtime service keys stay in
apikey; no fallback impersonation, browser access, or RLS change.

The report caller and the dedicated read-only smoke import the identical
requestRecommendationProof implementation. Its bounded255-second request allows
the already reviewed240-second paced acquisition. Caller errors continue to
block Recommendation only, not Market Report. Report generation/publication,
formal Decision, thresholds and LINE business behavior are otherwise unchanged.

NATURAL_CALLER_READONLY performs an independently verified2330 acquisition first,
then calls the exact report shared request path in Edge Runtime. The original
report handler is NOT invoked. The endpoint returns sanitized coverage and funnel
metadata, not provider payloads or credentials. Passing this measures the live
shared caller path, NOT a claim that a future scheduled report already ran.

## Exact controller failure and current evidence limits

The named worker rotation and gateway configuration were applied. The local
controller then checked a nonexistent JSON digest field. The official Go CLI
uses SecretResponse.Value for the digest (its table header is DIGEST). This
postcondition error caused safe credential disposal. No failed Auth or Provider
request occurred in this attempt. Additional rotation must not be inferred from
the earlier once-only authorization. No token, digest, key or raw payload is
retained in this artifact.

PR202's paced acquisition is deployed. New2330/72 and live Natural Caller results
remain UNVERIFIED until an authorized controlled identity is available. The last
measured60/72 price and59/72 OHLC/volume/amount are prior-run observations, not new
results. The1760 close-session question remains unmodified pending actual
provider evidence. Institutional TWD/consensus remain missing; no V2 promotion.

No Migration, Cron, historical rewrite, manual report, LINE send, Forward,
member exposure, or additional high-privilege identity.
