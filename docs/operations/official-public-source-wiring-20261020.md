# 原始 V1：官方公開來源實際接線（2026-10-20）

這是接續原始交付的獨立來源候選，不是新的推薦方法。基線為 `7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3`。PR #281 的空 Observation 入口、SQL 及 HEAD 完全不在本批；其 Production NO-GO 不變。本批沒有可直接部署的 Function、SQL 或 Caller，不能拿來源工程測試當作會員產品已完成。

## 已實際接入，而非只列調查清單

1. 有界公開擷取器使用固定來源、無憑證 GET、禁止 redirect、位元組／請求／期限上限，拒絕頁立即停止。不落盤公告原文、聯絡人或公司 profile。來源收據保留實際 HTTP bytes 的 SHA256；正規化列與原始 HTTP hash 不混稱。
2. 查到 TPEx 財報使用 `Date / Year / Season / SecuritiesCompanyCode`，不是 TWSE 中文識別欄位。已實作明確別名、衝突拒絕及原標籤保留。真實擷取 **54 上市一般業＋7 金控＋11 上櫃＝72 檔財務快照**，全部是 **2026-Q2**，不是四季。
3. `buildOfficialV1SourceCandidate` 把這 72 筆安全投影送進既有 earnings 輸入，原欄位數字仍是 as-reported 字串。會計期間、單位與單季／YTD 尚未證明，因此 `eps_actual / revenue_actual / announced_at / consensus / guidance` 不虛構。另保留原有 2330 四筆直接單季 Actual；它們仍缺原始公告版本／Consensus／Guidance，不互相拼接。
4. 官方公告取得 **12 筆、5 家公司**的原始發言時間、股票關聯及來源 hash；不是 12 個利多，也不是 12 筆推薦。原 evaluator 實際執行；公告事實與主旨驗證、因果審查、品質審查及會員發布是不同階段。
5. 接線重用原 `eventAlignmentFromDailyReceipts`、canonical sector observation 與 `buildEvidenceDecision`。不修改原 evaluator、分數、期間、時間門檻、Producer16、Worker4、Reader57、LINE71、Auth/RLS 或會員邊界。

真實最新來源重播與合成控制分開記錄。所用留存量價最後是 10/16，不能冒充 10/20 即時行情，也不能把這個隔離快照的額外 freshness 拒絕當成正式網站目前缺口。隔離結果仍是 Universe72 / Evaluated0 / BLOCKED72；這不是有效評估後全數不合格。

## 來源、用途與真正限制

| 來源／實際介面 | 內容及更新 | 授權證據與界線 |
| --- | --- | --- |
| TWSE `opendata/t187ap06_L_ci` | 本批54檔、2026Q2；營收、成本、獲利、基本EPS等原欄位；每季快照 | [一般業資料集91998](https://data.gov.tw/dataset/91998) 明列免費及 OGL1；[官方 OpenAPI](https://openapi.twse.com.tw/) 宣告授權連結。依法顯名的資料集／衍生使用可行，不須一律等新的付費授權；不是歷史四季或市場共識。 |
| TWSE `opendata/t187ap06_L_fh` | 本批7檔、2026Q2；淨收益／利息淨收益，不冒充一般業 gross revenue | [金控資料集91999](https://data.gov.tw/dataset/91999)，免費 OGL1。財務口徑仍須獨立確認。 |
| TPEx `mopsfin_t187ap06_O_ci` | 本批11檔、2026Q2；實際英文識別欄位＋中文金額欄位 | [上櫃一般業資料集94853](https://data.gov.tw/dataset/94853)，免費 OGL1；其明列 CSV 可直接依條款利用。JSON表示與資料集的確切資源對應保留於使用權審查，不擴大至其他櫃買商品。 |
| TWSE `t187ap04_L`／TPEx `mopsfin_t187ap04_O` | 每日官方發言時間／公司代碼／主旨定位；本批12件；原版本鏈未知 | [18415](https://data.gov.tw/dataset/18415)、[18418](https://data.gov.tw/dataset/18418) 明列免費 OGL1。來源事實可用，不自動通過投資因果／品質／發布審核。 |
| TWSE BFI82U | 已觀察市場 buy/sell/net 原生 TWD；**不是逐股** | [TWSE條款](https://www.twse.com.tw/zh/terms/use.html)限制非核准方式自動下載；尚無本報表專屬開放資料證據。早期私有實測只保留歷史，不宣稱自動化／會員使用已獲授權。**最終 runner 已移除該 GET**，不改任何既有正式程式。 |
| TPEx `tpex_3insti_summary`／[11743](https://data.gov.tw/dataset/11743) | 櫃買市場實際元；每日 | 精確資料集 OGL1 可用，但不能拿 OTC 總額充當 TAIEX 或逐股金額。 |
| TWSE T86／TPEx [11856](https://data.gov.tw/dataset/11856) | 逐股法人 **股數** | 已查核介面沒有逐股實際 TWD；禁止股數乘價。沒有推定所有官方產品均不提供。 |
| MOPS 2330 四季 XBRL | 嘗試2026Q3返回 HTTP200／98bytes，非 XBRL；其餘3季未嘗試 | 保留拒絕原因與 hash，不繞過、換身分或把拒絕頁當財報。**預設／CLI線上 batch 已停用**，只保留離線 parser 與合成 transport 控制；精確自動取得權未確認前不再次請求。既有4季管理報告是另一個來源，不冒稱本次取得。 |

[OGL1](https://data.gov.tw/license)允許符合顯名等義務的商用及衍生利用；這不代表所有交易所行情、IR PDF 或 Provider 合約同樣適用。沒有採購、報價接受、寄信、付費試用或契約承諾。既有來源可讀與合法會員公開仍分開審查。

## 仍阻擋原 V1 的具體證據

- 逐股 × 日期 × 三法人 actual buy/sell/net TWD：已查核官方逐股介面提供股數，不能滿足該欄；既有付費方案是否另有真實原始價金仍未證實。不預設需要加購。
- 四季 Actual：本批72筆均為2026Q2快照，單季／累計與金額單位不能猜。2330另有4直接單季數值，但原始公告時間與修正版本仍未閉合。MOPS取源已安全拒絕，不能靠今天取得資料補舊 cutoff。
- 公告前 Consensus：本批官方實際值資料不含公告前券商共識版本；公司財測不是市場 Consensus。沒有以今日估計、Actual、月營收或官方預測替代。
- Guidance：公司法說可以是來源，但沒有可比較版本與明示方向時，不預設 stable。
- 公司催化／供應鏈：12公告是公司直接事件事實，不是已核准因果／訂單／受惠關係；獨立審核仍需原文、傳導、反證及失效條件。
- 事件前後量價／benchmark：既有20日資料及至少兩個同業不代表事件後反應必然已可觀測；不得改事件 freshness 或填未來量價。

## 安全修復與驗收範圍

獨立普通 review 提出的四項已處理：全段評估期限檢查、相同瞬間不同時區的 retained 衝突拒絕、await前完整輸入快照、事件級 hash fragment 防止 aggregate URL 誤接別家公司公告。新增拒絕控制沒有刪除原斷言。舊 R10／cold-source 測試在逐位元固定 main 執行，並先通過完整當前來源 seal；沒有把舊環境當當前來源。

新程式的合成／隔離測試、Deno check、type-check、lint、build 與精確 HEAD CI 分開記錄；未變的 Fresh DB／RLS／會員測試證據可按 exact source 沿用，沒有冒稱新的正式 Free／Premium 登入。此次不增加 SQL／RPC／RLS，也不操作正式業務。

## 發布及回復

**本批 Production NO-GO**：是可重現的來源取得／原 evaluator 接線候選，不是已具完整資料的正式推薦 Producer。沒有要求部署空 Observation 入口、整包 main 或舊依賴。PR281仍獨立 HOLD。正式來源准入、私有 Producer／Reader 變更、原子 Observation 流程、會員公開，各自前置條件未通過前不得部署。

本批回復是停止隔離 runner（最多45秒 acquisition／20秒 evaluation；不繼續下一請求），撤回來源候選即可；沒有正式資源可刪、沒有 SQL 可回滾。原始私有收據及失敗歷史保留，不修改舊報告／Forward／Outcome。未來若需部署，須另列精確 runtime 閉包、來源權利、版本、寫入及安全回復，不能從本文件推論已授權。

唯一必要的外部決策不是「再買資料」：先確認既有方案是否涵蓋逐股原始價金及公告前歷史 Consensus／Guidance；未證實前不啟用額外費用。若現有合法來源確實不支持，才提交版本化方法差異供 Owner 決定，不暗降 V1 門檻。正式 Free／Premium 驗收仍需要合法既有身分，不能用 Owner 冒充。付款維持 DISABLED。
