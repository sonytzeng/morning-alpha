# Morning Alpha 核心功能 P0 發布收斂

本候選不改投資方法論、正式會員權益或核心服務。2026-10-15 正式保存推薦為 Universe 72、Evaluated 0、BLOCKED 72，READY／WATCH／NONE 均0。資料不足不是投資價值不合格。

## 單一問題責任分工

| 問題 | 唯一批次 | 根因與修復 | Production 狀態 | 商業阻擋 |
| --- | --- | --- | --- | --- |
| 2330成交量誤報 | V1 Producer | Reader V55已修B1；Acquisition V14仍封裝舊評估器。只重新封装兩個已合併B1依賴，不重寫算法 | 未發布修正到Producer | 是 |
| 法人金額 | V1 Evidence | 三法人TWD buy／sell／net沒有Producer；官方與Fugle個股資料是SHARES，不可乘收盤價冒充實際金額 | 表0筆，72檔缺失 | 是 |
| 四季預期比較 | V1 Evidence | 一季EPS Actual 72檔存在；Consensus／Guidance各0；完整四季契約0。不得用Actual取代Consensus | earnings_events 0筆 | 是 |
| 公司因果事件 | V1 Evidence | 官方公告事實未形成有來源、公司傳導、反证與失效条件的正式映射 | catalysts／mappings各0 | 是 |
| C增量安全封存 | C PR246 | 原b192c89d掃描補正終稿並成功封存；不修改Runtime38依賴 | Draft、Worker／SQL未發布 | 待具名發布 |
| C自然Forward／Outcome | C PR246 | 既有非阻塞Hook、Lease、Checkpoint、不可變鎖及獨立收盤來源；不回填、不宣稱可成交績效 | NOT_ENABLED | 是 |
| 正式Free／Premium身分 | Membership PR230 | 無合法正式驗收帳號。保留候選真實隔離Auth證據，不建立Production測試會員 | 正式E2E PENDING | 是 |
| Legacy有效權益 | Membership PR230 | 正式仍beta_full；候選政策未啟用。需保留既有期限與未知期限，不自動降級 | 不修改 | 是 |
| B2自然發送 | 已發布B2 | V71不可變Retry Key、payload及平台接受證據；09:35唯一終態觀測由既有monitor記錄 | 不人工發送／補發 | 待自然驗收 |
| 29項會員研究發布 | PR230 Publication | 品質、原發布時間、精確資料使用權及Sony逐筆核准須各自通过 | 未公開 | 是 |

正式V1理由數可重疊，不應相加作互斥股票數。逐股72列保存於 recommendation-v1-gap-matrix-20261015.json。45筆真實2330 candle與33筆Core close的最小私有重播，已重現V14缺成交量、B1依賴修正及原來源回復；不是72檔重新產製或Forward績效。

## 精確推薦Producer候選

來源基準 main 069e392eea326f6b02fa557e68103715a10b99ba，沿用PR247的已合併B1修復。Root及SDK2.57.4不變；20個封装檔案中18個不變，僅 decision-v1-evidence.ts、recommendation-stock-evidence.ts 與V14不同。完整SHA與前後版本在 recommendation-v1-producer-release-20261015.json；讀取式preflight拒絕任何範圍、來源或授權漂移。

唯一需要另核准的Function為 recommendation-stock-evidence-v1。不部署Reader、Report、LINE或Smoke Worker。沒有Migration、Cron、Secret、Auth/RLS、公開研究或品質門檻變更。合法Gateway verify_jwt=true及原Internal Auth保留。

發布前重新比較V14完整20檔與封存；若已變更立即停止。發布後先做不發送、唯讀的保存證據核對；下一自然Producer結果才判定正式2330缺口是否消失。不得人工重跑generate-daily-report-v7、改歷史Report或發LINE。若有未核准寫入、來源錯誤、品質放寬、不同Root／SDK或其他Dependency漂移，停止並回復封存V14原來源／設定；保留全部歷史。

## C精確候選

PR246 HEAD 9da487db73055eb983379ca2879822ebeb8f8906，與已發布A／B2及B1 main相容，9項CI通過。原54de182 Runtime seal与增量b192c89d seal串接，38個本機Runtime依賴不變。

唯一Migration 20261012054120_vnext_daily_research_runtime_candidate.sql，SHA256 8f483318e8e6ac0867ddee4cdd2282df13f045c6a6235c2213e15ad9f77fd86f。
新Worker vnext-daily-research-v1，既有Caller recommendation-v2-forward-worker-v1；完整封装、原Caller及RPC停寫回復包在本聊天封存的C_INTEGRATED_RELEASE_MANIFEST_20261015.json。

順序：SQL → Worker → 正式負向Auth與唯讀驗收 → 非阻塞Caller → 下一合法自然Checkpoint。實際Gateway接受、新增Prediction及自然成熟Outcome不能由隔離CI代替。若失敗先回復Caller，再停用新Worker寫入RPC；保留Owner鑑識讀、Prediction／Outcome／Audit，不DROP或DELETE。

## 資料與發布限制

Fugle官方Institutional Trades明確提供股數而非TWD，且無交易日可能不回列，不能補0。
來源：https://developer.fugle.tw/docs/data/http-api/ownership/institutional-trades/

V1精確Consensus／Guidance來源及成本尚未證明。不能自動購買，也不能宣稱付費即可補齊72檔。需Sony決定取得合法、point-in-time的預期資料，或另立版本化研究方法候選；不得直接改正式V1門檻。

TWSE／TPEx會員資料使用權仍依書面回覆及逐來源判定；收到詢問或API200不是授權。C啟用不會自動發布未審核研究。

本候選的新Git改動僅為部署來源准入、真實缺口矩陣、相關測試與封存，不再複製已完成的B1產品修改。原A／B2收據只更新共用驗證腳本的精確SHA，所有產品來源hash及Production旗標不變。

付款DISABLED；五日穩定验收0/5。正式Free／Premium E2E未完成前、V1必需Producer契約未齊全及C未自然執行前，CORE_FUNCTIONS_READY=NO，不宣告商業上線。
