# 核心資料修復接續點｜2026-10-17

本次從已合併 main `754850ba1c66329d12eac8e98ab799e0a0c9123e` 接續。外層舊 checkout 有不明修改，原 repository 又有損壞的 `origin/codex/release-c-runtime-240 2` ref；兩者均未修改、刪除或重寫。使用獨立乾淨 checkout 與 `codex/core-evidence-p0-20261016`。原 Master 0–22 節已讀取；操作批次 A/B1/B2/C 不等於 Master 的產品 Release A/B/C。

## 已核對的正式狀態，不重新發布

- Worker V1、Caller V2、Producer V15、Reader V55、Sender V71 的版本、設定及 ESZIP 指紋符合封存；Caller 沒有啟用 C Hook。
- 真實 Owner Console 已有固定 401／401／422 的成功輸出；422 只證明 Auth 後拒絕無效 Scope。沒有重新探測、部署 helper 或重建 Bucket。
- 唯讀確認臨時 Function 不存在、Bucket／物件都是0。清理順序及23:14完成時間沿用 Owner 交接紀錄，不把目前的不存在查詢冒充當時逐步操作證據。
- Auth 前後八類受保護資料的數量／指紋相同；C 的8表都是0筆、8表 FORCE RLS；付款 disabled。
- 10/16 已保存的 Operational 最高狀態 PASS；PREMARKET 與六個盤中 checkpoint 均11/11 COMMITTED、Closing SUCCEEDED、Learning succeeded、自然 LINE Outbox 3/3 SENT。此結果不能代替推薦驗收或計入修復後五日穩定。
- 674 是先前已驗 Readdy 版本；本輪沒有可用的已登入 Readdy 頁面，因此不宣稱重新讀得 Live674。沒有 Readdy Update/Publish。

## 實際程式修改

新增 BFI82U 市場法人金額 Adapter 與候選 Producer／保存 Reader 連接器。只認 TWSE 固定官方端點、交易日期及「單位：元」，驗證三法人買／賣／淨額與總和；自營商自行買賣加避險，外資自營商不得重複加入。只產生 TAIEX 市場金額，不產生72檔個股金額。

保存實際 first_seen／available_at、來源與內容雜湊；原公告時刻未知仍 null。新下載的舊日期資料不能進入原盤前 cutoff。固定一次請求、4秒網路期限、64KB串流上限、不帶憑證、不重試或寫正式資料；未知、不一致與衝突一律維持缺資料。

這兩個模組**尚未由已部署 Producer／Reader 入口匯入**，也沒有接正式排程。候選連接器已接至未改動的 V1 evaluator 與精確 saved-revision Reader；不得把它稱為 Production 修好。真正發布前還要審查 Producer acquisition／cache、保存 capture 與 Reader／Owner 的入口接合，不只部署一個未被使用的 helper。外部必要資料及方法論未決前，不單獨提案將此局部接合宣稱為推薦完整修復。

新增獨立 source-admission 層與負向測試：只允許精確列名的新檔與此層必要修改，舊 staged 收據不重寫；歷史檢查讀取已驗前序 bytes，當前新檔仍逐次核對完整指紋／未知路徑。原品質、會員、Reader 與 Publication gate 未刪除或放寬。

候選保存 Reader 另補正毫秒級 cutoff 邊界：報告提交晚於 Producer 評估，不代表可附加這段期間才取得的市場資料。固定用已驗證的原 Producer cutoff 再驗市場 capture；原有 capture 在較晚 Reader 時間仍可讀，但只晚於 Producer 0.5秒、即使早於 Reader 的資料也必須拒絕。這不是修改正式 Reader V55。

## 單一 P0 Blocker Register

| ID／主要批次 | 根因、影響 | 本次處置與證據 | 狀態／下一步 |
| --- | --- | --- | --- |
| V1-MARKET-TWD／V1 Evidence | 市場金額有官方 Producer 來源，但 V1 read path 未接；不是所有法人資料都無法取得 | 新 Adapter、候選 Proof／Reader、真來源 parser 與晚到拒絕、合成控制及隔離 SQL | CODE_ONLY；入口／cache 接合與新 Artifact 需另形成完整發布 diff |
| V1-STOCK-TWD／V1 Evidence | 個股三法人需要實際 TWD buy/sell/net，現有 T86／Fugle 是 SHARES | 保留72檔缺口；不以股數乘收盤價、不將市場金額複製給個股 | BLOCKED；查已購具體資料合約／欄位，或另核准版本化方法；未證明必須購買 |
| V1-FOUR-QUARTER／V1 Evidence | 四個連續季度 actual＋consensus 及最新 guidance；實際值不能補預期 | 正式 earnings 表與550日窗均0；原 EPS Actual coverage 不等於完整契約 | BLOCKED；合法可得預期／guidance能力與方法論決策，價格 UNKNOWN，不自行購買 |
| V1-EVENT／V1 Evidence | 公告取得不是因果映射；缺公司關聯、傳導、反證及失效條件 | mapping 表與7日窗均0；不自動判利多、不從未來補事件反應 | BLOCKED；補有來源且經審查的關聯，未完成前維持拒絕 |
| C-CALLER／操作C | Runtime／Auth 已完成，但 Caller 部署本身會啟用自然研究 | 本輪22本機＋63遠端來源0漂移；正式V2的19來源與完整6檔差異重查 | 發布準備可送核准；不得重跑 Runtime SQL、Worker或helper |
| MEMBER-IDENTITY／會員#251 | 無合法正式 Free／有效 Premium 驗收身分 | 舊精確HEAD隔離真實Auth及10/10 CI保留；正式Owner可見永久Owner | VERIFIED_PREVIEW／Production PENDING；不建立正式測試會員或改權益 |
| MEMBER-RIGHTS／會員#251 | 正式仍既有Beta政策，安裝與activation不同 | main與#251實際merge-tree無衝突；Worker／Runtime SQL／Producer無倒退 | BLOCKED正式切換；三個會員SQL、member-access、UI與activation須一次具名核准 |
| PUBLICATION／#230 | 29項歷史研究尚缺全部用途／時間／逐筆核准 | 不因Auth、C成功或自行撰寫就公開；Free／Premium真實發布0 | BLOCKED外部書面確認與逐筆審核；不購買／簽約／自動發布 |
| STABILITY／核心交付 | 推薦0/72未評估、C尚未自然執行 | Operational PASS獨立保存，歷史回放不進Forward | 0/5；修復正式啟用後才開始自然雙時點驗收 |

原因數彼此重疊，不可加總成股票數。全部72檔仍 BLOCKED，不是72檔投資價值不合格。詳同版 `core-evidence-status-20261017.json`。

## 原需求對照與發布順序

| 原需求／實作 | 真正狀態 | 尚需正式證據 |
| --- | --- | --- |
| 每日市場、Report、LINE、Closing、Learning／既有Runtime及Operational V2 | VERIFIED_PRODUCTION（10/16保存終態） | 五日不是1日；本輪不改原排程 |
| 正式V1推薦／Producer V15→Decision→Reader V55 | BLOCKED | 完整資料、有效個股評估與合格時會員輸出 |
| 短中長研究與Entry／VNext Runtime、既有三策略 | Worker CODE已部署；自然Caller未啟用 | 下一合法交易日的新SourceRevision、鎖定與自然Outcome |
| 股票觀察、產業事件／#230及#251 | VERIFIED_PREVIEW／正式未公開 | 合法來源用途、品質／時間／Owner審核及正式會員身分 |
| Academy／既有已發布課程、原創PDF、進度 | 正式Owner既有證據；會員VERIFIED_PREVIEW | 正式Free／Premium仍PENDING；不散布私人教材 |
| Signal Lab／老師策略／長期績效 | 既有獨立候選，UNPROVEN | 不列為核心Bug修復前提，不接正式推薦 |
| 商業付款 | DISABLED | 不作本輪技術發布前提，不宣稱已正式收費 |

建議唯一順序：**V1資料能力／方法論決策與入口接合候選 → C Caller具名啟用（可獨立審核）→ 新交易日資料試運行 → 會員政策／UI精確核准與正式身分驗收 → 合法內容逐筆公開 → 核心修復後五日自然驗收**。不得將Caller啟用與會員研究公開綁成同一默認動作。

## 測試與限制

Node22.23.1：實際 Type-check、Lint、Build 已通過；兩候選模組 Deno check 通過。新來源／Reader合成控制與原V1回歸通過；不是股票策略有效性或Production E2E。

Fresh SQL首次因本機Docker磁碟已滿失敗（initdb No space left on device）；沒有Prune、刪其他容器／資料或降低斷言。只將新的一次性Postgres17資料目錄置於256MiB tmpfs後，同一SQL／RLS／零寫入／回復測試通過，測試容器與其可拋棄volume已清理。先前Auth／Worker／會員完整隔離證據在相同來源下保留，不重新跑五小時全站驗收。

新HEAD必須自己的 CI／安全封存；舊#246 9/9及#251 10/10只證明各自精確版本。未Merge、Deploy、Migration、改Cron／Secret／Auth／RLS／會員權益；未發LINE或啟用付款。新候選實作／測試／Git交付不代表全產品完成。

本次受影響回歸160/160通過。乾淨單分支clone起初缺少原測試引用、但不在main祖先鏈的固定commit `4348efaff4514a43473d111950083799a23c79c2`，因此Footer歷史對照先失敗；唯讀補取此精確Git物件後通過，沒有替換baseline或刪除斷言。首次安全審查封存保留；修正cutoff後的新精確HEAD須增量重審，不拿前一快照封存冒充。
