# VNext Member Publication Readiness P0

續接 `6ddff21058ae59bd83ecbaf0ba51211d195b0f1f`，PR #230 維持 Draft。
本輪沒有 Merge、Production SQL／Function 操作、Cron、Secret、會員公開或新付費來源。

## 已核對的真實資料，不是合成投資故事

72檔／216份短中長審查清單，沿用不可變來源：

- history `7b21dbe4b3cfd50371cd791d3988d24c1e137db1d397e50c41dbe0cc2274d4aa`
- sources `ad8e4fb00b79a5d749194172c0c5c875e1a37902cb8ba374b4397a4e6af0fe9a`
- 量價截至2026-10-08；合併核對截止2026-10-10T10:22:25.360Z。不是最新即時行情，不延長證據有效期限。
- 20／60／120日72/72；250市場交易日71/72；2884停牌缺口仍保留。
- 四個實際含資料的營收/EPS API均對應具名開放資料集，144筆實績有條件授權可核對；兩個重大訊息資料集亦有明確授權，但當期72檔命中0。
- 六個資料集授權核對與研究有效性完全分開。缺精確原發布時間與 as_of 不用接收時間替代。過去432項歷史判斷沒有被新資料覆寫。

短期72份：消息、法人連續性、價格結構與歷史行情再散布範圍仍不足。
中期72份：營收有來源，不代表訂單、展望、產業影響已成立；單期實績不能冒充趨勢。
長期72份：EPS有來源，不代表需求、競爭優勢、毛利、資本支出、估值鏈已成立。兩家公司具名關係不等於當期訂單或需求。

目前三期間 `evidence_ready=0`，`member_eligible=0`。每份有股票名/代號/期間/白話研究方向/待確認/失效/再檢查/來源/精確拒絕原因。
分類是 `REVIEW_DOSSIER_NOT_PREDICTION`，不是事前鎖定訊號。Forward=0、Outcome=0。
資料與授權未知不是市場看空，也不是正式Recommendation的BLOCKED結果。

## Publication候選與權限

新增離線審查把**被渲染層拒絕的未來/缺時間證據也列入稽核**，不讓缺失輸入消失後看似完整。
中期的EPS／長期的營收補充背景也必須稽核，不因不是必要證據就跳過授權。無法安全核對的網址保留拒絕原因，但不能點擊。
精確來源綁定開放資料集；同hostname、相似名稱、歷史查詢、query參數與Fugle訂閱均不繼承授權。
原Publication Gate、不可變approval/hash與DB server entitlement保持不變；審查清單不能自動建立approval。
尚未證明rights的輸入、受限制衍生內容都不能提供Free/Premium。

Owner沿用真實隔離Supabase Auth→既有Owner RPC predicate→唯讀loopback研究資料，不用前端tier。
Free/Premium仍由正式候選SQL投影讀取，不以UI隱藏Owner資料。
本輪Preview使用DB append-only撤回測試publication；保留測試紀錄，不新增真實approval。
所以Free／Premium顯示真正的「沒有符合公開條件股票」；不是將合成股票換名字。
正向分級fixture只供既有安全測試；本輪交付Preview不再呈現它們。

## 自然更新：完成隔離提案，不是已啟用

來源程式稽核：目前正式Functions沒有VNext引用。既有V2路徑是
`fetch-market-data-v10` → `_shared/recommendation-v2-forward-trigger.ts` → `recommendation-v2-forward-worker-v1`；本輪不修改或挪用此正式V2 identity／排程。
既有純函式 `incrementalPlan` 的背景批次提案通過新增測試：Core未完成或忙碌就延後；Core不等待研究；固定cursor、最多12工作、單併發、2.2秒節流、20秒timeout、最多3次。
只在immutable evidence驗證成功後推進watermark；429/失敗不假補資料。
取得資料後仍必須逐資料集授權/PIT/quality/研究審查→immutable approval→member projection，不從acquisition直接發會員。
`NATURAL_UPDATE_RUNTIME=NOT_ENABLED`。尚無新worker、dispatcher、排程或production approval producer，不能宣稱每天已有會員內容。

## 最小發布 Manifest（待核准，本輪不執行）

1. PR #230 最終驗收HEAD之Merge。
2. 唯一既有候選 `20261010061630_vnext_research_projection_candidate.sql`（本輪SQL byte不變）；新候選表/RPC，不改既有Auth/RLS。
3. `/stocks`、共用Desktop/Mobile/Account入口的正式route掛載；Owner審查仍分離。現時僅loopback，不是Readdy或Production Preview。
4. Function/Secret/Cron本輪新增數均0。自然worker的實作、精確identity與獨立呼叫manifest尚未授權，不混入此release。
5. 公開內容另需逐筆完成缺失Evidence、明確再散布權利、immutable human review；UI上線不能自動批准原研究。
6. 正式Free/Premium/Owner合法帳號驗收另行執行，不能用本機帳號冒充。

不需要現在購買新來源；現有證據尚未證明能滿足所有長期資料與商用用途。
`VNEXT_MEMBER_RELEASE_READY=NO`；`PUBLIC_PRODUCT_APPROVAL=NO`；Sony使用體驗仍PENDING。

## 本輪實機驗收（2026-10-11 Asia/Taipei）

- Preview：`http://127.0.0.1:3223/stocks`；Owner：`http://127.0.0.1:3223/vnext/research`。僅本機，不是正式會員發布。
- 同一候選 Supabase Auth／PostgREST 隔離環境，Free、Premium、Owner 真實登入；無角色選擇器。Free／Premium 三期間公開股票均0，Premium清單／歷史亦無未核准研究。
- Premium直接Owner route拒絕；Owner登入可查72檔×3期間來源與缺口。登出立即清除私人資料，Reload仍拒絕；API驗證另涵蓋匿名、另一Free、錯tier參數、Owner-only資料拒絕與撤回後零投影。
- Free／Premium／Owner各於1440／768／430／390／375px量測實際innerWidth；水平溢出0。Owner長來源與拒絕原因展開後375px也無溢出，技術資料預設收合，Console error/warning=0。
- 截圖：`/private/tmp/ma-vnext-publication-qa/`，只保存本機驗收畫面，不含登入憑證。歷史Owner研究沒有對會員開放。
- 新增9項unit/negative與216份真實離線資料核對；離線期間網路呼叫0，沒有重新向Provider大量取得資料。
- 最終HEAD的CI必須重新完成；不可沿用起始HEAD的9項PASS。此文件不是Production身分或策略有效性證明。
