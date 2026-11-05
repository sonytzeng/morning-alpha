CREATE OR REPLACE FUNCTION vnext_runtime.validate_daily_ai_financial_refresh_v5(p_base_inputs jsonb, p_inputs jsonb, p_refresh jsonb, p_cutoff timestamp with time zone, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare proof jsonb:=p_refresh;response jsonb;rows jsonb;addition jsonb;body jsonb;row jsonb;expected jsonb;fact jsonb;
 stock jsonb;incoming jsonb;old_fact jsonb;new_fact jsonb;kept jsonb;fresh jsonb:='[]';removed jsonb:='[]';actual_removed jsonb;expected_removed jsonb;kind text;hash text;source text;prior_response jsonb;reason text;audit jsonb;old_company jsonb;new_company jsonb;prior_row jsonb;
 allowed_sources constant text[]:=array['https://openapi.twse.com.tw/v1/opendata/t187ap14_L','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O','https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d','https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis'];
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72 or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72 then raise exception 'AI_INTAKE_FINANCIAL_SCOPE';end if;
 if proof is null then
  proof:=jsonb_build_object('schema','DAILY_AI_FINANCIAL_REFRESH_V1','observed_at',to_char(p_cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'responses','[]'::jsonb,'additions','[]'::jsonb,'removals','[]'::jsonb,'company_names','[]'::jsonb);
 end if;
 if jsonb_typeof(proof) is distinct from 'object' then raise exception 'AI_INTAKE_FINANCIAL_PROOF';end if;
 if proof->'company_names' is null and jsonb_typeof(proof->'responses')='array' and jsonb_array_length(proof->'responses')=0 then proof:=proof||jsonb_build_object('company_names','[]'::jsonb);end if;
 if proof->>'schema' is distinct from 'DAILY_AI_FINANCIAL_REFRESH_V1' or octet_length(proof::text)>7000000
  or proof->>'observed_at' is null or not isfinite((proof->>'observed_at')::timestamptz) or (proof->>'observed_at')::timestamptz>p_cutoff
  or ((proof->>'observed_at')::timestamptz at time zone 'Asia/Taipei')::date<>p_business_date
  or jsonb_typeof(proof->'responses') is distinct from 'array' or jsonb_array_length(proof->'responses') not in(0,3,4,5)
  or jsonb_typeof(proof->'additions') is distinct from 'array' or jsonb_array_length(proof->'additions')>216
  or jsonb_typeof(proof->'removals') is distinct from 'array' or jsonb_array_length(proof->'removals')>72000 then raise exception 'AI_INTAKE_FINANCIAL_PROOF';end if;
 if jsonb_typeof(coalesce(proof->'company_names','[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(proof->'company_names','[]'::jsonb))>72
  or (select count(distinct x->>'symbol') from jsonb_array_elements(coalesce(proof->'company_names','[]'::jsonb))x)<>jsonb_array_length(coalesce(proof->'company_names','[]'::jsonb))
  or (select count(distinct x->>'symbol') from jsonb_array_elements(p_base_inputs)x)<>72 or (select count(distinct x->>'symbol') from jsonb_array_elements(p_inputs)x)<>72 then raise exception 'AI_INTAKE_FINANCIAL_COMPANY';end if;
 if jsonb_array_length(proof->'responses')>0 and exists(select from unnest(allowed_sources[1:3])u where not exists(select from jsonb_array_elements(proof->'responses')r where r->>'source'=u)) then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
 if (select count(distinct x->>'source') from jsonb_array_elements(proof->'responses')x)<>jsonb_array_length(proof->'responses') then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
 for response in select * from jsonb_array_elements(proof->'responses') loop
  if jsonb_typeof(response) is distinct from 'object' or (select count(*) from jsonb_object_keys(response))<>7 then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
  if not(coalesce(response->>'source','')=any(allowed_sources)) then raise exception 'AI_INTAKE_FINANCIAL_SOURCE';end if;
  if response->>'state'='CAPTURED' then
   if response->'error' is distinct from 'null'::jsonb or jsonb_typeof(response->'response_text') is distinct from 'string'
    or octet_length(response->>'response_text') not between 2 and 2000000
    or response->>'source_sha256' is distinct from encode(sha256(convert_to(response->>'response_text','UTF8')),'hex')
    or jsonb_typeof(response->'source_bytes') is distinct from 'number' or (response->>'source_bytes')::numeric<>octet_length(response->>'response_text')
    or response->>'received_at' is null or not isfinite((response->>'received_at')::timestamptz)
    or (response->>'received_at')::timestamptz>(proof->>'observed_at')::timestamptz
    or ((response->>'received_at')::timestamptz at time zone 'Asia/Taipei')::date<>p_business_date then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
   rows:=(response->>'response_text')::jsonb;
   if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)>5000 or exists(select from jsonb_array_elements(rows)x where jsonb_typeof(x)<>'object') then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
  elsif response->>'state'='UNAVAILABLE' then
   if response->'received_at' is distinct from 'null'::jsonb or response->'source_sha256' is distinct from 'null'::jsonb
    or response->'source_bytes' is distinct from 'null'::jsonb or response->'response_text' is distinct from 'null'::jsonb
    or coalesce(response->>'error','') !~ '^AI_FINANCIAL_REFRESH_[A-Z_]{1,80}$' then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
  else raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
 end loop;
 if (select count(distinct (a->>'symbol')||':'||((a->>'body_text')::jsonb->>'kind')) from jsonb_array_elements(proof->'additions')a)<>jsonb_array_length(proof->'additions') then raise exception 'AI_INTAKE_FINANCIAL_ADDITION';end if;
 for addition in select * from jsonb_array_elements(proof->'additions') loop
  if not exists(select from jsonb_array_elements(p_base_inputs)i where i->>'symbol'=addition->>'symbol') or jsonb_typeof(addition->'body_text') is distinct from 'string'
   or jsonb_typeof(addition->'row_text') is distinct from 'string' or octet_length(addition->>'body_text')>12000 or octet_length(addition->>'row_text')>30000 then raise exception 'AI_INTAKE_FINANCIAL_ADDITION';end if;
  body:=(addition->>'body_text')::jsonb;row:=(addition->>'row_text')::jsonb;kind:=body->>'kind';source:=body->>'source';
  select x into strict response from jsonb_array_elements(proof->'responses')x where x->>'source'=source and x->>'state'='CAPTURED';
  rows:=(response->>'response_text')::jsonb;
  if row is distinct from vnext_runtime.daily_ai_financial_latest_v5(rows,addition->>'symbol',(response->>'received_at')::timestamptz,source,kind) then raise exception 'AI_INTAKE_FINANCIAL_ROW';end if;
  if kind='EPS_AS_REPORTED' and source=allowed_sources[3] then
   select x into prior_response from jsonb_array_elements(proof->'responses')x where x->>'source'=allowed_sources[1] and x->>'state'='CAPTURED';
   if prior_response is not null and vnext_runtime.daily_ai_financial_latest_v3((prior_response->>'response_text')::jsonb,addition->>'symbol',(prior_response->>'received_at')::timestamptz) is not null then raise exception 'AI_INTAKE_FINANCIAL_PRIORITY';end if;
  end if;
  if kind='VALUATION_AS_REPORTED' and source=allowed_sources[5] then
   select x into prior_response from jsonb_array_elements(proof->'responses')x where x->>'source'=allowed_sources[4] and x->>'state'='CAPTURED';
   if prior_response is not null then
    prior_row:=vnext_runtime.daily_ai_financial_latest_v5((prior_response->>'response_text')::jsonb,addition->>'symbol',(prior_response->>'received_at')::timestamptz,allowed_sources[4],kind);
    if prior_row is not null and vnext_runtime.daily_ai_financial_body_v5(addition->>'symbol',kind,prior_row,prior_response,repeat('0',64)) is not null then raise exception 'AI_INTAKE_FINANCIAL_PRIORITY';end if;
   end if;
  end if;
  expected:=vnext_runtime.daily_ai_financial_body_v5(addition->>'symbol',kind,row,response,encode(sha256(convert_to(addition->>'row_text','UTF8')),'hex'));
  hash:=encode(sha256(convert_to(addition->>'body_text','UTF8')),'hex');
  if expected is null or body is distinct from expected or addition->>'fact_id' is distinct from 'official-open-api:'||(addition->>'symbol')||':'||kind||':'||(body->>'period')||':'||hash then raise exception 'AI_INTAKE_FINANCIAL_MAPPING';end if;
  fact:=body||jsonb_build_object('id',addition->>'fact_id','evidence_hash',hash);fresh:=fresh||jsonb_build_array(fact);
 end loop;
 for audit in select * from jsonb_array_elements(coalesce(proof->'company_names','[]'::jsonb)) loop
  select x into strict old_company from jsonb_array_elements(p_base_inputs)x where x->>'symbol'=audit->>'symbol';
  select x into strict new_company from jsonb_array_elements(p_inputs)x where x->>'symbol'=audit->>'symbol';
  if old_company->'company' is not distinct from new_company->'company' or not vnext_runtime.daily_ai_financial_company_v5(old_company,new_company,proof) then raise exception 'AI_INTAKE_FINANCIAL_COMPANY';end if;
 end loop;
 for stock in select * from jsonb_array_elements(p_base_inputs) loop
  select x into strict incoming from jsonb_array_elements(p_inputs)x where x->>'symbol'=stock->>'symbol';kept:='[]';
  if not vnext_runtime.daily_ai_financial_company_v5(stock,incoming,proof) then raise exception 'AI_INTAKE_FINANCIAL_COMPANY';end if;
  for old_fact in select * from jsonb_array_elements(stock->'facts') loop
   reason:=null;
   if vnext_runtime.daily_ai_financial_restricted_v3(old_fact->>'source') then reason:='RESTRICTED_COMPANY_WEBSITE_FACT_REMOVED_WITHOUT_RELABEL';
   elsif old_fact->>'id' like 'official-open-api:%' and exists(select from jsonb_array_elements(fresh)f where f->>'symbol'=stock->>'symbol' and f->>'kind'=old_fact->>'kind' and f->>'period'=old_fact->>'period' and f->>'source'=old_fact->>'source') then reason:='OFFICIAL_API_SAME_REPORTED_PERIOD_SUPERSEDED_BY_NEW_RECEIPT';end if;
   if reason is null then kept:=kept||jsonb_build_array(old_fact);else removed:=removed||jsonb_build_array(jsonb_build_object('symbol',stock->>'symbol','id',old_fact->>'id','source',old_fact->>'source','kind',old_fact->>'kind','period',old_fact->'period','evidence_hash',old_fact->>'evidence_hash','reason',reason));end if;
  end loop;
  for new_fact in select f from jsonb_array_elements(fresh)f where f->>'symbol'=stock->>'symbol' loop kept:=kept||jsonb_build_array(new_fact);end loop;
  if incoming->'facts' is distinct from kept then raise exception 'AI_INTAKE_FINANCIAL_RETAINED_BYTES';end if;
 end loop;
 if p_refresh is null then proof:=proof||jsonb_build_object('removals',removed);else
  select coalesce(jsonb_agg(jsonb_strip_nulls(x) order by x->>'symbol',x->>'id',x->>'reason'),'[]') into actual_removed from jsonb_array_elements(proof->'removals')x;
  select coalesce(jsonb_agg(jsonb_strip_nulls(x) order by x->>'symbol',x->>'id',x->>'reason'),'[]') into expected_removed from jsonb_array_elements(removed)x;
  if actual_removed is distinct from expected_removed then raise exception 'AI_INTAKE_FINANCIAL_REMOVALS';end if;
 end if;
 return proof;
end $function$
