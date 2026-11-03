-- CANDIDATE ONLY. New immutable three-review registry; V1 and old intakes unchanged.
-- No source admission, publication, Cron, model/provider, secret or RLS relaxation.
-- ACTIVE reviews bind exactly to the retained quote/date and exclusive expiry.
-- Inactive reviews are omitted from new working inputs; original registry/history remains.
begin;
do $guard$
begin
 if to_regclass('vnext_private.verified_documented_reviews_v2') is not null
  or to_regprocedure('vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2(jsonb,jsonb,jsonb,timestamptz,date)') is not null
  or to_regprocedure('public.load_daily_stock_ai_documented_reviews_v2(text,timestamptz)') is not null
  then raise exception 'DOCUMENTED_REVIEW_V2_ALREADY_PRESENT';end if;
 if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)')),'UTF8')),'hex') is distinct from 'd3c67c1395bda7414f2b070c5599542f44eb49777b95b5b2eb3f65501b679484'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(jsonb,jsonb,jsonb,timestamptz,date)')),'UTF8')),'hex') is distinct from '0d6cde2b2d48fd5976434bdd8a2859db0483b7b500b9d0eb45c083d37e438711'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('vnext_runtime.project_daily_stock_ai_inputs_v1(jsonb)')),'UTF8')),'hex') is distinct from '7b3da81170bfdae84fdac26fbf88844791f4e4d795b6e687499b7a655559a977'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.stage_daily_ai_research_edition_v1(text,text[],timestamptz)')),'UTF8')),'hex') is distinct from '651467f9f66872cd17d1eaa9855e789f35a0b88ad8836bd0a04acff8a9f35efb'
  then raise exception 'DOCUMENTED_REVIEW_V2_LIVE_DRIFT';end if;
end $guard$;

create table vnext_private.verified_documented_reviews_v2(
 source_seal_sha256 text primary key check(source_seal_sha256='6b3cfccff75a1960196a2edd9685290f7eb66b0bd7f0dd396c84de597ca12526'),
 facts_sha256 text not null check(facts_sha256='53765d515cc65a5deec0514fcf8c4cae8873010f54d016cfecfec7b039c1ad94'),
 facts_text text not null check(encode(sha256(convert_to(facts_text,'UTF8')),'hex')=facts_sha256
  and jsonb_typeof(facts_text::jsonb)='array' and jsonb_array_length(facts_text::jsonb)=3),
 source_review_sha256 text not null check(source_review_sha256='278fc4e6bf28e819ff6b46769883889d00f9580dcf05298dc20ef3b271435398'),
 review_receipt_sha256 text not null check(review_receipt_sha256='6936b55fa1162caf05bb54f642559695d407b54137643e8cf09f1361a88d2cf8'),
 review_valid_until text not null check(review_valid_until='2026-11-02T13:30:00+08:00' and isfinite(review_valid_until::timestamptz)),
 review_price_basis_text text not null check(encode(sha256(convert_to(review_price_basis_text,'UTF8')),'hex')='35c10d20d169b4fdb52c679a3fb9ffb40fb5c5412db1d6f838a186f5e2c37df2'),
 source_admitted boolean not null default false check(source_admitted=false),
 member_publication_approved boolean not null default false check(member_publication_approved=false)
);
alter table vnext_private.verified_documented_reviews_v2 enable row level security;
revoke all on table vnext_private.verified_documented_reviews_v2 from public,anon,authenticated,service_role;
create function vnext_private.seal_documented_reviews_v2() returns trigger language plpgsql set search_path='' as $fn$
begin raise exception 'DOCUMENTED_REVIEW_V2_REGISTRY_IMMUTABLE';end $fn$;
revoke all on function vnext_private.seal_documented_reviews_v2() from public,anon,authenticated,service_role;
create trigger seal_documented_reviews_v2 before update or delete or truncate on vnext_private.verified_documented_reviews_v2
 for each statement execute function vnext_private.seal_documented_reviews_v2();
insert into vnext_private.verified_documented_reviews_v2(source_seal_sha256,facts_sha256,facts_text,source_review_sha256,review_receipt_sha256,review_valid_until,review_price_basis_text)
 values('6b3cfccff75a1960196a2edd9685290f7eb66b0bd7f0dd396c84de597ca12526','53765d515cc65a5deec0514fcf8c4cae8873010f54d016cfecfec7b039c1ad94',$review_facts$[{"as_of":"2026-09-30T23:59:59+08:00","available_at":"2026-10-31T10:32:10.692Z","basis":"DOCUMENTED_REVIEW","data_quality_status":"OWN_DOCUMENTED_RESEARCH_REVIEW_WITH_EXPLICIT_SCOPE_AND_UNRESOLVED_LIMITATIONS","evidence_hash":"c4fd0d40bc49110c94c81de4d36d5a04272a3e9717dfbc47b333601483e13071","first_seen_at":"2026-10-31T10:32:10.692Z","id":"own-documented-review:2330:DEMAND:fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72","kind":"DEMAND","member_publication_approved":false,"period":"2026-Q3","primary_source_role":"INPUTS_ONLY_ANALYST_CONCLUSION_NOT_ISSUER_OR_REGULATOR_VERDICT","published_at":null,"review_price_basis":{"close_twd":2370,"scope":"RETAINED_CLOSE_AS_OF_REVIEW_NOT_CURRENT_QUOTE","session_date":"2026-10-30","symbol":"2330","unit":"TWD_PER_COMMON_SHARE"},"review_valid_until":"2026-11-02T13:30:00+08:00","reviewed_at":"2026-10-31T10:32:10.688Z","source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26e_withguidancexfinal.htm","source_admitted":false,"source_bytes":28015,"source_dependencies":[{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":28058,"kind":"release","period":"2025-Q4","received_at":"2026-10-31T08:54:25.368025+00:00","sha256":"1f2a428101dcf7bd96b21d50e2bb85820ae9898498983e24001ac2d9274e160d","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000008/a4q25e_withguidancexfinal.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":27566,"kind":"release","period":"2026-Q1","received_at":"2026-10-31T08:54:38.606922+00:00","sha256":"af4a01cdb2020878d07c5ff46f5ad2b3e0ec94f508a41033b534901a93fc6f02","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000199/a1q26e_withguidancexfinal.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":28122,"kind":"release","period":"2026-Q2","received_at":"2026-10-31T08:54:45.270805+00:00","sha256":"f48f42c822d0dba2a233b669c3b437787bd156b263c4c395c82116e148eaf79d","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/a2q26e_withguidancexfinal.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":28015,"kind":"release","period":"2026-Q3","received_at":"2026-10-31T08:54:52.075521+00:00","sha256":"2e5a10327f473f483d2e035970860ca8bf374a568eceb04c94ee19de8330b8a1","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26e_withguidancexfinal.htm"}],"source_locator":{"review_canonical_hash":"fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72","review_file":"evidence/2330-long-bound-reviews-v2-source.review.json","review_id":"DEMAND_2025Q4_TO_2026Q3_REALIZED_SALES_PROXY","review_section":"reviews.DEMAND","review_sha256":"278fc4e6bf28e819ff6b46769883889d00f9580dcf05298dc20ef3b271435398","source_receipt_file":"evidence/2330-long-bound-reviews-v2-source.receipt.json","source_receipt_hash":"79fd96963e7ddf8fa1338d0cbec8b839c8579ff04db0cac3d86ff3583071cb07","source_section":"3Q26 release current-quarter results; four-quarter rows in review","source_type":"PRIMARY_INPUT_DEPENDENCY_FOR_OWN_ANALYSIS_NOT_OFFICIAL_VERDICT"},"source_sha256":"2e5a10327f473f483d2e035970860ca8bf374a568eceb04c94ee19de8330b8a1","symbol":"2330","values":{"admission_status":"CANDIDATE_FOR_NEW_SOURCE_BATCH_ONLY","analysis_zh":"四季營收年增率均為正，營收由新台幣1,046.09十億元增至1,494.24十億元；先進製程占晶圓營收74%至79%。第三季2奈米及3奈米合計占41%。這些實現營收與製程組合支持需求研究假設，沒有把第四季指引當作已實現訂單。","classification":"INFERENCE_FROM_REPORTED_FACTS","data_quality_limitations":"Known limits remain in review JSON; original issuer releases not asserted audited; exact publication timestamps unknown; no annual IFRS EPS mixed into four-quarter TIFRS EPS.","lifecycle_zh":"本研究只適用保留的2026-10-30收盤2370元，且須早於2026-11-02台北13:30；價格、資料日期或有效期改變時停用三筆並重審，不把舊判定套用新價格。","policy_id":"2330_EPS_REINVESTMENT_THREE_SCENARIO_25_BUFFER_CONDITIONAL_WAIT_V1","publication_status":"NOT_APPROVED","quarterly_accounting_framework":"TIFRS_CONSOLIDATED","review_canonical_hash":"fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72","review_id":"DEMAND_2025Q4_TO_2026Q3_REALIZED_SALES_PROXY","review_price_close_twd":2370,"review_price_scope":"RETAINED_CLOSE_AS_OF_REVIEW_NOT_CURRENT_QUOTE","review_price_session_date":"2026-10-30","review_sha256":"278fc4e6bf28e819ff6b46769883889d00f9580dcf05298dc20ef3b271435398","review_valid_until":"2026-11-02T13:30:00+08:00","scope":"Observed realized sales and leading-edge mix support a demand research thesis in the four-quarter retained window; no multiyear customer orders are asserted.","source_authority_zh":"SEC文件是原始申報輸入；SUPPORTED／NOT_SUPPORTED是Morning Alpha自有條件式研究判斷，不是SEC或公司給的估值裁決。","source_receipt_hash":"79fd96963e7ddf8fa1338d0cbec8b839c8579ff04db0cac3d86ff3583071cb07","verdict":"SUPPORTED"}},{"as_of":"2026-09-30T23:59:59+08:00","available_at":"2026-10-31T10:32:10.692Z","basis":"DOCUMENTED_REVIEW","data_quality_status":"OWN_DOCUMENTED_RESEARCH_REVIEW_WITH_EXPLICIT_SCOPE_AND_UNRESOLVED_LIMITATIONS","evidence_hash":"f7075601bf220a59e5c251645367d67676efeea2a7ec78a765a2bde77f4ed1af","first_seen_at":"2026-10-31T10:32:10.692Z","id":"own-documented-review:2330:MOAT:fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72","kind":"MOAT","member_publication_approved":false,"period":"2026-Q3","primary_source_role":"INPUTS_ONLY_ANALYST_CONCLUSION_NOT_ISSUER_OR_REGULATOR_VERDICT","published_at":null,"review_price_basis":{"close_twd":2370,"scope":"RETAINED_CLOSE_AS_OF_REVIEW_NOT_CURRENT_QUOTE","session_date":"2026-10-30","symbol":"2330","unit":"TWD_PER_COMMON_SHARE"},"review_valid_until":"2026-11-02T13:30:00+08:00","reviewed_at":"2026-10-31T10:32:10.688Z","source":"https://www.sec.gov/Archives/edgar/data/1046179/000162828026025362/tsm-20251231.htm","source_admitted":false,"source_bytes":10355936,"source_dependencies":[{"accounting_framework":"IFRS_AS_ISSUED_BY_IASB","bytes":10355936,"path":"evidence/sec-2025-20f-review.html","received_at":"2026-10-31T09:18:49.191318+00:00","sha256":"2b1c62b01618142622890c97866bfe5171415f8a58e22af0015a3a8ffea7d7b1","source":"https://www.sec.gov/Archives/edgar/data/1046179/000162828026025362/tsm-20251231.htm","text_path":"evidence/sec-2025-20f-review.txt"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":28058,"kind":"release","period":"2025-Q4","received_at":"2026-10-31T08:54:25.368025+00:00","sha256":"1f2a428101dcf7bd96b21d50e2bb85820ae9898498983e24001ac2d9274e160d","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000008/a4q25e_withguidancexfinal.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":11280,"kind":"presentation","period":"2025-Q4","received_at":"2026-10-31T08:54:25.385389+00:00","sha256":"5fffba51696f3531b76df836e2a2ff51731ebdaceb2ad86dd25beec998a96943","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000008/a4q25presentatione.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":27566,"kind":"release","period":"2026-Q1","received_at":"2026-10-31T08:54:38.606922+00:00","sha256":"af4a01cdb2020878d07c5ff46f5ad2b3e0ec94f508a41033b534901a93fc6f02","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000199/a1q26e_withguidancexfinal.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":9630,"kind":"presentation","period":"2026-Q1","received_at":"2026-10-31T08:54:38.617881+00:00","sha256":"af912b8899329b7e306c91eda5aa2ca9bc75694a8cea2647057d6fd58ba17b43","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000199/a1q26presentatione.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":28122,"kind":"release","period":"2026-Q2","received_at":"2026-10-31T08:54:45.270805+00:00","sha256":"f48f42c822d0dba2a233b669c3b437787bd156b263c4c395c82116e148eaf79d","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/a2q26e_withguidancexfinal.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":9729,"kind":"presentation","period":"2026-Q2","received_at":"2026-10-31T08:54:45.225727+00:00","sha256":"da97d69759eb7179bd293441a36d12a0cf274adc6536887723b6c19a419025f5","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/a2q26presentatione.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":28015,"kind":"release","period":"2026-Q3","received_at":"2026-10-31T08:54:52.075521+00:00","sha256":"2e5a10327f473f483d2e035970860ca8bf374a568eceb04c94ee19de8330b8a1","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26e_withguidancexfinal.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":9565,"kind":"presentation","period":"2026-Q3","received_at":"2026-10-31T08:54:52.081316+00:00","sha256":"7aefc2944ddfd666e3a574fdb79870bddb2e15b61aacae746c649583f48d4a32","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26presentatione.htm"}],"source_locator":{"review_canonical_hash":"fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72","review_file":"evidence/2330-long-bound-reviews-v2-source.review.json","review_id":"MOAT_OBSERVABLE_TECHNOLOGY_REINVESTMENT_SCALE","review_section":"reviews.MOAT","review_sha256":"278fc4e6bf28e819ff6b46769883889d00f9580dcf05298dc20ef3b271435398","source_receipt_file":"evidence/2330-long-bound-reviews-v2-source.receipt.json","source_receipt_hash":"79fd96963e7ddf8fa1338d0cbec8b839c8579ff04db0cac3d86ff3583071cb07","source_section":"2025 Form20-F Item4 R&D/Capacity/Competition and Item3 Risks","source_type":"PRIMARY_INPUT_DEPENDENCY_FOR_OWN_ANALYSIS_NOT_OFFICIAL_VERDICT"},"source_sha256":"2b1c62b01618142622890c97866bfe5171415f8a58e22af0015a3a8ffea7d7b1","symbol":"2330","values":{"admission_status":"CANDIDATE_FOR_NEW_SOURCE_BATCH_ONLY","analysis_zh":"2025年研發支出為新台幣246.427十億元，年產能逾1,700萬片12吋約當晶圓；公司在年報描述製程開發、量產及客戶協作。最新季2奈米已占晶圓營收8%，四季毛利率由62.3%到66.4%，但比前季67.7%下降。研發、實際先進節點營收及目前經濟表現共同支持可觀察的技術與規模優勢；未宣稱競爭者無法追趕或股價必然上漲。","classification":"BOUNDED_ANALYST_INFERENCE_FROM_ISSUER_DISCLOSURE","data_quality_limitations":"Known limits remain in review JSON; original issuer releases not asserted audited; exact publication timestamps unknown; no annual IFRS EPS mixed into four-quarter TIFRS EPS.","lifecycle_zh":"本研究只適用保留的2026-10-30收盤2370元，且須早於2026-11-02台北13:30；價格、資料日期或有效期改變時停用三筆並重審，不把舊判定套用新價格。","policy_id":"2330_EPS_REINVESTMENT_THREE_SCENARIO_25_BUFFER_CONDITIONAL_WAIT_V1","publication_status":"NOT_APPROVED","quarterly_accounting_framework":"TIFRS_CONSOLIDATED","review_canonical_hash":"fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72","review_id":"MOAT_OBSERVABLE_TECHNOLOGY_REINVESTMENT_SCALE","review_price_close_twd":2370,"review_price_scope":"RETAINED_CLOSE_AS_OF_REVIEW_NOT_CURRENT_QUOTE","review_price_session_date":"2026-10-30","review_sha256":"278fc4e6bf28e819ff6b46769883889d00f9580dcf05298dc20ef3b271435398","review_valid_until":"2026-11-02T13:30:00+08:00","scope":"Reported technology commercialization, reinvestment scale and current economics support an observable competitive-advantage thesis; perpetual excess returns, independently verified dominance and quantified switching costs are not established.","source_authority_zh":"SEC文件是原始申報輸入；SUPPORTED／NOT_SUPPORTED是Morning Alpha自有條件式研究判斷，不是SEC或公司給的估值裁決。","source_receipt_hash":"79fd96963e7ddf8fa1338d0cbec8b839c8579ff04db0cac3d86ff3583071cb07","verdict":"SUPPORTED"}},{"as_of":"2026-10-30T13:30:00+08:00","available_at":"2026-10-31T10:32:10.692Z","basis":"DOCUMENTED_REVIEW","data_quality_status":"OWN_DOCUMENTED_RESEARCH_REVIEW_WITH_EXPLICIT_SCOPE_AND_UNRESOLVED_LIMITATIONS","evidence_hash":"c710fdf67312736e8791883027e806a51a68ad26c8c309b8828b7f381a1abe56","first_seen_at":"2026-10-31T10:32:10.692Z","id":"own-documented-review:2330:VALUATION:fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72","kind":"VALUATION","member_publication_approved":false,"period":"2026-10-30","primary_source_role":"INPUTS_ONLY_ANALYST_CONCLUSION_NOT_ISSUER_OR_REGULATOR_VERDICT","published_at":null,"review_price_basis":{"close_twd":2370,"scope":"RETAINED_CLOSE_AS_OF_REVIEW_NOT_CURRENT_QUOTE","session_date":"2026-10-30","symbol":"2330","unit":"TWD_PER_COMMON_SHARE"},"review_valid_until":"2026-11-02T13:30:00+08:00","reviewed_at":"2026-10-31T10:32:10.688Z","source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26presentatione.htm","source_admitted":false,"source_bytes":9565,"source_dependencies":[{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":28058,"kind":"release","period":"2025-Q4","received_at":"2026-10-31T08:54:25.368025+00:00","sha256":"1f2a428101dcf7bd96b21d50e2bb85820ae9898498983e24001ac2d9274e160d","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000008/a4q25e_withguidancexfinal.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":11280,"kind":"presentation","period":"2025-Q4","received_at":"2026-10-31T08:54:25.385389+00:00","sha256":"5fffba51696f3531b76df836e2a2ff51731ebdaceb2ad86dd25beec998a96943","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000008/a4q25presentatione.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":27566,"kind":"release","period":"2026-Q1","received_at":"2026-10-31T08:54:38.606922+00:00","sha256":"af4a01cdb2020878d07c5ff46f5ad2b3e0ec94f508a41033b534901a93fc6f02","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000199/a1q26e_withguidancexfinal.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":9630,"kind":"presentation","period":"2026-Q1","received_at":"2026-10-31T08:54:38.617881+00:00","sha256":"af912b8899329b7e306c91eda5aa2ca9bc75694a8cea2647057d6fd58ba17b43","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000199/a1q26presentatione.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":28122,"kind":"release","period":"2026-Q2","received_at":"2026-10-31T08:54:45.270805+00:00","sha256":"f48f42c822d0dba2a233b669c3b437787bd156b263c4c395c82116e148eaf79d","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/a2q26e_withguidancexfinal.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":9729,"kind":"presentation","period":"2026-Q2","received_at":"2026-10-31T08:54:45.225727+00:00","sha256":"da97d69759eb7179bd293441a36d12a0cf274adc6536887723b6c19a419025f5","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/a2q26presentatione.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":28015,"kind":"release","period":"2026-Q3","received_at":"2026-10-31T08:54:52.075521+00:00","sha256":"2e5a10327f473f483d2e035970860ca8bf374a568eceb04c94ee19de8330b8a1","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26e_withguidancexfinal.htm"},{"accounting_framework":"TIFRS_CONSOLIDATED","bytes":9565,"kind":"presentation","period":"2026-Q3","received_at":"2026-10-31T08:54:52.081316+00:00","sha256":"7aefc2944ddfd666e3a574fdb79870bddb2e15b61aacae746c649583f48d4a32","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26presentatione.htm"},{"available_at":"2026-10-31T07:16:54.698Z","evidence_hash":"a6581cee0c392d3f767c27f408d5b2d61400113fd4488ba80ad7ec4044f742b2","source":"https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d","source_bytes":195790,"source_sha256":"41200d54900709212fd359d7e870ceb343017c087b9f54c1f360aedaeb442ba0"}],"source_locator":{"review_canonical_hash":"fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72","review_file":"evidence/2330-long-bound-reviews-v2-source.review.json","review_id":"VALUATION_THREE_SCENARIO_25_BUFFER_WAIT","review_section":"reviews.VALUATION","review_sha256":"278fc4e6bf28e819ff6b46769883889d00f9580dcf05298dc20ef3b271435398","source_receipt_file":"evidence/2330-long-bound-reviews-v2-source.receipt.json","source_receipt_hash":"79fd96963e7ddf8fa1338d0cbec8b839c8579ff04db0cac3d86ff3583071cb07","source_section":"3Q26 presentation EPS current-quarter; four-quarter EPS in review; retained TWSE price fact","source_type":"PRIMARY_INPUT_DEPENDENCY_FOR_OWN_ANALYSIS_NOT_OFFICIAL_VERDICT"},"source_sha256":"7aefc2944ddfd666e3a574fdb79870bddb2e15b61aacae746c649583f48d4a32","symbol":"2330","values":{"actual_fcfe_verified":"FALSE","admission_status":"CANDIDATE_FOR_NEW_SOURCE_BATCH_ONLY","analysis_zh":"未獲支持。2,370元高於三組固定情境各自的25%折讓門檻，故在這個條件式分析方法下採等待／不支持現價新增的研究意見。沒有宣稱市場價格必然高估、公司沒有競爭力或投資必然虧損。","base_R_H":0.25,"base_R_T":0.15,"base_discount_25_threshold_twd":1174.17409309445,"base_g_H":0.12,"base_g_T":0.03,"base_model_value_twd":1565.5654574592666,"base_r":0.1,"base_terminal_fraction":0.8084653077608785,"classification":"CONDITIONAL_ANALYST_RESEARCH_OPINION","comparison_rule":"2370 <= 0.75 * each fixed scenario model value; all three false","comparison_zh":"保留2370元高於三情境各自25%折讓門檻約651／1174／2055元。樂觀模型值約2740元仍高於2370，但25%折讓門檻約2055低於2370；因此不是三情境都認定高估，也不是保證買入價。","confirmation_zh":"價格進入已採用情境與折讓條件的門檻，且下一季需求、獲利與投入資本後現金流仍支持原假設，再重新審查；若以較強成長支撐現價，須提出可核對的經常性獲利與現金流證據。","conservative_R_H":0.12,"conservative_R_T":0.12,"conservative_discount_25_threshold_twd":650.9724999999999,"conservative_g_H":0.06,"conservative_g_T":0.02,"conservative_model_value_twd":867.9633333333331,"conservative_r":0.12,"conservative_terminal_fraction":0.7306905984665755,"data_quality_limitations":"Known limits remain in review JSON; original issuer releases not asserted audited; exact publication timestamps unknown; no annual IFRS EPS mixed into four-quarter TIFRS EPS.","display_state":"WAIT","distribution_limitations_zh":"模型折現的是假設分配，不是已核實FCFE或已宣布股利。終值約占73%至89%，EPS98.26未正常化；TIFRS季度與IASB年報未和解，不可混接。25%是所選條件，不保證本金或報酬。","dividend_policy_is_announced":"FALSE","eps0_twd":98.26,"invalidation_zh":"若後續資料否定假設的EPS起點、再投資報酬、分配可行性或競爭優勢，就廢止這版估值；若有經獨立驗證的新條件使門檻成立，改版重評，不沿用等待結論。","lifecycle_zh":"本研究只適用保留的2026-10-30收盤2370元，且須早於2026-11-02台北13:30；價格、資料日期或有效期改變時停用三筆並重審，不把舊判定套用新價格。","missing_data_caused_negative_verdict":"FALSE","model_value_is_official_target":"FALSE","normalization_status":"REPORTED_NOT_NORMALIZED","optimistic_R_H":0.3,"optimistic_R_T":0.2,"optimistic_discount_25_threshold_twd":2055.3516666651776,"optimistic_g_H":0.18,"optimistic_g_T":0.04,"optimistic_model_value_twd":2740.4688888869036,"optimistic_r":0.09,"optimistic_r8_counterexample_discount25_twd":2626.3192648436034,"optimistic_r8_counterexample_meets_policy":"TRUE","optimistic_r8_counterexample_required_return":0.08,"optimistic_r8_counterexample_value_twd":3501.759019791471,"optimistic_r8_counterexample_zh":"要求報酬改為8%的樂觀敏感度反例會滿足25%折讓條件；這不是本版三個固定情境之一，也不是市場已校準的報酬率，說明等待判定依賴參數，不是無條件高估。","optimistic_terminal_fraction":0.8871207802941113,"policy_id":"2330_EPS_REINVESTMENT_THREE_SCENARIO_25_BUFFER_CONDITIONAL_WAIT_V1","publication_status":"NOT_APPROVED","quarterly_accounting_framework":"TIFRS_CONSOLIDATED","required_discount_fraction":0.25,"retained_price_twd":2370,"review_canonical_hash":"fe5c4c7d0ed8422eeda739beb2b8fd4efc04c774b6e6c22f8d15f1cdef039c72","review_id":"VALUATION_THREE_SCENARIO_25_BUFFER_WAIT","review_price_close_twd":2370,"review_price_scope":"RETAINED_CLOSE_AS_OF_REVIEW_NOT_CURRENT_QUOTE","review_price_session_date":"2026-10-30","review_sha256":"278fc4e6bf28e819ff6b46769883889d00f9580dcf05298dc20ef3b271435398","review_valid_until":"2026-11-02T13:30:00+08:00","risk_zh":"模型主要價值來自終值，未正常化EPS包含非營業項目，分配政策是假設，並非真實FCFE或已宣布股利。折讓百分比不保證本金安全；TIFRS季度數與IASB IFRS年度數未對帳，不可混接。","scenario_assumptions_zh":"三情境依序為保守／基準／樂觀：前5年成長6%／12%／18%，新增再投資報酬12%／25%／30%，要求報酬12%／10%／9%，永續成長2%／3%／4%，成熟期再投資報酬12%／15%／20%；都是分析假設，不是公司預測。","scenarios_meeting_discount":0,"scope":"是否以保留收盤2,370元新增一筆「要求模型價值至少高於價格33.33%，即價格相對模型值折讓25%」的長期研究觀察，在明示的三組EPS/再投資折現情境下獲得估值吸引力支持？","source_authority_zh":"SEC文件是原始申報輸入；SUPPORTED／NOT_SUPPORTED是Morning Alpha自有條件式研究判斷，不是SEC或公司給的估值裁決。","source_receipt_hash":"79fd96963e7ddf8fa1338d0cbec8b839c8579ff04db0cac3d86ff3583071cb07","verdict":"NOT_SUPPORTED"}}]$review_facts$,
 '278fc4e6bf28e819ff6b46769883889d00f9580dcf05298dc20ef3b271435398','6936b55fa1162caf05bb54f642559695d407b54137643e8cf09f1361a88d2cf8','2026-11-02T13:30:00+08:00',$review_basis${"close_twd":2370,"scope":"RETAINED_CLOSE_AS_OF_REVIEW_NOT_CURRENT_QUOTE","session_date":"2026-10-30","symbol":"2330","unit":"TWD_PER_COMMON_SHARE"}$review_basis$);

create function public.load_daily_stock_ai_documented_reviews_v2(p_source_seal text,p_cutoff timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare r vnext_private.verified_documented_reviews_v2;
begin
 if p_source_seal is distinct from '6b3cfccff75a1960196a2edd9685290f7eb66b0bd7f0dd396c84de597ca12526' or p_cutoff is null or not isfinite(p_cutoff) then raise exception 'DOCUMENTED_REVIEW_V2_SCOPE';end if;
 select * into strict r from vnext_private.verified_documented_reviews_v2 where source_seal_sha256=p_source_seal;
 if exists(select from jsonb_array_elements(r.facts_text::jsonb)f where (f->>'available_at')::timestamptz>p_cutoff) then raise exception 'DOCUMENTED_REVIEW_V2_FUTURE_RECEIPT';end if;
 return jsonb_build_object('schema','DOCUMENTED_REVIEW_REGISTRY_V2','source_seal_sha256',r.source_seal_sha256,
  'facts_sha256',r.facts_sha256,'facts',r.facts_text::jsonb,'source_review_sha256',r.source_review_sha256,
  'review_receipt_sha256',r.review_receipt_sha256,'review_valid_until',r.review_valid_until,
  'review_price_basis',r.review_price_basis_text::jsonb,'source_admitted',false,'member_publication_approved',false);
end $fn$;
revoke all on function public.load_daily_stock_ai_documented_reviews_v2(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_documented_reviews_v2(text,timestamptz) to service_role;

create function vnext_runtime.is_documented_review_v2(p_fact jsonb) returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(p_fact->>'id' like 'own-documented-review:%',false);
$fn$;
revoke all on function vnext_runtime.is_documented_review_v2(jsonb) from public,anon,authenticated,service_role;

-- Only raw quote identity is read; no market forecasting or negative inference.
create function vnext_runtime.documented_review_phase_v2(p_inputs jsonb,p_cutoff timestamptz,p_until text,p_basis jsonb) returns jsonb
language plpgsql immutable set search_path='' as $fn$
declare s jsonb;bar_count integer;closing numeric;observed jsonb;state text;
begin
 select x into s from jsonb_array_elements(p_inputs)x where x->>'symbol'='2330';
 select count(*),min(case when jsonb_typeof(b->'close')='number' then (b->>'close')::numeric else null end) into bar_count,closing
  from jsonb_array_elements(coalesce(s->'bars','[]'))b where b->>'date'=s->>'through';
 if bar_count<>1 or closing is null or closing<=0 then closing:=null;end if;
 observed:=jsonb_build_object('session_date',s->'through','close_twd',closing);
 if p_cutoff>=(p_until::timestamptz) then state:='EXPIRED_NOT_APPLIED';
 elsif s is null or coalesce(s->>'through','') !~ '^\d{4}-\d\d-\d\d$' or closing is null then state:='PRICE_DATE_UNVERIFIED_NOT_APPLIED';
 elsif s->>'through' is distinct from p_basis->>'session_date' then state:='PRICE_DATE_CHANGED_NOT_APPLIED';
 elsif closing is distinct from (p_basis->>'close_twd')::numeric then state:='PRICE_CHANGED_NOT_APPLIED';
 elsif (select count(*) from jsonb_array_elements(s->'facts')f where f->>'id' like 'sec-quarter:2330:%')<>12 then state:='FINANCIAL_BASE_INCOMPLETE_NOT_APPLIED';
 else state:='ACTIVE';end if;
 return jsonb_build_object('state',state,'observed_price',observed);
end $fn$;
revoke all on function vnext_runtime.documented_review_phase_v2(jsonb,timestamptz,text,jsonb) from public,anon,authenticated,service_role;

-- Preserve V1's projection and all 71 other issuers. Only ACTIVE review inputs
-- reserve the 84-company-observation budget by retaining one latest as-reported
-- observation per financial kind. Omitted old observations remain in history.
create function vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(p_inputs jsonb) returns jsonb
language plpgsql stable set search_path='' as $fn$
declare r vnext_private.verified_documented_reviews_v2;reviews jsonb;registered jsonb;projected jsonb;phase jsonb;result jsonb;
begin
 projected:=vnext_runtime.project_daily_stock_ai_inputs_v1(p_inputs);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into reviews from jsonb_array_elements(p_inputs)i,
  lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_documented_review_v2(f);
 if reviews='[]'::jsonb then return projected;end if;
 select * into strict r from vnext_private.verified_documented_reviews_v2;
 select jsonb_agg(f order by (f->>'id') collate "C") into registered from jsonb_array_elements(r.facts_text::jsonb)f;
 if reviews is distinct from registered then raise exception 'DOCUMENTED_REVIEW_V2_PROJECT_SCOPE';end if;
 phase:=vnext_runtime.documented_review_phase_v2(p_inputs,(p_inputs->0->>'cutoff')::timestamptz,r.review_valid_until,r.review_price_basis_text::jsonb);
 select jsonb_agg(i.value||jsonb_build_object('facts',case when i.value->>'symbol'<>'2330' then i.value->'facts' else (
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]'::jsonb) from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where case when phase->>'state'<>'ACTIVE' then not vnext_runtime.is_documented_review_v2(f.value)
   when f.value->>'kind' not in('EPS_AS_REPORTED','FINANCIAL_AS_REPORTED','VALUATION_AS_REPORTED') then true
   else f.value=(select x from jsonb_array_elements(i.value->'facts')x where x->>'kind'=f.value->>'kind'
    order by coalesce(x->>'period','') desc,(x->>'available_at')::timestamptz desc,(x->>'id') collate "C" desc limit 1) end)end) order by i.ordinality)
 into result from jsonb_array_elements(projected) with ordinality i(value,ordinality);
 return result;
end $fn$;
revoke all on function vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(jsonb) from public,anon,authenticated,service_role;

create function vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2(p_base_inputs jsonb,p_inputs jsonb,p_refresh jsonb,p_cutoff timestamptz,p_business_date date) returns jsonb
language plpgsql stable set search_path='' as $fn$
declare r vnext_private.verified_documented_reviews_v2;registered jsonb;base_reviews jsonb;incoming_reviews jsonb;provided boolean;
 phase jsonb;state text;expected jsonb;base_stripped jsonb;input_stripped jsonb;prior_proof jsonb;projected jsonb;required_ids jsonb;selected_ids jsonb;price_count integer;
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72
  or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i where jsonb_typeof(i->'facts') is distinct from 'array')
  then raise exception 'DOCUMENTED_REVIEW_V2_INPUT_SCOPE';end if;
 provided:=coalesce(p_refresh?'documented_review_replay',false);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into base_reviews from jsonb_array_elements(p_base_inputs)i,
  lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_documented_review_v2(f);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into incoming_reviews from jsonb_array_elements(p_inputs)i,
  lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_documented_review_v2(f);
 if not provided and base_reviews='[]'::jsonb and incoming_reviews='[]'::jsonb then
  return vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(p_base_inputs,p_inputs,p_refresh,p_cutoff,p_business_date);end if;
 if p_cutoff is null or not isfinite(p_cutoff) then raise exception 'DOCUMENTED_REVIEW_V2_CLOCK';end if;
 select * into strict r from vnext_private.verified_documented_reviews_v2;
 select jsonb_agg(f order by (f->>'id') collate "C") into registered from jsonb_array_elements(r.facts_text::jsonb)f;
 if (base_reviews<>'[]'::jsonb and base_reviews is distinct from registered)
  or (incoming_reviews<>'[]'::jsonb and incoming_reviews is distinct from registered)
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i,lateral jsonb_array_elements(i->'facts')f
   where vnext_runtime.is_documented_review_v2(f) and i->>'symbol' is distinct from '2330')
  or exists(select from jsonb_array_elements(registered)f where (f->>'available_at')::timestamptz>p_cutoff)
  then raise exception 'DOCUMENTED_REVIEW_V2_FACT_DRIFT';end if;
 phase:=vnext_runtime.documented_review_phase_v2(p_inputs,p_cutoff,r.review_valid_until,r.review_price_basis_text::jsonb);state:=phase->>'state';
 if provided and p_refresh->'documented_review_replay'->>'state'='REGISTRY_UNAVAILABLE_NOT_APPLIED' then state:='REGISTRY_UNAVAILABLE_NOT_APPLIED';end if;
 if not provided and incoming_reviews='[]'::jsonb and state='ACTIVE' then state:='REGISTRY_UNAVAILABLE_NOT_APPLIED';end if;
 if not provided and base_reviews='[]'::jsonb and incoming_reviews<>'[]'::jsonb then raise exception 'DOCUMENTED_REVIEW_V2_PROOF_REQUIRED';end if;
 if state='ACTIVE' and incoming_reviews is distinct from registered
  or provided and state<>'ACTIVE' and incoming_reviews<>'[]'::jsonb then raise exception 'DOCUMENTED_REVIEW_V2_ACTIVATION';end if;
 expected:=jsonb_build_object('schema','DOCUMENTED_REVIEW_REPLAY_V2','source_seal_sha256',r.source_seal_sha256,'facts_sha256',r.facts_sha256,
  'review_valid_until',r.review_valid_until,'review_price_basis',r.review_price_basis_text::jsonb,
  'review_fact_ids',(select jsonb_agg(f->>'id' order by (f->>'id') collate "C") from jsonb_array_elements(registered)f),
  'applied_fact_ids',case when state='ACTIVE' then (select jsonb_agg(f->>'id' order by (f->>'id') collate "C") from jsonb_array_elements(registered)f)else '[]'::jsonb end,
  'state',state,'observed_price',phase->'observed_price','source_refetched',false,'source_admitted',false,'member_publication_approved',false);
 if provided and p_refresh->'documented_review_replay' is distinct from expected then raise exception 'DOCUMENTED_REVIEW_V2_PROOF_DRIFT';end if;
 select jsonb_agg(i.value||jsonb_build_object('facts',(select coalesce(jsonb_agg(f.value order by f.ordinality),'[]')
  from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality) where not vnext_runtime.is_documented_review_v2(f.value))) order by i.ordinality)
 into base_stripped from jsonb_array_elements(p_base_inputs) with ordinality i(value,ordinality);
 select jsonb_agg(i.value||jsonb_build_object('facts',(select coalesce(jsonb_agg(f.value order by f.ordinality),'[]')
  from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality) where not vnext_runtime.is_documented_review_v2(f.value))) order by i.ordinality)
 into input_stripped from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality);
 prior_proof:=vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(base_stripped,input_stripped,
  case when p_refresh is null then null else p_refresh-'documented_review_replay' end,p_cutoff,p_business_date);
 if state='ACTIVE' then
  select vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(jsonb_agg(i||jsonb_build_object('cutoff',p_cutoff))) into projected from jsonb_array_elements(p_inputs)i;
  select coalesce(jsonb_agg(f->>'id' order by (f->>'id') collate "C"),'[]') into required_ids from jsonb_array_elements(p_inputs)i,
   lateral jsonb_array_elements(i->'facts')f where i->>'symbol'='2330' and (vnext_runtime.is_documented_review_v2(f) or f->>'id' like 'sec-quarter:2330:%');
  select count(*) into price_count from jsonb_array_elements(projected)i,
   lateral jsonb_array_elements_text(i->'expected_sessions') with ordinality s(day,n),lateral jsonb_array_elements(i->'bars')b
   where i->>'symbol'='2330' and s.n>greatest(jsonb_array_length(i->'expected_sessions')-20,0) and b->>'date'=s.day;
  select coalesce(jsonb_agg(f.value->>'id' order by (f.value->>'id') collate "C"),'[]') into selected_ids from jsonb_array_elements(projected)i,
   lateral jsonb_array_elements(i->'facts') with ordinality f(value,n)
   where i->>'symbol'='2330' and f.n<=84-price_count and (vnext_runtime.is_documented_review_v2(f.value) or f.value->>'id' like 'sec-quarter:2330:%');
  if jsonb_array_length(required_ids)<>15 or selected_ids is distinct from required_ids then raise exception 'DOCUMENTED_REVIEW_V2_15_EVIDENCE_BUDGET';end if;
 end if;
 return prior_proof||jsonb_build_object('documented_review_replay',expected);
end $fn$;
revoke all on function vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2(jsonb,jsonb,jsonb,timestamptz,date) from public,anon,authenticated,service_role;

-- Match the exact model-visible projection of a registered fact. Raw source
-- hashes/permissions remain bound through the unchanged per-fact evidence hash.
create function vnext_runtime.documented_review_packet_fact_matches_v2(p_e jsonb,p_f jsonb) returns boolean
language sql immutable set search_path='' as $fn$
 select coalesce(p_e-'content'=jsonb_build_object('id','2330:FINANCIAL:'||(p_f->>'id'),'symbol','2330','kind','FINANCIAL',
  'source',p_f->>'source','published_at',p_f->'published_at','available_at',p_f->>'available_at',
  'first_seen_at',p_f->>'first_seen_at','as_of',p_f->>'as_of','evidence_hash',p_f->>'evidence_hash',
  'time_basis',case when p_f->'published_at'='null'::jsonb then 'OBSERVED_AFTER_RECEIPT' else 'PUBLISHED' end)
  and (p_e->>'content')::jsonb=jsonb_build_object('kind',p_f->>'kind','period',p_f->'period','basis',p_f->'basis',
   'values',p_f->'values','original_id',p_f->>'id'),false);
$fn$;
revoke all on function vnext_runtime.documented_review_packet_fact_matches_v2(jsonb,jsonb) from public,anon,authenticated,service_role;

-- Deadline is chosen before edition hashing/insertion, never by an AFTER hash
-- mutation. Legacy batches without this review namespace are exactly unchanged.
create function vnext_runtime.documented_review_packet_original_id_v2(p_e jsonb) returns text
language plpgsql immutable set search_path='' as $fn$
declare c jsonb;
begin
 if p_e->>'kind' is distinct from 'FINANCIAL' or jsonb_typeof(p_e->'content') is distinct from 'string' then return null;end if;
 begin c:=(p_e->>'content')::jsonb;exception when invalid_text_representation then return null;end;
 return c->>'original_id';
end $fn$;
revoke all on function vnext_runtime.documented_review_packet_original_id_v2(jsonb) from public,anon,authenticated,service_role;

create function vnext_runtime.documented_review_edition_expiry_v2(p_payload jsonb,p_requested timestamptz) returns timestamptz
language plpgsql volatile set search_path='' as $fn$
declare r vnext_private.verified_documented_reviews_v2;review_rows jsonb;stock jsonb;f jsonb;e jsonb;actual_ids jsonb;expected_ids jsonb;
 until_value timestamptz;basis_value jsonb;price_count integer;closing numeric;expected_count integer:=0;
begin
 select coalesce(jsonb_agg(jsonb_build_object('packet_symbol',p->'symbol','evidence',x)),'[]') into review_rows
  from jsonb_array_elements(coalesce(p_payload->'packets','[]'))p,lateral jsonb_array_elements(coalesce(p->'evidence','[]'))x
  where coalesce(x->>'id','') like '%own-documented-review:%'
   or exists(select from vnext_private.verified_documented_reviews_v2 known,lateral jsonb_array_elements(known.facts_text::jsonb)known_fact where known_fact->>'evidence_hash'=x->>'evidence_hash')
   or coalesce(vnext_runtime.documented_review_packet_original_id_v2(x),'') like 'own-documented-review:%';
 if review_rows='[]'::jsonb then return p_requested;end if;
 select * into strict r from vnext_private.verified_documented_reviews_v2;
 until_value:=r.review_valid_until::timestamptz;basis_value:=r.review_price_basis_text::jsonb;
 if jsonb_array_length(review_rows)<>3 or exists(select from jsonb_array_elements(review_rows)x where x->>'packet_symbol'<>'2330')
  or p_requested is null or not isfinite(p_requested) or p_requested<=clock_timestamp()
  or clock_timestamp()>=until_value or p_payload->>'cutoff' is null or not isfinite((p_payload->>'cutoff')::timestamptz)
  or (p_payload->>'cutoff')::timestamptz>=until_value then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_EXPIRED_OR_SCOPE';end if;
 select p into strict stock from jsonb_array_elements(p_payload->'packets')p where p->>'symbol'='2330';
 select coalesce(jsonb_agg(x->>'id' order by (x->>'id') collate "C"),'[]') into actual_ids
  from jsonb_array_elements(p_payload->'packets')p,lateral jsonb_array_elements(p->'evidence')x
  where coalesce(x->>'id','') like '%own-documented-review:%' or coalesce(x->>'id','') like '%:FINANCIAL:sec-quarter:%'
   or coalesce(vnext_runtime.documented_review_packet_original_id_v2(x),'') like 'sec-quarter:%'
   or coalesce(vnext_runtime.documented_review_packet_original_id_v2(x),'') like 'own-documented-review:%'
   or x->>'kind'='FINANCIAL' and coalesce(x->>'source','') ~* '^https?://[^/]*sec[.]gov[^/]*/Archives/edgar/data/0*1046179(/|$)';
 select jsonb_agg('2330:FINANCIAL:'||(candidate_fact->>'id') order by (candidate_fact->>'id') collate "C") into expected_ids
  from (select x candidate_fact from jsonb_array_elements(r.facts_text::jsonb)x union all
   select x from vnext_private.verified_retained_sec_facts_v1 n,lateral jsonb_array_elements(n.facts_text::jsonb)x)sealed;
 if actual_ids is distinct from expected_ids then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_RESERVED_SCOPE';end if;
 if stock->>'data_through' is distinct from basis_value->>'session_date' then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_QUOTE_DATE';end if;
 select count(*),min(((x->>'content')::jsonb->>'close')::numeric) into price_count,closing
  from jsonb_array_elements(stock->'evidence')x where x->>'kind'='PRICE'
   and (x->>'content')::jsonb->>'date'=basis_value->>'session_date';
 if price_count<>1 or closing is distinct from (basis_value->>'close_twd')::numeric
  or exists(select from jsonb_array_elements(stock->'evidence')x where x->>'kind'='PRICE' and (x->>'content')::jsonb->>'date'>basis_value->>'session_date')
  then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_QUOTE_DRIFT';end if;
 for f in select x from jsonb_array_elements(r.facts_text::jsonb)x union all
  select x from vnext_private.verified_retained_sec_facts_v1 n,lateral jsonb_array_elements(n.facts_text::jsonb)x loop
  select x into strict e from jsonb_array_elements(stock->'evidence')x where x->>'id'='2330:FINANCIAL:'||(f->>'id');
  if not vnext_runtime.documented_review_packet_fact_matches_v2(e,f) then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_FACT_DRIFT';end if;
  expected_count:=expected_count+1;
 end loop;
 if expected_count<>15 then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_FINANCIAL_SCOPE';end if;
 return least(p_requested,until_value);
end $fn$;
revoke all on function vnext_runtime.documented_review_edition_expiry_v2(jsonb,timestamptz) from public,anon,authenticated,service_role;

-- SOURCE keeps all other live V16 code, including CLAIM's two original V1
-- projections and the existing V4 packet-equality validator.
do $patch$
declare d text;p text;
begin
 d:=pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)'));
 if encode(sha256(convert_to(d,'UTF8')),'hex') is distinct from 'd3c67c1395bda7414f2b070c5599542f44eb49777b95b5b2eb3f65501b679484'
  or (length(d)-length(replace(d,'vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(','')))/length('vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(')<>1
  or (length(d)-length(replace(d,'vnext_runtime.project_daily_stock_ai_inputs_v1(final_inputs)','')))/length('vnext_runtime.project_daily_stock_ai_inputs_v1(final_inputs)')<>1 then raise exception 'DOCUMENTED_REVIEW_V2_SOURCE_DRIFT';end if;
 p:=replace(replace(d,'vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(','vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2('),'vnext_runtime.project_daily_stock_ai_inputs_v1(final_inputs)','vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(final_inputs)');execute p;
 if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)')),'UTF8')),'hex') is distinct from 'a9074dcad28525d207b9b28f894c95392823ae44331446827f968d6f83e763c6' then raise exception 'DOCUMENTED_REVIEW_V2_PATCH_UNCONFIRMED';end if;
end $patch$;
do $stage_patch$
declare d text;p text;needle constant text:=$stage_needle$ payload:=jsonb_build_object('schema','VNEXT_AI_RESEARCH_EDITION_V1'$stage_needle$;
begin
 d:=pg_get_functiondef(to_regprocedure('public.stage_daily_ai_research_edition_v1(text,text[],timestamptz)'));
 if encode(sha256(convert_to(d,'UTF8')),'hex') is distinct from '651467f9f66872cd17d1eaa9855e789f35a0b88ad8836bd0a04acff8a9f35efb'
  or (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_CALLSITE_DRIFT';end if;
 p:=replace(d,needle,$stage_line$ p_expires_at := vnext_runtime.documented_review_edition_expiry_v2(b.payload,p_expires_at);
$stage_line$||needle);execute p;
 if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.stage_daily_ai_research_edition_v1(text,text[],timestamptz)')),'UTF8')),'hex') is distinct from 'e744ae5fd8f0f31967e179ffdbdf3cc74672892564c0f6c454c8ff7847626b44'
  then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_PATCH_UNCONFIRMED';end if;
end $stage_patch$;
commit;
