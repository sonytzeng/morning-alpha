# 正式基線唯讀稽核
2026-10-10：只讀 metadata，不匯出會員、交易或原始業務 payload。
GitHub main fff51d76a8e6c90768772023c37afbb112761a3a；Readdy672 為前輪正式來源比對與實機驗收基線。本輪不將 Git SHA 誤認每支 Edge 的部署 SHA，也不將 ACTIVE 等同自然 E2E PASS。

|Function|正式 metadata|
|---|---|
|line-daily-push|ACTIVE V70|
|generate-daily-report-v7|ACTIVE V248|
|daily-delivery-orchestrator|ACTIVE V44|
|research-analysis-shadow-v1|ACTIVE V10|
|owner-trading-lab-v1|ACTIVE V9|
|recommendation-stock-evidence-v1|ACTIVE V14|
|recommendation-stock-evidence-smoke-v1|ACTIVE V15|
|recommendation-v2-forward-worker-v1|ACTIVE V2|
|entry-opportunity-shadow-v1|ACTIVE V3|

舊指令記錄 LINE V69；現況 metadata V70。只記錄差異，沒有回復、部署或觸發 LINE。V659 自然發送驗收仍由原獨立任務負責。

已查 schema：company_events、news_events、research_facts、research_methodology_versions、research_*、recommendation_shadow_v2_*、entry_opportunity_*、academy_* 存在；Signal Lab PR103 tables 不在查詢結果。
company_events 缺明確 first_seen_at/available_at、原始 payload 不可直接變會員事件。
news_events 有 published_at/fingerprint/created_at，但無完整 license/PIT publication contract。
因此採新 private 研究 envelope 引用來源，不修改既有 schema 或補寫可得時間。

本次 Production 寫入、migration、deploy、merge、Cron、Secrets、Auth/RLS 修改皆 0。正式 business content diff 沒有重新做全資料 fingerprint；安全證據是零業務操作及受保護程式碼逐 byte 比對，不能冒充資料庫全量一致性快照。
