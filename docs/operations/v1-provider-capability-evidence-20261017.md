# V1 Provider 能力、方案與用途證據盤點｜2026-10-17

狀態：`EVIDENCE_REVIEW_ONLY / EXTERNAL_BLOCKED`。這是非敏感保存證據與公開官方文件的盤點，不是來源准入、購買建議、法律意見、正式資料更新或發布核准。

以下HEAD與乾淨工作樹是本輪來源盤點開始時的R7基準，不是R8交付後的Git狀態。最新逐股保存期間與當前發布決策請併讀[72檔缺口](evidence/v1-source-gap-detail-r8-20261017.json)及[R8決策包](owner-release-decisions-r8-20261017.md)；本輪沒有讀取帳號憑證或實際呼叫Provider，不能將候選診斷視為能力已證實。

## 1. 查核基準與結論

- 工作目錄：`core-member-r7-20261017`；分支 `codex/core-member-r7-20261017`；HEAD `b29ee8a80f798c20d8ae5e9234ade8544852d10f`。
- 本機 `origin/main`：`754850ba1c66329d12eac8e98ab799e0a0c9123e`；ahead 56／behind 0，未 fetch；開始時 working tree 乾淨。
- 唯一新增檔為本文件。未讀 `.env`、key、Secret、憑證或 provider dashboard；未呼叫需憑證 API、Production、DB；未寄信、送出表單、購買或接受合約。公開查核只取官方文件、官方資料集詮釋頁及官方 SDK 文件，未執行其中 API 範例。
- 在本輪讀取的 repo 文件及既有非敏感證據索引中，**未找到可證明本帳號目前 Fugle／Finnhub 方案、有效期、指定介面 entitlement 與 Morning Alpha 會員用途的合約或方案收據**。這是「未找到足夠證明」，不是證明沒有帳號、沒有訂閱或必須另購；也不是對所有磁碟位置的窮盡檢索。
- 現有程式／舊 acquisition 成功只證明當次介面與回應，不能反推今日方案或商用權。公開價目是產品說明，不是本帳戶合約；費用與新增購買必要性均 `UNKNOWN`。

### 不混用的兩組保存結果

| 證據集合 | 已保存事實 | 本輪不能宣稱 |
| --- | --- | --- |
| 正式 V1 | `core-evidence-status-20261017.json` 保存觀測時刻 `2026-10-16T15:48:29.29105+00:00`：universe 72、evaluated 0、blocked 72、ready/watch/none 各 0；下列五類 reason 各影響 72，彼此重疊 | 不是72檔已完整評估後沒有機會；不是本輪重新查詢 Production；五類不能加成360檔 |
| 更早正式缺口 | `recommendation-v1-gap-matrix-20261015.json` cutoff `2026-10-14T23:06:45.587Z`，同為72／0／72；當時單一 `20_DAILY_VOLUMES_MISSING` 屬量價依賴 | 不用後來資料更改舊 cutoff、舊 reason 或舊收據；後續保存快照的 volume 修復不使 evaluated 自動變72 |
| VNext 歷史研究 | `REAL_STOCK_RESEARCH.md`、`FIRST_PUBLICATION_REVIEW.md`：29項期間觀察＝短期1＋中期28，長期0；使用8類官方來源，**沒有 Fugle**；未獲逐筆發布核准 | 不是正式 V1 的29檔通過；不能把未使用的 Fugle 合約列成這29項逐卡阻擋，也不能以資料授權取代品質、時間與 Owner 發布核准 |

## 2. 已保存的方案／權利證據，與缺少的證明

| 對象 | 實際定位的非敏感證據 | 可以證明／不能證明 |
| --- | --- | --- |
| Fugle | `docs/vnext/DATA_LICENSE_AUDIT.md` 記載帳號實際方案、保存及會員商用衍生合約未提供；`docs/10k-program/recommendation-v2-universe-candidate.md`、`stock-acquisition-candidate.md` 是公開能力／舊 acquisition 記錄 | 可定位既有工程來源與公開方案；無法確認目前 Basic／Developer／Advanced／企業方案、有效期、逐介面權限或本案用途。未讀 key，也不以 key 存在當證據 |
| Finnhub | `docs/operations/market-news-persistent-degradation-20261008.md` 記載舊保存回應中 Finnhub configured；`v1-source-capability-20261017.md` 記載 EPS／revenue estimate 公開候選及帳戶能力未知 | 舊新聞來源 configured 不證明兩個 estimate endpoint 可用、TW72覆蓋、歷史版本或會員商用權；純候選 validator 的合成 PASS 不是 provider 能力測試 |
| TPEx | 私有保存矩陣 `VNEXT_EXACT_SOURCE_LICENSE_MATRIX.md` 第10節，記錄2026-10-13 19:36:31 Asia/Taipei官方回覆摘要 | 摘要記載寄件網域及郵件驗證通過；本輪未開郵件或重新驗章。答覆僅確認應在 OGL 涵蓋範圍使用，未逐項確認歷史 JSON／HTML、會員用途、費用或原始版本。不能說完全沒回覆，也不能說全面核准 |
| TWSE | 同一保存矩陣最後記錄仍只有原詢問寄件，未取得實質回覆 | 只描述該次保存檢查；本輪未查看信箱，不宣稱目前仍未回覆。BFI82U 是後來獨立新來源，不在原8類歷史詢問中 |
| 官方開放資料 | `DATA_LICENSE_AUDIT.md`、私有精確資源矩陣及下列官方資料集頁 | 已核對資源依其 OGL 條件使用；不把同網域、同名、歷史查詢或不同格式自動視為相同授權範圍 |

OGL 第1版允許符合範圍的產品／服務與衍生利用，並要求顯名；符合條款的開放資料不必再逐案取得書面授權。**需釐清的是實際歷史資源是否在涵蓋範圍，不是預設所有自行分析都禁止或都需購買。** 原始資料、官方事實、原創分析、公告全文／附件、數值圖表應分開認定；資料用途也不等於金融業務資格。[官方 OGL](https://data.gov.tw/license)

最小補證格式：由有權人提供已遮蔽帳號、付款資料及所有 key 的方案名稱／有效期、產品或 endpoint 清單、72股票適用範圍、適用合約版本及用途條款頁碼。只需證明內部計算、Free／Premium 顯示、衍生數值／文字／圖表、原始值再散布、保存／稽核及終止後義務；不索取登入或憑證。

## 3. 五類正式缺口：確切欄位、可得範圍與待詢問項

欄位依 HEAD 下 `supabase/functions/_shared/decision-v1-evidence.ts:146` 起的現有 evaluator、`decision-v1-data.ts` loader 及既有來源模組核對；以下不是新增契約或降低門檻。問題代碼對應第7節官方收件管道，僅列問題，未發送。

| 正式缺口 | 必要欄位／來源與已知可得範圍 | 尚未證明／最小供應商問題 |
| --- | --- | --- |
| 1. `MARKET_REQUIRED_INSTITUTIONAL` | `symbol=TAIEX`、`trading_date`、foreign／investment_trust／dealer 各一列 `buy_amount/sell_amount/net_amount`、`currency=TWD`、`provider/source_ref/captured_at/created_at`。TWSE BFI82U 提供市場彙總實際元金額；現有候選合併自營商分類並避免外資自營商重複計入，不是逐股來源。[BFI82U](https://www.twse.com.tw/zh/trading/foreign/bfi82u.html)、[官方商品欄位／版本說明](https://eshop.twse.com.tw/zh/product/detail/d31c1b9570ae47058ec83a0bb1ffa419) | 保存快照 flows 0；私有 capture 不等於 canonical／會員准入。原始發布時刻未知仍 null；實際 first_seen `2026-10-16T15:55:40.387Z` 不能回填舊盤前。問 **T1**：精確 BFI82U 資源、歷史日期與14:50／19:40不同統計範圍的首次發布／更正版本，及本案用途適用條款；已有權利是否涵蓋，不先問購買 |
| 2. `THREE_INSTITUTIONS_MISSING` | 每個本地股票／指定交易日，三種 institution_type 各恰一列，同上實際 TWD 欄位；買賣非負、buy−sell≈net、gross非零。現有 T86、TPEx及 Fugle institutional 回應均為 **SHARES**，不是缺一個 mapping 就有金額。[TWSE T86](https://www.twse.com.tw/zh/trading/foreign/t86.html)、[TPEx11856欄位](https://data.gov.tw/dataset/11856)、[Fugle法人欄位](https://developer.fugle.tw/docs/data/http-api/ownership/institutional-trades/) | 保存10日窗口及表列均0。已讀公開資料沒有證明逐股三法人真實 TWD buy/sell/net 可由目前帳戶取得；不是證明所有官方／企業產品都不存在。禁止股數×收盤／均價、全市場金額分攤、總成交額或單純 net 取代。問 **T2／P1／F1**：是否有「逐股×日×三法人」實際買賣成交金額、幣別、是否含鉅額／零股／盤後、dealer組成、缺列語意、修正與發布時間；請指出產品與欄位，先核對既有合約 |
| 3. `FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING` | 四連續 fiscal quarters 的 `revenue_actual/revenue_consensus/eps_actual/eps_consensus`、`fiscal_period/announced_at/provider/source_ref/created_at`，最新有來源 `guidance_direction=up/stable/down`。現有550日窗口、最新公告≤120日及現行 intact／damaged 方法保持不變。官方實際值資源與 Finnhub estimate 只涵蓋部分所需，詳第4節。[上市EPS](https://data.gov.tw/dataset/20756)、[上櫃EPS](https://data.gov.tw/dataset/20757)、[Finnhub官方SDK](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/docs/DefaultApi.md#companyepsestimates) | 保存 earnings 表／550日窗均0。單季實際值、合格 consensus、公告前 vintage、最新 issuer guidance 及用途不能互相替代。問 **H1–H3／T3／P2**：TW72逐股映射、四季可比基礎與原始／更正版本；估計是否純券商、可否排除自有值、每筆 estimate 的公告前版本；公司 guidance 原文及修正／撤回。沒有 guidance 不得填 stable |
| 4. `SOURCED_COMPANY_CATALYST_MAPPING_MISSING` | `news_events` 的來源及發布時間；`research_catalysts.source_refs/event_at`；`catalyst_tw_mappings.stock_symbol/catalyst_id/transmission_path/taiwan_supply_chain_relation/invalidation_condition/source_refs/created_at`。mapping還須對應最新 earnings source_ref。官方公告只證明事件事實，現有 producer 不把它自動判利多。[上市重大訊息18415](https://data.gov.tw/dataset/18415)、[上櫃18418](https://data.gov.tw/dataset/18418) | 保存 mapping／7日窗0；公告全文、附件權利、穩定ID與首次公開／更正、來源支持的公司因果與反證審查未完成。問 **T3／P2**：索引與歷史全文／附件涵蓋範圍、穩定版本與發布時間、可引用範圍。供應商資料或 LLM 分類不代替獨立關係審查；不預設需付費 causal product |
| 5. `EVENT_ALIGNED_PRICE_VOLUME_REACTION_MISSING` | 每股≥20完整交易日 closes／volumes；事件前6 bars、當階段可觀測的事件後 quote／volume；同 preBase 交易日 TAIEX及最新 TAIEX、至少2同sector peers。每筆需 symbol／session／trading_date／OHLC、volume單位、source／revision及實際 availability。官方 TAIEX與官方個股歷史為候選，Fugle已有工程 acquisition 路徑；詳第5節。[TAIEX11755](https://data.gov.tw/dataset/11755)、[上市現行日行情11549](https://data.gov.tw/dataset/11549) | 不能把 Shadow benchmark 存在視為正式已接線，也不能以ETF或不同日期替代。問 **T4／P3／F2**：指定歷史範圍、交易時段、調整／未調整、停牌／公司行動、更正版本、發布時間與使用範圍。事件尚未發生時不能造事後價格；PREMARKET 的 NOT_YET_OBSERVABLE 也不免除其餘缺口 |

共同時間條件：原始 event／observation time 與實際資料可得時間都要符合保存 cutoff；loader／evaluator 的現有窗口不因本文件改變。今天讀到歷史列、官方網站今天可下載，均不能證明當時已取得該 revision。

## 4. 四季財務：actual、consensus vintage、guidance 分開驗證

### 4.1 官方 actual：有資料，不等於完整四季契約

- 官方 EPS 統計含年度、季別、公司代號、基本EPS（元）及營收等；月營收資源含當月及累計值。確切登錄資源為 [20756](https://data.gov.tw/dataset/20756)／[20757](https://data.gov.tw/dataset/20757)及 [18420](https://data.gov.tw/dataset/18420)／[56510](https://data.gov.tw/dataset/56510)，頁面列 OGL、免費。這證明登錄資源的欄位／條件，不證明全部歷史 MOPS 查詢等同該資源，亦不證明每列單季與原始 vintage。
- 現有 `recommendation-official-actuals.ts` 明確保存來源單位，`source_timestamp=null`、`consensus=null`、`guidance=null`、`complete=false`。出表日或會計期間末日不是精確首次公告時間。
- 舊研究確有72／72月營收、2024Q1至2026Q2共10個 **YTD期間** 的 income／EPS／cashflow覆蓋記錄，但不是每股四季「單季實際值＋公告前共識＋最新guidance」。月營收加總不自動等於財報營收；累計EPS不能直接相減，因加權股數基礎可能不同；單季收入推導也須同範圍、同會計版本及可追溯計算。

### 4.2 Finnhub：兩個 estimate 候選，不是合格 consensus 證明

- 官方 SDK 列 `/stock/eps-estimate`、`/stock/revenue-estimate`，參數為 `symbol`、`freq`（annual／quarterly）。所讀方法沒有歷史 as-of 選擇器；這不等於供應商其他產品一定沒有 vintage，須另詢。動態 API 頁本文未取得，故欄位依官方 SDK，而非空頁或第三方解說。[EPS方法](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/docs/DefaultApi.md#companyepsestimates)、[Revenue方法](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/docs/DefaultApi.md#companyrevenueestimates)
- 兩個 info model 都說 average 包含 Finnhub 自有預估；提供 high／low、`numberAnalysts`、period／year／quarter，不證明純券商共識或同一受訪集合。不得直接寫入正式 `eps_consensus/revenue_consensus`。[EPS model](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/docs/EarningsEstimatesInfo.md)、[Revenue model](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/docs/RevenueEstimatesInfo.md)
- 已讀 model 未替本案證明 currency／scale、IFRS或adjusted、basic或diluted、普通股／ADR映射、每筆 revision first_seen／available。TW72覆蓋、帳戶 entitlement、實際可用股票數均 **UNKNOWN／72**，不是0或72。保存候選只做 declared envelope 合成驗證，永遠不授予正式准入。
- [Finnhub條款](https://finnhub.io/terms-of-service)要求適用的商業／分享書面許可，並涉及終止後資料刪除；本案留存稽核需求須一併確認。[官方企業方案](https://api.finnhub.io/pricing-startups-and-enterprise)宣傳商用與 redistribution，但不證明目前帳戶已持有；本輪僅取得其官方搜尋摘要，未取得完整動態頁本文，不據此判定具體合約或費用。

### 4.3 最小可審核財務證據包

每股四季須分開帶：本地／provider symbol 與映射依據、fiscal year／quarter及起迄、單季／累計、currency／scale、營收定義、會計及EPS股別基礎、actual原始來源與公告／重編版本。每季 EPS 與 revenue estimate 分別帶估計集合／方法、analyst count、對應期別、當次 revision、source_as_of（未知保留null）、first_seen／available及合法保存依據；**所比較的 estimate revision 必須在對應 actual 公告前且在決策 cutoff 前可得**，不能用事後修正的平均值計 surprise。

最新 guidance 須另有 issuer／官方原文、針對期間與指標、發布／撤回／取代關係及可核對方向。券商預估、實際營收成長或未變動的預估不自動成為 issuer guidance；本輪未證明存在覆蓋TW72的統一 guidance 介面，也未逐公司查 IR。純格式驗證不能證明它確為最新、來源內容為真或權利有效。

## 5. 官方 benchmark 與事件量價邊界

| 來源／用途 | 已證實範圍 | 未完成事項 |
| --- | --- | --- |
| TWSE TAIEX 11755 | 官方頁列最新月份每日日期、開／高／低／收指數，OGL且免費；這是官方大盤價格 benchmark 候選，不是個股或法人流量。[官方資料集](https://data.gov.tw/dataset/11755) | 原歷史研究 S2 用帶日期的 `MI_5MINS_HIST` JSON；與登錄 open_data CSV 的歷史範圍／格式對應、原始發布及修正時間仍待精確確認。現有 V1 的 symbol 固定TAIEX，不以市場總成交額或ETF替代 |
| 官方個股歷史及產業同儕 | 舊 S1 是 TWSE `STOCK_DAY` 歷史；S3／S4為法人股數；既有20／60／120日舊覆蓋不等於事件同cutoff可用。正式 sector 比較目前要求至少2檔同 sector 股票，不是任意產業指數 | 需確認點時股票／產業分類、同日期與同市場時段、股數／張數、價格調整和公司行動。官方產業指數如另選須證明方法、版本、用途並另核准契約變更；本輪沒有這種替換 |
| TPEx 指數 | TPEx [聯絡頁](https://www.tpex.org.tw/zh-tw/about/company/contact/contact.html)有官方櫃買指數歷史入口 | 本輪該歷史入口本文未成功取得；未宣稱欄位／歷史版本／授權已驗。它也不自動替換現行TAIEX；上櫃個股與sector比較仍需各自完整證據 |

原 S2 私有帳本 first_seen 為 `2026-10-11T02:02:02.887Z`，不是10/8收盤或更早。價格session定位13:30、月末／季末日期都不是官方原始發布時間；晚取得資料不能倒填。事件後資料在盤前尚未存在時只能保留未可觀測分類，不用未來值使舊研究合格。

## 6. 29項歷史觀察的8類官方 lineage（不含 Fugle）

此表是已保存歷史來源識別，不是本輪新下載資料，也不是重新查核全部端點。精確參數、首次取得與權利缺口沿用私有矩陣，不重寫歷史封存。

| ID／保存來源 | 官方來源識別／對照資源 | 尚不能由對照資源推論的事項 |
| --- | --- | --- |
| S1 TWSE_STOCK_DAY_HISTORY | `www.twse.com.tw/exchangeReport/STOCK_DAY`（日期／stockNo歷史JSON）；對照 [11549](https://data.gov.tw/dataset/11549)為現行日行情 | 不是相同歷史資源／全部期間的自動授權；無原始版本證明 |
| S2 TWSE_INDEX_HISTORY | `www.twse.com.tw/indicesReport/MI_5MINS_HIST`（日期JSON）；[11755](https://data.gov.tw/dataset/11755)為最新月份OHLC | 歷史日期及輸出格式對應尚待確認；不是FMTQIK |
| S3 TWSE_T86_HISTORY | `www.twse.com.tw/rwd/zh/fund/T86`（日期JSON） | 股數非TWD；精確歷史權利與版本仍待確認 |
| S4 TPExInstitutionalHistory | `www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php`（民國日期JSON）；[11856](https://data.gov.tw/dataset/11856)為登錄CSV | 官方回覆未確認全部歷史JSON等同CSV；股數非金額 |
| S5 MOPSRevenueListed | `mopsov.twse.com.tw/nas/t21/sii/t21sc03_115_{month}.csv`；[18420](https://data.gov.tw/dataset/18420) | 歷史月份與原申報／更正版不因當期彙總授權而自動齊備 |
| S6 MOPSRevenueOTC | `mopsov.twse.com.tw/nas/t21/otc/t21sc03_115_{month}.csv`；[56510](https://data.gov.tw/dataset/56510) | 同上；TPEx回覆未逐月確認 |
| S7 MOPS_FINANCIAL_YTD_HISTORY | `mopsov.twse.com.tw/mops/web/ajax_t163sb04` 歷史HTML；私有矩陣對照 [20762](https://data.gov.tw/dataset/20762)／[94853](https://data.gov.tw/dataset/94853) | 不把不同年度／業別／累計HTML視為完整單季或原公告版本；與本文件當期EPS統計20756／20757亦不可混同 |
| S8 MOPS_MATERIAL_EVENT_HISTORY | `mops.twse.com.tw/mops/api/t05st01` 歷史索引；對照 [18418](https://data.gov.tw/dataset/18418)等當期彙總 | 索引不授予所有原文／附件權利，不證明最初公開、修正／撤回及公司因果 |

保存矩陣計667個證據參照、456個缺原始發布時間，**不是456個不重複資料列**。原創分析、少量事實、原文素材的精確用途尚待釐清，不能將疑義擴張為所有分析禁止，也不能以顯名自行產生未涵蓋資源的權利。29項仍各自有時間、品質、授權及發布審核問題；本輪不改其狀態。

## 7. 最小供應商問題與官方收件管道（未發送）

可合併同一機構的問題，避免重複詢問；先核對既有方案，不要求新key、不承諾採購。不得夾帶私有研究、72逐卡內容、私人郵件ID、API回應或憑證。

| 對象／問題代碼 | 最小問題 | 官方收件管道及查核限制 |
| --- | --- | --- |
| Fugle **F1** | 現有方案是否有「逐股三法人實際TWD買／賣／淨額」產品？請指出精確欄位與統計範圍；已知 institutional-trades 是股數，升級同一股數介面不能解決金額缺口 | [官方價格頁的企業需求表單](https://developer.fugle.tw/docs/pricing/#需要更進階的企業方案嗎)；官方文件頁尾技術客服 `tech.support@fugle.tw`。只確認公開管道，沒有填表或聯絡 |
| Fugle **F2** | 以遮蔽方案識別確認現有歷史candles／quote／法人介面的有效期、TW72範圍及更正版本；內部計算、會員顯示、衍生數值／圖文與保存／終止權利是否包含，依哪份條款？ | 同上；[使用規範](https://developer.fugle.tw/docs/data/intro/)要求遵守來源交易資訊規範，不能用公開個人方案表取代本帳戶商用合約。文件稱法人股數上市／上櫃自2013年、單次區間小於1年；未以真實回應驗TW72。空陣列也可能是無效代號／無資料，不當0交易 |
| Finnhub **H1** | 目前合約對 EPS／revenue estimate、actual及guidance各有何 entitlement？請提供TW72普通股映射與逐股四季覆蓋範圍／缺值語意，不以US或ADR範例推定 | [官方企業方案頁](https://api.finnhub.io/pricing-startups-and-enterprise)官方搜尋摘要列 Contact Sales：`support@finnhub.io`；完整動態頁未取得，不能驗證其全部條款或報價 |
| Finnhub **H2** | average是否可提供排除 proprietary 的純券商集合？若沒有，請確認不可替代的差異；能否取得每筆四季 estimate 公告前的原始revision／as-of及更正序列？幣別、scale、會計與EPS基礎如何證明？ | 同上；請以產品／欄位文件及可保存的非敏感合約附件回答，不索取key、不呼叫試用API |
| Finnhub **H3** | 本帳戶是否已有內部商用、Free／Premium衍生內容／數值圖表、必要原始值顯示、歷史稽核保存及終止後留存權？若既有方案不足，適用條件／費用為何？ | 同上；只有確定既有權利不足且使用者另核准後才作採購決策，這不是購買授權 |
| TWSE **T1／T2** | 分別確認BFI82U市場金額的範圍／版本／用途，及有無逐股三法人實際TWD buy/sell/net產品與現有合約涵蓋；兩種分母不可混為一問 | [官方資料商品頁](https://eshop.twse.com.tw/zh/product/detail/d31c1b9570ae47058ec83a0bb1ffa419)列 `dataeshop@twse.com.tw`、(02)8101-3494／3393。商品列市場彙總不證明逐股金額存在；公開價格不作本案費用推定 |
| TWSE **T3／T4** | 精確確認S1／S2／S3／S5／S7上市／S8上市歷史資源與OGL登錄範圍、單季actual／原始申報／修正版本、公告全文附件權利及會員原創分析用途；指出已公開依據即可，非一律要求另行付費授權 | 同上請轉資料授權／MOPS權責單位；官方資料集如 [20756](https://data.gov.tw/dataset/20756)列資料開放管理者 (02)2792-8188，可用於精確資源釐清，非本輪致電 |
| TPEx **P1** | 是否有逐股三法人真實TWD買／賣／淨額、完整統計與版本欄位，而非11856股數或市場彙總？現有權利是否涵蓋？ | [官方聯絡表單](https://www.tpex.org.tw/zh-tw/about/company/contact/contact.html)可請轉交易資訊／資料授權承辦；需本人Email驗證才送出，本輪未開始。官方總機(02)2369-9555；[11856](https://data.gov.tw/dataset/11856)資料集承辦電話(02)2366-6179 |
| TPEx **P2／P3** | 接續已保存10/13答覆，只追問尚未明確的S4歷史JSON、S6歷史CSV、S7上櫃YTD HTML、S8歷史索引／全文／附件與登錄資源的精確對應；單季actual／guidance／指數與個股原始發布／修正版本、會員原創分析／衍生圖表的範圍、顯名要求及若有費用的適用依據 | 同上；[官方資訊商店](https://eshop.tpex.org.tw/zh/)亦導向此聯絡管道。不能把保存的簡短回覆當成所有用途已核准或所有衍生利用被禁止 |

## 8. 證據定位、雜湊與本輪驗證邊界

下列 SHA-256 為本輪實際讀取 bytes，方便對照保存版本，不是 provider 簽章或歷史公布時間。外部私有保存物僅摘錄非敏感狀態／來源中繼資料，未複製完整郵件、私人聯絡方式或研究 payload。

| 保存檔 | SHA-256 |
| --- | --- |
| `docs/operations/evidence/recommendation-v1-gap-matrix-20261015.json` | `61d0cddb923305f7bbbc957eb73cbe26d66b36269e015d1e1753f0b0408c9e27` |
| `docs/operations/evidence/core-evidence-status-20261017.json` | `b81f972cfb9a8b586d5ad4e6686c954ccc11d51674c5100b78924df855a3fb63` |
| `docs/operations/v1-source-capability-20261017.md` | `8dc17aa95262bead4f968855e0414be15baee6986d4d45c1feecfb5cc5629096` |
| `docs/vnext/REAL_STOCK_RESEARCH.md` | `a9d7aa6dcf0bce754143300a152cd14f31c0f8f89f9770089a1d4926c8419637` |
| `docs/vnext/FIRST_PUBLICATION_REVIEW.md` | `fd318d39c54afef6b16c7302421c5245071cbee72e8363171b5d25a1eb24ae1b` |
| `docs/vnext/DATA_LICENSE_AUDIT.md` | `e1b7728a834dcc066d561670370f990c422757e2d19ab1cad60187d633a66c98` |
| 私有保存根目錄下 `core-evidence-resume-20261017/V1_EXACT_CAPABILITY_AND_METHOD_DECISIONS_20261017.json` | `b1928635245a8e993470e595b3a25c657af24826b91e1ff45cdd44beb2ad2e2b` |
| 同根目錄 `data-licensing-20261012/VNEXT_EXACT_SOURCE_LICENSE_MATRIX.md`（含10/13回覆補充） | `52e6117a5093d1432bd579c589c5ffc241b0162a24c3e19581221e24325ca8fe` |

私有保存物保留於本任務受控證據區，不隨本文件上傳原文。另靜態閱讀相關來源／evaluator及現有 operations、10k-program、VNext 文件；沒有執行 acquisition、策略評估、runtime測試或更新保存結果。公開頁查核日為2026-10-17，不當成歷史取得日的條款版本；官方 SDK master 亦只是本輪讀到的公開介面描述，不是固定產品版本保證。

本輪只驗證文件範圍、Git基準、已引用保存檔雜湊、文字差異／空白及單檔新增；不重跑 type-check／build／lint，避免不相關輸出或 build 載入 env。沒有新的程式或端到端 PASS；Main 的 R7 CI／安全封存不因本文件自動通過。

結論：目前可確認「市場實際TWD有官方來源」「逐股已知法人介面為股數」「官方actual不等於合格四季consensus／guidance」「官方benchmark可定位但點時／精確用途仍須綁定」。本帳號實際方案、逐股TWD產品、TW72合格consensus vintage、最新guidance與完整會員用途仍缺證；**維持 formal 72／0／72及五類重疊阻擋，不改時間、不補造值、不推定需購買，不進行Commit／Push／Deploy／Migration／Cron／權益／付款／發布變更。**
