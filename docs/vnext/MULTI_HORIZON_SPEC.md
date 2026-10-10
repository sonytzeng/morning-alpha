# 三期限獨立觀察
|期限|研究期間|必要證據族群|事後觀察|
|---|---|---|---|
|SHORT|1–10交易日|量價、法人、新聞、技術結構|1/5/10D|
|MEDIUM|2–12週|營收、訂單、法說、法人、產業事件|20/40/60D|
|LONG|3–18月|需求、護城河、供應鏈、EPS、毛利、CAPEX、估值|120/180/250D|

這是新的研究完整性契約，不修改 V1/V2 門檻。缺一項標 Evidence Gap；不是「股票不會漲」。
沒有自動計算 technical score 當三種期限。confirmation/invalidation 需明確文字和可追溯 evidence_ids。
状態優先：到期 EXPIRED → 已證實失效 INVALIDATED → 所有確認已證實且無未知風險 CONDITION_MET → WATCHING。
研究條件成立不等於正式買進推薦或下單。
created_at/as_of/available_at/last_verified_at/next_review_at 分隔；逾期review停止會員projection。
mode嚴分HISTORICAL_REPLAY/FORWARD_SHADOW。事前lock不可倒填，evidence links在同一DB transaction鎖定，後加證據拒絕。

價格/公司行動/可成交性不足不產生Outcome績效。統計區別每筆最大回撤和組合最大回撤，不捏造CAGR。
