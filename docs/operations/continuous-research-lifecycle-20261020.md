# 連續資料更新、研究、Outcome 與 Learning：同一交付主線

本輪延續 PR #284；不是新引擎、排程或正式發布授權。af22 舊來源封存、自然失敗、測試與安全結果維持原紀錄；新結論及完整 composition 另存。付款 DISABLED；穩定驗收不自動計分。

## 已查證的正式範圍

2026-10-20 台北11:55唯讀：Worker4仍ACTIVE；continuous-learning-engine V17 ACTIVE、get-learning-center V9 ACTIVE。10/15、10/16、10/19各有一個succeeded Learning run、各一筆 **market** prediction，沒有symbol prediction。這不是72股、三期間、VNext Forward或策略準確度證明。當日收盤尚未發生，沒有提前宣稱今日收盤成功。

晨間既有證據仍是正式 V1 Evaluated0/72、BLOCKED72；C Run EXPIRED、無鎖／無Outcome。舊失敗不能靠重新命名或歷史補跑改成成功。

台北12:13再次唯讀來源計數，正式確有10/19、10/20保存來源，而非只有一次本機搜集：10/20含PRICE647收據／12403列、OTC177／1947、benchmark11／212、營收72／2592、法人40／1440、事件144／575等。這是跨期間來源列數，不是有效股票數或推薦採用數；部分事件／公司行動可真實無資料，不能自動說全部抓取失敗或全部有用。

尤其 **已保存** 財務及現金流各648列、72股，task標籤2024Q2～2026Q2，均為AS_REPORTED_YTD，原公告時間0筆。後續DB側型別計數確認9個標籤各72個numeric EPS、65個numeric revenue；數值型別不是會計口徑、來源實際期間或品質證明。既有parser的period由request task產生，不能冒稱官方回應期間已核實。不是資料完全不存在，也不是四季可比較Actual已齊；不可把YTD當單季、下載時間當公告時刻。既有私有資料與正式原V1適用契約須分開接入。

## 真正修復

1. **Outcome快取前綴飢餓**：長期窗口可有325項來源。逐項CACHE RPC在70秒預算中反覆走同一前綴，已取得資料也進不了Outcome。大於既有8項有界取得額度的計畫先讀本run來源一次，依完整task（含日期、PREMARKET/CLOSE）、版本、時間及payload hash匹配，只保留缺項走原有預約／有界重試。小窗口維持原路徑。零行情仍UNKNOWN，不產生填單、交易成本或績效。
2. **Learning沒有跨日樣本**：每日只產生當日review後，原caller把當日結果直接送入90D校準及Pattern。新loader只讀既有120日prediction window對應的歷史CLE_REVIEW_V1，小欄位、每128ID、最多2000、身分／版本／溢位拒絕；不重寫舊prediction/outcome/review。
3. **樣本外污染**：先用全樣本成立率選調整，再切70/30不是真正OOS。候選改成整個報告日分組，訓練標籤必須在首個OOS預測前已實際觀測；只用訓練組選原有0.55/0.75及-8/+4，20訓練／10OOS、Brier及統計條件保留。新rule key temporal-v2、backtest版本CLE_BACKTEST_TEMPORAL_V2，不升級或覆寫既有Production rule。
4. **Shadow起算時區**：起算日轉Asia/Taipei，同時要求prediction_at在啟動後；UTC前一日不能讓啟動前預測混入自然Shadow樣本。
5. **因果準確度誤標**：僅有方向及分數，不能把催化、Surprise或Price-in標成已證明正確／錯誤。保留可信方向結果及原候選權重，三種獨立因果正確性維持unverified；初步錯誤分類不冒充已確認因果。
6. **模型版本隔離**：跨日資料恢復後，Pattern必須按model_version分組；不同／未知版本不得混成一個OOS。新Shadow只累積同版本、啟動後樣本；舊無版本候選保持原狀，需人工審核，不自動進入新Shadow。原Production規則不變。新temporal候選不代表Promotion ready；正式消費端model-scope相容性未另行驗收前保持Promotion HOLD。

上述只是資料／驗證正確性修復。正式推薦權重、校準函式、原V1品質門檻、正式規則Promotion、Auth/RLS、會員權益及核心Report/LINE都未修改。

## 增量取得與重新分析邊界

現有dailyAdapter按真實交易日產生key；當月／當日資料按日期更新，歷史快取有限7日TTL。新合法收據改變組裝值及source_revision/snapshot_hash；已鎖Prediction不因晚到修正改寫。原本最新已收盤日從1日轉7日policy會額外重驗同一來源；這是3個日期來源的成本取捨，不冒稱已證明的資料錯誤，本輪不自行改TTL或更正檢查政策。

現有日研究仍是盤前不可變鎖＋後續到期Outcome，不假裝已完成完整原始三期間推薦／盤中新資料發布。官方財務快照72檔只是一季as-reported，非四季Actual；逐股三法人實際TWD、公告前Consensus、可靠Guidance、經審核事件因果仍有實質缺口。PR281原子Observation入口仍NO-GO；來源准入、品質、用途、Owner及會員發布Gate保持獨立。

## 發布及回復

候選Worker仍只換dailyRuntime；完整固定44runtime/78payload及Worker4功能等效回復閉包另有逐檔catalog。這不是部署授權。原Worker4 recovery保留source、Prediction、Outcome與audit，不reset/rearm／回填舊run。

Learning修正是另一個明確Function範圍：continuous-learning-engine及其shared core。正式V17已唯讀20/20來源與固定7bfc一致，非敏感[逐檔證明](evidence/learning-v17-exact-readback-20261020.json)已保存。[精確CLE catalog](../../scripts/operations/continuous-learning-20261020/release-catalog.json)共67項（20部署來源＋15固定SDK runtime＋30 license＋2 type-only），固定2.57.4；候選只換index/core，兩variant使用相同本機SDK、窄unknown型別聲明及明確null Run回覆保護。該保護與V17在null時相同TypeError、同一ID指派前停止；不是非null斷言或關閉檢查，正常回覆及Auth邊界不變。回復是功能等效，不是原實體ESZIP逐位元重建。

Worker candidate payload SHA256 `565d67d93f1ec7cd2c5a9f14f1d226bbd5c287f0109d5df765e5e5899ef81dba`，recovery `34a0fe4a0b17dc56a72c43d7687738047b59d695ae1bbda676b85f321d9c0762`；CLE candidate `cc26e4fe4a83b2e3d0a2374f4380a6c14af309d7444f19f33905674e261f7004`，recovery `dbda560ebd0c80281f6f5fea98420ef2f64406312b08d31c0118b6c272526636`。這是兩個分開的Function核准項目，不是整包PR部署。

正式操作先重核Worker4/CLE17來源／設定、main及精確HEAD／CI。部署後只做已核准的不啟動業務Smoke，不人工Producer/Research/Report/LINE或歷史補跑。來源／設定漂移、不可回復、越權、重複鎖或核心退化立即停止受影響批次；精確回復各自Function，保留所有來源、Prediction、Outcome、Learning及稽核，不刪資料、不改Cron/Secret或自動改規則。

沒有新Migration／Cron／Secret／Caller／Producer／Reader／LINE／會員政策／研究公開／付款。取得精確HEAD與各Function閉包的具名核准後才可執行正式操作。自然Forward、成熟Outcome、真實Free/Premium身分及五個交易日均不能以候選測試代替。

## 本輪實際驗證與單一責任範圍

- 325快取／24個LONG-250鎖：原版連兩次同一280項前綴、0Outcome；新版13個控制通過，全快取只一次inventory read、零Provider；309快取＋16缺項兩次各取得8筆。600ms是合成RPC時鐘，不是正式SLA；空行情24項仍UNKNOWN，無績效。
- 兩個合法交易日各72×3重新評估、營收修正值／hash／revision、同checkpoint衝突、晚到拒絕、舊鎖及過期會員內容拒絕4項通過。合成來源、記憶體Store不是正式資料更新證據。
- 原Runtime45項、Learning核心8項、時間／版本隔離與真實函式loader／candidate／Shadow12項、Closing/Learning契約22項通過；原斷言保留。
- PostgreSQL17＋PostgREST＋HTTP Worker Fresh DB通過原Migration、8個FORCE RLS表、角色拒絕、Lease／fencing、不可變鎖、崩潰／失聯、成熟Outcome、append-only及只撤新Writer的回復；專用容器／網路已確認0殘留。這不是Production登入／自然樣本。
- 固定SDK實際離線REST/RPC六種呼叫、V17與回復正負方向審核一致、三個版本HTTP401拒絕且0client/0egress；兩個實際轉換payload在全新Deno cache禁remote/npm下編譯。SDK消費的具體輸入／回傳型別與安裝的2.57.4交叉檢查；不宣稱證明上游所有遞迴泛型query。unknown及未暴露Auth API另以編譯反例拒絕。
- 本輪最終增量回歸：Runtime／連續更新／Learning／Closing 104/104，加上實際固定payload與完整來源准入32/32，均0 fail／0 skip；type-check、lint、build及diff check通過。這是本機隔離結果，新HEAD的GitHub CI與安全審查另行記錄，不沿用af22的綠燈冒稱本輪已驗。

| 尚存問題 | 唯一責任 | 最新結論 |
| --- | --- | --- |
| C盤前／Outcome連續執行 | PR284 Worker | 修正未正式部署；需精確Worker核准及下一自然批次 |
| 跨日Learning／OOS／Shadow | PR284 CLE | 候選已修；不自行套用或晉升Production規則 |
| 原V1完整必要證據 | 官方來源／原Producer契約 | 仍0/72有效評估；一季快照、公告事實、量價完整不能取代其他必要證據 |
| C至原Observation原子交易 | PR281 | 仍NO-GO，未部署／未執行SQL |
| 研究用途／逐筆品質／公開 | Publication既有Gate | 29歷史研究不公開，API可讀不代表會員再散布授權 |
| Free/Premium正式身分 | 會員原批次 | 尚無合法正式驗收身分；Owner不冒充，既有權益不改 |

正式發布Learning後，既有90D calibration會讀取修正的跨日統計；計算公式／上限未改，但統計值可能與舊「當日樣本」不同，必須在精確部署審核明列此影響。任何方法／規則Promotion仍走既有OOS、Shadow與Owner審查，不因本候選自動升級。
