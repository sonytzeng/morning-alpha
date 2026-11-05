# 精確開放資料資源漏登修正

Morning Alpha 現有來源分類只登錄六個具名資源，將每日研究已使用的三個官方開放 API 判成 `LICENSING_UNVERIFIED`。本次補上它們的精確資料集／資源／API 對應及顯名文字，不修改資料、AI 費用開關、SQL、RLS 或會員發布流程。

| 資料集 | 實際 API | 範圍 |
| --- | --- | --- |
| [91998](https://data.gov.tw/dataset/91998) | `https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci` | 一般業原報綜合損益表；不是已核對的連續四個單季 EPS |
| [11764](https://data.gov.tw/dataset/11764) | `https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d` | 原報每日本益比、殖利率及股價淨值比；不是未來獲利預測或可成交價格 |
| [11373](https://data.gov.tw/dataset/11373) | `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis` | 上櫃每日原報估值；不延伸至指定日期的其他查詢介面 |

2026-11-05 實際核對上述官方資料集均標示免費及政府資料開放授權條款第1版，並核對兩交易所 Swagger 內同名精確 operation。TWSE Swagger SHA256 `6f47523aead8cf9da8bba6e9b511198eb1b491080c6cb2e20dda927cc31d8bac`；TPEx Swagger SHA256 `05af7755d0d528626c104f7a8ccd7b00c6a0cf228d30bcb4669020e514eb0c7e`。資源使用仍須依 [OGL1](https://data.gov.tw/license) 顯名；不對其他 URL、查詢參數、歷史資料、公司網站或供應商產品授權。

TPEx 資料集列出的舊 CSV 連結於查核時回403，沒有重試或換入口下載。這份對應以資料集列出的 OAS 文件及該官方文件的具名 API 為依據，不聲稱舊 CSV 已下載或資料內容逐列等價。分類相符也不要求重新取得市場資料。

保留原六筆及順序，三筆以附錄新增。匹配仍是完整字串相等，包含精確資源原有的 query；不接受新增 query、slash、同站鄰近資源或仿冒網域。未知原始公告時間、完整財務期間、方法審查、Owner 核准及會員權限繼續各自驗證。

此修正不建立正式 `source_licenses` 或用途審查紀錄，不移除 `PRIVATE_SOURCE_RESEARCH_ONLY` quarantine，不啟用模型。既有兩份 `FACT_ONLY_OWN_ANALYSIS` 審查是其他 edition 的已過期記錄，不能拿來源 URL 重合或本分類結果當作新批次的審查通過。

官方元資料：

- https://openapi.twse.com.tw/v1/swagger.json
- https://www.tpex.org.tw/openapi/swagger.json
- https://data.gov.tw/license

本機檢查與真實批次重播結果另記於本次接續證據；尚未 Commit、Push 或部署，正式推薦完成狀態不得由此修正推定。
