# Owner 進場研究狀態文案修正

正式 Caller 已啟用時，Owner Cockpit 仍固定顯示「每日自動進場研究尚未啟用」，把沒有今日 Entry 結果誤說成呼叫器未啟用。此候選只修正三處顯示文案，不改研究啟用狀態、策略判斷、資料請求或寫入。

沒有今日有效 Entry 結果時，顯示「尚未取得今日進場研究結果」。有當日有效 FORWARD Entry 時，保留原本依 symbol 去重後的待確認與 READY 數量，並說明待確認不代表買入指令。V2 WATCH、歷史重播、過期及未來 Entry 都不能填入今日進場計數。樣本限制說明改為目前樣本不足，不再斷言自動研究未啟用。

## 精確交付

- 唯一網站操作：修改 `src/pages/admin/analysis/OwnerCockpit.tsx`。
- 預期網站前像 SHA256：`d795ce150a851b6e8985858f052cc47b9b896dd7a7cbcb7c0781fef34521baed`。這是封存的預期值，發布前仍須實際讀回核對。
- 目標 SHA256：`45ce7e4e776b9ffb7250b7603255928f839d8e8bb27c30b11afdc19f383e29fd`；13,088 bytes。
- 回復只還原同一檔的精確前像；不得回退其他網站修正、Reader 或研究 Worker。
- `tests/ownerCockpit.test.mjs` 加入實際元件 SSR 及同日、去重、歷史／未來拒絕測試；fixture 不執行 effects，不能當成正式 Auth 或資料驗收。

## 當前與歷史驗證的邊界

原 B24 receipt、舊 composition receipt 與原斷言不改寫。原 `verifyFrontendTypeClosure()` 物理入口會繼續拒絕新 Owner 雜湊，不能把文案修改冒充舊的 type-only 操作。

新 `verifyOwnerStatusCopy()` 必須先及後驗證完整目前 composition，核對新 Owner bytes、測試來源及其餘 23 個 B24 實體檔案。單一操作 catalogue 位於 `docs/operations/evidence/owner-status-copy-20261019.json`，不授予部署或政策權限。

三套既有歷史 package suites 保留原 assertions，使用明示 historical-view 入口及讀取 binding；既有 type-only JavaScript equivalence 測試也只在 Owner 的歷史讀取使用同一適配，其他 DTO 雙向型別與負向比較仍檢查目前來源。只有精確 Owner path、符合目前 seal 的完整 bytes 可映射為不可變前像；每次映射重新驗證完整目前 source admission。注入的 source／mode／inventory／receipt drift、未知 path、異常字串及來源例外仍拒絕或原樣保留。其餘來源及 current 負向測試仍檢查目前實體檔案。

CI 保留歷史 B24 24 檔封裝，receipt 明示 historical source view，並另附目前單檔 `owner-status-copy-source.zip` 及獨立 receipt。兩者不能互相當成網站部署範圍。

## 限制

沒有改 Auth、RLS、Cron、會員權益、付款、LINE、來源准入、研究公開、V1 門檻或 Provider。此文案不代表已有正式可買股票、成熟 Outcome、合法正式會員 E2E 或五日穩定驗收。原 C／D／E HOLD 邊界維持。
