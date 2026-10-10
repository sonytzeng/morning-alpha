# 資料與授權
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
