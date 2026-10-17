# Morning Alpha R10：補齊價格窗口與可審閱財報／事件

接續 [PR #258](https://github.com/sonytzeng/morning-alpha/pull/258) 的 R9 `882d6799e4646c7917621843a65b960f7a7666ed`；main 仍為 `754850ba1c66329d12eac8e98ab799e0a0c9123e`。這是實際取得、接線與驗證，不是正式發布或全功能結案。最新提交及 CI 終態以 PR 的最終 binding 為準；不覆寫 R9 原始封存。

## 1. 138個價格缺口已補齊，但沒有倒填舊研究

先做了 Production 唯讀盤點。私有 V2 快取已保存 10/15 的72檔完整 OHLC、`volume_shares` 與 `amount_twd`，單位為 SHARES／TWD；實際可得時間為10/15 23:00:12.347Z～23:06:47.442Z。10/16完整日K尚未保存。最初用一般 `volume`／`amount` 名稱做欄位存在檢查並不正確；後續以實際欄位及正值重新核對，沒有把它記成資料缺失。未匯出原始受限快取，也未把DB列包裝成來源收據。

原143份官方收據仍完整保留。重用既有三股較新收據後是1302/1440，其餘69檔各缺10/15、10/16。新程式只依缺口選資源：**58個TWSE當月資源＋2個TPEx日資源＝60個GET**，不是重抓250日，也沒有再抓已有的TAIEX。月資料自然包含重疊日期，不額外為10/15增加請求。1600ms限速、零重試、總150秒／64請求／8MB上限，未知錯誤及403／429會停止後續請求。

實際取得結果：60/60收據，3,892,850bytes，95.735秒，無失敗。新實際cutoff為 **2026-10-17T08:55:36.500Z（台北16:55:36.500）**。只選同一資源較新的完整收據，不拼接欄位、不補first_seen、不覆寫原快取。

| 本輪真實來源接線 | 結果 |
|---|---:|
| 固定72檔×20交易日 | 1440/1440 |
| OHLC、成交股數、實際成交TWD及同日TAIEX | 1440/1440 |
| TAIEX完整交易日 | 20/20 |
| 剩餘股票／日期缺口 | 0 |
| canonical分類至少兩個同業 | 72/72 |
| 至少兩個完整同時點20日同業窗口 | 72/72 |

原canonical分類從來不是整個Universe沒有同業；之前三股樣本的1／1／0不代表72股。新來源全部經既有 `eventAlignmentFromDailyReceipts`，Node22.14.0離線重播、60個檔案hash及權限再核對。新60份收據在原10/16 cutoff可用quote為0。當天是週六，結果為來源窗口完整／非交易日，不是自然Forward、V1有效評估、調整後報酬或投資績效。

公開安全的日期／數量／來源hash與窗口證據見 [R10功能來源包](evidence/r10-functional-source-closure-20261017.json)。原始行情只留私有0600收據，未進Repository；會員再利用權仍待逐資源確認。

## 2. Actual與事件不再只有shape validator

新增一份2330可讀、逐來源定位的財報與事件草案，並接到既有事件adapter；不建立earnings／news／catalyst／mapping資料列，也不生成已批准的CausalReview。

- 由公司直接季度發布確認目前四季為 **2025Q4、2026Q1、2026Q2、2026Q3**，不再把舊2026Q2窗口稱為最新。營收及稀釋EPS直接讀取單季，未由YTD相減。
- 四份季度發布已直接閱讀；普通股分母的額外管理報告證據，Q2／Q3直接可讀，Q4／Q1只有官方索引摘錄，不能宣稱四季所有基礎都已完整。
- 保留營收原稿的TWD一千萬元精度，不冒稱精確到元。文件日期不變成首發時分秒；本輪觀察checkpoint不是原始文件bytes／簽章／歷史版本證明。
- 另列Q4公司USD展望，但 `direction`、`reliableGuidance`、公告前Consensus仍為null；不把美元展望混入台幣Actual或預設stable。
- 事件草案僅限2330自身「先進製程／2nm需求→出貨與組合→營收」假設，平衡毛利稀釋及需求／匯率反證，附確認、失效與取消條件。沒有推定其他公司的客戶／供應商關係或股價必漲。

[原創事實投影與事件草案](../../tests/fixtures/issuer-event-review-official-facts-20261017.json) 可以直接審閱；目前仍 **PENDING_OWNER_REVIEW，批准因果0**。首發精度、原始版本及商用／保存權利未完整確認，正式准入與會員公開均未成立。其他71檔仍沿用逐股缺口矩陣，不以月營收72/72代替四季Actual。

## 3. 外部資料查到具體產品與限制，不是先要求購買

[精確產品與版本能力查核](evidence/r10-provider-capability-review-20261017.json) 列15個官方來源及可執行問題：

- TEJ `TWN/APISHRACT` 的法人金額欄位明載股數乘收盤價，**不符合真實成交TWD**。市場BFI商品也不能分攤成逐股金額。本輪沒有證明市場上所有來源都不存在，但已排除這些不合格替代品。
- 公告前共識可具名查 **LSEG I/B/E/S PIT、FactSet PIT**；一般historical endpoint、ADR或事後平均值不是替代品。仍缺本帳戶權限、台灣普通股逐公司／季度／雙指標覆蓋、公告前可得時刻及修訂／QA／FX版本。
- LSEG／FactSet guidance產品與公司原公告可作候選，但previous period不是同季previous revision；不能直接判上修／下修。
- 費用及是否需要新購均UNKNOWN；未購買、寄新信、接受條款或執行F。先確認既有合約是否涵蓋具名package及內部保存／會員衍生用途，再談受控樣本；若來源確不支持V1，只能另提版本化方法決策，不能暗降V1門檻。

## 4. 發布仍分A／B／C，D／E保持HOLD

1. **A Caller-only**：原5f337778的22本機／63遠端、SDK2.57.4、JWT=true；不能混入R9同名actuals檔。部署就會啟用自然研究，仍需精確具名核准。原Worker／Runtime／Auth不重做。完整回復閉包最後核對與結果另見PR binding。
2. **B安裝與網站**：三份原SQL、固定member-access 2／54閉包及24項網站操作，與R9逐位元相同。明確保留verify_jwt=false/custom Auth，不整包部署完整PR、不全量db push。SQL安裝不啟用政策。網站回復Live674、Function固定SDK功能等效V8，保留Schema／稽核與Legacy保護。
3. **C政策啟用**：獨立RPC、approval reference及維護窗口，不能靠Owner瀏覽器權限直接代替service-role的受控執行核准。本輪實際盤點可用Chrome及正式頁面，只有Sony永久Owner；Free／Premium／Legacy尚無合法正式驗收Session，不是只照抄舊文件。隔離身分證據與正式驗收分開。

D／E仍HOLD：不順帶部署Producer／Reader、不准入新正式來源或公開29份歷史研究。若將來保存新private receipts，Reader只能用 `cd3e49cb6e60908346ccb04ed5c07ee5e89412ad` 的完整strip-only固定SDK閉包回復，不直退V55。F本輪不優先、不建立任何臨時資源。

## 5. 原任務尚未全數交付

正式版本仍為網站674、Reader55、Producer15、Sender71、研究Worker1、Caller2、member-access8。Runtime八表RLS及FORCE RLS都在；自然Run／Prediction／Outcome仍各0，政策activation RPC尚未安裝。本輪沒有Merge／Deploy／SQL／Cron／Secret／會員權益／LINE／付款變更，也不宣稱正常Owner讀取的既有稽核副作用為零。

正式V1保存結果仍 **72擷取、0有效評估、72資料阻擋，READY／WATCH／NONE各0**。價格補齊沒有補出逐股三法人實際金額、四季合格公告前共識、可靠guidance或批准事件因果；不得把它說成72檔分析後沒有投資價值。短、中、長期及進場／Outcome方法不被單一量價窗口代替。

獨立review另重現preview輸入在await期間被修改，造成review與alignment使用不同cutoff的正確性缺陷；已改為入口一次快照全部輸入，三類晚改反例通過。修前失敗保留，不當成安全批准繞過。本輪11個取得反例及20個issuer反例、Deno、type-check、lint、build另有實測。R9未變的會員／Auth／SQL／手機驗收按來源hash沿用，不冒稱重新跑完五小時或正式Free／Premium PASS；最新HEAD CI及獨立差異安全審查另綁定PR終態。

下一客觀營運里程碑是A經具名核准並成功部署後，第一個合法交易日的真實自然Run與Prediction；Outcome等成熟日，五日驗收依原08:15／15:40規則，不能先算分。B／C也須各自核准及安排合法正式身分。V1資料與用途決策仍獨立阻擋推薦完整交付；不保證日期、不自動Promotion V2／Entry，付款維持DISABLED，商業穩定0/5。
