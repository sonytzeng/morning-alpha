# 每日股票研究本輪上線審閱

本輪目標是每日真實來源 → 72 檔 AI 短、中、長期分析 → 審查與會員閱讀。目標一萬名付費訂閱者，尚未以一萬人併發壓測證明容量。

## 已實際更新的本人研究

- 正式 `/stocks` 已讀到新私人版本 `c450970cd6ecceb7d8fca2794df66ba6a27f2289171bc4a5845cf17bfcaeb8be`；分析完成於 2026-10-31 11:25 台北，行情仍截至 10/30。
- 四檔重點股、12 個期間判讀已核對新增新聞；其餘 204 列沿用原篩選並保留新聞缺口。72 檔逐檔新聞未全數補齊。
- 正式瀏覽器已逐一驗收短、中、長期；中期理由與條件獨立，未帶入短期買區；四個舊價格計畫全部撤回。
- 此私人版本以 ChatGPT 本次研究流程完成，正式模型 API 執行數為 0。尚未發布給會員。

## 根因與本輪變更

既有期貨來源 `fugle_futopt` 在 10/30 盤前回傳 HTTP 403 / PROVIDER_ENTITLEMENT，既有 11/11 原子市場批次因此未成立，10/30 股票研究 run 也未建立。Cron 的 SQL 成功並不代表下游業務成功。

新增獨立 AS_OF 來源佇列，沿用有來源雜湊及日期的保留財務資料；公開交易所價格、新聞與可核實的美股／期貨資料獨立收集。未取得資料會變成實際雜湊的一部分並在會員頁顯示，不冒充今日完整財報或已發生的未來事件。原 Forward、Core、LINE 及原 Cron 排程不變。

首批真實種子包含 72 檔、5,165 筆證據、三個新取得的美股收盤指數，以及一筆較早成功保留的官方台指夜盤。夜盤保留時間為 10/31 11:47 台北，不冒充本次新抓取；首批證據截止為 10/31 12:03 台北。原生 Node 連線在本機環境失敗，三個美股來源透過 urllib HTTPS 實際讀取；正式 Deno 端連線仍待部署後驗收。夜盤新抓取曾達期限，失敗收據保留，未刪除或改標成功。

單支新 Worker 同時支援 SOURCE 與分析 checkpoint。SOURCE 無模型呼叫；每次分析最多一檔，實際收據及精確輸入雜湊入庫後才重用。會員讀取共用完成結果，不觸發模型。完成後建立私人待審版本，獨立品質／時效／使用方式審查及 Owner 核准通過才提供會員。

短期 1～10 個交易日、中期 2～12 週、長期 3～18 個月分開顯示；各自包含理由、反面證據、確認與失效條件、實際資料時間及缺口。保留閱讀期間選擇，權限刷新仍會清除並重新讀取私人資料。

## 驗證

| 項目 | 實際結果 |
|---|---|
| 相關單元／元件／入口流程 | 156/156 通過；未跳過或取消 |
| PostgreSQL 隔離流程 | 7 組通過，另含真實保留 seed 契約回放與完整七份 SQL 套用順序 |
| App type-check / lint / build | 通過 |
| Edge 獨立型別檢查 | 通過；最小 Deno ambient 宣告與實際入口 |
| git diff --check | 通過 |
| 當前本人頁實際驗收 | 已完成，看到新版本與三期間獨立內容 |
| 新 Worker 正式模型執行 | 尚未部署，正式執行數 0 |
| 新會員日版正式 Auth／訂閱驗收 | 尚未執行，不能用合成測試冒充 |

隔離測試中的模型結果、身分、授權及審查紀錄均為測試資料。未執行整個歷史 `npm run test:public`；本輪執行表中具體相關範圍，既有歷史封存證明未修改。

## 待核准上線範圍

1. 以本輪內容指紋提交並推送目前工作分支，不強推、不合併 main。
2. 依下表順序套用七份新增 migration。已核准且已套用的 `daily_stock_ai_jobs_v1` 不重複套用。
3. 單獨部署新 `daily-stock-analysis-v1`：入口 `supabase/functions/daily-stock-analysis-v1/index.ts`，共 43 個本機依賴檔。`verify_jwt=false`，函式本身以既有內部秘密及既有派送 token 雜湊恆時比較驗證，拒絕瀏覽器 Origin；不變更任何 secrets。
4. 發布本輪會員與 Owner 前端變更，保留舊 RPC fallback。
5. 新增唯一 `ma-ai-asof-watchdog-v1` 排程，每五分鐘檢查；只在台北 06:50–09:00 啟動或恢復每日研究，包含週末。保留所有既有 Cron。
6. 首次匯入已備妥的真實 72 檔種子／手動啟動當日來源，完成實際模型執行及審查、Owner 核准與免費／Premium 正式閱讀驗收。不得建立虛構授權或審查，未通過者保持未發布。

| 順序 | 候選 SQL | SHA256 |
|---|---|---|
| 1 | `research/daily-ai-batches.candidate.sql` | `ba13c5cadcc233895319e58158203a0282f7e87e5681c446d421551334e692b1` |
| 2 | `research/daily-ai-dispatch.candidate.sql` | `4470b575958b0d0595fb3f836421c7907f2502557ebac844f5adfd03cd13e3a7` |
| 3 | `research/daily-ai-handoff.candidate.sql` | `dbdb3e47881dbd09af5d6b9a96b5e31ccdf55469b78cf939674a5dd93cee7561` |
| 4 | `research/daily-ai-member.candidate.sql` | `449145c4d8434215b40e64be443d60d1e826920eede0718896c7a45707e07d70` |
| 5 | `research/daily-ai-use-review.candidate.sql` | `549f9c9e05214d1f3ec999b4023a5f4fef31da89376d3ba917b222065e3e1500` |
| 6 | `research/daily-ai-intake.candidate.sql` | `9be2c5a3a7594ec51ecf468026c5766b5349dd320dcf6db91bcf4a5746181660` |
| 7 | `research/daily-ai-intake-cron.candidate.sql` | `6823d2ec164411423a551b4e38edd94307b43edd91eac82ab34fbf1cf27c35df` |

## 可回復方式及限制

如新流程異常，先停用唯一新增 watchdog，撤回新會員日版，再回復前端至原版本；保留不可變來源及研究稽核記錄，不刪原報告、市場或訂閱資料。原付費供應商 entitlement 不在本輪代為變更。

保留資料仍可能沒有完整最新財報、法人及公司行動；近五日公開量價補抓有上限。所有缺口會保留。沒有已驗證買價、策略績效或萬人併發實測；沒有為湊齊推薦數而產生標的。

## Git 與執行狀態

| 項目 | 狀態 |
|---|---|
| Branch | `codex/stock-delivery-20261030-verified-push` |
| HEAD | `0b22366434af62c11d0d5c9ea7b5953c98e1c504` |
| origin/main | `7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3` |
| 相對 origin/main | `66	0` |
| 本輪 Commit／Push | 否 |
| 本輪新 Worker／前端部署 | 否 |
| 本輪新增 Migration／Cron | 否 |
| 本輪正式資料動作 | 透過既有專用 RPC 新增上述不可變本人研究版本 |

完整變更檔案、內容指紋、部署依賴與測試摘要見 `docs/operations/evidence/daily-ai-delivery-20261031.json`。
