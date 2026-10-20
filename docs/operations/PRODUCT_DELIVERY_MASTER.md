# Morning Alpha 單一產品交付主線

更新日期：2026-10-20（Asia/Taipei）。本文件管理原需求、相依性與真實驗收；不是部署授權，也不取代歷史封存。

## 判定規則

- `PRODUCTION_VERIFIED`、`ISOLATED_VERIFIED`、`IMPLEMENTED_NOT_RELEASED`、`EXTERNAL_DECISION`、`NOT_VERIFIED` 分開記錄。
- Core 營運、V1 完整逐股評估、三期間研究、研究可公開、會員身分、方法績效、容量與付款是不同結論。
- 不改 V1 門檻；C QUALIFIED 不等於 V1 Recommendation／會員 Published。
- 不能以 CI、資料覆蓋、離線或合成控制宣告正式完成。
- 付款維持 DISABLED；五日穩定維持已證明的 0/5，不補記未觀察的日期。

## 本輪接續點與保護範圍

- 乾淨接續工作樹：`codex/v1-source-integration-20261020`，起點 `8c110263ddcf83e4471dfc8e32adafd1c47c2c40`。
- GitHub PR #284 維持 Draft；main `7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3`。PR #281 的來源 Registry／Observation 候選獨立保留，不部署空入口。
- 10/20 正式 metadata：Worker4、Caller4、Producer16、Reader57、LINE71、member-access9 ACTIVE。
- A／B1／B2、C Runtime SQL、既有 Auth／清理成果不重做。
- 舊外層 Repository 有不明修改，本輪不修改；不覆蓋其他 worktree。
- 既有來源封存、舊失敗及已通過的逐位元未變證據保留。新變更另測，不追溯改寫舊結論。

## P0 Blocker Register（每項單一主要負責範圍）

| ID／負責範圍 | 真正原因與目前證據 | 已完成工程／下一可執行步驟 | 正式狀態／阻擋 |
| --- | --- | --- | --- |
| DATA-01／行情接線 | 固定20日1440/1440，250日17999/18000；2884停牌缺格保留。來源收據不等於已准入 canonical | 重用現有 eventAlignmentFromDailyReceipts／RetainedEvidence；不重抓、不補停牌K、不倒填cutoff | 資料可讀覆蓋已證明；用途／因果及正式准入分開 |
| DATA-02／法人 | 法人股數已保存；逐股三法人實際TWD尚未證明，formal institutional_flows=0 | 原生市場TWD候選保留；股數、股數乘價、hedging單項均不能替代三法人原金額 | EXTERNAL_DECISION：確認實際欄位、單位、股票與歷史覆蓋及用途；費用UNKNOWN，不自購 |
| DATA-03／Actual | 請求季別不等於來源回應季別；648列YTD不能當四季Actual。2454既存14份原件集合已零HTTP回放4季／8個Revenue與ordinary Basic EPS量測 | 既有解析器新增版本化Q4直接季度欄＋已獨立審閱年度股別政策證明，62 controls通過；原45項不變，禁止年度相減 | 原始公告時間、不可變來源版次及使用權仍UNKNOWN；canonical Actual writer未部署，PDF不假冒iXBRL，品質審閱不自行安裝准入權威 |
| DATA-04／Consensus／Guidance | 公告前歷史Consensus未取得；Guidance不能預設stable。Actual不等於預期 | 核對具名既有方案能力與官方原公告；保存實際問項、涵蓋與版本缺口 | EXTERNAL_DECISION：既有合約權限／歷史版本／用途；不推定必購、不改方法 |
| DATA-05／事件因果 | 事件索引575列／66股不等於公告原文、經審核公司傳導或供應鏈關係 | 重用官方事件／issuer review adapter，綁原文、公司、時間與hash；支持／反對／失效條件獨立審查 | 正式核准因果不足；不以公告存在、LLM分類或同業關係自動准入 |
| V1-01／正式評估 | 10/20 Universe72、Evaluated0、BLOCKED72；六類重疊缺口各72，非72股分析後不合格。另確認原read model會先刪除缺Consensus的新財報，再錯讀舊完整版本，且重複季度會擠掉四季 | 獨立worktree修復先選實際季度／版本再檢查完整性；不同來源、衝突版本或重用row ID拒絕。Fresh PG17原PK／UNIQUE＋真實loader驗證72合成股票，新partial版本安全降為71 evaluated／1 blocked，不改評分門檻 | IMPLEMENTED_NOT_RELEASED，非真實72股評估成果；正式earnings_events=0，institutional_flows=0，仍NOT_READY |
| OBS-01／原子流程 | C lock與原Observation是不同契約，不能直接promotion | PR281獨立Registry、來源／品質／權利authority、原子Observation／audit／commit guard；檢查條件Producer缺口 | IMPLEMENTED_NOT_RELEASED；真實准入資料與正式核准不足，不部署空入口 |
| RUNTIME-01／自然研究 | 10/20自然run EXPIRED／LATE_ACQUISITION_NOT_FORWARD；0 Prediction、0 Outcome，執行版次未保存則UNKNOWN | PR284保留既有截止／冷快取／Outcome修復，精確Worker小包與固定SDK功能等效rollback已備妥 | 需精確Owner發布核准；不重跑歷史或重設舊run |
| MEMBER-01／會員 | 正式只有已授權Owner Session；Free／Premium／Legacy正式身分仍缺，不能Owner冒充 | 原會員SQL／Function／網站／政策分階段；隔離真實Auth／RLS／取消到期／跨帳號驗證證據保留 | 正式Free／Premium E2E NOT_VERIFIED；不得擅建帳號或改權益 |
| SITE-01／網站 | 正式/stocks有三期間切換、0核准內容與誠實空狀態；不代表V1完成 | 沿用原Today／報告／Academy／帳戶／手機路由，對實際缺陷最小修復 | UI可用與股票結果有效分開；重新驗證的範圍另記收據 |
| SCALE-01／10,000會員 | 10,000合成DB帳戶逐筆resolver驗證；4連線穩態19.62TPS，16連線尖峰89.41TPS，錯誤／跳過0，但未達設定100TPS尖峰目標 | 22項SQL權限控制通過，容器移除、在途session0；不是10,000並發或正式Auth／Production SLA。LINE離線同payload10k需20組，獨立payload每drain僅20人 | NOT_READY；Production pool／費用／LINE配額UNKNOWN；LINE整體deadline與caller120秒衝突另在獨立worktree修復，不發真LINE |
| SEC-01／平台風險 | 官方唯讀Advisor列92個RLS無policy項、1個anon與10個authenticated可執行SECURITY DEFINER、pg_net位於public、密碼洩漏防護未啟用；它們是待依用途審閱的提示，不一律等於漏洞 | 已核對既有私有table無policy通常為deny-by-default；不可為清除提示而新增權限。正式組織Pro，PG17.6；compute、pool及成本上限未由此證明。另有20項未覆蓋FK、4組重複索引、130項未用索引提示，不直接DROP | 尚無本輪新增可達安全漏洞；10,000上線安全／容量須單獨處置，Auth設定變更／正式索引DDL不在本輪核准內 |
| OPS-01／自然營運 | 08:15／15:40及六個盤中Checkpoint既有，不為本輪改Cron | 合法時間唯讀保存既有自然結果；Recommendation不誤加Core PASS gate | 連續五個交易日未證明，0/5；不自動計分 |

## 發布相依順序與具名核准

1. 原已封存的小範圍 Worker 修正：精確 SHA／固定 SDK／44本機Runtime閉包與功能等效回復重新對應。僅經Owner核准才Merge／部署；不順帶部署整份PR、SQL、Learning或其他Function。
2. 真實來源／用途／獨立品質／公告版次證據齊備後，才對Actual canonical與PR281 Registry／Observation提出具名SQL與source admission。SQL安裝不是批准資料，不能自動公開。
3. 保留已發布會員UI與既有權益；若剩餘會員政策需切換，獨立reference、維護窗口、合法正式角色與回復驗證，不從SQL安裝隱性啟用。
4. 完整V1證據到齊後，按新cutoff自然評估；逐筆研究公開必須再通過權利、品質、時間、Owner核准與Server entitlement。29份歷史研究仍不得湊數發布。
5. 取得自然Prediction後按實際成熟日追蹤Outcome／Learning；依原08:15／15:40五個有效交易日與授權容量窗口驗收。沒有正式證據不宣稱10,000會員或績效已通過。

停止條件：精確HEAD／來源閉包／正式指紋漂移、Schema或權限不符、無可證明安全rollback、可能破壞歷史或會員權益、外送不確定、超出授權。只停止受影響正式步驟；其餘隔離工程繼續。

## 本輪驗證與證據更新方式

財報解析、會員容量、原子接線review各有獨立檔案範圍；主工作樹負責整合。新變更跑相關真實原件重播、負控制、type-check／lint／build及必要Fresh DB；不以新增測試數取代功能。

起點CI：19項SUCCESS、1項既有條件SKIP、0FAIL。此結論只綁8c11026，後續未提交修改不可沿用其HEAD CI。

最新實際測試結果、變更檔、Git狀態及仍須Owner操作於本輪收據追加；不得把本文件當產品完成或正式變更授權。

本輪正式唯讀驗收：Owner帳戶、Today 10/20、Academy及股票觀察三期間空狀態可讀；不以Owner冒充Free／Premium／Legacy。瀏覽器375px override實際仍1470px，故本輪正式手機驗收不得標PASS。既有未變的隔離手機證據仍可依其原版本沿用。

本輪資源與資料保護：無Provider深歷史重抓、無正式寫入或部署、無LINE人工外送。官方逐股三法人原始TWD與公告前Consensus仍未證明；查核既有方案／合約的指定本機與官方廠商郵件範圍未找到可用權利證據，不等於所有方案均不可得，也不構成購買決策。

`MORNING_ALPHA_PRODUCT_DELIVERED = NO`
