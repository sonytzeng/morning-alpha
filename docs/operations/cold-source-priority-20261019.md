# 冷快取來源順序修復與正式交付界線

本批不是推薦方法 Promotion，也不是已完成的 Production 股票推薦。基線為 `fda6d637ebf35ce545a31ddba3ad2e2b4724e7a8`，正式 Worker3、Caller4、Producer16、Reader57、member-access9、LINE71 已唯讀確認；不重做其發布。

## 真正的零推薦原因

10/19 自然 C run 於台北07:00建立，停在 cursor284／1358，Prediction0。07:14底層RPC中斷的確切原因仍未知；09:00後舊Worker邏輯又留下473次 `COLD_BOOTSTRAP_NO_LATE_FORWARD`，最終512次工作額度耗盡。後段已由先前Worker2／3修復，不在本批重做；不得重設／補跑今天批次。

原封存SourceReceipt文字逐位元核對286／286，並核對normalized payload hash。以既有 `assembleDaily`／`evaluateResearch` 在新審查截止時間離線執行，保留所有原取得時間：72檔有1440根完整20日資料，行情截至10/16。C探索短期為可評估72、合格2、不符70、資料不足0；中期與長期各資料不足72。沒有營收、法人或財務收據進入今天C run；這些來源還沒被走到，不是已證明官方沒有資料。此結果不是自然Prediction、正式推薦或會員公開核准。

正式V1另有保存的72股逐檔拒絕證據：Evaluated0、BLOCKED72、READY／WATCH／NONE皆0。六個重疊原因各72：三法人實際金額、四季完整基本面、公司事件因果映射、事件前後量價，以及市場法人／催化證據。20日成交量缺失已不在本次阻擋清單。正式earnings_events／institutional_flows沒有可用資料；月營收與報表EPS各72覆蓋，不等於四季單季Actual＋公告前Consensus／Guidance完整。

`/stocks`讀取已審核的 `vnext_private` Published Projection，不讀C Prediction。今天兩者皆0，正式Owner三個期間均可正常切換且顯示0；不是前端把合法股票藏起來。C到原始三期間／會員發布仍有Evidence、審閱、來源使用權與交易式Publication接線缺口，不能只部署此修復就稱產品完成。

## 本批實際修復

只重排原有 acquisitionPlan：完整72股短期20日價格與TAIEX窗口 → 原C中期三月營收／十日法人來源 → 其他既有事件、財務、公司行動與資料 → 深歷史價格bootstrap。沒有新增請求、刪除來源、修改task key／freshness／限速／三次來源重試／512次invocation上限／09:00截止或任何Evaluator門檻。

以真實61上市／11上櫃分類，1358項工作不變。營收首項從zero-based1168提前到164；法人從1128提前到144。全部舊持久化plan仍由原Runtime直接沿用，不重排今天plan，不寫回舊cutoff。這只是防止必要資料被深歷史排程餓住；不能保證Provider成功，也不解決原07:14未明RPC故障。

## 精確發布範圍

唯一可提審Function：`vnext-daily-research-v1`。候選由真實Worker3完整44個Runtime來源建立，43個逐位元不變，只有 `src/features/vnext/dailyAdapter.ts` 改變。SDK仍2.57.4、verify_jwt=true、原Internal Auth不變。另保留30份授權檔與4個純型別依賴；兩個型別import僅補`.ts`，不改Runtime行為。完整78檔清單／hash及payload指紋見 `scripts/operations/cold-source-priority-20261019/release-catalog.json`。

不含Migration、Caller、Producer、Reader、Auth／RLS／Cron／Secrets、會員政策、研究公開、LINE、付款或舊批次處理。候選不自行部署。新精確Commit／CI結果以PR最新正文為準，不能把來源封存旗標當發布授權。

## 驗收與回復

來源排序、原任務集合與日期／權限負例、現有Lease／Checkpoint／Prediction／Outcome回歸須通過；對精確候選與回復78檔執行Deno check，不以主工作樹替代。最初74檔檢查缺純型別依賴而失敗，已保留這項紀錄；不刪型別檢查、不以any或no-check繞過。

隔離Fresh DB最初因Postgres readiness失敗；後續唯讀診斷確認本機Docker磁碟100%，不清理他人資料。測試Harness補傳其自行產生的隨機PGPASSWORD、固定錯誤分類，並沿用既有 `MA_ISOLATED_DB_TMPFS=1` 的256MiB拋棄式資料庫選項。最後14組真實SQL／HTTP、Owner／Member拒絕、Lease／fence、崩潰／回應遺失、216筆原子鎖、到期Outcome及精確回復檢查通過。這是隔離合成身分及時鐘，不讀正式Secret，也不是自然Production PASS；原失敗不改寫為通過。

發布前重新比對Worker3的44個來源、JWT／SDK及ESZIP指紋；漂移即停止。發布後只做不觸發業務的狀態／來源核對，並等待下一合法自然批次；不得人工POST建立推薦或回填今日。若Runtime／Auth／既有服務退化，使用已封存recovery payload回復原Worker3完整Runtime來源。固定SDK功能等效回復不冒稱ESZIP逐位元一致；保留Schema、既有資料、稽核及所有歷史批次。

## 仍未交付的必要項目

- 新自然C run必須實際走完評估／不可變保存；216筆鎖也不代表216筆推薦。
- 原始SHORT仍缺完整公司消息／法人／技術結構審閱；MEDIUM仍缺訂單、可靠展望、產業傳導；LONG需完整需求、競爭優勢、供應鏈、估值與逐股可比較財務。
- 已保留2330四季12項財務family為離線研究成果，非本批Runtime來源准入；未知原發布時間不能填成取得時間。
- 正式V1的逐股實際TWD、公告前Consensus版本及可靠Guidance能力／使用權尚未證實，不用股數×收盤價、今日預估或stable預設替代。
- 會員只讀完整通過品質、時間、用途、Owner逐筆核准的Projection；D／E及29份舊研究公開HOLD不變。Free／Premium真實正式身分驗收仍需合法身分，Owner不能冒充。

`STOCK_RECOMMENDATION_DELIVERED=NO`；付款維持DISABLED，五日穩定及Forward／Outcome樣本不得因本批隔離測試自動加分。
