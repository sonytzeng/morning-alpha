# Release B：真實保存證據研究候選

2026-10-10，從 PR #230 / `9f993568d6726f14f3988198530cd6c9fa52b72b` 續跑。
這份文件只列可重現工程證據，不是投資成效或 Production 發布證明。

## 真實資料，不是合成績效

使用既有已審核的 `ENTRY_MINIMIZED_RETAINED_V1` 私有膠囊，保留原截止：

|交易日|原始截止（UTC）|輸入 SHA256|研究輸出 SHA256|
|---|---|---|---|
|10/7|2026-10-07T12:28:24.170Z|b9b7b4a991de35fda898e9429a9c15b112465a0a35fd0f2cf98d697579053b4a|218d42648729210e264fde9bb07d2c5f4580731141f6ce081a84f962e4908178|
|10/8|2026-10-08T06:33:01.624Z|cd1f38272c43a78d51a87b87cb993a04796c40fdcd24467db8d858ceb2f2fb24|fdd649ea8957c68bcce6bbd1008f62a693c7094b3d676e381987f2f7524e990e|

每次載入先做原隱私掃描、最小化欄位驗證及完整膠囊 SHA 比對。
原資料與衍生研究鎖均在 Repository 外，檔案600、目錄700；不提交到 Git、不上傳 CI/Readdy。
僅唯讀查詢正式 `sector_stock_map` 的72檔代號／顯示名稱，不含會員、Owner交易或憑證；公司名稱只供顯示，不是歷史 Universe 證明。

## 覆蓋：不能混合兩種取得時間

|資料集|20D|60D|120D|250D|可否回放原截止|
|---|---:|---:|---:|---:|---|
|10/7 原留存45根日K|72/72|0/72|0/72|0/72|僅原本已取得資料|
|10/8 原留存45根日K|72/72|0/72|0/72|0/72|僅原本已取得資料|
|10/8後來取得官方快取|72/72|72/72|72/72|0/72|不可以|

後來快取8640根、2026-04-16至10-07；逐檔驗證首次取得時間晚於10/8原截止。
TWSE月檔使用精確欄位；TPEx只使用 `exact_volume_amount=true` 日檔，不以四捨五入月檔冒充精確股數／金額。
每個快取檔核對原內容 SHA、來源與日曆；不重新大量請求 Provider。
公司行動68筆（TWSE60、TPEx8）不是完整除權息／分割／減資清冊；不可據此宣稱調整報酬完整。
六檔同群比較限制仍為1590、2049、4566、2208、2634、8033；不擴大正式72檔 Universe。

## 三個期間獨立判斷

每一天72檔 × 3期間 = 216項；兩日共432項。每期均為：合格待確認0、資料不足72。
這是資料缺失拒絕的真實結果，不是策略勝率或市場沒有機會。

- 短期：當時20日量價位置、成交量與法人股數可讀；支撐結構確認、完整公司消息、精確原發布時間仍缺。價格位置不是買入價，20日低點不是已核對公司行動的停損價。
- 中期：已保存月營收實績、報表EPS、單日法人可讀。單月／單日不能代表多週趨勢；訂單、展望、可判讀產業事件仍缺。
- 長期：報表EPS及單月營收可作已知背景，不能取代持續需求、競爭優勢、供應鏈、毛利、資本支出與估值。
- EPS原始欄位為 `eps_actual_as_reported`，未保存單季／累計口徑，明確保留待核對；不自行換算、不冒充Consensus。
- 各期沿用原 `HORIZONS.required`，未降低要求，也未用同一個技術分數代替三種期間。

## 時間、事件、鎖定

每筆映射證據保留 `published_at / first_seen_at / available_at / as_of / source / evidence_hash`。
缺少的原發布時間、首次取得時間與資料時間保留null，不從接收時間、營收期間或今天時間代填。
當時已保存但部分時間未知的事實可作有缺口背景；不能通過完整資格判斷。
任何明確在截止後才發布、取得或屬於未來的資料，不能出現在卡片已知事實。

10/7有9筆、10/8有12筆官方事件來源識別與發布／可取得時間。
膠囊不含事件標題／內文，故不猜產業影響、受惠受損，也不將公告自動視為利多。
公司間真實關係尚無可核對資料，Supply Chain = UNKNOWN；同產業不能自動建立供需連結。

重播輸出固定 `HISTORICAL_REPLAY`、`NOT_FORWARD`，Forward Sample=0、Outcome Sample=0。
本機快照以 canonical hash + exclusive-create保存；重跑ALREADY_LOCKED，竄改驗證拒絕，既有鎖不覆寫。
原候選DB的不可變Prediction、Evidence membership、Outcome revision規則保持不變；本輪沒有建立Production或事前Forward Prediction。

## Owner Preview與安全

URL：`http://127.0.0.1:3220/vnext/research`，只在此Mac可用，不是Production。
使用原隔離 Supabase Auth → 既有RPC伺服器Owner判定 → 本機唯讀輸出。
沒有Client role開關、Production token、service-role登入、Auth bypass或新RLS政策。
Owner ALLOW；匿名、Free、Premium、另一帳號、偽造JWT、query role、跨Origin、寫入method均拒絕。
登出後畫面立即清除真實研究卡；頁面與API no-store。來源膠囊不在Vite可公開目錄。
這是真實隔離Auth帳號，不是Sony正式Production Owner E2E；後者維持PENDING。

第一屏包含短／中／長三入口；每卡說明已知事實、何時考慮、失效、下次評估。
可選10/7、10/8，依名稱／代號查詢，按代號排序並分批顯示；不是推薦排名。
資料缺口與技術詳細預設收合；事件來源與公司關係獨立呈現。
Desktop1440與Mobile375/390/430、768實測；技術詳細展開亦不得水平溢出。

## 驗證方式

- 公開CI僅執行明確標為合成的 negative/unit controls，不接觸私有膠囊。
- `tests/vnextRealEvidence.test.mjs`：18項涵蓋缺時戳、未來時間、不同symbol、不同期間、缺值不補零、EPS口徑、來源追溯、不可變與Owner-only邊界。
- `tests/vnextRealReplay.integration.mjs`：實際兩日膠囊hash、432項、覆蓋、事件數、determinism、後來快取不得回灌、零Forward/Outcome。
- 同一integration以 `MA_VNEXT_REAL_AUTH=ISOLATED_ONLY` 驗真實本機Auth、GET owner資料與非Owner拒絕；不輸出憑證。
- 原17組隔離DB/RLS檢查續用；新候選不需要再次改Schema。
- Type-check、Lint、Build、精確全檔Integrity及PR最新HEAD所有GitHub Gate必須通過，不能沿用舊HEAD。

本機重現時只提供私有目錄環境路徑：`MA_ENTRY_PRIVATE_FIXTURE_DIR`、`MA_VNEXT_DISPLAY_NAMES`、`MA_ENTRY_HISTORY_CACHE_DIR`、`MA_VNEXT_LOCK_DIR`，不得將payload印出或提交。
Preview重用既有DB：`MA_VNEXT_REUSE_LOCAL_DB`、`MA_VNEXT_REAL_PREVIEW=ISOLATED_OWNER_ONLY` → `node scripts/vnext/preview.mjs`。

## 發布邊界與剩餘缺口

仍是Draft PR #230；本輪不Merge、不Deploy、不執行Production Migration、不更改Cron/Secret/Auth/RLS。
唯一既有候選Migration仍為 `20261010061630_vnext_research_projection_candidate.sql`，內容未變；Function候選沒有新增；Production Router沒有VNext入口。
正式Decision、Recommendation、Report、LINE依整體baseline byte-identity及本輪零業務寫入判定為0變更；不是全Production資料庫前後快照稽核。

缺口：250D、歷史PIT Universe、完整公司行動與可成交資料、原始完整時間戳、事件內文／產業影響、連續法人與營收、訂單／展望、需求／護城河／毛利／資本支出／估值、可查證公司關係、Forward及Outcome樣本。
商用／再散布權利未完成逐dataset審核。沿用 `DATA_LICENSE_AUDIT.md`；官方可讀不等於全部商用／會員再散布許可。
沒有證明需要新付費資料，也沒有購買、擴大公開或取新Secret。缺口先保持可見，不藉調低要求製造候選。

結論：可操作的真實保存資料Owner研究候選已建立；完整多期間分析與成效尚未成立。
`RELEASE_B_ANALYSIS_VALUE = INSUFFICIENT_SAMPLE`；`SONY_USABILITY = PENDING`；`PUBLIC_PRODUCT_APPROVAL = NO`。
