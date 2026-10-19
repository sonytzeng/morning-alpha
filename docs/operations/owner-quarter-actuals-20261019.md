# 台積電四季 Actual 的 Owner 研究接線

本候選讓 Owner 從既有報告來源區讀到台積電四季營收與稀釋普通股每股盈餘，並把四筆數字實際送進 Owner 研究的 earnings 輸入。此前官方 Actual 只出現在取得覆蓋計數，沒有進入這個輸入。正式推薦和會員讀取仍使用原本資料。

基線為 `ff88a4ed7ce10116a6fad84110770953941fcd08`。這是來源與工程候選，沒有部署、舊報告改寫、正式來源准入、會員權益或付款啟用。

正式 Producer15／Reader56 尚未部署本候選依賴的 Git `foundation_candidate` 私有祖先。以下四筆接線與畫面為候選和離線驗證，不代表目前正式 Owner 已看見 4/4。不得把整包 Git Reader／Producer 當作 Actual 單項修復直接部署，也不得順帶啟用市場流私有 capture 或來源准入。日後正式 Owner 研究發布，必須另從真實 Producer15／Reader56 做精確增量閉包，證明原 saved-capsule 邊界；本輪不新增 route、資源或 late Reader 注入。

## 真正接入的四筆數字

| 直接單季 | 稀釋普通股 EPS（TWD） | 合併營收（十億 TWD） |
| --- | ---: | ---: |
| 2025-Q4 | 19.50 | 1046.09 |
| 2026-Q1 | 22.08 | 1134.10 |
| 2026-Q2 | 27.25 | 1270.38 |
| 2026-Q3 | 29.43 | 1494.24 |

來源為已保存的四份台積電官方 Management Report。建包時離線核對原 PDF bytes、SHA-256、原取得時間、季度及普通股／稀釋口徑；Runtime 不取得 PDF，不呼叫 Provider。營收保留原報表十億 TWD 小數兩位，換算 TWD 的解析度是一千萬元，不宣稱精確到底層元。Basic 未揭露，不因此新增 V1 門檻，也不混入 ADR、USD、累計值或年度相減。

固定來源包位於 `supabase/functions/_shared/retained-2330-quarter-actuals-20261019.json`。檔案 SHA-256 為 `6b2775376d09849c27523248c27cde889c49b1aaaac8a9e535fb91282e276dc7`；保留原數值型別的 canonical JSON SHA-256 為 `cf8a3700217d9652d9d293b73c2addf19c151556fcfe21daf7299a70884b686d`。兩種指紋用途不同；後者允許儲存端重排 JSON 物件鍵而不改來源內容。

## 保存、讀取與顯示

新的 Producer 候選將完整 source-bound capsule 附在原有 `foundation_candidate` 私有祖先下。Capsule 綁定 report date、Producer revision、Producer cutoff、evidence cutoff 及來源包指紋；16 KB 上限、精確欄位及 payload hash 均須符合。舊報告沒有 capsule 就維持舊行為，Reader 不在之後補入新包，也不更新可用時間。

只有既有伺服器 Owner 身分核對通過的研究分支會把四筆 Actual 加入 earnings。穩定 row ID 使重讀不累加；遇同 ID 不同內容就拒絕。不與同季 Consensus／Guidance row 拼接，不覆寫原本 canonical row。正式 `buildRecommendationProof` 和會員 `persistedRecommendationReaderInput` 的輸入與判斷保持原樣。

畫面重用既有 Owner 的 `get-report-payload` 回應及 `LineDecisionPreview` 來源區，不增加入口、請求或權限。會員 LINE Flex 不含這四筆私有候選。主表顯示季度、EPS、營收與官方 PDF，查核詳情保留原雜湊、取得時間、包建立時間、截止與未知公告資訊。

## 截止與仍缺的證據

來源包於 `2026-10-19T01:12:04.643Z` 新建，版本截至台北 2026-10-19，僅支援 2026-10-19 至 2026-12-31 報告日期，不能永久當成最新四季。包建立時間、原 PDF 取得時間及印刷日期標籤彼此分開，皆不代替首次公開公告時間。

包與來源均須先於新的 evidence cutoff，且完整沿用原報告／Producer correlation／revision／cutoff 關係。10/19 已有早報不回補；依既有盤前研究讀取合約，正常首個可使用此包的是建包後的新交易日 Producer 收據。

四份原件仍缺確切首次公告時刻及原始版本鏈，因此 `announced_at` 與未知 source version 保持 null。公告前 Consensus 與最新 Guidance 也保持 null。Owner 可核對四季 Actual，但仍不能完成正式推薦；原 V1 完整性門檻沒有降低。正式啟用仍須補足上述來源證明與其他推薦所需資料，另行完成來源准入，不以這個候選的 false 旗標代替真正授權判斷。

## 驗證及交付界線

真實留存 Actual 搭配明示的合成新報告／市場控制離線重播：Owner earnings 從 0 增至 4，正式 proof 與會員結果完全相等，72 檔仍為有效評估 0／資料阻擋 72。這不是 Production E2E，也不是對未來交易日的取數證明。

新回歸涵蓋來源變造、錯誤季度／EPS 股別、假公告、同季拼接、重讀、防止回填舊報告、錯 Producer、晚 Reader、大小上限、未授權、會員、來源連結及登出／換日期晚回應。CI 新步驟只執行這些離線接線與既有 Reader／LINE 回歸。

前次新測試的 Universe fixture 缺少既有 `created_at`／`updated_at`，導致 27/28；僅修正合成 fixture 後 28/28，原失敗 log 保留。限定獨立 review、其餘測試與精確來源綁定見同名 review JSON；此候選沒有把有限程式審閱稱為完整安全掃描。

既有八組 guard 初跑為 102/103，凍結 R8 D 包依序遇到本輪 foundation 與 Reader 的新 bytes；原 R8 封存與斷言均保留。測試 reader 僅加入兩個固定路徑的歷史 view：完整 current composition 先驗，當前實體 bytes／mode 精確符合新 seal，才還原 foundation 的 `bc48d784…`／`f4584ce2…`。Reader 使用固定 `ff88a4ed…` 的原 `c36a5d41…`，保留其已固定 SDK import；不冒用不同 Reader bytes 的 core 祖先。既有 primitive 對注入值原物件返回，因此該值不轉成歷史 bytes。原 102/103 與中間 19/20 log 均保留；最後只重跑該七項 package 及十三項必要 admission，20/20 通過，其餘已通過的 83 項與新 28＋16 項不重跑。

前端 type-check、Lint、Build 及含既有 JavaScript 模組推型別的後端 strict TypeScript 檢查通過。本機沒有 Deno，未把 TypeScript 檢查冒稱 Deno；真正 Deno 檢查保留由 CI 執行。

後繼 composition 封存原 348 列 Owner 文案 seal 的精確 bytes，再列本輪必要來源。舊 seal、B24 實體 guard、Worker／SDK、Auth／RLS／Cron、Caller、LINE 發送及付款保持原狀；八個發布旗標仍全為 false。
