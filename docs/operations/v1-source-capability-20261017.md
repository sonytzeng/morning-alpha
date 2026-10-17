# V1 五類來源阻擋與 Finnhub 純能力候選（2026-10-17）

狀態：`CANDIDATE_ONLY / EXTERNAL_BLOCKED`。本文件不是正式來源准入、部署核准、完整評估完成或會員可發布證明。

本輪授權只建立三檔：`supabase/functions/_shared/recommendation-consensus-capability-candidate.ts`、`tests/recommendationConsensusCapability.test.mjs`、本文件。未修改正式策略、evaluator、gates、歷史 manifest、Producer/Reader index、Auth/RLS/Cron、資料表或會員權益。Main 負責整合、來源封存、CI 與後續准入。

起始分支 `codex/core-member-integration-20261017`；HEAD `bc48d784487fd5ae63ac2bb9c28d9343de41034f`；本機 `origin/main` `754850ba1c66329d12eac8e98ab799e0a0c9123e`，ahead 5 / behind 0，未 fetch。主整合既有 staged 變更及三個衝突檔不是本輪修改，未處理或覆寫。下列行號是本輪讀取時的來源定位；最終完整樹以 Main 的新來源封存為準，舊 hash/manifest 不得覆寫。

## 一、已保存結果的意義

既有證據檔 `docs/operations/evidence/recommendation-v1-gap-matrix-20261015.json:2-34` 記錄 2026-10-15、cutoff `2026-10-14T23:06:45.587Z`：72 檔、有效評估 0、BLOCKED 72，flows/earnings/mappings/catalysts 各 0。這是該保存快照的事實，不是本輪重新查詢 Production。不得解讀為「72 檔完整分析後均無機會」。其另列單一 `20_DAILY_VOLUMES_MISSING` 是價格依賴問題，歸入下列第 5 類，不另造第六類來源阻擋。

## 二、exact 5 blocker：source → producer → store → canonical join → Reader/member → cutoff

| # / 正式阻擋 | Source 與 producer 現況 | Store / 保存位置 | Canonical join 與必要契約 | Reader / 會員投影 | Cutoff 與尚缺事項 |
| --- | --- | --- | --- | --- | --- |
| 1. 市場法人實際 TWD 金額；`MARKET_REQUIRED_INSTITUTIONAL` | TWSE BFI82U 市場金額候選；`normalizeMarketInstitutionalTwd` 檢查「單位：元」、買賣淨額及總額，合併自營商且不重複加外資自營商。不是逐股金額。來源：`supabase/functions/_shared/recommendation-market-institutional-candidate.ts:1-76`。Producer 在同一 acquisition bundle 取得，見 `supabase/functions/recommendation-stock-evidence-v1/index.ts:44-59`。 | 現有 `research_private.recommendation_v2_acquisition_cache.payload.marketFlow`；report acquisition 的 `foundation_candidate.market_flow`；沒有新增資料表或直接寫正式 `institutional_flows`。見 `supabase/migrations/20261007125316_recommendation_v2_forward_lifecycle.sql:275-319`、`supabase/functions/_shared/recommendation-foundation-candidate.ts:20-29`。 | 候選轉成 `symbol=TAIEX`、同交易日、foreign/investment_trust/dealer 三列 TWD。正式 evaluator 的 `flowsFor('TAIEX', ...)` 仍需要現有 flows input，見 `supabase/functions/_shared/decision-v1-evidence.ts:146-159`。候選建立 formal proof 時刻意使用原 input，不把新金額加入正式 proof，見 `supabase/functions/_shared/recommendation-foundation-candidate.ts:20-29`。 | `persistedFoundationCandidateInput` 另作研究 input；正式 member path 使用 `persistedRecommendationReaderInput`，不是候選 adapter。見 `supabase/functions/_shared/recommendation-foundation-candidate.ts:33-58`、`supabase/functions/get-report-payload/index.ts:1493-1500,1525-1533`。正式來源與用途未准入前不能移除隔離。 | 歷史日期新下載資料 first_seen/available 是現在，不能回填收盤時點。候選須 PREMARKET、前一交易日、first_seen=available≤原 acquisition cutoff；後來 publication receipt 不延長窗口。見 `supabase/functions/_shared/recommendation-market-institutional-candidate.ts:109-135`、`supabase/functions/_shared/recommendation-foundation-candidate.ts:49-58`。 |
| 2. 逐股三大法人實際買／賣／淨 TWD；`THREE_INSTITUTIONS_MISSING` | 既有 Fugle `ownership/institutional-trades` 與 TWSE/TPEX Shadow adapter 是 **SHARES**；不是實際金額 producer。見 `supabase/functions/_shared/recommendation-shadow-v2-sources.ts:7-20,66-112,142-151`。沒有在本輪 inspected Function tree 找到把合法逐股實際 TWD 寫入 canonical flows 的 producer；不得股數乘收盤價替代。 | 正式目標是既有 `public.institutional_flows` 的 buy_amount/sell_amount/net_amount/currency/captured_at/source_ref/created_at；schema 見 `supabase/migrations/20260822090305_production_architecture_v1.sql:152-175`。Shadow shares 留在既有 acquisition/Shadow 路徑，不改寫成 TWD。 | 以本地股票 symbol＋指定交易日＋三種 institution_type 各恰一列 join；TWD、非負買賣、buy−sell≈net、非零 gross、可得時間合格，不能用 TAIEX 市場金額補個股。見 `supabase/functions/_shared/decision-v1-evidence.ts:146-157,180-187`。INTRADAY 使用前一交易日。 | `loadDecisionEvidence` flows query → 同一 evaluator → 既有 publication/會員 gates；不是在 UI 改 reason code 即可解除。見 `supabase/functions/_shared/decision-v1-data.ts:15,24-45`、`supabase/functions/get-report-payload/index.ts:1484-1500`。 | captured_at 與 created_at 均≤assessment cutoff；loader 查 10 日，evaluator 另有 14 日 freshness。仍需合法實際 TWD 來源、逐股覆蓋、用途與 producer/storage 准入。股份來源能力不等於 TWD 能力。 |
| 3. 連四季 actual／consensus＋有來源最新 guidance；`FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING` | 官方 TWSE/TPEX actual adapter 只回報來源值；明確 consensus/guidance=null、complete=false、單位未轉換，不能把 YTD 當單季。見 `supabase/functions/_shared/recommendation-official-actuals.ts:1-12,36-62,91-99`。Finnhub EPS/revenue estimate 是本輪查到的候選，不是已啟用 producer；本輪新增純 validator，沒有 acquisition。 | 正式讀既有 `earnings_events`；schema `supabase/migrations/20260822090305_production_architecture_v1.sql:239-263`。官方 actual capture 目前保存在 recommendation acquisition 收據，不會自動合併成 canonical earnings，見 `supabase/functions/_shared/recommendation-stock-evidence.ts:142-158`。本輪模組沒有 store、RPC 或新收據接線。 | symbol＋連續四個 fiscal quarters；每季 revenue_actual/revenue_consensus/eps_actual/eps_consensus 有限值；最新 sourced guidance up/stable/down。evaluator 用宣布時間排序，四季連號、550 日窗口、最新≤120 日、營收 actual≥0/consensus>0。見 `supabase/functions/_shared/decision-v1-evidence.ts:160-175`。候選平均值不得直接對映為這些 consensus 欄位。 | 正式 Reader 仍查 canonical earnings 並按既有條件投影；候選不被 import，不改 Reader 或 member output。見 `supabase/functions/_shared/decision-v1-data.ts:16,24-45`、`supabase/functions/get-report-payload/index.ts:1484-1500`。 | 來源公開時間與 first_seen/available 都須≤cutoff；比較 actual surprise 時，對應 estimate revision 必須在 actual 公告前已可得。今天下載的歷史列不證明歷史 vintage。四季完整性、單位／幣別／會計及股別基礎、歷史版本與權利仍待外部證據。 |
| 4. 公司事件因果及供應鏈映射；`SOURCED_COMPANY_CATALYST_MAPPING_MISSING` | TWSE/TPEX material announcements 的 producer 只產生 event_fact=true、bullishness=null、impact_review=REQUIRED，不自動產生正面催化或公司受益關係。見 `supabase/functions/_shared/recommendation-company-events.ts:1-9,20-49`。AI news symbols/sectors 不能冒充已驗證關係，見 `supabase/functions/_shared/decision-v1-evidence.ts:103-116`。 | 事實 capture 在既有 bundle 的 companyEvents；正式需 `research_catalysts`、`catalyst_tw_mappings` 及 `news_events`。schema 見 `supabase/migrations/20260820131721_content_intelligence_v2_foundation.sql:54-109`；producer 事實／Shadow 用途見 `supabase/functions/recommendation-stock-evidence-v1/index.ts:71-82`。 | mapping.stock_symbol→股票；mapping.catalyst_id→catalyst.id；catalyst.source_refs 必須對上當時 news id/URL；mapping.source_refs 必須含最新 earnings source_ref，且 transmission_path、taiwan_supply_chain_relation、invalidation_condition 不空。見 `supabase/functions/_shared/decision-v1-evidence.ts:188-197`。這是目前程式契約，不等於已完成人工因果審核。 | 正式機會卡只消費完整可追溯 join；member 投影再按既有公司內容與 publishedSymbols 過濾 fundamental/mapping evidence。見 `supabase/functions/_shared/decision-v1-evidence.ts:242-265,333-359`。LLM 文句不能取代 source/review。 | news 的 published/created、catalyst event/created、mapping created 均須≤cutoff；overnight news 有固定窗口。仍需具來源、確認／失效條件及可審核關係的 producer/review，不把公告事實直接視為利多。 |
| 5. 事件量價反應＋市場／產業 benchmark；`EVENT_ALIGNED_PRICE_VOLUME_REACTION_MISSING`（含 sector/20 日量價依賴） | Fugle historical/candles 與 intraday/quote producer 保留來源 OHLCV/turnover，shares/lots 明確轉換但不以價格推算法人金額，見 `supabase/functions/_shared/recommendation-stock-evidence.ts:29-65`。既有 Shadow 有 TAIEX benchmark_history，不代表已接正式 V1，見 `supabase/functions/_shared/recommendation-shadow-v2-sources.ts:22-32,278-279`。 | 正式 `market_quotes`＋既有 report `recommendation_stock_evidence.captures`；Producer 寫入 ai_strategy_json 的既有位置見 `supabase/functions/generate-daily-report-v7/index.ts:3203-3211`。Reader 僅重用保存資料，不補抓或刷新 receipt time，見 `supabase/functions/_shared/recommendation-stock-evidence.ts:159-210`。 | 每股≥20 completed closes/volumes；事件前 6 bars、事件後 quote/volume；TAIEX 與 preBase 同 trading_date，最新 TAIEX，至少 2 同 sector peers。見 `supabase/functions/_shared/decision-v1-evidence.ts:117-142,180-205,224-233`。缺 benchmark 不用未接線的 Shadow 值填補。 | Reader 綁 report revision_id、producer correlation_id、report_date、generated_at/capture cutoff；不混同 canonical snapshot ID 與 producer ID。見 `supabase/functions/_shared/recommendation-stock-evidence.ts:181-210`。會員另受 publication 狀態、既有推薦 gate、canonical member revision 與 publishedSymbols 限制，見 `supabase/functions/get-report-payload/index.ts:1493-1512`。 | captured_at/ingested_at、capture received_at≤保存 cutoff≤published cutoff；source session/date 保留。PREMARKET 事件後市場尚未發生可標 NOT_YET_OBSERVABLE，不能造量價；其餘 knowable prerequisites 缺失仍 BLOCKED，見 `supabase/functions/_shared/decision-v1-evidence.ts:198-218,305-326`。 |

共同注意：`loadDecisionEvidence` 同時以 event/observation time 與 database availability time 限制讀取；超過 cap、查詢失敗都回 failures，不裝作完整。見 `supabase/functions/_shared/decision-v1-data.ts:12-45`。會員隔離、Owner 同 JWT/getUser/predicate 窄修及整棵樹來源准入由 Main 另外完成；本輪沒有修正或聲稱已驗證 Reader 的 Owner authorization。不能以 tier=admin 或單一 ownerAuthorized flag 代替附件要求的真實 Owner 驗證。

## 三、官方 Finnhub 文件查核：能力存在 ≠ 本帳號可用

查核日 2026-10-17；僅瀏覽公開官方文件。未呼叫 `/api/v1` 資料端點，未登入 dashboard、讀 key、檢視帳戶方案、產生憑證或進行付費呼叫。

1. 官方 API 文件入口：[EPS Estimates](https://finnhub.io/docs/api/company-eps-estimates)、[Revenue Estimates](https://finnhub.io/docs/api/company-revenue-estimates)。本次文字擷取未取得動態文件本文，因此以官方組織維護的 SDK 文件補足，不將空頁視為欄位證據。
2. 官方 SDK [DefaultApi](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/docs/DefaultApi.md#companyepsestimates) 列 `GET /stock/eps-estimate`、`GET /stock/revenue-estimate`；參數為 symbol、freq，支援 annual/quarterly。這些方法的文件參數沒有提供可直接證明歷史 vintage 的 as-of 選擇器。
3. 官方 [EarningsEstimates](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/docs/EarningsEstimates.md)／[RevenueEstimates](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/docs/RevenueEstimates.md) 列 data、freq、symbol；info models 列 average/high/low、numberAnalysts、period、year、quarter。
4. 官方 [EarningsEstimatesInfo](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/docs/EarningsEstimatesInfo.md) 與 [RevenueEstimatesInfo](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/docs/RevenueEstimatesInfo.md) 都說平均值包含 Finnhub 自有預估。故 **EPS 和營收都標 `FINNHUB_AVERAGE_INCLUDING_PROPRIETARY`，不可預設純券商 consensus**。analyst count 也不證明排除了供應商估值。
5. 上述 inspected models 沒有替本案證明 currency、scale、會計基礎、普通股/ADR 對應或每個值的 revision first_seen。adapter 不得猜測單位、以今天的 receipt 冒充舊版本，或由代號推導跨市場映射。
6. [Finnhub Terms of Service](https://finnhub.io/terms-of-service) 對商業使用、資料及衍生結果分享要求適用的書面許可，並含訂閱結束後刪除資料的要求；資料保存／稽核需求須納入權利確認。[官方 Enterprise 頁面](https://api.finnhub.io/pricing-startups-and-enterprise) 宣傳商用與 redistribution 類型方案，不證明本帳戶已持有，也不是本輪購買建議或核准。費用未取得適用報價，不杜撰成本。

| 能力／數量 | 本輪證據結果 |
| --- | --- |
| 文件中季度 estimate endpoint 候選數 | 2：EPS、revenue；僅文件查核 |
| 本輪真實 provider/runtime 資料呼叫／付費呼叫 | 0 / 0 |
| 本案固定股票分母 | 72；來源 `supabase/functions/_shared/recommendation-stock-evidence.ts:10-17` |
| Finnhub 已證明覆蓋股票數／72 | **UNKNOWN / 72**；不是 0，也不是 72 |
| EPS／revenue 可用股票數 | **UNKNOWN / UNKNOWN** |
| 四季 actual＋estimate 且具合格歷史 vintage 的股票數 | **UNKNOWN / 72** |
| 目前帳戶兩介面 entitlement、頻率及上限 | **UNKNOWN**；既有 key 不等於權限證明 |
| 本帳戶會員商用、衍生結果、保存／重用權 | **UNKNOWN** |
| 純券商共識可替代性 | **NOT ESTABLISHED**；官方平均值含供應商估值 |
| 合成測試可證明的實際來源覆蓋／會員 E2E | **無**；61 項控制不是 61 個真實來源或股票樣本 |

## 四、本輪純模組契約及界線

`assessQuarterlyConsensusCapability(serialized)` 只接收≤64,000 UTF-8 bytes JSON，沒有 import、fetch、環境存取、時鐘、SDK、DB、排程或 Runtime 接線。它不是新 pipeline，也不是可直接把 Finnhub 原始回應送進正式資料表的 adapter。

輸入是明確標示的 pre-normalized evidence envelope：本地／provider symbol 與 mapping reference、TWD、cutoff、恰四個連續 fiscal quarters、各季 actuals 與 EPS/revenue selected-record snapshot，以及獨立 issuer guidance。每個 selected-record snapshot 僅一列，保留文件中的 year/quarter/period/freq/symbol；不是假稱供應商完整 response 只有一列。未來 adapter 仍須將它綁到合法保存的原始版本與不可變 receipt。

本地控制包含：

- 實際季度起迄、70–110 日有界期間及相鄰日連續；不把 annual/YTD 偽裝為單季。實際來源的 symbol、fiscal period、起迄須與要求相符；fiscal year 不強迫等於日曆季度。
- actual 與 estimate 分型；只接收明示 TWD、原幣單位 scale=1、EPS per-share、相符 accounting/basic-diluted basis 及 measurement references；不猜匯率、千／百萬單位或 ADR 倍率。
- 有限數值、營收非負／預估營收正值、low≤average≤high、正整數 analyst count；EPS 可零或負，不藉此更動正式策略結論。
- 對每個值的當前 revision：first_seen≤available≤cutoff；estimate available **嚴格早於**對應 actual 公告；如有 source_as_of，須≤first_seen；null 明確保留未知，不回填時間。
- actual 公告不得早於台北會計季度結束，且須先公告再 first_seen；guidance 必須有來源、同股票、明示 up/stable/down、在 cutoff 前可得且不早於已提供的最新 actual 公告。未證明它是所有公告中的最新值，不因通過格式而取得該事實。
- unknown 欄位／權限旗標、來源不符、缺值、晚到、期別／維度衝突全部拒絕；後段失敗不返回前幾季 partial rows；固定安全診斷不回顯原始輸入。

只有兩種結果：`BLOCKED_INPUT` 或 `CANDIDATE_SHAPE_VALID_EXTERNAL_BLOCKED`。兩者的 `v1_admitted`、`member_publication_approved`、`pure_broker_consensus` 永遠 false；沒有 `eps_consensus`／`revenue_consensus` 輸出。單位、mapping、revision reference 是**宣告且可檢查一致性的 metadata，不是本模組驗真過的外部證據**。通過合成 shape 控制不會解除五類正式 blocker。

硬性保留外部阻擋：TW72 coverage、current entitlement、四季 historical-as-of、commercial/member reuse rights 均 UNPROVEN；pure-broker consensus 未建立。呼叫端無法送入 true 旗標使其升級。來源准入前禁止把此結果寫入正式 `earnings_events`、報告或會員判斷。

## 五、驗證、凍結與 Main 交接

本輪實際結果：

- Node **22.14.0** `--experimental-strip-types --test tests/recommendationConsensusCapability.test.mjs`：**61 PASS、0 FAIL、0 SKIP**；全部是明示 SYNTHETIC 的 parser/negative controls，不是實際 Finnhub、Production 或會員 E2E。
- 獨立 strict TypeScript check：**PASS**；固定 `--types node --lib ES2022,DOM`，避免 node_modules 中既有 `@types/react 2`、`react-dom 2` 目錄被隱式收集。第一次未限定 ambient types 的嘗試因這兩個既有目錄 TS2688 失敗；未修改 dependencies 或關閉模組 strict 檢查。
- `deno check --no-config --no-lock --no-remote --no-npm` 此唯一新模組：**PASS**，不下載依賴。最初 `--cached-only` 在現有 CLI 不支援，改用 CLI 明列的離線旗標後完成。
- 既有 `npm run type-check`：**PASS**；`npm run lint`：**PASS**。兩者使用 Node 22.14.0。
- **未執行 build**：本工作分工僅三個新檔；既有 Vite config 有 `out`、AutoImport `dts:true`，正常 build 也可能載入 env 檔。避免本輪新增其他檔案或讀取 secrets；完整樹 build、source seal、CI 由 Main 執行，不將此處標為 build PASS。
- 沒有真實 provider/paid/runtime calls、新憑證、secret reads、正式資料讀寫、Commit、Push、Deploy、Migration、Auth/RLS/Cron 或會員權益變更；既有 lockfile/manifests 未改。

三檔到此凍結，提供 Main 做完整樹來源封存及 CI。Main 不應把本地 shape PASS 當成來源／資安／正式研究或會員發布准入。

## 六、仍需外部證據／選擇（不是新的 pipeline 授權）

1. **現有合約能力**：以非敏感合約／方案證據確認兩 estimate 介面、TW72 普通股逐檔映射與覆蓋。尚無適用報價，不預設要買新資料；若需 provider 回覆，由 Main 彙整唯一必要問題及費用決策。
2. **歷史 vintage 與比較基礎**：確認四季每筆 estimate revision 在對應 actual 公告前及決策 cutoff 前已保存，具合法留存、來源、單位／幣別／會計及股別基礎；今天的歷史回應不夠。補齊真正單季 actual 與 sourced latest guidance。
3. **用途權利**：確認本帳戶商用計算、會員顯示、衍生結果分享、保留／稽核及訂閱終了義務；不能拿公開 API 文件當授權書。
4. **方法選擇**：若產品要求純券商共識，Finnhub proprietary-inclusive 平均值目前不滿足。應提出其他合法來源或明確版本化的方法差異供決策；不得直接更名、降低門檻或替換正式 V1。既有 V2 Shadow/Entry 另線，不因本候選而 promotion。

目前結論：工程候選可交 Main 封存；資料能力與用途仍 **EXTERNAL_BLOCKED**，不能宣稱股票已能完整評估或對外正式使用。
