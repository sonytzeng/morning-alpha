# 會員制度與付款整合 P0：候選驗收與商業決策

2026-10-13，從 PR #230 `da6bb56b826eb0c76073a6870e5447a9f43fba87` 續作。Production 唯讀；本文件不是發布、啟用收款或切換權益的授權。

## 實際付款稽核

| 項目 | 真實觀察 | 判定 |
| --- | --- | --- |
| 正式設定 | `signup_mode=beta_full`、`billing_mode=disabled`、trial_days=14、Beta 無結束時間 | 收款未啟用 |
| Function | `member-access` V8 ACTIVE，兩個部署檔案與 main `2a5d461` 完全一致 | 現有登入／權益服務，不是付款入口 |
| Payment Provider | Repository 沒有可驗證的 Checkout／付款 callback；部署 Function 清單沒有 payment/checkout/subscription handler | 尚未辨識，不推定 Stripe |
| SDK | package.json 有 `@stripe/react-stripe-js`，未找到實際串接 | 套件存在不證明 Merchant／產品已設定 |
| Secret 名稱 | 唯讀檢查 Production Secret Store 名稱，未見付款 Merchant／付款簽章設定；沒有讀取值 | 沒有證明付款環境可用 |
| Merchant／Production Endpoint／商品 | 現有程式及資料庫沒有可驗證的 Merchant、Checkout、商品 ID 或有效訂閱來源 | UNKNOWN，不宣稱帳號不存在 |
| 價格 | UI 原有預定 NT$199/月；沒有已核實的正式 Provider product/price/currency 設定 | 保留原文，不啟用或更改價格 |
| 交易 | `billing_webhook_events=0`；canonical entitlement 綁定 provider/customer/subscription 各0 | 無已驗證正式付款紀錄 |
| 權益函式 | `apply_membership_billing_event_v1` 是 service-only 的 SQL 狀態介面 | 不等於已驗證簽章 Webhook |

沒有付款 API 金鑰、Webhook Secret、會員姓名／Email、交易個資或 Production 原始 payload 進入本文件或 Repository。金流商識別不足時沒有自行建立第二套付款系統，也沒有發動真實扣款。

## 舊會員事實與保護

正式帳號2：Owner1，非Owner1。Owner 有 canonical `owner`／`admin`、明確 permanent 依據；非Owner是 active legacy profile、paid_until=NULL，沒有 canonical entitlement／付款綁定。這1人不是已證明的付費或永久會員，分類為 `LEGACY_POLICY_REVIEW_REQUIRED`，但原有有效存取必須保留。

新候選 `20261013045054_membership_legacy_policy_candidate.sql`：

- 安裝只建立候選 schema/RPC/trigger 並擴充 config 的 `free` 選項；不呼叫 activation，不改任何 config row、profiles 或 canonical entitlement row。
- 生效須另核准 `activate_membership_policy_candidate_v1(approval_reference)`。不接受使用者指定日期；鎖定快照後採 DB `clock_timestamp()`，不倒填。`MEMBERSHIP_POLICY_EFFECTIVE_AT` 本輪尚未設定。
- 過程使用全域 exclusive/shared advisory lock、原子交易與短時間表鎖，避免新帳號／既有權益漏進 cutoff 之間。相同核准識別重跑回原結果，不同識別拒絕；失敗全部 rollback。
- 原 canonical rows 逐位元不改；既有 active profile 的合法存取才補成 canonical 相容表示，保留到期日。未知開始時間仍在來源證據標 UNKNOWN，canonical 新列的開始時間只代表實際接軌時間。
- 舊來源、原狀態、原期限、版本與雜湊保存在不可變 private snapshot。未知期限不設新期限，也不寫成永久付款授權。
- 單憑註冊日期不升級：以前無已取得有效權益的 Free 仍是 Free。新帳號不會自動開 Beta／14日試用；有效付費、既有試用及核准特殊權益仍走同一 canonical table。
- `ensure_member_entitlement_v2` 在生效前沿用舊函式；生效後不再因登入把 Beta 轉試用、不重算期限或版本。原 server resolver、Academy／VNext 權限讀取邏輯不改。
- 最後交叉檢查發現 `get-report-payload` 仍呼叫舊 `ensure_member_entitlement_v1`；舊函式把未知signup_mode當Beta，單改member-access不足以防止新Free被升級。候選在同一SQL保留舊函式原文、移至private，再建立同名service-only相容入口導向v2。報告來源程式不變，既有RPC名稱／回應／權限不變；政策生效前行為相同，生效後Report reader不再另開Beta。這是既有RPC路由變更，必須包含於精確Migration核准，不能只稱新增資料表。
- `preserve_legacy_grant_v1` 防止未來 billing update 意外取消／縮短仍有效的獨立舊權益或降級 Owner。確有退費／取消可撤銷舊權益的契約時，必須另行提出明確政策，不能猜。正常原期限屆滿仍由既有 reader 判定失效。
- 新 private tables 不對 browser 授權；所有 mutation/receipt RPC 僅 service_role EXECUTE，固定 search_path。Owner Browser 也不能直接啟用政策／讀別人的政策紀錄。既有 Auth/RLS policy 沒有修改。

## 已驗證範圍

`tests/membershipPolicy.integration.mjs` 使用一次性 PostgreSQL17、真實 GoTrue 密碼登入及 PostgREST；完整既有 entitlement schema + 本次 SQL + Academy + VNext publication 候選共同驗證。隔離帳號不是 Production 會員，不發 Email、不收款。

- 安裝前後 config／canonical 資料相同；8次同時 activation 僅1筆政策與固定 cutoff。
- 原 canonical 的到期、永久、試用、取消、已到期資料不被改寫；active legacy profile 保留且標待審核；Free 不因帳號較舊升級。
- 8次登入 activation、不正確試用設定、重跑政策都不造成權益漂移。
- 既有Report使用的v1入口與v2皆測試：生效前沿用原Beta行為、生效後新Free維持無完整權益；8次併發舊入口不改舊會員／Owner版本或日期，private原始函式不讓service_role直接繞過政策。
- 不可變快照、匿名／會員／Owner 直接 API 操作拒絕、service_role 不能直接讀新 private tables。
- 真實隔離 Free 可讀7章，Premium／Legacy完整權益10章，Owner仍10章；user_metadata偽造tier無效，直接讀Premium章節拒絕。
- 新會員與 VNext projection tier 一致；有效權益不能公開未審核研究。實際股票可見0。
- 既有 SQL billing active／canceled未到期／expired／past_due及相同event防重通過**SQL控制測試**；不是支付商E2E。`refunded` 沒有已確認映射，保持未驗證，不硬映射為 expired。
- Legacy降級／縮期的 billing update 被拒絕，失敗交易不留下半筆 billing event。
- 登出清除 browser 私人顯示，refresh token撤銷，重新登入權益一致。沒有更改既有 JWT 存活時間或宣稱所有已簽 JWT 立即失效。
- Chromium public／free／premium／legacy／owner，1440／375／390／430：無水平溢出、Reload與Logout、實際會員卡／方案頁；零 page error／非預期HTTP。UI測試的本機 adapter先經真實GoTrue驗證再執行同一SQL與resolver，不宣稱已部署的 Edge Function E2E。

Preview：`http://127.0.0.1:3225/membership`；方案 `/pricing`，股票研究 `/stocks`。測試帳號僅 `@academy.test`；研究沒有公開合成股票。

## 仍未通過的付款 Gate

1. 指定並證明既有 Merchant／Payment Provider，以及合法 Sandbox、正式商品／價格／幣別；目前只能核實收款disabled。
2. Provider-specific Checkout、簽章驗證、raw-body驗證、重放時間窗、事件順序、付款人與訂閱綁定、真實重送／取消／退款測試尚無入口。不能把傳入SQL的字串當簽章或付費證明。
3. 既有 billing SQL 的 event ID 去重不是完整 webhook 防護：沒有provider驗證／事件時間排序；退款語意不明。禁止拿此RPC直接公開為付款API。
4. Production 合法 Free／Premium 登入、付款成功、取消、退款的 E2E PENDING。不得建立正式測試訂閱冒充證據。

## 取消的 GitHub Gate

`Analysis intelligence gate` run `38237299118` 在已知 HEAD 上原次與**一次相同條件重跑**均達20分鐘而取消。第二次04:45:46Z開始、05:06:03Z結束；40個已完成斷言PASS，其中 comparison predecessor integrity 耗時716082ms。沒有把被取消的後續測試列PASS。

候選僅將該job bounded timeout改成40分鐘，所有測試命令、Fresh DB、Auth/RLS、Deno步驟不變；exact integrity assertion同步驗證只有這一行變化。其餘既有Gate不刪減。最終新HEAD的CI仍以GitHub Checks實際結果為準。

## 一次需要 Sony 決定的事項

- 既有金流究竟是哪一個 Merchant／Provider？若先前未成立，指定要採用的方案；若因此要新 Secret／合約／付費，另列精確授權，不能自動採用。
- 確認既有預定 NT$199/月是否為正式商品條件，以及退款／付款失敗／取消政策。沒有在此候選擅自更改。
- 對1筆無明確期限／依據的Legacy權益作正式政策決定。在這之前保留現狀，不以處理該決定作為再次開通其他普通工程工作的理由。
- 最終SHA、4份candidate SQL、3支Function與UI的精確部署核准。會員政策正式生效時間在受控activation時記錄；不是本輪日期。
- TWSE／TPEx資料用途書面回覆、原始時間證據、逐筆Owner核准仍獨立阻擋29項研究公開。付款不能繞過Publication Gate。

## 交付狀態

`LEGACY_ENTITLEMENT_PROTECTION=PASS` 僅指候選隔離驗證；Production尚未切換。

`PAYMENT_INTEGRATION=INCOMPLETE`；`MEMBERSHIP_ENGINEERING=INCOMPLETE`（付款與正式會員E2E未完成）。

`PRODUCTION_RELEASE_READY=NO`；`PUBLIC_PRODUCT_APPROVAL=NO`。

本輪 Production 寫入／Merge／Deploy／Migration／Cron／Secret變更皆0。Decision／Recommendation／Report／LINE產品程式不改；不是宣稱自然排程期間全站所有資料指紋永遠不變。
