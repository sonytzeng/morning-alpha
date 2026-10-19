# 四季財務證據族群的離線接線

既有LONG觀察模型需要EPS、公告毛利率及資本支出等財務證據，但原離線編排沒有把已保存且逐件核對的四季公司原件轉成這三種fact。此候選只補原有研究流程的離線轉換，不修改共享evaluator、原HORIZONS、正式V1/V2門檻、C Worker、Caller或會員發布。

產品來源只有三檔：`scripts/vnext/research-funnel.mjs`、`research/retained-quarter-financials.ts`、`tests/vnextRetainedQuarterFinancials.test.mjs`。新adapter固定四份已保存公司原件的公開URL／來源hash／大小，另由受信任離線來源審查的seal綁定私有financial pack。實際12項數值及其原始pack不入Git；公開測試使用明確合成數值。沒有取得新資料或回填舊快照。

轉換保留普通股稀釋EPS、公告毛利率與資本支出的原始單位／欄位／符號。只把明確列示的負向資本支出現金使用轉為支出量，並保留原負值；投資現金流不冒充CapEx。EPS必須是有限數字，來源收取時間不能早於該季結束。發布時間、原始版本及修訂鏈未知時仍為null，收取時間不當成公告時間。所有fact保留source_admitted=false與member_publication_approved=false。

這個離線研究現在能把三種財務族群送入未修改的LONG評估，但需求、護城河、估值的文件審查仍缺，原LONG完整性契約的供應鏈證據也仍須具備。真實結果仍是INSUFFICIENT；不是已完成長期推薦。舊累計EPS保留為獨立背景，不直接相減、不與直接單季序列混算。沒有提升方法、生成自然Forward／Outcome或公開研究。

新外層封存接續精確PR277來源 `9de380f6d8473e920e19d955d0782950ed4cae2f`。前序C seal、七項C來源proof、原SDK與其他歷史斷言逐位元不變；七項proof在固定9de checkout原封執行。Owner quarter工作也使用同一份當前來源准入，只更換precheck selector，其餘固定歷史封裝與檢查指令保留。當前完整來源准入、未知檔案／漂移／模式負控、新adapter合成測試、受影響funnel／dossier測試、C實際SDK協定、Deno及Type／Lint／Build仍驗證當前checkout。VNext記憶體／時間守衛、V2測試分配及原public SDK freshness檢查全部不改。

本輪沒有新增正式部署包：C的44個runtime／74個payload來源及其回復封存維持原指紋。這是離線工程接線與實際保存資料的獨立檢查，不是Production端到端、正式來源准入、會員公開或全功能完成證據。無Migration、Secret、Auth/RLS、Cron、正式權益、付款或LINE操作。
