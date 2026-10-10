# 資料與授權
## 2026-10-10 Publication P0 精確覆核（優先於下方早期盤點）

本節是工程用途的來源/授權稽核，不是對整個商業產品的法律保證。
政府資料開放授權第1版允許符合條件的商業、衍生、再散布用途，**須保留來源標示**；不包括所有第三方素材、商標、專利或個資。只涵蓋明列dataset，不把同站其他行情服務包進來。

|來源/類型|可確認範圍|本輪分類/處理|
|---|---|---|
|TWSE公司重大訊息|[18415](https://data.gov.tw/dataset/18415) → `t187ap04_L` CSV/OpenAPI|OPEN_DATA_WITH_ATTRIBUTION；事件存在不等於利多|
|TPEx公司重大訊息|[18418](https://data.gov.tw/dataset/18418) → `t187ap04_O` CSV/`mopsfin_` API|同上；不發布個人聯絡資料|
|TWSE月營收|[18420](https://data.gov.tw/dataset/18420) → `t187ap05_L`|可依法使用公開實績及原創衍生分析，仍受時間與品質Gate|
|TPEx月營收|[56510](https://data.gov.tw/dataset/56510) → `t187ap05_O`|同上；實績不是Consensus|
|TWSE EPS統計|[20756](https://data.gov.tw/dataset/20756) → `t187ap14_L`|有條件開放；與91998綜合損益表`ap06`不同dataset，不混用|
|TPEx EPS統計|[20757](https://data.gov.tw/dataset/20757) → `t187ap14_O`|同上；不推定單季/累計口徑|
|TWSE日行情開放集|[11549](https://data.gov.tw/dataset/11549)明列`STOCK_DAY_ALL?response=open_data`|該資料集有OGL；既有歷史`STOCK_DAY?date=...`不是相同資源，歷史cache仍LICENSING_UNVERIFIED|
|TPEx日行情開放集|[11370](https://data.gov.tw/dataset/11370)列舊`stk_quote_result.php?l=zh-tw&o=data`，Swagger列`/tpex_mainboard_daily_close_quotes`|本機歷史cache為`/www/zh-tw/afterTrading/dailyQuotes?date=...`；未證明歷史範圍等價，維持LICENSING_UNVERIFIED|
|Fugle|[API規範](https://developer.fugle.tw/docs/data/intro/)要求遵守交易資訊管理與再傳輸限制|RESTRICTED_CONTRACT_REQUIRED；目前帳戶的第三方/商用衍生合約未提供。不能用付費訂閱當會員許可|
|公司官網公告/供應鏈|[TSMC網站條款](https://www.tsmc.com/english/legal_and_trademark)一般授予個人非商用瀏覽|官方關係可作私人核對；原文/圖形再散布與商用衍生範圍未核准，LICENSING_UNVERIFIED。事實與受保護表達分開，不宣稱事實本身由其專有|
|產業事件分析|以具名OGL公告事實重新撰寫，逐聲明保留來源|原創推論須標示推論與可驗證條件；不能用相同行業推造公司關係；目前72檔snapshot命中0|
|私人老師素材|既有私人來源|不得再散布；本輪完全不納入會員內容|

2026-10-10T15:51:54Z 前完成官方網頁、dataset下載URL及TWSE/TPEx Swagger metadata核對。六個具名API標題與CSV識別一致；目前僅註冊這六個精確API/CSV，不自動套用domain/prefix。
來源：上列逐筆官方頁；[授權原文](https://data.gov.tw/license)；[TWSE資料使用規範](https://www.twse.com.tw/zh/products/information/use.html)；[TPEx資訊商店條款](https://eshop.tpex.org.tw/zh/product/shoppingTerm)。
沒有接受新契約、購買、讀取Secret或聯絡Provider。未知範圍要取得書面範圍確認或改用已明確授權且可合法取得的來源，不能用換句話說繞過。

## 早期盤點（保留稽核歷史）
2026-10-10 重新查閱官方文件。技術可讀、付費訂閱不等於商用或再散布核准。
|來源|技術證據|權利狀態|本候選處理|
|---|---|---|---|
|Fugle|既有 operational acquisition；歷史 API|實際方案、儲存、商用衍生、會員再散布合約未提供|UNKNOWN；不擴大使用/公開、不索取新 Secret|
|TWSE/TPEx 官方 OGL 指定 dataset|既有 72 檔歷史 cache|個別 dataset license/attribution 要逐筆保留，不能將 OpenData 規則套用全部 endpoint|來源別 gate；未審核不公開|
|TWSE MIS/非 OGL 即時|既有 Operational evidence|另有行情使用規範|不視為 public research license|
|既有公司事件/新聞 DB|查到 source_ref 與 published/event 時間|created_at 不是自動的 available_at；未見完整 rights record|adapter 不推造可得時間|
|私人老師講義/影片|既有研究|不具會員再散布許可|不複製、不上傳、不公開|
|Academy 原創教材|既有 rights/manifest|沿用審核；本輪不修改|重用|

官方來源：
- [政府資料開放授權條款](https://data.gov.tw/license)
- [Fugle 資料文件](https://developer.fugle.tw/docs/data/intro/)
- [TWSE 資訊使用](https://www.twse.com.tw/zh/products/information/use.html)
既有 PR103 DATA_LICENSE_AUDIT 提供逐 dataset 引用，仍不是本帳戶商業合約證明。

## 歷史覆蓋的精確限制
既有私有 cache 稽核：72/72 股票，20/60/120日量價完整，共8640bars；2026-04-16～10-07。
但新取得時間為10/8實際時間，不能回填成10/7/8原預測截止時點已知。原始留存只有45bars。
六檔 thematic peers不足：1590、2049、4566、2208、2634、8033。官方大產業分類 peers不等於已驗證同業，不改72檔Universe。
公司行動68筆不等於完整adjustment/rights ledger；保留不計可調整報酬。
LONG250D超過120D覆蓋；PIT universe與可成交證據仍不足。
未重新抓 Provider、未購買資料、未把私有 cache 上傳 GitHub。
