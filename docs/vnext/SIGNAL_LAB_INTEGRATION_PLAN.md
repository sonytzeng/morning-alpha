# PR103 Frozen V1 依賴與比較
唯讀核對 PR103：OPEN DRAFT，HEAD568694f92072d049e35cd2d8fd148db6d3547154；validate SUCCESS 為該舊HEAD。
保留 Institutional、Technical、Regime、CrossSignal、Backtest、ForwardOutcome、ImmutablePrediction 原始定義；不 cherry-pick、不改權重／threshold、不Merge103。
strategy-contract parser要求weights合計1、threshold嚴格排序，不提供隱藏fallback。

A = Frozen V1。
B = Multi-Horizon Event。
C = Frozen V1 + Event + Institutional + TechnicalStructure。
同symbol/signal_time/horizon/mode配對；缺任一arm或重複樣本不比較。
TAIEX / Random eligible / Momentum 作基準；必須相同PITUniverse與費用。
metrics：樣本數、hit rate、expectancy、excess、profitfactor、MAE/MFE、per-tradeDD、regime；
沒有portfolio策略不宣稱CAGR/portfolio drawdown；無loss時profitfactor=null，不顯示無限。
本輪比較器只接受具明確lineage已驗證Outcome；沒有真實Outcome所以metrics=null，SIGNAL_EDGE=UNPROVEN。
train/validation/OOS時間不重疊、策略freeze早於OOS；walk-forward/prospective cohort獨立。
Teacher邏輯門檻UNRESOLVED，不以「主力」推斷法人身分。
正式多臂run/長期Backtest仍BLOCKED於PR103依賴＋historicalPIT/adjustment/executable evidence，不以候選數學測試冒充投資績效。
