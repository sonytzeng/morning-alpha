-- CANDIDATE ONLY: this file has not been executed against any database.
-- Fixed-seal retained SEC replay for the existing daily SOURCE transaction.
-- Does not change Cron, secrets, frontend, model/provider, source admission,
-- publication approval, the V5 financial validator, or immutable past intakes.
-- Only the fingerprinted live public SOURCE call site changes to the wrapper.
-- Registering retained bytes is not a commercial-source or publication grant.
-- Apply once in one transaction after adapter review. Existing objects fail closed;
-- never rerun by removing the guards, CHECK constraints, or fingerprint checks.
-- New SEC quarters/revisions require a separately reviewed new seal/version.
begin;

-- Fail before creating objects if the captured live V15 functions have changed.
do $guard$
declare source_def text;financial_def text;projection_def text;
begin
 if to_regclass('vnext_private.verified_retained_sec_facts_v1') is not null
  or to_regprocedure('vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(jsonb,jsonb,jsonb,timestamptz,date)') is not null
  or to_regprocedure('public.load_daily_stock_ai_sec_replay_v1(text,timestamptz)') is not null
  then raise exception 'SEC_REPLAY_ALREADY_PRESENT_OR_CONFLICT';end if;
 source_def:=pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)'));
 financial_def:=pg_get_functiondef(to_regprocedure('vnext_runtime.validate_daily_ai_financial_refresh_v5(jsonb,jsonb,jsonb,timestamptz,date)'));
 projection_def:=pg_get_functiondef(to_regprocedure('vnext_runtime.project_daily_stock_ai_inputs_v1(jsonb)'));
 if encode(sha256(convert_to(source_def,'UTF8')),'hex') is distinct from '26169e11d79560f63909a4726aa41cb849782fc786819cef83d43e2ad33a6d4c'
  or encode(sha256(convert_to(financial_def,'UTF8')),'hex') is distinct from 'e6f4aa5a0f9f89fa42eaeff44fcde20c75620ec3937f9cdc477706415b87e318'
  or encode(sha256(convert_to(projection_def,'UTF8')),'hex') is distinct from '7b3da81170bfdae84fdac26fbf88844791f4e4d795b6e687499b7a655559a977'
  then raise exception 'SEC_REPLAY_LIVE_BASELINE_DRIFT';end if;
end $guard$;

-- A single immutable row retains exact UTF-8 canonical texts. Hash the retained
-- text, never jsonb::text, whose whitespace/key ordering is a different encoding.
create table vnext_private.verified_retained_sec_facts_v1(
 source_seal_sha256 text primary key check(source_seal_sha256='a4398990a8bf63580efae7afee918613783249573f78e1ca7a11fd70de0f6edb'),
 facts_sha256 text not null check(facts_sha256='d0402e790286173f8cac9cb9b8cf216d4c3dc0db78dc83f3ac1c91878d141527'),
 facts_text text not null check(encode(sha256(convert_to(facts_text,'UTF8')),'hex')=facts_sha256
  and jsonb_typeof(facts_text::jsonb)='array' and jsonb_array_length(facts_text::jsonb)=12),
 source_documents_sha256 text not null check(source_documents_sha256='77fe7baac1e3208c5fb82c4c9c2613177307a6f583a70b7b5496a2338967f710'),
 source_documents_text text not null check(encode(sha256(convert_to(source_documents_text,'UTF8')),'hex')=source_documents_sha256
  and jsonb_typeof(source_documents_text::jsonb)='array' and jsonb_array_length(source_documents_text::jsonb)=8),
 replay_basis text not null default 'RETAINED_ORIGINAL_RECEIPTS_NOT_REOBSERVED'
  check(replay_basis='RETAINED_ORIGINAL_RECEIPTS_NOT_REOBSERVED'),
 source_admitted boolean not null default false check(source_admitted=false),
 member_publication_approved boolean not null default false check(member_publication_approved=false)
);
alter table vnext_private.verified_retained_sec_facts_v1 enable row level security;
revoke all on table vnext_private.verified_retained_sec_facts_v1 from public,anon,authenticated,service_role;

create function vnext_private.seal_verified_retained_sec_facts_v1() returns trigger
language plpgsql set search_path='' as $function$
begin raise exception 'SEC_REPLAY_REGISTRY_IMMUTABLE';end $function$;
revoke all on function vnext_private.seal_verified_retained_sec_facts_v1() from public,anon,authenticated,service_role;
create trigger seal_verified_retained_sec_facts_v1 before update or delete or truncate
 on vnext_private.verified_retained_sec_facts_v1 for each statement
 execute function vnext_private.seal_verified_retained_sec_facts_v1();

insert into vnext_private.verified_retained_sec_facts_v1(
 source_seal_sha256,facts_sha256,facts_text,source_documents_sha256,source_documents_text)
values('a4398990a8bf63580efae7afee918613783249573f78e1ca7a11fd70de0f6edb',
 'd0402e790286173f8cac9cb9b8cf216d4c3dc0db78dc83f3ac1c91878d141527',
 $sec_facts$[{"as_of":"2025-12-31T23:59:59+08:00","available_at":"2026-10-31T08:54:25.368025+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"7386527dfafc92b4b24d6d8d0b198756cba9424e209fe37e7824502a0e5f3efd","first_seen_at":"2026-10-31T08:54:25.368025+00:00","id":"sec-quarter:2330:2025-Q4:EPS:1f2a428101dcf7bd96b21d50e2bb85820ae9898498983e24001ac2d9274e160d","kind":"EPS","member_publication_approved":false,"period":"2025-Q4","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000008/a4q25e_withguidancexfinal.htm","source_admitted":false,"source_bytes":28058,"source_locator":{"accession":"000104617926000008","column":"4Q25","row":"diluted earnings per share of NT$","section":"Quarterly reported results"},"source_sha256":"1f2a428101dcf7bd96b21d50e2bb85820ae9898498983e24001ac2d9274e160d","symbol":"2330","values":{"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","consolidation":"CONSOLIDATED","measurement_basis":"DILUTED","reported_decimal":"19.50","subsequent_revision_review":"NOT_PERFORMED","unit":"TWD_PER_COMMON_SHARE","value":19.5}},{"as_of":"2025-12-31T23:59:59+08:00","available_at":"2026-10-31T08:54:25.368025+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"12c9d95f3aa01b8984968a65e40ef52e84b10ed7a499735350429c6a0fe65672","first_seen_at":"2026-10-31T08:54:25.368025+00:00","id":"sec-quarter:2330:2025-Q4:MARGIN:1f2a428101dcf7bd96b21d50e2bb85820ae9898498983e24001ac2d9274e160d","kind":"MARGIN","member_publication_approved":false,"period":"2025-Q4","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000008/a4q25e_withguidancexfinal.htm","source_admitted":false,"source_bytes":28058,"source_locator":{"accession":"000104617926000008","column":"4Q25","row":"Gross margin for the quarter","section":"Quarterly reported results"},"source_sha256":"1f2a428101dcf7bd96b21d50e2bb85820ae9898498983e24001ac2d9274e160d","symbol":"2330","values":{"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","measurement_basis":"DIRECTLY_REPORTED_GROSS_MARGIN","net_margin_percent":48.3,"operating_margin_percent":54,"reported_decimal":"62.3","subsequent_revision_review":"NOT_PERFORMED","unit":"PERCENT","value":62.3}},{"as_of":"2025-12-31T23:59:59+08:00","available_at":"2026-10-31T08:54:25.385389+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"eec2258bbaddcc47e5077fee88f91031c52866f34ef6a90f73df15d754086268","first_seen_at":"2026-10-31T08:54:25.385389+00:00","id":"sec-quarter:2330:2025-Q4:CAPEX:5fffba51696f3531b76df836e2a2ff51731ebdaceb2ad86dd25beec998a96943","kind":"CAPEX","member_publication_approved":false,"period":"2025-Q4","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000008/a4q25presentatione.htm","source_admitted":false,"source_bytes":11280,"source_locator":{"accession":"000104617926000008","column":"4Q25","row":"Capital expenditures; Cash from operating activities; Free Cash Flow","section":"Cash Flows"},"source_sha256":"5fffba51696f3531b76df836e2a2ff51731ebdaceb2ad86dd25beec998a96943","symbol":"2330","values":{"amount_precision":"ROUNDED_DISCLOSED_BILLIONS_NOT_EXACT_UNDERLYING_YUAN","amount_resolution_twd":10000000,"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","cashflow_sign":"OUTFLOW_POSITIVE_MAGNITUDE","free_cashflow_twd":368600000000,"measurement_basis":"DIRECTLY_REPORTED_QUARTER_CAPITAL_EXPENDITURES","operating_cashflow_twd":725510000000,"reported_decimal_billion":"356.91","subsequent_revision_review":"NOT_PERFORMED","unit":"TWD","value":356910000000}},{"as_of":"2026-03-31T23:59:59+08:00","available_at":"2026-10-31T08:54:38.606922+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"d5c59829fccf50e43deb2e1668615025db665f6f768c4f1de7e61bf5729efbe7","first_seen_at":"2026-10-31T08:54:38.606922+00:00","id":"sec-quarter:2330:2026-Q1:EPS:af4a01cdb2020878d07c5ff46f5ad2b3e0ec94f508a41033b534901a93fc6f02","kind":"EPS","member_publication_approved":false,"period":"2026-Q1","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000199/a1q26e_withguidancexfinal.htm","source_admitted":false,"source_bytes":27566,"source_locator":{"accession":"000104617926000199","column":"1Q26","row":"diluted earnings per share of NT$","section":"Quarterly reported results"},"source_sha256":"af4a01cdb2020878d07c5ff46f5ad2b3e0ec94f508a41033b534901a93fc6f02","symbol":"2330","values":{"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","consolidation":"CONSOLIDATED","measurement_basis":"DILUTED","reported_decimal":"22.08","subsequent_revision_review":"NOT_PERFORMED","unit":"TWD_PER_COMMON_SHARE","value":22.08}},{"as_of":"2026-03-31T23:59:59+08:00","available_at":"2026-10-31T08:54:38.606922+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"1e47d5452d75889165bb96817bd94a1583ad0e83b6458c80021e930af50d5b61","first_seen_at":"2026-10-31T08:54:38.606922+00:00","id":"sec-quarter:2330:2026-Q1:MARGIN:af4a01cdb2020878d07c5ff46f5ad2b3e0ec94f508a41033b534901a93fc6f02","kind":"MARGIN","member_publication_approved":false,"period":"2026-Q1","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000199/a1q26e_withguidancexfinal.htm","source_admitted":false,"source_bytes":27566,"source_locator":{"accession":"000104617926000199","column":"1Q26","row":"Gross margin for the quarter","section":"Quarterly reported results"},"source_sha256":"af4a01cdb2020878d07c5ff46f5ad2b3e0ec94f508a41033b534901a93fc6f02","symbol":"2330","values":{"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","measurement_basis":"DIRECTLY_REPORTED_GROSS_MARGIN","net_margin_percent":50.5,"operating_margin_percent":58.1,"reported_decimal":"66.2","subsequent_revision_review":"NOT_PERFORMED","unit":"PERCENT","value":66.2}},{"as_of":"2026-03-31T23:59:59+08:00","available_at":"2026-10-31T08:54:38.617881+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"7acb390fb62ced4580095ce7e921600293753a08474f2291832c99bdb7e235ea","first_seen_at":"2026-10-31T08:54:38.617881+00:00","id":"sec-quarter:2330:2026-Q1:CAPEX:af912b8899329b7e306c91eda5aa2ca9bc75694a8cea2647057d6fd58ba17b43","kind":"CAPEX","member_publication_approved":false,"period":"2026-Q1","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000199/a1q26presentatione.htm","source_admitted":false,"source_bytes":9630,"source_locator":{"accession":"000104617926000199","column":"1Q26","row":"Capital expenditures; Cash from operating activities; Free Cash Flow","section":"Cash Flows"},"source_sha256":"af912b8899329b7e306c91eda5aa2ca9bc75694a8cea2647057d6fd58ba17b43","symbol":"2330","values":{"amount_precision":"ROUNDED_DISCLOSED_BILLIONS_NOT_EXACT_UNDERLYING_YUAN","amount_resolution_twd":10000000,"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","cashflow_sign":"OUTFLOW_POSITIVE_MAGNITUDE","free_cashflow_twd":348210000000,"measurement_basis":"DIRECTLY_REPORTED_QUARTER_CAPITAL_EXPENDITURES","operating_cashflow_twd":698970000000,"reported_decimal_billion":"350.76","subsequent_revision_review":"NOT_PERFORMED","unit":"TWD","value":350760000000}},{"as_of":"2026-06-30T23:59:59+08:00","available_at":"2026-10-31T08:54:45.270805+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"f22e3869233931e4e01e382f989c3173f1396168956598f84ee8d60ecb9af7e9","first_seen_at":"2026-10-31T08:54:45.270805+00:00","id":"sec-quarter:2330:2026-Q2:EPS:f48f42c822d0dba2a233b669c3b437787bd156b263c4c395c82116e148eaf79d","kind":"EPS","member_publication_approved":false,"period":"2026-Q2","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/a2q26e_withguidancexfinal.htm","source_admitted":false,"source_bytes":28122,"source_locator":{"accession":"000104617926000451","column":"2Q26","row":"diluted earnings per share of NT$","section":"Quarterly reported results"},"source_sha256":"f48f42c822d0dba2a233b669c3b437787bd156b263c4c395c82116e148eaf79d","symbol":"2330","values":{"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","consolidation":"CONSOLIDATED","measurement_basis":"DILUTED","reported_decimal":"27.25","subsequent_revision_review":"NOT_PERFORMED","unit":"TWD_PER_COMMON_SHARE","value":27.25}},{"as_of":"2026-06-30T23:59:59+08:00","available_at":"2026-10-31T08:54:45.270805+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"599675f91d9b4417c54bcd0bb6dc7a181e5c3c177d0750cd8a69595817f2f2fb","first_seen_at":"2026-10-31T08:54:45.270805+00:00","id":"sec-quarter:2330:2026-Q2:MARGIN:f48f42c822d0dba2a233b669c3b437787bd156b263c4c395c82116e148eaf79d","kind":"MARGIN","member_publication_approved":false,"period":"2026-Q2","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/a2q26e_withguidancexfinal.htm","source_admitted":false,"source_bytes":28122,"source_locator":{"accession":"000104617926000451","column":"2Q26","row":"Gross margin for the quarter","section":"Quarterly reported results"},"source_sha256":"f48f42c822d0dba2a233b669c3b437787bd156b263c4c395c82116e148eaf79d","symbol":"2330","values":{"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","measurement_basis":"DIRECTLY_REPORTED_GROSS_MARGIN","net_margin_percent":55.6,"operating_margin_percent":60.3,"reported_decimal":"67.7","subsequent_revision_review":"NOT_PERFORMED","unit":"PERCENT","value":67.7}},{"as_of":"2026-06-30T23:59:59+08:00","available_at":"2026-10-31T08:54:45.225727+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"7f9f55f6759d6b5dc91261e4d3cbca1c94fac15f66de6ec6f993a6ebab2813d3","first_seen_at":"2026-10-31T08:54:45.225727+00:00","id":"sec-quarter:2330:2026-Q2:CAPEX:da97d69759eb7179bd293441a36d12a0cf274adc6536887723b6c19a419025f5","kind":"CAPEX","member_publication_approved":false,"period":"2026-Q2","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/a2q26presentatione.htm","source_admitted":false,"source_bytes":9729,"source_locator":{"accession":"000104617926000451","column":"2Q26","row":"Capital expenditures; Cash from operating activities; Free Cash Flow","section":"Cash Flows"},"source_sha256":"da97d69759eb7179bd293441a36d12a0cf274adc6536887723b6c19a419025f5","symbol":"2330","values":{"amount_precision":"ROUNDED_DISCLOSED_BILLIONS_NOT_EXACT_UNDERLYING_YUAN","amount_resolution_twd":10000000,"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","cashflow_sign":"OUTFLOW_POSITIVE_MAGNITUDE","free_cashflow_twd":287360000000,"measurement_basis":"DIRECTLY_REPORTED_QUARTER_CAPITAL_EXPENDITURES","operating_cashflow_twd":783360000000,"reported_decimal_billion":"496.00","subsequent_revision_review":"NOT_PERFORMED","unit":"TWD","value":496000000000}},{"as_of":"2026-09-30T23:59:59+08:00","available_at":"2026-10-31T08:54:52.075521+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"299d63eb1712cb3c54389180321f0a1c4c15af0a34fd60344103a0a16ff9c1f0","first_seen_at":"2026-10-31T08:54:52.075521+00:00","id":"sec-quarter:2330:2026-Q3:EPS:2e5a10327f473f483d2e035970860ca8bf374a568eceb04c94ee19de8330b8a1","kind":"EPS","member_publication_approved":false,"period":"2026-Q3","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26e_withguidancexfinal.htm","source_admitted":false,"source_bytes":28015,"source_locator":{"accession":"000104617926000726","column":"3Q26","row":"diluted earnings per share of NT$","section":"Quarterly reported results"},"source_sha256":"2e5a10327f473f483d2e035970860ca8bf374a568eceb04c94ee19de8330b8a1","symbol":"2330","values":{"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","consolidation":"CONSOLIDATED","measurement_basis":"DILUTED","reported_decimal":"29.43","subsequent_revision_review":"NOT_PERFORMED","unit":"TWD_PER_COMMON_SHARE","value":29.43}},{"as_of":"2026-09-30T23:59:59+08:00","available_at":"2026-10-31T08:54:52.075521+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"5943929de2b4e2b64cff03581cb86b143e050cfc2f4e7d915394406ea6df0df1","first_seen_at":"2026-10-31T08:54:52.075521+00:00","id":"sec-quarter:2330:2026-Q3:MARGIN:2e5a10327f473f483d2e035970860ca8bf374a568eceb04c94ee19de8330b8a1","kind":"MARGIN","member_publication_approved":false,"period":"2026-Q3","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26e_withguidancexfinal.htm","source_admitted":false,"source_bytes":28015,"source_locator":{"accession":"000104617926000726","column":"3Q26","row":"Gross margin for the quarter","section":"Quarterly reported results"},"source_sha256":"2e5a10327f473f483d2e035970860ca8bf374a568eceb04c94ee19de8330b8a1","symbol":"2330","values":{"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","measurement_basis":"DIRECTLY_REPORTED_GROSS_MARGIN","net_margin_percent":51.1,"operating_margin_percent":58.7,"reported_decimal":"66.4","subsequent_revision_review":"NOT_PERFORMED","unit":"PERCENT","value":66.4}},{"as_of":"2026-09-30T23:59:59+08:00","available_at":"2026-10-31T08:54:52.081316+00:00","basis":"SINGLE_QUARTER","data_quality_status":"SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED","evidence_hash":"aad28f05c52d86c34076ddb601987130be1bd405b3b417de893512a2d997f591","first_seen_at":"2026-10-31T08:54:52.081316+00:00","id":"sec-quarter:2330:2026-Q3:CAPEX:7aefc2944ddfd666e3a574fdb79870bddb2e15b61aacae746c649583f48d4a32","kind":"CAPEX","member_publication_approved":false,"period":"2026-Q3","published_at":null,"source":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26presentatione.htm","source_admitted":false,"source_bytes":9565,"source_locator":{"accession":"000104617926000726","column":"3Q26","row":"Capital expenditures; Cash from operating activities; Free Cash Flow","section":"Cash Flows"},"source_sha256":"7aefc2944ddfd666e3a574fdb79870bddb2e15b61aacae746c649583f48d4a32","symbol":"2330","values":{"amount_precision":"ROUNDED_DISCLOSED_BILLIONS_NOT_EXACT_UNDERLYING_YUAN","amount_resolution_twd":10000000,"assurance":"ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED","board_approval_at_release":"NOT_APPROVED","cashflow_sign":"OUTFLOW_POSITIVE_MAGNITUDE","free_cashflow_twd":476560000000,"measurement_basis":"DIRECTLY_REPORTED_QUARTER_CAPITAL_EXPENDITURES","operating_cashflow_twd":919770000000,"reported_decimal_billion":"443.21","subsequent_revision_review":"NOT_PERFORMED","unit":"TWD","value":443210000000}}]$sec_facts$,
 '77fe7baac1e3208c5fb82c4c9c2613177307a6f583a70b7b5496a2338967f710',
 $sec_documents$[{"bytes":28058,"kind":"release","period":"2025-Q4","received_at":"2026-10-31T08:54:25.368025+00:00","sha256":"1f2a428101dcf7bd96b21d50e2bb85820ae9898498983e24001ac2d9274e160d","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000008/a4q25e_withguidancexfinal.htm"},{"bytes":11280,"kind":"presentation","period":"2025-Q4","received_at":"2026-10-31T08:54:25.385389+00:00","sha256":"5fffba51696f3531b76df836e2a2ff51731ebdaceb2ad86dd25beec998a96943","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000008/a4q25presentatione.htm"},{"bytes":27566,"kind":"release","period":"2026-Q1","received_at":"2026-10-31T08:54:38.606922+00:00","sha256":"af4a01cdb2020878d07c5ff46f5ad2b3e0ec94f508a41033b534901a93fc6f02","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000199/a1q26e_withguidancexfinal.htm"},{"bytes":9630,"kind":"presentation","period":"2026-Q1","received_at":"2026-10-31T08:54:38.617881+00:00","sha256":"af912b8899329b7e306c91eda5aa2ca9bc75694a8cea2647057d6fd58ba17b43","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000199/a1q26presentatione.htm"},{"bytes":28122,"kind":"release","period":"2026-Q2","received_at":"2026-10-31T08:54:45.270805+00:00","sha256":"f48f42c822d0dba2a233b669c3b437787bd156b263c4c395c82116e148eaf79d","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/a2q26e_withguidancexfinal.htm"},{"bytes":9729,"kind":"presentation","period":"2026-Q2","received_at":"2026-10-31T08:54:45.225727+00:00","sha256":"da97d69759eb7179bd293441a36d12a0cf274adc6536887723b6c19a419025f5","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/a2q26presentatione.htm"},{"bytes":28015,"kind":"release","period":"2026-Q3","received_at":"2026-10-31T08:54:52.075521+00:00","sha256":"2e5a10327f473f483d2e035970860ca8bf374a568eceb04c94ee19de8330b8a1","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26e_withguidancexfinal.htm"},{"bytes":9565,"kind":"presentation","period":"2026-Q3","received_at":"2026-10-31T08:54:52.081316+00:00","sha256":"7aefc2944ddfd666e3a574fdb79870bddb2e15b61aacae746c649583f48d4a32","url":"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26presentatione.htm"}]$sec_documents$);

-- Read-only, fixed-seal server RPC. No grants expose the underlying table.
create function public.load_daily_stock_ai_sec_replay_v1(p_source_seal text,p_cutoff timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $function$
declare registry vnext_private.verified_retained_sec_facts_v1;facts jsonb;
begin
 if p_source_seal is distinct from 'a4398990a8bf63580efae7afee918613783249573f78e1ca7a11fd70de0f6edb'
  or p_cutoff is null or not isfinite(p_cutoff) then raise exception 'SEC_REPLAY_SCOPE';end if;
 select * into strict registry from vnext_private.verified_retained_sec_facts_v1 where source_seal_sha256=p_source_seal;
 facts:=registry.facts_text::jsonb;
 if exists(select from jsonb_array_elements(facts)f where (f->>'available_at')::timestamptz>p_cutoff)
  then raise exception 'SEC_REPLAY_FUTURE_RECEIPT';end if;
 return jsonb_build_object('schema','DAILY_AI_SEC_RETAINED_REGISTRY_V1',
  'source_seal_sha256',registry.source_seal_sha256,'facts_sha256',registry.facts_sha256,'facts',facts,
  'source_documents_sha256',registry.source_documents_sha256,'source_documents',registry.source_documents_text::jsonb,
  'replay_basis',registry.replay_basis,'source_admitted',false,'member_publication_approved',false);
end $function$;
revoke all on function public.load_daily_stock_ai_sec_replay_v1(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_sec_replay_v1(text,timestamptz) to service_role;

-- Reserved identity detection is deliberately broader than accepted provenance:
-- even a changed scheme, port, userinfo or lookalike host cannot sneak a modified
-- SEC-CIK observation past the exact registry comparison under a different ID.
create function vnext_runtime.is_retained_sec_quarter_identity_v1(p_fact jsonb) returns boolean
language sql immutable set search_path='' as $function$
 select coalesce(p_fact->>'id' like 'sec-quarter:%',false)
  or coalesce(p_fact->>'source' ~* '^https?://[^/]*sec[.]gov[^/]*/Archives/edgar/data/0*1046179(/|$)',false);
$function$;
revoke all on function vnext_runtime.is_retained_sec_quarter_identity_v1(jsonb) from public,anon,authenticated,service_role;

-- No model calls, source collection or writes here. The original V5 validator
-- still validates every non-SEC fact and existing response/removal/company proof.
-- STABLE is intentional: unlike immutable V5, this wrapper reads the registry.
create function vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(
 p_base_inputs jsonb,p_inputs jsonb,p_refresh jsonb,p_cutoff timestamptz,p_business_date date) returns jsonb
language plpgsql stable set search_path='' as $function$
declare registry vnext_private.verified_retained_sec_facts_v1;registered jsonb;base_sec jsonb;incoming_sec jsonb;projected_sec jsonb;
 stripped_base jsonb;stripped_inputs jsonb;old_proof jsonb;expected_replay jsonb;proof_present boolean;
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72
  or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i where jsonb_typeof(i->'facts') is distinct from 'array')
  then raise exception 'SEC_REPLAY_INPUT_SCOPE';end if;
 proof_present:=coalesce(p_refresh?'sec_replay',false);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]'::jsonb) into base_sec
  from jsonb_array_elements(p_base_inputs)i cross join lateral jsonb_array_elements(i->'facts')f
  where vnext_runtime.is_retained_sec_quarter_identity_v1(f);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]'::jsonb) into incoming_sec
  from jsonb_array_elements(p_inputs)i cross join lateral jsonb_array_elements(i->'facts')f
  where vnext_runtime.is_retained_sec_quarter_identity_v1(f);
 -- Preserve the exact old behavior during the staged rollout when neither side
 -- carries SEC facts and the adapter has not supplied its optional proof.
 if not proof_present and base_sec='[]'::jsonb and incoming_sec='[]'::jsonb then
  return vnext_runtime.validate_daily_ai_financial_refresh_v5(p_base_inputs,p_inputs,p_refresh,p_cutoff,p_business_date);
 end if;
 select * into strict registry from vnext_private.verified_retained_sec_facts_v1
  where source_seal_sha256='a4398990a8bf63580efae7afee918613783249573f78e1ca7a11fd70de0f6edb';
 select jsonb_agg(f order by (f->>'id') collate "C") into registered from jsonb_array_elements(registry.facts_text::jsonb)f;
 if exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i cross join lateral jsonb_array_elements(i->'facts')f
   where vnext_runtime.is_retained_sec_quarter_identity_v1(f) and i->>'symbol' is distinct from '2330')
  or (base_sec<>'[]'::jsonb and base_sec is distinct from registered)
  or incoming_sec is distinct from registered
  or p_cutoff is null or not isfinite(p_cutoff)
  or exists(select from jsonb_array_elements(registered)f where (f->>'available_at')::timestamptz>p_cutoff)
  then raise exception 'SEC_REPLAY_FACTS_NOT_EXACT';end if;
 expected_replay:=jsonb_build_object('schema','DAILY_AI_SEC_RETAINED_REPLAY_V1',
  'source_seal_sha256',registry.source_seal_sha256,'facts_sha256',registry.facts_sha256,
  'fact_ids',(select jsonb_agg(f->>'id' order by (f->>'id') collate "C") from jsonb_array_elements(registered)f),
  'replay_basis',registry.replay_basis,'source_refetched',false,'source_admitted',false,'member_publication_approved',false);
 if proof_present then
  if p_refresh->'sec_replay' is distinct from expected_replay then raise exception 'SEC_REPLAY_PROOF_NOT_EXACT';end if;
 elsif base_sec='[]'::jsonb then
  -- First addition must have explicit replay proof. A prior exact full set may
  -- survive an adapter read failure, without turning old receipts into new ones.
  raise exception 'SEC_REPLAY_PROOF_REQUIRED';
 end if;
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]'::jsonb)
  from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not vnext_runtime.is_retained_sec_quarter_identity_v1(f.value))) order by i.ordinality)
  into stripped_base from jsonb_array_elements(p_base_inputs) with ordinality i(value,ordinality);
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]'::jsonb)
  from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not vnext_runtime.is_retained_sec_quarter_identity_v1(f.value))) order by i.ordinality)
  into stripped_inputs from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality);
 old_proof:=vnext_runtime.validate_daily_ai_financial_refresh_v5(stripped_base,stripped_inputs,
  case when p_refresh is null then null else p_refresh-'sec_replay' end,p_cutoff,p_business_date);
 -- SOURCE applies this same pinned projection after validation. Refuse an
 -- otherwise valid intake if competing facts would silently displace any of
 -- the twelve retained SEC facts from the four-per-kind quarterly budget.
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]'::jsonb) into projected_sec
  from jsonb_array_elements(vnext_runtime.project_daily_stock_ai_inputs_v1(p_inputs))i
  cross join lateral jsonb_array_elements(i->'facts')f
  where vnext_runtime.is_retained_sec_quarter_identity_v1(f);
 if projected_sec is distinct from registered then raise exception 'SEC_REPLAY_PROJECTION_TRUNCATED';end if;
 return old_proof||jsonb_build_object('sec_replay',expected_replay);
end $function$;
revoke all on function vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(jsonb,jsonb,jsonb,timestamptz,date)
 from public,anon,authenticated,service_role;

-- Localized live call-site replacement. No copied SOURCE definition and no
-- rename of V5: previously cached V5 OIDs retain their original semantics.
-- Recheck immediately before replacement and confirm the resulting definition.
do $patch$
declare definition text;patched text;needle constant text:='vnext_runtime.validate_daily_ai_financial_refresh_v5(';
 replacement constant text:='vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(';
begin
 definition:=pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)'));
 if encode(sha256(convert_to(definition,'UTF8')),'hex') is distinct from '26169e11d79560f63909a4726aa41cb849782fc786819cef83d43e2ad33a6d4c'
  or (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  then raise exception 'SEC_REPLAY_SOURCE_CALLSITE_DRIFT';end if;
 patched:=replace(definition,needle,replacement);
 execute patched;
 if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)')),'UTF8')),'hex')
  is distinct from 'd3c67c1395bda7414f2b070c5599542f44eb49777b95b5b2eb3f65501b679484' then raise exception 'SEC_REPLAY_SOURCE_PATCH_UNCONFIRMED';end if;
end $patch$;

commit;
