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

R6 只快取固定 commit 的 tree SHA256、diff／scope 事實，回傳陣列與 Buffer 都是副本，Git replacement objects 不參與固定版本讀取。同一次 verifier 重用一份 scope。所有現行 manifest、實體 bytes 的 hash／模式、inventory、注入 reader 與前後完整驗證仍逐次執行，不快取成功結果、不省略任何既有斷言或獨立負向案例。R5 原收據另行固定保留。此優化不是放寬來源准入，也未修改 Runtime、SQL、前端、package 或 lockfile。

R5 的 VNext 真實 CI 失敗另行保留：歷史 UTF-8 fixture 經新外層 reader 被強轉 Buffer，讓 tracked 二進位 `.DS_Store` 的有損文字視圖失去原型態；R6 保留注入文字 reader 的字串型態，正式實體准入仍檢查原始 bytes。歷史負向測試仍要求拒絕相同路徑，只額外接受最外層精確 reason/path 的較早拒絕，並追蹤現行 diff＋untracked inventory，而非假設一定經過舊 status 指令。News baseline 保留逐位元相等條件，以 Buffer.equals 的同值布林斷言取代大型 Buffer 差異格式化，避免錯誤診斷本身耗盡512MiB heap；不刪除斷言、不提高記憶體或跳過案例。

R4 的 VNext CI run 38996610486 在 10 分鐘上限取消；來源觀測仍運算，沒有 OOM 或已保存的斷言失敗。R5 將五個共用深層來源鏈工作的時間預算統一設為有界 45 分鐘；不改任何 run 指令、512MiB 子程序限制、拒絕控制或驗收條件。新增逐位元對照測試，確保除 timeout 外整份工作流程不變。舊收據原本為讀一個檔案而保留整棵歷史 Git tree；R5 僅快取固定 revision/path 的單一 immutable blob，核對 regular blob 模式，停用 Git replacement，保存每次 live read 與逐位元比對，不快取成功判定。R4 收據原值固定保留；取消／未執行項目不計 PASS。

獨立複核發現 R3 的隔離檔案測試誤把 `.git` 永遠視為 gitfile。R4 以 Git 回報的 absolute gitdir 建立測試指標，同時支援一般 clone 與 linked worktree；R3 收據原值固定保留。這是測試可攜性修正，不改來源准入條件。

本整合只有候選程式與隔離驗證授權。尚不得 Merge、部署、執行 Migration、啟用 Caller、切換會員政策、公開研究或發送 LINE。精確來源、完整依賴、測試、安全審查與回復方案需附最終決策包；Production E2E、自然 Prediction／Outcome、正式會員身分與五日穩定分開列示。

## R7 有界批次歷史驗證候選（尚待驗收）

R6 本機六套來源檢查44 PASS、VNext CI四套來源檢查26 PASS，但四項舊版 CI 於45分鐘取消，不能稱為完整通過。固定Node22.14.0的兩次單一路徑量測為46.192／44.169秒；暖快取仍有大量重建lineage成本，不能只再增加timeout。

R7僅調整測試來源讀取的同步批次邊界，保留原逐檔hash斷言、舊收據與負向案例。每個批次仍須全工作樹及完整注入來源前後准入、逐次實體bytes／mode／receipt檢查；未知路徑、symlink、晚到修改及注入值不得被歷史資料抹除。Reader不得逃出同步callback或跨批次重用；既有transition工廠仍驗證完整歷史鏈，不以任意Git資料取代原驗證。完整安全複核及精確HEAD的CI未完成前保持NO-GO。R6收據固定於1a3b8c9原值，不改寫舊hash；不修改Runtime、SQL、付款、會員權益或正式資料。

批次契約明確限制為可信測試的同步呼叫：不是每個路徑都重跑完整工作樹准入，也不宣稱可偵測任意瞬間修改後復原的所有交錯。完整前後准入、每次 requested path 的實體來源／收據檢查與原本142／169逐檔斷言仍保留，公開release gate不改；原30／39逐列注入案例每項建立新context，不能重用clean proof。新增focused控制明列於CI，不增加timeout或記憶體額度。

R7審查中另確認尚未發布的測試工具可把偽造source錯誤誤映射成既有drift拒絕；修復以module-private WeakSet識別真正mismatch，再核對完整path／representation／hash tuple。source拋錯一律轉成不帶原message／cause的固定失敗，舊genuine錯誤重放及Buffer自訂hook均不得變成有效負向證據；callback失敗不能被finally的後續mismatch覆蓋。保留該候選缺陷與中止測試收據，加入偽造、重放及清理覆蓋反例後重新驗證，不將中止run或合成控制當成Production驗收。
