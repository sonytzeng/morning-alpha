# Core 與會員整合候選（未發布）

基準 main：754850ba1c66329d12eac8e98ab799e0a0c9123e。
固定父版本：Core PR254 bc48d784487fd5ae63ac2bb9c28d9343de41034f；會員 PR255 bcf665cad237e9c5e76c9abdd12cc12d5133aaed（包含 PR251）。

## 來源驗證修復

舊 Core 與 VNext 都以「自己是最外層」為前提檢查工作樹，因此兩份各自合法的候選合在一起仍會互相拒絕。不能改寫舊 hash 或任意放寬舊目錄。

新的獨立整合收據檢查 Git 追蹤基準、精確差異與非 ignored 未追蹤路徑、父版本、來源與模式。這不是 ignored 建置／依賴目錄的整個檔案系統驗證；實際 Runtime import 閉包另行封存。未知路徑、刪檔、symlink、未封存修改及權限旗標一律拒絕。實體准入通過後，歷史測試才取得固定父版本視圖；只有位元完全符合新收據的資料可以轉換。注入的錯誤資料不會被好資料覆蓋。公開驗證入口前後重新驗證，不能以先前成功快取掩蓋後續修改。

舊收據逐位元保留；歷史測試仍保留原斷言與分母。新的整合測試另外驗證實際來源，不把新增測試抵銷舊失敗。動態 loopback、明確 opt-in 的 256MiB tmpfs 與固定官方 GoTrue digest 保留。

## 權限與資料

新的市場研究收據只提供既有 Admin 且同一 JWT 經伺服器確認為 Research Owner 的使用者；不是會員發布核准。缺資料、授權未知、時間未證明都不等於通過。正式 V1 門檻、Caller、已部署 Worker、會員權益、付款與歷史資料不變。

Node 固定 22.14.0；原 package-lock 不變。未取得另一份未提交 patch，只按 Owner 指定行為重新實作，不宣稱套用相同 patch。

## 2026-10-17 增量收斂（R2）

第一次整合 HEAD 8146eb4 的 CI 保留失敗結果：Node 22.14.0 的舊 plain-node 指令需要明確啟用實驗性 TypeScript strip；VNext 自訂 reader 在非 VNext 路徑漏傳外層已驗證視圖，讓 Core-only Producer 新位元漏進較舊 Forward 收據驗證。修復只補完整視圖傳遞與 CI runtime 選項，不改舊預期 hash、來源目錄、斷言或正式業務邏輯。原整合收據逐位元保留，新封存另存 `core-member-integration-20261017-r2.json`，並固定原 8146eb4 收據不可被改寫。所有型別檢查繼續執行，不把 strip 當作 Type-check。

## 2026-10-17 來源解析效能（R3）

深層歷史驗證反覆解碼相同整合 JSON。R3 只保留單筆「完整位元→不可變解析列」快取，每次仍重新讀取實體收據，重新驗證來源 hash／模式、工作樹、權限與前後准入；不快取成功結果，不忽略注入或晚到修改。位元改變立即重解碼，無效文字直接拒絕；保留原本第一筆相符列的語意。隔離檔案系統測試驗證 warm cache 後的來源變動、權限、刪檔、symlink、目錄及無效收據仍被拒絕。R2 收據固定於 cc16730 原值，R3 另立收據，不改舊 hash。

## 發布邊界

R4 的 VNext CI run 38996610486 在 10 分鐘上限取消；來源觀測仍運算，沒有 OOM 或已保存的斷言失敗。R5 將五個共用深層來源鏈工作的時間預算統一設為有界 45 分鐘；不改任何 run 指令、512MiB 子程序限制、拒絕控制或驗收條件。新增逐位元對照測試，確保除 timeout 外整份工作流程不變。舊收據原本為讀一個檔案而保留整棵歷史 Git tree；R5 僅快取固定 revision/path 的單一 immutable blob，核對 regular blob 模式，停用 Git replacement，保存每次 live read 與逐位元比對，不快取成功判定。R4 收據原值固定保留；取消／未執行項目不計 PASS。

獨立複核發現 R3 的隔離檔案測試誤把 `.git` 永遠視為 gitfile。R4 以 Git 回報的 absolute gitdir 建立測試指標，同時支援一般 clone 與 linked worktree；R3 收據原值固定保留。這是測試可攜性修正，不改來源准入條件。

本整合只有候選程式與隔離驗證授權。尚不得 Merge、部署、執行 Migration、啟用 Caller、切換會員政策、公開研究或發送 LINE。精確來源、完整依賴、測試、安全審查與回復方案需附最終決策包；Production E2E、自然 Prediction／Outcome、正式會員身分與五日穩定分開列示。
