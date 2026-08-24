# Morning Alpha Continuous Learning Engine v1

狀態：程式碼與隔離 Branch 資料庫驗證完成；尚未套用 Production migration、部署 Edge Functions 或執行歷史 backfill。

## 1. Current Architecture Audit

- `generate-daily-report-v7` 已負責盤前資料擷取、Scoring、OpenAI／deterministic fallback、Editorial／Premium Gate、`reports` 寫入與 `publish_decision_snapshot_v2`。
- `decision_snapshots` 已是 PREMARKET／CLOSING 的 canonical immutable-versioned decision contract；CLE 沿用它，不另建重複的報表快照系統。
- 收盤流程由 GitHub Actions 依序呼叫 `close-market-review` 與 `closing-verification-engine`。既有 closing verification 已計算 TAIEX 方向、受惠股相對績效與結構化驗證。
- `prediction_accuracy_logs` 與 `close_market_reviews` 已保存局部驗證成果，但沒有逐筆 immutable prediction、跨時距 outcome、case/pattern、calibration、backtest 與 rule lifecycle。
- Production 盤查時 `decision_snapshots`、`editorial_reviews`、`pipeline_runs`、`content_feedback` 尚無資料；`prediction_accuracy_logs` 26 筆、`close_market_reviews` 27 筆。這些資料未被改寫。
- `market_data_snapshots` 有 2026-06-26 至 2026-08-21、21 個 symbols、901 筆資料；TAIEX／2330／美股資料可供初期驗證，但個別受惠股覆蓋稀疏，必須由 Data Quality Gate 排除不足樣本。
- 現有 production profile 盤查只有 `member`，沒有 `admin`；因此後台程式雖已實作，部署後仍需另行核准一名管理員角色才能存取。

## 2. Implemented Architecture

CLE 是既有正式流程後方的 failure-isolated sidecar，而非新內容管線：

1. PREMARKET canonical decision snapshot 正規化為 append-only `learning_predictions`。
2. Closing verification 完成後，CLE 以可信 market snapshot 更新 intraday／close／1D／3D／5D outcome。
3. Deterministic evaluator 先計算方向、時機、相對績效、資料品質與初步 error taxonomy。
4. 每日最多一個小型 semantic batch（最多 12 個可信錯誤）只補充 root cause／missed signal／lesson；沒有 API key、逾時或回應不合法時維持 deterministic 結果。
5. Error／Success cases 聚合為結構化 market patterns。
6. 樣本足夠才建立 rule candidate，依時間順序切分 training／out-of-sample，通過後進入 shadow。
7. Shadow 只累積新資料，不讀取啟動日前樣本，也不影響 Production。
8. 下一次晨報只讀 90D calibration 與 `status = production` 的完全匹配規則；學習資料表尚未部署或讀取失敗時維持原始 Confidence。

## 3. Database Changes

Migration：`supabase/migrations/20260822090000_continuous_learning_engine_v1.sql`

| Table | Responsibility |
|---|---|
| `learning_predictions` | 不可更新／刪除的逐項 prediction；revision 以 self-FK 串接原始版本 |
| `prediction_outcomes` | 唯一 `(prediction_id, horizon)` 的多時距結果與 MFE／MAE／benchmark／abnormal return |
| `prediction_reviews` | 結構化 Prediction vs Reality review |
| `learning_cases` | 永久 error／success memory；唯一 `(prediction_review_id, case_type)` |
| `market_patterns` | 結構化維度 fingerprint、樣本、成功率、return、calibration gap |
| `learning_rules` | candidate → backtesting → eligible_shadow → shadow → production／rejected lifecycle |
| `rule_backtests` | 時序 OOS 回測、baseline／candidate Brier error、regression failures |
| `model_evaluations` | 30D／90D、model/version/confidence-bucket metrics |
| `learning_runs` | idempotent job、狀態、計數器、錯誤、重試資訊 |
| `learning_audit_logs` | append-only 系統與 rule lifecycle audit |

`decision_snapshots` 與 `reports` 保持 canonical；CLE 只透過 FK 正規化，不重建既有責任。Schema 已預留 10D／20D horizon，但 V1 runtime 只更新規格要求的 intraday／close／1D／3D／5D。

## 4. Learning Pipeline

- Job key：`{target_date}:{daily|backfill}:CLE_V1.0.0`。成功重跑直接回傳既有 run。
- Prediction key：canonical snapshot/report identity + window + symbol + horizon + engine version。
- Snapshot 改版會新增 revision，不覆寫舊 prediction。
- Outcome 以交易日序列而非 calendar day 計算，並以 `(prediction_id, horizon)` upsert。
- 缺資料會標成 `insufficient_data`、`provider_failure`、`stale_data`、`incomplete_market_session` 或 `invalid_prediction`；這些結果一律 `learning_eligible = false`。
- Review 同時區分 Direction、Timing、Catalyst、Surprise、Taiwan Mapping 與 Price-in；`Catalyst Correct ≠ Trade Correct` 是獨立 error type。
- Similar Case retrieval 由 `pattern_dimensions`／`case_signature`／regime／confidence bucket 索引提供；不把整份歷史資料注入 Prompt。
- Semantic layer 不接收新聞全文、來源 metadata、thesis 或自由文字，只接收已驗證的 enum／score／return；輸出欄位、長度、action 與 adjustment 皆再驗證。

## 5. Security / RLS

- 10 個 CLE tables 全部 `ENABLE RLS` + `FORCE RLS`。
- `public`、`anon`、`authenticated` table privileges 全部撤銷；僅 `service_role` 可讀寫。
- Advisor 顯示的 `RLS enabled, no policy` 為此內部模型的預期結果：一般角色連 table privilege 都沒有，service role 以 server-side bypass RLS 存取，不建立會員政策可避免誤開資料。
- 一般會員前台不查詢 CLE tables；Learning Center 先以 access token 執行 `auth.getUser`，再由 server-side `profiles.role = admin` 驗證。
- Rule promotion 只能由已驗證管理員的 Edge Function 呼叫 `promote_learning_rule_v1`；RPC 使用 `SECURITY INVOKER`、固定空 `search_path`、只授權 `service_role`，並再次驗證傳入 ID 對應 admin。
- Database trigger 再檢查 admin identity、理由、OOS passed、OOS n ≥ 10、shadow n ≥ 10 與 shadow completed；所有狀態改變寫入 append-only audit log。
- Cron endpoint 使用 `x-cron-secret`；service-role key 僅存在 Edge runtime。
- 現存專案仍有與 CLE 無關的 Security Advisor 警告（例如既有 public SECURITY DEFINER functions、leaked-password protection 未啟用），需獨立 remediation，不在本 migration 中偷改。

## 6. Cron / Scheduling

- `morning-alpha-runtime-checkpoints.yml` 將 CLE 放在獨立 job，使用 `always()` 與資料庫 `CLOSING_VERIFIED` gate；收盤抓取 job 失敗不會再讓 CLE 直接 skipped。
- Closing watchdog 若已確認完成，會跳過重複的核心與受惠股收盤抓取，改用已保存的正式收盤證據。
- Supabase Cron 在台北時間 14:40、14:50 透過既有私有 token route 執行同日 CLE 備援；兩次觸發使用相同 run key，第二次必須重用第一筆結果。
- CLE step 設為 `continue-on-error: true`，最多嘗試兩次；失敗只留下 degradation 訊息，不能阻止 closing/report/LINE 等正式服務。
- Release workflow 僅允許手動觸發，並以互斥的 `migration`／`deploy` input 分隔 Production database migration 與 Edge Functions deployment。
- `deploy` 階段已加入兩個 Edge Functions：`continuous-learning-engine` 與 `get-learning-center`，且不會執行 `supabase db push`。
- Backfill 必須顯式傳 `backfill=true` + 單一 `target_date`；不提供不受控的 bulk mutation。
- 非交易日、缺 canonical report 或缺 current PREMARKET decision snapshot 的日期會 skip／degrade，不能為了補歷史而從不可信舊內容反推 prediction。

## 7. Backtest Method

- Pattern 至少 20 個可信、可判定樣本才可能產生 candidate。
- 樣本依 `report_date` 排序，以前 70% training、後 30% out-of-sample；OOS 至少 10 筆。
- V1 比較 baseline Brier error 與套用候選 confidence adjustment 後的 Brier error，並以 paired Brier improvement 的單尾 90% lower bound 檢查最小統計支持。
- Backtest 同時記錄 OOS accuracy、market-regime slice、平均 abnormal return 與 max adverse excursion；exact-pattern condition 避免規則外溢到其他 regime。
- 只有 candidate OOS error 嚴格優於 baseline、paired lower bound > 0 才標為 passed 並成為 `eligible_shadow`。
- Shadow 從啟動後的新 prediction 開始累積，至少 10 筆才完成；歷史 backfill 不啟動或推進 shadow。
- Promotion 仍需管理員人工理由與資料庫 guard。AI、Cron、candidate/backtest 程式都不會自動寫入 production。

## 8. Calibration Method

- Confidence buckets：`<50`、`50–60`、`60–70`、`70–80`、`80–90`、`90+`。
- 每個 model version 產生 30D／90D accuracy、precision、Brier、calibration gap、mapping accuracy、price-in error rate、false-positive rate 與 data-completeness rate。
- 下一次晨報只使用相同 model version + bucket 的最新 90D evaluation，且 `sample_size >= 20`。
- Calibration adjustment = empirical accuracy − model confidence，單次限制在 ±10 points。
- 完全匹配目前 structured pattern dimensions 的 production rules 才能再調整，全部 production rule 合計另限制在 ±10 points。
- Decision snapshot 內部保存 raw model、calibrated、final confidence、evaluation key 與 applied rule IDs；公開 report 只保存最終 confidence，不曝光 Market Memory。

## 9. Test Results

- `node --test tests/*.test.mjs`：168/168 passed。
- CLE unit／integration：15/15 passed（包含 data-failure exclusion、revision/idempotency、production-only rule、shadow/OOS/promotion guard、RLS/API、cron isolation）。
- `npm run type-check`：passed。
- `npm run lint`：passed，0 warnings。
- `vite build`：passed，195 modules transformed。
- 三個受影響 Edge Functions TypeScript transpile：passed。
- 兩個受影響 GitHub Actions YAML parse：passed。
- `git diff --check`：passed。
- CLE migration 在無 Production 資料的 Supabase Development Branch 實際 apply：passed。
- PostgreSQL transaction smoke：Prediction/Audit append-only、Outcome idempotency、未達門檻 Promotion 阻擋、admin + OOS + Shadow 正向 Promotion 與 Audit 全部 passed；測試資料已 rollback。
- PostgreSQL catalog：10 tables 均 `RLS + FORCE RLS`；anon/authenticated 無 table privilege；service role 有必要權限。
- Advisor remediation：7 個 CLE Foreign Key covering indexes 已補齊；Promotion RPC 已改為 service-role-only `SECURITY INVOKER`，對應 Advisor warning 歸零。

## 10. Remaining Risks

- CLE migration 本身已在隔離 Branch runtime 驗證；但整個 Morning Alpha migration ledger 無法從空資料庫完整重播：既有 `202606260002_opening_radar_degraded_metadata` 依賴未被 migration 建立的 `opening_market_radar`。CLE 測試使用最小 dependency scaffold，不代表全專案 baseline 已修復。
- 個別台股 market snapshot 覆蓋不足，初期 symbol outcome 會大量落入 `insufficient_data`；這是正確降級，不應放寬 gate。
- V1 OOS regression 指標以 calibration/Brier 為主；跨多 regime 統計顯著性、drawdown trade-off 與 sector benchmark 仍需更多可信歷史樣本後擴充。
- Semantic review 依賴既有 OpenAI key；失敗會 deterministic fallback，不影響主流程，但 root-cause 語意深度會下降。
- Production 尚無 admin profile；不得由此次程式變更自行提升任何使用者權限。

## 11. Production Readiness

程式碼層 readiness 可在所有回歸通過後標為 GO。Production cutover 仍需依序取得獨立核准並執行：

1. 另案補齊 Morning Alpha baseline migration，使整個 Repository 可由空資料庫重播。
2. 另行核准 Production CLE migration。
3. 另行核准並部署兩個 Edge Functions 與既有 generator 更新。
4. 指定一名必要的 admin profile（正式資料變更，另行核准）。
5. 以一個可信交易日做 backfill smoke test，確認 idempotent rerun、Data Quality Gate、Learning Center 與 failure isolation。
6. 再啟用完整歷史可信資料 backfill；不納入無 snapshot／無收盤／provider failure 的日期。

## 12. GO / NO-GO

- **Code readiness：GO。** Source-level build、typecheck、lint、tests 與 integration guards 全部通過。
- **Production deployment：NO-GO。** CLE migration 已通過 Branch runtime 驗證，但 Edge 尚未部署、Production 無 admin、live smoke/backfill 尚未執行，且全專案 baseline migration 仍不可從零重播。這些步驟必須保留獨立審批，不能在本次開發中越權完成。
