# 事件契約
來源順序：官方公告／財報／月營收／法說／交易所，才是可信媒體與合法 Provider。
source + source_event_id 明確對應 event_id；不以模糊標題合併不同公司事件。
(event_id,revision) immutable、重複 exact revision 冪等；同 revision 不同內容拒絕。
修正用新 revision，available_at 單調；last_verified_at 不晚於觀察 cutoff。
相同事件 timeline 始終只有一個 distinct_event_count，不把更正多次計利多。
published_at / first_seen_at / available_at / last_verified_at 分開保存。
CONFIRMED_FACT、REPORTED_CLAIM、INFERENCE、UNVERIFIED 明確分類；只有具備來源的事實能滿足必要 fact gate。
每筆留 affected_companies、expected_horizons、invalidation、evidence_ids/hash。
來源缺 available_at 時拒絕整合，不能從 title、event_at 或 created_at 猜測。
正式 ingestion 自然 caller：NOT_ENABLED。本輪不觸發任何既有市場/新聞流程。
