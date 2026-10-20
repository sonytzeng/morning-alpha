# 原 V1 財報來源與 canonical 接線（續跑、未部署）

正式 `2026-10-20` 報告唯讀核對：Universe72、Evaluated0、BLOCKED72、READY／WATCH／NONE皆0。六類重疊缺口各72，不是432檔，也不是完成評估後全部不合格。正式 `earnings_events` 與 `institutional_flows` 實際各0列。

## 已修復的真實缺陷

原 `parseFinancial` 以請求的年／季標示回應，沒有驗證來源回應是否為同一期間。新版本只接受報表 heading／caption 的明確期間，並拒絕錯季、矛盾期間、空表、只有表單輸入／script／註解的期間。通過期間核對仍是 YTD，不轉成單季，不作EPS相減。舊庫存不可被新程式默默升級；40個財報／現金流任務使用明確新版本鍵，其他來源、請求數、排序、重試、時窗均保持不變。舊收據不改寫；無來源期間證明的財務快取隔離，原因納入新分析 snapshot hash。

既有 MOPS `ajax_t163sb04` 兩次有界公開查核的原文均未落盤。第一次只檢查未去標記字串，不能據此推定沒有公司資料表。第二次於2026-10-20T06:11:06.331Z開始、06:11:09.864Z取得，HTTP200、1,634,892 bytes、SHA256 `1e09a5a620bea78e41fe7fd65ecfdac938b7535c8cea584625abc0520d5d9559`；新 parser 實際讀到「上市公司第二季資料」，但回應未證實年度。因此保留未驗證快照的原欄位，`period/as_of=null`、請求期間另列，不能作單季Actual，也不將穩定的期間缺證當暫時故障反覆重試。

## 原件與口徑

已查 Morning Alpha 指定本機工作樹、交付目錄及私有快取，在已查範圍未定位21份金融業原始 iXBRL 或四份2330 PDF實體。現有七家金控收據是2026Q2 as-reported JSON，不能代替原件。2330四季包的既有數字、原來源URL／hash／取得時間及前次審查保留；本次未聲稱重新重算原件hash。

本輪另從[國泰金控官方財報頁](https://www.cathayholdings.com/holdings/eng/ir/financial_information/quarterly_reports)實際取得並私有0400保存2025Q3、2026Q1、2026Q2三份完整PDF，逐份hash與EPS附註已核對。新離線座標解析器從三個月欄直接抽取普通股Basic EPS，與附註29／30／31交叉核對；不取六／九個月欄，不相減。2025 IFRS4／overlay與2026 IFRS17重編口徑尚不可直接混比；2025年報不是Q4單季原件。淨收益身分、精確公告時間、取得時原生收據及修正版本鏈仍缺；PDF中核准日期不冒充發布時間。此成果是3個EPS候選，不是四季完整Actual，也未被iXBRL canonical writer支援。可審閱的非敏感來源hash／數量／缺口在[原件解析摘要](evidence/issuer-financial-pdf-20261020.json)，原PDF與數值結果不提交Git。

金融業 `NetIncomeLoss` 的既有 profile 是淨收益，不是一般業 Revenue／本期淨利；EPS股別、basic／diluted、合併及幣別必須可比較。公告時間、原始版本、事前Consensus與Guidance仍缺時不得填入默認值；原 `earnings_events.announced_at` 為 NOT NULL，不能用取得時刻或日期午夜代填。

## canonical 接線與授權界線

現有正式 Producer只把行情合入 evaluator；官方Actual存於 acquisition，不存在既有 `earnings_events` 寫入ETL。新增候選 `20261020070000_v1_actual_canonical_candidate.sql` 與ID-only adapter，從已獨立核准、不可變的來源／Actual／品質／內部使用權紀錄，交易式追加canonical Actual與稽核。public-schema wrapper僅service_role可EXECUTE，私有七表FORCE RLS、無應用程式Registry DML權限，原表RLS／權限不變。caller不能傳數值或自授品質／權利；無來源種子、無自動核准、尚未接入正式Caller。

僅已審核NONFINANCIAL_IFRS iXBRL受支援；PDF及未知格式拒絕，金融淨收益不冒充generic revenue。公告／原版本不明、錯季、YTD、未知股別／單位、撤銷、重播衝突均零追加；append與audit失敗同交易回復。重播可防重，但撤銷後不能重播，新舊canonical皆不刪改。Actual-only的Consensus／Guidance固定null。隔離真SQL經原loader→原`buildRecommendationProof`仍是0 evaluated／72 blocked，證明未降低原V1門檻，不宣稱真實個股已評估。既有service_role廣泛權限維持原狀，這不是全域特權SQL禁止方案。

此候選未完成真實來源准入與權利／獨立審查authority安裝，故**不是可單獨部署的解封方案**。精確SQL與來源准入仍須獨立核准。回復只撤銷新wrapper的service_role EXECUTE、停止新寫入，保留Schema、canonical與稽核；不DROP、不刪資料。未來若補入Consensus，必須另審查即時來源撤銷／讀取及口徑相容，不能因本次Actual-only測試就准入。

PR #281 的 Registry→OriginalObservation 與此不同；不得用 WATCHING、C QUALIFIED 或私有來源PASS當成正式股票推薦／會員Published。真實Free／Premium身分仍未提供；不以Owner替代。29份歷史研究不公開，付款保持停用。

## 精確候選與回復

[Worker來源封包](../../scripts/operations/financial-response-period-20261020/release-catalog.json)僅替換 `dailyRuntime.ts`（保留PR284既有截止／恢復修復）、`dailyAdapter.ts`、`dailyParsers.mjs`、`dailyIntelligence.ts`，其餘Worker4閉包、固定SDK2.57.4及JWT設定不變。這不是部署授權，也不會部署Learning、Producer、Reader、Caller或啟用會員政策。回復封包重建固定Worker4來源，屬功能等效，不冒稱實體ESZIP逐位元重建。保留全部收據／Prediction／Outcome與稽核，不刪歷史。

PR284既有Outcome／Learning修復及原封存逐位元保留、未再次擴充。最新來源封存與原文的歷史結論分開。隔離controls及Fresh DB不等於正式個股或自然營運PASS。正式變更、來源准入與股票研究公開仍需各自精確核准。
