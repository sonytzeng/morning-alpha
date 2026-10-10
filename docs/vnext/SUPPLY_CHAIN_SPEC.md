# 供應鏈關係契約
節點包含公司、產品、產業；CUSTOMER/SUPPLIER/COMPETITOR/PRODUCT/INDUSTRY 邊。
每邊 source、evidence_ids、valid_from/to、observed_at、available_at、confidence、revenue_exposure、verification_status。
缺持續有效證據顯示 UNKNOWN。revenue_exposure null 不得轉0，0～1只在正式來源支持時輸入。
DOCUMENTED + VERIFIED + 所有來源 PIT PASS 才表示「關係有證據」，不是方向或股價預測。

需求 → 訂單 → 營收 → 獲利 → 市場預期 → 估值與股價，每一層各需證據。
不能從上游新聞自動產生營收、EPS或利多推論；不能由同產業分類臆造客戶關係。
圖譜候選結構和 status validator 已實作；真實 graph ingestion／授權公開資料尚缺，Preview 必須呈現缺口而不是虛構關係。
