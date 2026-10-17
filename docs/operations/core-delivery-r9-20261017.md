# Morning Alpha R9：實作與真實來源交付

接續 [R8](owner-release-decisions-r8-20261017.md)／[PR #258](https://github.com/sonytzeng/morning-alpha/pull/258)，不重做已完成的發布。這不是全功能結案或正式執行核准。精確提交與當次 CI 以 PR 描述的最終 binding 為準。

本輪的程式變更不是新增產品：修正會員中心歷史報告／身分及跨日失效，讓既有官方資料 adapter 接入金融格式與可稽核取得紀錄，並接通既有量價／TAIEX 到未修改的 V1 evaluator 的隔離證據路徑。完整安全摘要、來源指紋及網站操作見 [R9 來源與功能證據](evidence/r9-functional-source-closure-20261017.json)。原 R8 封存及舊失敗不覆寫。

精確HEAD的Core member integration CI另產出受控GitHub Artifact：`morning-alpha-r9-member-ui-source-<HEAD>`，僅24項網站來源與receipt，含實際ZIP SHA256及逐檔前後hash；不含.env、完整Production Export、Provider原始資料或臨時F入口。可由同一GitHub執行紀錄直接下載，不需搬本機檔案；Artifact不是發布授權。

## 功能矩陣：不能混成單一 PASS

| 功能 | 已實際確認 | 尚未正式交付的部分 |
|---|---|---|
| 市場、報告、新聞、收盤及既有學習 | 沿用未變版本的 10/16 保存驗收；本輪再確認正式六支 Function 版本／設定／ESZIP 不變 | 不以營運成功代替股票評估或五日穩定 |
| 會員中心 | 真實 Owner 重新整理後發現：10/16 報告存在，10/17 無報告，畫面卻丟失最近報告；已修索引→同 Reader 完整 payload 選取 | 候選尚未發布；當日 PARTIAL 不被舊報告掩蓋，歷史不當今日 |
| 登出、換帳號、晚到回應與跨日 | 候選清空 dashboard、generation fence、午夜一次失效及回到前景檢查；不改 Auth／RLS | 正式 Free／Premium／Legacy 身分安排仍缺，不以合成控制或 Owner 冒充 |
| Academy | 本輪 Chrome 正式 Owner 可見10章、保留原有1章進度與上次閱讀位置；1440／375／390／430無水平溢出／主要文字裁切 | 沒有作答、完成章節或寫入正式測試進度；沒有把此唯讀檢查當完整 Free／Premium E2E |
| 72檔月營收 | 本輪兩個固定官方來源 HTTP200：TWSE 61＋TPEx 11＝72/72，2026-09，缺列／null／衝突0 | 實際共同 cutoff 2026-10-17T07:31:16.355Z；不能修補10/16舊盤前。月營收不是四季單季財報或預期 |
| 金融格式 | 五檔金融月營收可由原 normalizer 讀取；金控 full-width EPS 欄位已接入既有取得流程 | 原67/72缺口的當時完整 raw revision未留存，真正歷史原因 UNKNOWN；不能說已證明金融來源不支援或原 parser 一定有錯 |
| 法人金額 | 新真實 BFI82U：6原始列→3市場實際 TWD 列，既有 adapter離線重播通過 | 不是逐股 TWD。T86／TPEx OGL11856及已查付費 TWT86UC／TWTAIUC／S35仍列股數，不能靠乘價格補值 |
| 四季 Actual／Consensus／Guidance | 2330官方IR有直接季度 Actual；另取得五檔官方EPS／金控損益最小樣本 | 股別／版本／首次發布精度未全部證實；無公告前 Consensus receipt；issuer outlook不自動變stable/up/down |
| 事件量價與基準 | 重用既有 VNext receipt／V2 retained validator，真實三股20交易日與TAIEX完整量價匹配60/60 | 事件因果審核0；canonical peer僅2330=1、2303=1、2344=0；不能因同官方產業碼改寫「記憶體」為半導體 |
| V1股票推薦 | 原保存分母72、有效評估0、BLOCKED72，2330 volume缺失0；門檻不變 | 新來源接線是隔離候選，不是正式72檔已完成評估；五類阻擋重疊，不加總成360 |
| 短／中／長期與進場／追蹤 | 既有三期間及 Entry 工程不重寫；正式Worker V1、Runtime、Auth保留 | Caller尚未啟用；自然Run／Prediction／Outcome各0；長期必要財務、估值與因果缺口不由短期動能取代 |
| 會員研究與付款 | 沒有公開29份歷史研究；付款仍DISABLED | 可公開研究0，正式會員政策未安裝／啟用；商業穩定仍0/5 |

## 精確發布差異與順序

### A：Caller-only獨立可審，不混入本輪財務修改

仍只部署原 `5f33777836778e3600e4e377fcb3cf4de690fe80` 的 `recommendation-v2-forward-worker-v1`，固定SDK2.57.4、verify_jwt=true。22個immutable本機來源與63個遠端來源均重核；不能從當前工作樹整包部署。

**新財務修正的 `recommendation-official-actuals.ts` 也在A的閉包中。** 它目前不同於原封存，必須從原5f337778取出A的完整閉包，不能混入R9版本；這不需要重建舊Worker／Auth／Runtime，也不授權部署D。部署本身即啟用自然研究，須Owner另行具名核准。回復沿用原Caller V2固定SDK功能等效封存，保留研究與稽核，不冒稱ESZIP相同。

### B：會員安裝與網站，現在是24項，不是23或211項

三份SQL、`member-access`及原R8範圍不變：

1. `20261010061630_vnext_research_projection_candidate.sql`
2. `20261012080628_vnext_member_publication_control_candidate.sql`
3. `20261013045054_membership_legacy_policy_candidate.sql`

SQL原文／RLS／ACL／RPC／ensure相容路由與constraint影響仍在R8安全包；安裝不代表政策啟用。member-access保留verify_jwt=false自訂Auth，發布payload固定SDK2.115.0；2本機／54遠端閉包重核。

原22項＋R8排程元件＋本輪 `useAccountDashboard.ts`＝**24項**。`Account.tsx`已在原22項內，更新其新hash，不重複計數。精確操作及回復前後hash在R9 JSON；保留其他Live674來源與3個既有策略型別檔，不全站覆寫。停止條件仍為來源、版本、SQL、權限或回復漂移、權益變更或資料外洩。正式發布後必須實際驗收，不能延用隔離結果。

回復網站至已核對的Live674來源，Function用既有固定SDK功能等效V8；保留Schema與稽核。若C已啟用，不得回復會取消Legacy保護的舊政策。任何額外SQL修正須另核准。

### C：會員政策獨立核准；D／E仍HOLD

政策啟用的RPC、核准參考、DB當下時間、不可變Legacy快照與維護鎖窗口不變；不得因B安裝或R9Commit而啟用。正式身分不足時保留PENDING。

本輪金融與事件程式屬D私有候選，未部署Producer／Reader、未准入正式來源；現有Producer V15不變。D若後續提審，必須重封存它受新shared module影響的閉包，不能直接沿用R8舊payload。新private receipts保存後，Reader回復仍須strip-only `cd3e49cb6e60908346ccb04ed5c07ee5e89412ad`及固定SDK閉包，不能直退原V55。

獨立review發現並已修正一個取得流程取消競態：transport同步abort後的晚到Promise可能未接rejection handler。隔離控制先重現1次unhandled rejection；修正先接手Promise，再處理已取消狀態，兩種profile的resolve／reject反例均通過，不藉此重新執行線上抓取或改寫取得收據。

E公開研究仍需逐項品質、時間、用途、Owner核准及Server Entitlement；不將OGL未涵蓋的歷史資源或IR內容一律判成允許，也不把全部自撰分析一律判成禁止。

## 外部能力：不是先買資料或先部署F

既有授權Gmail帳號的三組精確方案／收據／權利查詢未找到相符郵件；Chrome公開Finnhub頁未提供可核對本帳戶方案的安全畫面，未進入key頁。這只證明本輪沒取得足夠帳戶證明，不能推定沒有訂閱或必須另購。

F最多六次查詢只能縮小介面／假設代碼未知，不能證明72股、公告前vintage、純券商Consensus、Guidance或會員權。**現在不建議先部署F換取形式進度。** 費用／預算、帳戶產品權限與診斷用途未成立，不執行。原F有效期至2026-10-18 14:00台北，逾期不自動延長；入口、Bucket與暫時UI均未建立。

最小外部問題已具體化：逐股×日×三法人的真實TWD buy/sell/net產品代碼與交易範圍；四季對應公告前estimate版本、估計集合、會計／股別／單位、issuer guidance撤回／更正與本帳戶用途。已查付費規格仍是股數，不能把購買當解法；費用與購買必要性尚UNKNOWN。未寄新信、未接受條款／報價。

如果現行V1要求在來源／個股上不能成立，只能另提版本化方法決策：既有V2／Entry保持Owner／Shadow，不自動替代V1、不降低正式門檻。20自然交易日僅能提出promotion review，不能自動晉升。

## 下一個客觀里程碑

A取得具名核准並成功部署後，第一個合法自然交易日追蹤實際Run、72檔各期間結果與Prediction；Outcome按既有成熟日觀察，不回填。沿用08:15／15:40既有規則，不新建Production Cron、不把單日或重播折抵五日。

B／C必須各自依核准範圍正式發布及安排合法身分；目前不宣稱已在背景驗收自然研究，也不能保證一輪或某天全功能上線。原需求仍未交付完成，付款維持DISABLED。
