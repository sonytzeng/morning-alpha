# 金融業單季財報解析修復（2026-10-19）

七檔金融股原件已經有單季收益數字；舊通用解析器只認 IFRS Revenue，不能因此把所有金融業收益都視為不存在。本次新增明確啟用的 `tifrs-fh-direct-v1`，將這些數字解析成金融業專用欄位，供研究重播與後續口徑配對。預設行為、通用 Revenue 與既有 V1 門檻保持原樣。

21 份原件（2025Q3、2026Q1、2026Q2）產生66筆直接單季金融數字：淨收益21、利息淨收益21、利息收入21、原報收益3。其餘18項原報收益保持缺值，沒有補零或加總。各筆保留 exact QName、context、entity、TWD、單季起迄、原始小數、scale、指紋、收到時間與原始來源 URL。21份預設完整輸出與原程式逐字典相同。

`fh:NetIncomeLoss` 在這21份原件的實際行標是「4XXXX 淨收益 Net revenue」，不能按英文名稱誤認為本期淨利；後者是獨立 IFRS ProfitLoss（69000）。`Incomes` 只證明原報「40000 收益 Revenues」，不擅自取名 gross。新欄位獨立放在 financial_rows，沒有改名塞進 generic Revenue 或 Consensus。

原合併報表請求 C、七個 entity 與觀測的 exact taxonomy URI 是顯式範圍。QTD、entity、unit、nil、重複衝突、混用 taxonomy、numeric/markup、receipt 與大小／時間上限均保持拒絕錯誤資料；不同來源 namespace 不能靠 prefix 或 local name 冒充。個別 A 報表不自動套用這個 profile。

這次是可執行的來源解析修復，不是正式資料准入或完整四季基本面驗收。仍需相同收益定義、普通股／會計／重編口徑、consolidation scope及公告前預估版本才能與 Consensus 比較。未取得的季度、逐股法人實際 TWD、Guidance 與事件因果，也不會因66筆新解析值自動補齊。

沒有 Production 部署、Migration、SQL寫入、Auth／既有RLS／Cron／會員權益／付款／LINE變更。Live696與原C Worker／Caller仍是原正式來源。原先Q4批次403停止控制失敗保留，不重新啟動或改寫為成功。回復可使用本次來源差異的反向提交，無業務資料需要刪除。

來源、41項測試、真實21份重播與獨立審查結果記於同名 evidence JSON；舊組合收據依 b07001e55f7c7892f2b46094da1d117a050b95dc 原件凍結，新收據只核對當前來源完整性，不授權發布。
