# Daily Stock Intelligence Production Wiring P1

2026-10-12，接續 PR #230 `d7606a7ab73229459209220a1842149a7d193b5b`。本輪建立每日資料 Adapter、交易式持久化、新 Worker 及既有 Lifecycle 的非阻塞接點。這是未部署的 Owner-only 研究候選，不是正式自然執行驗收。

## 可執行鏈與資料邊界

既有 V2 Lifecycle 的合法11/11 COMMITTED checkpoint → 背景enqueue → SQL核實交易日及batch → 官方資料取得 → 三期間研究 → 既有三種Entry → 216項交易式鎖定 → 到期觀察 → Owner唯讀狀態。

研究判斷、資料不足及執行失敗分開保存。會員發布另受品質、時間、授權及Sony核准控制；本Worker只能寫入「尚待審查」，沒有核准或公開操作。正式V1、V2方法論與投資門檻不變。

| 輸入 | 日期與來源 | 不可推定的內容 |
| --- | --- | --- |
| 股票量價 | 當日官方名錄、前250個正式交易日；TWSE STOCK_DAY、TPEx逐日量價 | 停牌缺K不補0；成交範圍明記，不冒充盤中成交 |
| 市場基準 | 官方TAIEX月資料，與股票相同截止時間 | 未確認的基準權息調整不當成超額報酬 |
| 月營收／法人 | 36個月官方營收、20個交易日法人股數 | 股數不是TWD；實際值不是Consensus |
| 財務 | 10個已結束季度的官方財務／現金流來源 | 尚未發布、格式不符、YTD不可比、缺EPS或資本支出均維持缺口 |
| 事件／權息 | 兩個月官方事件索引、六類公司行動來源 | 索引不等於全文；可取得不等於完整權益證明或可公開 |
| Entry背景 | 同日同Atomic batch、hash可驗的V2 capsule及Canonical背景 | 不借用別日；缺同時點資料則證據不足 |

Adapter由執行交易日計算窗口，沒有固定10/8快照或本機fixture fallback。保存實際收到時間、來源URL、版本、原始回應及正規化hash、證據截止時間。原始發布時間無法證明則保留null，不拿下載時間冒充。原始API回應僅在記憶體解析；名錄移除個資，只保存72檔所需欄位。

2026-10-12 06:06Z真實官方唯讀驗證：TWSE名錄61檔、TPEx名錄11檔；2330當月7筆量價可解析。payload指紋依序為 `3de55bf1a0f1953edbe78e32f2ce6914f7ec4adad3c9cce5344a9470292d9715`、`6e0ea782f84c643c4deeb17249e86433f0b6b71fb0749ba51ccc228fc04ec017`、`cb9089416e27a71b86c8b647bad0182211d7ae26b009804404ec2dcaf7279282`。這只證明新日期Adapter的真實HTTP接線，不宣稱72檔每日完整資料或Production Worker已自然執行。

## 有界執行與恢復

- 實際72檔plan共1,420項，上限1,600。冷啟動可能跨越預測截止，必須先形成快取；不得為趕截止縮減證據。
- 全域SQL lease避免多個invocation同時打Provider。lease100秒、工作預算70秒、每次最多8個來源請求、至少2.5秒間隔、每請求12秒、8MB上限。
- 每來源最多3次，次數先保存；429／timeout／存取限制／parser各自記錄。短Retry-After等待後續跑，超過20秒保留retry_at由下一既有checkpoint恢復，不密集自我呼叫。
- 每run最多512次invocation，耗盡明確BLOCKED。self-continuation中斷或崩潰可由下一合法checkpoint續跑；不新增Cron。既有checkpoint全部停止時不會自我喚醒。
- 歷史月份快取最長7日；今日敏感來源key包含交易日，不把昨天當今日增量。過期lease更換fence；舊writer恢复後也不能寫入。
- SQL transaction不做網路請求。計畫、準備中prediction batch及source revision鎖定後不可改；216筆任一失敗整批回滾。

## Forward與Outcome

每日一份authoritative run；正式交易日、當日batch、DB時間及hash皆核對。本版本最早可行動時點為當日09:00，必須此前鎖定；晚到只保留快取並標示EXPIRED，不補Forward。

Short追蹤1／5／10，Medium20／40／60，Long120／180／250交易日。每天掃描先前鎖定的到期研究，每批24筆；其餘checkpoint續跑。超出正式日曆涵蓋回UNKNOWN，當日未收盤不把日K當完整Outcome。

結果是價格觀察，不是實際成交。缺公司行動完整證明、基準調整、失效觸發或成交／費用證據時，不產生調整後報酬、淨損益、MFE／MAE或最大回撤。SQL拒絕提前成熟、假成交及performance_eligible=true。新資料只追加source revision，不改寫舊預測或Outcome。

研究與Entry版本沿用 `VNEXT_OBSERVATION_HYPOTHESIS_2.0.0`、`ENTRY_OPPORTUNITY_1.0.0`。本輪未重跑10/8研究當作完成證明；既有29項研究與16項品質通過結果不變。真實Forward Sample=0、Outcome Sample=0。

## 安全及隔離驗收

新schema `vnext_runtime` 的8表全部ENABLE/FORCE RLS；匿名、會員、service_role都無直接表權限。3個Worker RPC僅service_role可EXECUTE，search_path固定為空；Owner透過 `get_owner_vnext_daily_v1(date)` 唯讀，重用 `is_research_owner_v1()`，未修改既有Auth或RLS。

新Worker需要既有Supabase Gateway JWT，再加server-only `x-vnext-internal` 與既有CRON_SECRET的constant-time比對。Owner、會員、匿名、service-role JWT單獨都不滿足身份；Origin拒絕，無瀏覽器寫入／CORS入口。不建立新Secret、不取得或輸出Production秘密。

隔離Postgres17＋PostgREST14.13＋實際HTTP handler已驗證：原SQL套用；Owner唯讀、Free/Premium/anonymous拒絕；併發一成功一BUSY；lease恢復及舊fence拒絕；216笔交易式防重與最後一筆錯誤整批回滾；晚到Forward拒絕；準備中batch不可改；Prediction/Source不可變；偽造JWT／登出拒絕；Outcome未成熟／假績效拒絕；來源3次重試上限。

控制使用明確合成資料、隔離身份與受控DB時間；216項均證據不足。不能當成真實研究、Sony Production登入或正式自然PASS。HTTP使用相同handler與真正SQL，不是mock storage。

Owner UI未重做。既有Preview `http://127.0.0.1:3225/vnext/research`：真實本機隔離Auth、1440／375／390／430px、無水平溢出、details收合、Reload及登出清除PASS。第一屏明記尚無自然新研究、歷史不是今日推薦；截圖 `/private/tmp/ma-daily-qa-p1`。這是UI回歸，不冒充新Worker正式結果。

## 唯一 Production Release Manifest 待核准

PR #230保持Draft，不得整包部署。以下為本輪最小範圍，逐檔hash封存在 `docs/vnext/transition.json`；正式執行須綁定最終HEAD與全部CI。

1. 唯一新增Migration：`supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql`。8私有表、不可變trigger、4個public RPC；依賴既有Owner predicate、台股日曆、Atomic checkpoint、V2 run與Canonical snapshot。交易式套用，唯一schema重複建立明確失敗、不覆寫。本輪只套用隔離Fresh DB。
2. 新Function：`vnext-daily-research-v1`，`index.ts`及`handler.ts`；Gateway verify_jwt=true，不部署public bypass。
3. 唯一既有Function更新：`recommendation-v2-forward-worker-v1`。只加1個import與1行detached hook，新增 `_shared/vnext-daily-hook.ts`。保留原Auth／Gateway設定及V2策略、寫入、Outcome語意；部署前與正式V2來源逐位元核對。
4. 必要新依賴：`src/features/vnext/dailyAdapter.ts`、`dailyParsers.mjs`、`dailyRuntime.ts`。其餘沿imports重用既有dailyIntelligence／dailyOutcome、研究契約、Entry與共享純函式；以Deno依賴圖封存傳遞閉包，不部署純函式所屬的其他Function。
5. 設定引用：既有SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY、CRON_SECRET。service-role僅在server記憶體作具名RPC，不傳Provider／Browser。無Secret新增／旋轉、Cron或既有RLS變更；發布時只確認引用存在，不讀值。
6. Owner新read path為上述RPC；前端Preview仍候選。將新run展示到正式Owner頁時須核對最小路由／RPC同步範圍，不能把localhost當正式API。原會員projection候選Migration `20261010061630_vnext_research_projection_candidate.sql` 不屬於本runtime最小發布包。
7. 順序：最終HEAD/CI/hash → 核實V2回復來源 → 具名Migration → 新Worker與無業務寫入Auth smoke → V2精確hook更新 → 等下一自然checkpoint。不呼叫Report／LINE、不回填歷史Prediction。
8. 回復：V2worker回到核對過的原部署來源，停用新Worker；保留新增append-only研究與稽核資料，不刪除業務／會員／研究。程式比較基線 `2a5d461ec3d98bfc8bc3177a295c95e299b7bda2` 不能代替未核對的正式bundle。

## 尚待正式證明

啟用仍需此Manifest具名核准、部署來源比對、Migration、兩支Function部署及下一交易日自然驗收。正式Owner read、完整日常72檔coverage、冷快取耗時與平台背景續跑，須以部署後真實結果確認。

長期基本面／供應鏈、公告原文時間、完整公司行動與成交證據不足仍UNKNOWN；TWSE／TPEx授權未回覆不自動公開。流程可完成明確INSUFFICIENT／UNKNOWN紀錄，不代表已能產生有效買點或績效。

本輪Production只讀部署metadata；正式業務寫入、Function invocation、Deploy、Migration、Cron、Secret變更均0。Decision／Recommendation方法論／Report／LINE／Academy／Entry／Cockpit受保護原碼逐位元不變；未重新擷取線上DB前後指紋，不虛稱一次新的線上Business Diff驗收。

NATURAL_FORWARD_EXECUTION=NOT_ENABLED；PUBLIC_PRODUCT_APPROVAL=NO；SONY_USABILITY=PENDING。最終HEAD與CI以GitHub Checks及交付回報為準。
