# 每批資料的模型前置用途審查接線

既有 `ai_research_use_reviews` 綁定分析完成後的 edition；新財報留存批次則在模型讀取前被隔離，無法沿用該後置審查。這次只補上前置審查的接入點。原來源、隔離標記、72份packet、證據ID、cutoff與原始財務值全部保留。

## 完成的候選

- 新增私有、不可變的 `ai_model_source_use_reviews_v1`；只有service角色可透過具名RPC登錄審查，瀏覽器角色沒有執行權。新增表強制RLS，service不能直接INSERT／UPDATE／DELETE。
- 審查綁定確切batch及其全部72份canonical packet hash，核對完整來源URL集合、用途、契約適用範圍、三份審查文件hash、時間及最長72小時有效期。hash用於防止串批，不能創造第三方授權。
- 新讀取RPC只接受最新的有效PASS；PENDING／FAIL／REVOKED／過期均阻擋，不回退到舊PASS。重送舊PASS不會新增紀錄或恢復權限。每次讀取重新檢查資料承諾及現行primary-document政策。
- Worker僅在遇到財務隔離時讀取此前置收據，並自行重算packet承諾。一般未隔離資料維持原讀取路徑；新聞與市場來源禁用規則獨立保留。JSON request、原始batch附帶的approval欄位不能提供審查權限。
- 非同步讀取前先取得自有快照；取消、過期、錯誤hash、不同批次或過舊收據均拒絕。至少保留60秒有效期，涵蓋既有最長45秒分析呼叫；每次checkpoint重新讀取最新審查。無收據時不執行完整雜湊計算。

## 真實資料用途仍未批准

現有兩份edition審查已過期，不能批准這份新批次。聯發科官網條款對網站內容之非商業使用及其他利用有明確限制；這與數字是否受著作權保護是不同問題。本批8個聯發科PDF來源的處理範圍尚未釐清，沒有把它們自動列為PASS。

官方核對資料：

- https://www.mediatek.com/terms-of-use
- https://www.tipo.gov.tw/tw/copyright/692-16653.html

本輪只準備PENDING審查資料，不建立真實PASS，不新增來源授權，不聯絡供應商，不接受合約，不轉售原文。正式來源用途必須有適用本批輸入及處理方式的有效依據；一般工程核准不能代替該依據。

## 驗證與發布範圍

95項相關Node測試通過；隔離PGlite 101項SQL檢查通過，包含SQL／JS承諾一致、真實SQL收據進入實際JS讀取器、依賴及ACL漂移拒絕、晚到撤回、來源集合、資料篡改、即將到期、重送、RLS、直接寫入拒絕與保留資料的回復。正向審查全部是合成協定資料，不是實際來源批准；沒有原生PostgREST網路競爭測試。撤回阻擋後續准入，不宣稱能追回已送出的模型請求。

正式Worker基底為v26、62檔，EZBR `a65102843e2ce0033a01608351714d0a9de7ecf36f4be15adb7d6231603f38b6`。精確部署候選只改 `intake.ts`，新增 `model-source-review.ts`，共63檔；另外61檔、入口、SDK、JWT=false及原內部驗證逐字保留。三個OGL分類修正是既有獨立WIP，不夾帶進這個Edge payload。

套用順序為獨立核准後執行 `daily-ai-model-source-use.candidate.sql`，再單獨部署上述Worker。Migration不插入任何審查，Worker沒有前端或請求欄位可自授權。既有付費模型code flag保持false；本次候選不啟用模型、會員發布、收費或新Cron。

回復時以 `daily-ai-model-source-use.rollback.sql` 收回兩個新公開RPC的執行權，再回復原v26完整62檔Worker。保留所有新審查與既有來源，不DROP／DELETE／重寫舊資料。新SQL防止重複套用，並固定三個原有helper的definition／owner／ACL，發現漂移即拒絕。

正式Migration、Deploy、Commit與Push均尚未執行。完成候選及協定驗證不等於短中長推薦、價格計畫或正式會員比較已交付。
