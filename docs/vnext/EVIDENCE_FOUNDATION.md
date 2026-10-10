# Release B Evidence Foundation P0 — 私人研究候選

續接 PR #230 / ebcbb4a6d3dccb1d68694c9dbd6fa5a08de5ac4b。PR 維持 Draft。
不修改正式策略、推薦、Provider、Atomic、Report、LINE、Academy、Cockpit、Cron、Secrets、Auth/RLS；沒有 Production 呼叫或寫入。

## 真實來源與時間

- 72檔名單逐byte核對原核准10/8膠囊指紋；目前名單不是2025年歷史全市場，不能做無存活偏差的全市場回測。
- 250個正式市場交易日：2025-09-25～2026-10-08。使用既有版本化台股日曆，不修改日曆。
- 上市61檔使用 TWSE STOCK_DAY 月批次；上櫃11檔使用 TPEx dailyQuotes 全市場日批次。
- TPEx 月檔為四捨五入的仟股／仟元，不可當成精確股數／元；本輪仍用日檔的原始整數單位。
- 保留 raw OHLC、shares、TWD、session scope、source URL、source version、實際首次取得時間、available_at、來源／紀錄hash。
- 原始發布時間無法證實即為 null；交易日期13:30只表示該session收盤參考，不充當發布／首次取得時間。
- 新增資料首次取得2026-10-10，既有快取保留2026-10-08原收件時間；不以最近重讀時間覆寫原首次取得時間。
- 新快取留存原回應hash及最小正規化紀錄，不保留個人聯絡資料或完整Provider自由文字。
- 所有真實紀錄留在權限0700/0600的本機私有目錄，不提交Git、公開CI或Readdy。

## 缺口不得假補

2884 / 2025-11-05：TWSE STOCK_DAY回應成交股數=0、成交金額=0、OHLC=--。證交所公告自11/5暫停交易，11/6恢復。
本輪仍以「250個市場交易日內有完整OHLC」的嚴格定義計數，不把停牌刪掉、填前價，或偷偷改成250筆有效日K。
實際覆蓋：20/60/120個市場交易日72/72；250個市場交易日71/72，2884為249/250。
另保留原官方月快取已存在的2884 2025-09-24成交紀錄，作為額外warmup；沒有增加Provider請求。若明確採「250筆實際成交日量價」統計，72/72均可讀。兩種口徑分欄，原250市場交易日Gate不變、停牌日不消失、也不推定停牌可成交。

來源：
- [官方暫停交易公告](https://wwwc.twse.com.tw/staticFiles/news/news/tsecnews/8a8216d69a3d6cf9019a4e78607c0048.pdf)
- [官方恢復交易公告](https://wwwc.twse.com.tw/staticFiles/news/news/tsecnews/8a8216d69a3d6cf9019a53ba147e0060.pdf)
- [官方原始月量價](https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20251101&stockNo=2884)

這個缺口是合法無交易狀態，不是整個資料Producer失敗，也不能拿來虛構可成交價格。

## 公司行動與合法調整

六組上市／上櫃官方來源：除權息、減資恢復買賣、面額變更恢復買賣。實際取得81筆除權息（上市70／上櫃11）；本窗口兩種恢復買賣來源無命中。
上市70筆逐一查核官方股息配股明細，其中60筆重用已有私有快取；保留生效日、前後參考價、現金／配股、認購資料及來源。
來源查詢成功或零筆，**不證明**所有分割、分拆、換股與其他權益事件已全部清除。完整權益ledger／全事件clearance仍不足。
價格調整候選只允許在完整clearance及逐筆verified entitlement成立後，以官方前後參考價計算price-index rebasing；不等同股東總報酬或可成交報酬。真實資料仍保持 `adjusted_return_eligible=false`。

## 事件與財務實績

實測 TWSE / TPEx 官方重大訊息來源分別返回6／4筆；當期快照中72檔命中0筆，不是fetch失敗、不等於過去沒有公告。
修正本研究adapter對TPEx `SecuritiesCompanyCode`、`Date`、`Year`、基本每股盈餘欄位的相容；正式Provider程式未動。
月營收72檔、EPS72檔可讀，保留當期period與as-reported口徑。精確發布時間未知不從出表日期推造；單期數字不替代多期趨勢，Actual絕不冒充Consensus。
重大公告只保留來源、symbol、精確發言時間、首次取得、type、原紀錄及主旨hash；正文、產業影響與完整歷史事件留存尚缺。法說/財報/營收的event type僅按原始公告主旨辨識，不推論利多利空。

## 供應鏈：一條已核對，其他未知

[TSMC官方2025供應商獎項](https://pr.tsmc.com/english/news/3274)明列 Jentech Precision Industrial；TWSE公司目錄另行驗證英文名對應3653。
可收錄：健策3653 → 台積電2330，2025年具名supplier關係。
不可推論：產品種類、當前訂單、營收占比、利潤、上下游傳導或股價受益；customer反向僅是同一關係視角，不另計第二條證據；其他競爭／產品关系仍UNKNOWN。
官方網頁的程式GET為403，沒有反覆繞過；改以可合法讀取的公開網頁工具人工核對，僅保留自寫事實摘要hash與來源。資料明確標 `PUBLIC_WEB_READER`，raw response hash為null，未偽造HTTP回應。此來源未做自動每日取得。

## 自然增量候選（未啟用）

不增加Cron，不把VNext放入07:00報告或LINE同步依賴。
提案：既有核心流程完成後發出非阻塞背景工作，core busy或未完成即延後；Core完全不await研究結果。
穩定job清單／cursor：TWSE月內增量每symbol一工作、TPEx全市場單日一工作、行動／事件／實績快照三類。每次最多12個工作、concurrency1、至少2.2秒節流、每請求20秒、最多3次；實際429 Retry-After過長即延後，不忽略限流。
已完成session watermark略過；cursor基於固定工作清單，不能因已完成項目移除而跳過下一批。只有驗證成功且不可變快取寫入後才推watermark；失敗保持未完成。
本輪僅pure planner和研究CLI，不包含dispatcher、背景正式consumer或timer。部署/新正式接入必須另批精確Manifest。

## 權限／授權／Owner畫面

新增資料摘要沿用同一loopback Owner endpoint及現有Supabase Auth/RLS驗證；anonymous/free/premium/偽造身分不得取得。只回傳覆蓋與缺口摘要，不傳18,000筆原始量價。
Owner研究仍是短／中／長三期間；新增「查看本次新取得資料與剩餘缺口」，與原截止歷史卡片分開，技術資訊收合。不宣稱432項歷史研究因後來資料變成合格。
權限驗收是真正隔離Supabase Auth，不冒充Sony Production Owner。Production驗收不在本輪授權內。

開放資料授權只在明確列入的資料集成立；不可從網站可讀推導所有歷史接口可商用再散布。
- [TWSE資料使用規則](https://www.twse.com.tw/zh/products/information/use.html)
- [政府資料開放授權條款](https://data.gov.tw/license)
- [上市重大訊息資料集](https://data.gov.tw/en/datasets/18415)
- [TPEx日行情資料集](https://data.gov.tw/dataset/11370)

目前僅Owner本機私人研究；history endpoint mapping、權利聲明及第三方公司網頁商用再散布尚未全部清除，不發布會員。未需要新付費來源，但也未證明現有來源足以完成所有長期研究。

## 驗證／重現

新增unit tests只驗證protocol、時間、防偽及限制，明確SYNTHETIC，不是績效。
`tests/vnextFoundationReal.integration.mjs`在私有本機、離線禁網路下核對完整coverage、每筆hash、first_seen、舊截止可用新資料=0、兩日研究與已鎖定檔案完全一致。
以 `MA_VNEXT_FOUNDATION_DIR` 指向本機0700資料目錄啟用Owner摘要；不在Production router掛載，不需新增Migration、Function、Secret或Cron。
既有隔離資料庫schema／RLS未改，本輪不重建已PASS資料库；同一endpoint新的資料傳輸需重新做非Owner拒絕與Owner Browser驗收。
所有最後candidate依賴的Integrity／Type-check／Lint／Build／CI以最新HEAD重跑。

保留未完成：完整公司行動clearance、歷史公告內文、多期財務、估值／需求／訂單證據、更多真正公司關係、PIT歷史Universe、自然dispatcher、Forward／Outcome、商用再散布及Production Owner驗收。
Forward=0；Outcome=0；Analysis Value=INSUFFICIENT_SAMPLE；SONY_USABILITY=PENDING；PUBLIC_PRODUCT_APPROVAL=NO。
