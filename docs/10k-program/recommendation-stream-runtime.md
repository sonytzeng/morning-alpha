# 72-stock pacing / gateway idle timeout — 2026-10-07

PR203 merged at eb0286320c7874744ab5b3bc74d77b22f6e17c85.
Named extra-once token rotation succeeded, metadata verified, no value retained.
Missing/wrong/no-JWT requests returned401; browser returned403. Live2330 returned
HTTP200 with price/OHLC20/volume20/amount20/session/freshness allPASS.

The subsequent actual bounded72 request returned504 IDLE_TIMEOUT at the gateway's
150-second idle limit.144 paced requests at50/minute inherently exceed150seconds.
This is a transport/pacing integration bug, not an Auth or data-quality failure.

Only after unchanged Auth and input validation, long producer/smoke responses
start a JSON stream. Periodic JSON whitespace keeps transport active. Exactly one
complete final proof is emitted. No partial batch is declared successful.
transport_result_status preserves the final inner HTTP status; callers fail closed
on non200, and still verify all previous lineage, completeness and business-write
contracts. Provider acquisition remains240seconds, producer transport260seconds,
outer smoke285seconds. No deadline/SLA/Core Retry policy changes.

Reference: https://supabase.com/docs/guides/troubleshooting/edge-function-monitoring-resource-usage
Reference: https://supabase.com/docs/guides/functions/error-codes

No new Secret, Migration, Cron, RLS, downstream Auth, data write, thresholds,
V2 promotion, public exposure, or manual Report/LINE.1760freshness remains
unmodified until a completed real acquisition yields its actual diagnostics.
