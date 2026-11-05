-- V3: audited, as-reported official financial observations. No model, Cron,
-- permission, review or prior receipt is changed. Apply after market-policy-v2.
begin;
alter table vnext_runtime.ai_stock_intakes add column if not exists financial_refresh jsonb;

create function vnext_runtime.daily_ai_financial_restricted_v3(p_source text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(p_source ~* '^https?://([a-z0-9-]+\.)*(tsmc[.]com|mediatek[.]com|honhai[.]com)(:[0-9]+)?(/|$)',false);
$$;
revoke all on function vnext_runtime.daily_ai_financial_restricted_v3(text) from public,anon,authenticated,service_role;

create function vnext_runtime.daily_ai_financial_field_v3(p_row jsonb,p_keys text[]) returns jsonb
language sql immutable set search_path='' as $$
 select p_row->k from unnest(p_keys) with ordinality keys(k,n)
 where p_row->k is not null and p_row->k<>'null'::jsonb order by n limit 1;
$$;
revoke all on function vnext_runtime.daily_ai_financial_field_v3(jsonb,text[]) from public,anon,authenticated,service_role;

create function vnext_runtime.daily_ai_financial_number_v3(p_value jsonb) returns double precision
language plpgsql immutable set search_path='' as $$
declare value text:=btrim(p_value#>>'{}');result double precision;
begin
 if jsonb_typeof(p_value)='number' or jsonb_typeof(p_value)='string' and value ~ '^[-+]?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$' then
  result:=replace(value,',','')::double precision;
  if result::text not in('Infinity','-Infinity','NaN') then return result;end if;
 end if;return null;
exception when others then return null;
end $$;
revoke all on function vnext_runtime.daily_ai_financial_number_v3(jsonb) from public,anon,authenticated,service_role;

create function vnext_runtime.daily_ai_financial_report_v3(p_row jsonb,p_received timestamptz) returns jsonb
language plpgsql immutable set search_path='' as $$
declare roc text:=vnext_runtime.daily_ai_financial_field_v3(p_row,array['年度','Year'])#>>'{}';q text:=p_row->>'季別';
 exported text:=vnext_runtime.daily_ai_financial_field_v3(p_row,array['出表日期','Date'])#>>'{}';year integer;report_end date;export_date date;
begin
 if coalesce(roc,'') !~ '^\d{1,3}$' or roc::integer not between 80 and 300 or coalesce(q,'') !~ '^[1-4]$'
  or coalesce(exported,'') !~ '^\d{7}$' then return null;end if;
 year:=roc::integer+1911;report_end:=(make_date(year,q::integer*3,1)+interval '1 month'-interval '1 day')::date;
 export_date:=make_date(substring(exported from 1 for 3)::integer+1911,substring(exported from 4 for 2)::integer,substring(exported from 6 for 2)::integer);
 if report_end>(p_received at time zone 'Asia/Taipei')::date or export_date>(p_received at time zone 'Asia/Taipei')::date then return null;end if;
 return jsonb_build_object('roc',roc,'quarter',q,'exported',exported,'period',year::text||'-Q'||q,'rank',year*10+q::integer,
  'scope','YEAR_'||roc||'_QUARTER_'||q||'_AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_EXPLICIT');
exception when others then return null;
end $$;
revoke all on function vnext_runtime.daily_ai_financial_report_v3(jsonb,timestamptz) from public,anon,authenticated,service_role;

create function vnext_runtime.daily_ai_financial_latest_v3(p_rows jsonb,p_symbol text,p_received timestamptz) returns jsonb
language plpgsql immutable set search_path='' as $$
declare row jsonb;label jsonb;winner jsonb;best_rank integer:=-1;best_export text:='';ties integer:=0;rank_value integer;
begin
 for row in select r from jsonb_array_elements(p_rows)r where vnext_runtime.daily_ai_financial_field_v3(r,array['公司代號','SecuritiesCompanyCode'])#>>'{}'=p_symbol loop
  label:=vnext_runtime.daily_ai_financial_report_v3(row,p_received);if label is null then return null;end if;rank_value:=(label->>'rank')::integer;
  if rank_value>best_rank or rank_value=best_rank and label->>'exported'>best_export then
   winner:=row;best_rank:=rank_value;best_export:=label->>'exported';ties:=1;
  elsif rank_value=best_rank and label->>'exported'=best_export then ties:=ties+1;end if;
 end loop;
 if ties<>1 then return null;end if;return winner;
end $$;
revoke all on function vnext_runtime.daily_ai_financial_latest_v3(jsonb,text,timestamptz) from public,anon,authenticated,service_role;

create function vnext_runtime.daily_ai_financial_body_v3(p_symbol text,p_kind text,p_row jsonb,p_response jsonb,p_row_hash text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare label jsonb:=vnext_runtime.daily_ai_financial_report_v3(p_row,(p_response->>'received_at')::timestamptz);
 values jsonb;decimal jsonb;revenue double precision;n double precision;ratio double precision;key text;field text;raw jsonb;
begin
 if label is null then return null;end if;
 if p_kind='EPS_AS_REPORTED' and p_response->>'source' in('https://openapi.twse.com.tw/v1/opendata/t187ap14_L','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O') then
  decimal:=vnext_runtime.daily_ai_financial_field_v3(p_row,array['基本每股盈餘(元)','基本每股盈餘']);n:=vnext_runtime.daily_ai_financial_number_v3(decimal);if n is null then return null;end if;
  values:=jsonb_build_object('value',n,'reported_decimal',decimal#>>'{}','unit','SOURCE_REPORTED_YUAN_PER_SHARE','measurement_basis','BASIC_AS_REPORTED',
   'reported_year_roc',label->>'roc','reported_quarter',label->>'quarter','period_scope',label->>'scope','period_basis','AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_INFERRED','no_single_quarter_or_ttm_inference','TRUE');
 elsif p_kind='FINANCIAL_AS_REPORTED' and p_response->>'source'='https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci' then
  values:=jsonb_build_object('reported_year_roc',label->>'roc','reported_quarter',label->>'quarter','period_scope',label->>'scope','period_basis','AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_INFERRED',
   'unit','PERCENT_RATIO_OF_SAME_REPORTED_MONETARY_UNIT','source_monetary_scale','NOT_EXPLICIT_IN_API_ROW_NO_SCALED_AMOUNT_CLAIMS',
   'calculation_basis','GROSS_OPERATING_NET_PROFIT_DIVIDED_BY_REPORTED_REVENUE_TIMES_100','no_single_quarter_or_ttm_inference','TRUE');
  revenue:=vnext_runtime.daily_ai_financial_number_v3(p_row->'營業收入');if revenue is null or revenue=0 then return null;end if;
  foreach key in array array['gross_margin_percent','operating_margin_percent','net_margin_percent'] loop
   raw:=case key when 'gross_margin_percent' then case when coalesce(p_row->>'營業毛利（毛損）淨額','')<>'' then p_row->'營業毛利（毛損）淨額' else p_row->'營業毛利（毛損）' end
    when 'operating_margin_percent' then p_row->'營業利益（損失）' else p_row->'本期淨利（淨損）' end;
   n:=vnext_runtime.daily_ai_financial_number_v3(raw);if n is null then continue;end if;
   ratio:=floor(((n/revenue)*100)*1000000+0.5)/1000000;
   if ratio::text not in('Infinity','-Infinity','NaN') then values:=values||jsonb_build_object(key,ratio);end if;
  end loop;
  if not(values ?| array['gross_margin_percent','operating_margin_percent','net_margin_percent']) then return null;end if;
 else return null;end if;
 return jsonb_build_object('symbol',p_symbol,'kind',p_kind,'period',label->>'period','basis','AS_REPORTED','values',values,'source',p_response->>'source','published_at',null,
  'first_seen_at',p_response->>'received_at','available_at',p_response->>'received_at','as_of',p_response->>'received_at','source_sha256',p_response->>'source_sha256',
  'source_bytes',p_response->'source_bytes','source_received_at',p_response->>'received_at','source_locator',jsonb_build_object('company_code',p_symbol,
   'reported_year_roc',vnext_runtime.daily_ai_financial_field_v3(p_row,array['年度','Year']),'reported_quarter',p_row->'季別',
   'source_export_date_not_publication',vnext_runtime.daily_ai_financial_field_v3(p_row,array['出表日期','Date']),'row_sha256',p_row_hash),
  'data_quality_status','OFFICIAL_OPEN_API_OBSERVED_AFTER_RECEIPT_PUBLICATION_UNKNOWN_AS_REPORTED_PERIOD_BASIS_NOT_INFERRED','actual_only',true,
  'historical_knowledge',false,'source_admitted',false,'member_publication_approved',false);
end $$;
revoke all on function vnext_runtime.daily_ai_financial_body_v3(text,text,jsonb,jsonb,text) from public,anon,authenticated,service_role;

create function vnext_runtime.validate_daily_ai_financial_refresh_v3(p_base_inputs jsonb,p_inputs jsonb,p_refresh jsonb,p_cutoff timestamptz,p_business_date date) returns jsonb
language plpgsql immutable set search_path='' as $$
declare proof jsonb:=p_refresh;response jsonb;rows jsonb;addition jsonb;body jsonb;row jsonb;expected jsonb;fact jsonb;
 stock jsonb;incoming jsonb;old_fact jsonb;new_fact jsonb;kept jsonb;fresh jsonb:='[]';removed jsonb:='[]';actual_removed jsonb;expected_removed jsonb;kind text;hash text;source text;prior_response jsonb;reason text;
 allowed_sources constant text[]:=array['https://openapi.twse.com.tw/v1/opendata/t187ap14_L','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O'];
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72 or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72 then raise exception 'AI_INTAKE_FINANCIAL_SCOPE';end if;
 if proof is null then
  proof:=jsonb_build_object('schema','DAILY_AI_FINANCIAL_REFRESH_V1','observed_at',to_char(p_cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'responses','[]'::jsonb,'additions','[]'::jsonb,'removals','[]'::jsonb);
 end if;
 if proof->>'schema' is distinct from 'DAILY_AI_FINANCIAL_REFRESH_V1' or octet_length(proof::text)>7000000
  or proof->>'observed_at' is null or not isfinite((proof->>'observed_at')::timestamptz) or (proof->>'observed_at')::timestamptz>p_cutoff
  or ((proof->>'observed_at')::timestamptz at time zone 'Asia/Taipei')::date<>p_business_date
  or jsonb_typeof(proof->'responses') is distinct from 'array' or jsonb_array_length(proof->'responses') not in(0,3)
  or jsonb_typeof(proof->'additions') is distinct from 'array' or jsonb_array_length(proof->'additions')>144
  or jsonb_typeof(proof->'removals') is distinct from 'array' or jsonb_array_length(proof->'removals')>72000 then raise exception 'AI_INTAKE_FINANCIAL_PROOF';end if;
 if (select count(distinct x->>'source') from jsonb_array_elements(proof->'responses')x)<>jsonb_array_length(proof->'responses') then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
 for response in select * from jsonb_array_elements(proof->'responses') loop
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
  if row is distinct from vnext_runtime.daily_ai_financial_latest_v3(rows,addition->>'symbol',(response->>'received_at')::timestamptz) then raise exception 'AI_INTAKE_FINANCIAL_ROW';end if;
  if kind='EPS_AS_REPORTED' and source=allowed_sources[3] then
   select x into prior_response from jsonb_array_elements(proof->'responses')x where x->>'source'=allowed_sources[1] and x->>'state'='CAPTURED';
   if prior_response is not null and vnext_runtime.daily_ai_financial_latest_v3((prior_response->>'response_text')::jsonb,addition->>'symbol',(prior_response->>'received_at')::timestamptz) is not null then raise exception 'AI_INTAKE_FINANCIAL_PRIORITY';end if;
  end if;
  expected:=vnext_runtime.daily_ai_financial_body_v3(addition->>'symbol',kind,row,response,encode(sha256(convert_to(addition->>'row_text','UTF8')),'hex'));
  hash:=encode(sha256(convert_to(addition->>'body_text','UTF8')),'hex');
  if expected is null or body is distinct from expected or addition->>'fact_id' is distinct from 'official-open-api:'||(addition->>'symbol')||':'||kind||':'||(body->>'period')||':'||hash then raise exception 'AI_INTAKE_FINANCIAL_MAPPING';end if;
  fact:=body||jsonb_build_object('id',addition->>'fact_id','evidence_hash',hash);fresh:=fresh||jsonb_build_array(fact);
 end loop;
 for stock in select * from jsonb_array_elements(p_base_inputs) loop
  select x into strict incoming from jsonb_array_elements(p_inputs)x where x->>'symbol'=stock->>'symbol';kept:='[]';
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
end $$;
revoke all on function vnext_runtime.validate_daily_ai_financial_refresh_v3(jsonb,jsonb,jsonb,timestamptz,date) from public,anon,authenticated,service_role;

create or replace function vnext_runtime.daily_stock_ai_intake_view_v1(p_id uuid,p_state text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema','DAILY_AI_INTAKE_SOURCE_V1','state',p_state,'intake_id',q.id,'lease',q.lease,
  'business_date',q.business_date,'requested_at',to_char(q.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'projection','DAILY_AI_RETAINED_INPUT_PROJECTION_V1','source_kind',q.source_kind,'source_id',q.source_id,
  'source_revision',q.source_revision,'source_cutoff',q.source_cutoff,'source_business_date',q.source_business_date,'snapshot_hash',q.snapshot_hash,
  'companies',q.companies,'inputs',case when q.state in('SOURCED','COMPLETE') then q.inputs else q.base_inputs end,
  'source_issues',q.source_issues,'cutoff',q.cutoff_text,'news',coalesce(q.news,'[]'::jsonb),'market',q.market,'financial_refresh',case when q.financial_refresh is null then null else jsonb_build_object(
   'schema','DAILY_AI_FINANCIAL_RECEIPT_SUMMARY_V1','observed_at',q.financial_refresh->>'observed_at',
   'responses',(select coalesce(jsonb_agg(r-'response_text'),'[]') from jsonb_array_elements(q.financial_refresh->'responses')r),
   'additions',jsonb_array_length(q.financial_refresh->'additions'),'removals',jsonb_array_length(q.financial_refresh->'removals'),
   'proof_hash',encode(sha256(convert_to(q.financial_refresh::text,'UTF8')),'hex'))end,
  'intake_gaps',q.intake_gaps,'gaps_by_symbol',q.gaps_by_symbol,'member_published',false)
 from vnext_runtime.ai_stock_intakes q where q.id=p_id;
$$;
revoke all on function vnext_runtime.daily_stock_ai_intake_view_v1(uuid,text) from public,anon,authenticated,service_role;

create or replace function vnext_runtime.seal_daily_stock_ai_intake_v1() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.state='COMPLETE' then raise exception 'AI_INTAKE_IMMUTABLE';end if;
 if tg_op='UPDATE' and old.state='SOURCED' and new.state='COMPLETE'
  and not vnext_runtime.validate_daily_ai_market_v1(new.market,new.cutoff,new.business_date) then raise exception 'AI_INTAKE_MARKET_POLICY';end if;
 if tg_op='UPDATE' and old.state='SOURCED' and new.state='COMPLETE' and exists(
  select from jsonb_array_elements(new.inputs)i,jsonb_array_elements(i->'facts')f
   where vnext_runtime.daily_ai_financial_restricted_v3(f->>'source')) then raise exception 'AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE';end if;
 if old.state='SOURCED' and (tg_op='DELETE' or new.state<>'COMPLETE'
  or (to_jsonb(new)-array['state','batch_id','updated_at']) is distinct from (to_jsonb(old)-array['state','batch_id','updated_at']))
  then raise exception 'AI_INTAKE_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function vnext_runtime.seal_daily_stock_ai_intake_v1() from public,anon,authenticated,service_role;

-- Replace the old signature atomically, avoiding ambiguous PostgREST optional-argument overloads.
drop function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb);
create function public.daily_stock_ai_intake_v1(p_op text,p_intake_id uuid,p_lease uuid default null,
 p_inputs jsonb default null,p_gaps jsonb default null,p_batch_id text default null,p_code text default null,p_symbol_gaps jsonb default null,p_market jsonb default null,p_financial_refresh jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q vnext_runtime.ai_stock_intakes;prior vnext_runtime.ai_stock_intakes;r vnext_runtime.runs;
 base jsonb;dirs jsonb;companies jsonb;frozen jsonb;final_inputs jsonb;gaps jsonb;item jsonb;old_item jsonb;packet jsonb;ev jsonb;expected_company_ids jsonb;actual_company_ids jsonb;expected_market_ids jsonb;actual_market_ids jsonb;b vnext_runtime.ai_stock_batches;
 at_time timestamptz:=clock_timestamp();cutoff_value timestamptz;financial_proof jsonb;
begin
 if p_op is null or p_op not in('CLAIM','SOURCE','COMPLETE','FAIL') or p_intake_id is null then raise exception 'AI_INTAKE_SCOPE';end if;
 select * into strict q from vnext_runtime.ai_stock_intakes where id=p_intake_id for update;
 if q.state='COMPLETE' then
  if p_op='COMPLETE' and p_batch_id is distinct from q.batch_id then raise exception 'AI_INTAKE_BATCH_CONFLICT';end if;
  return jsonb_build_object('state','CACHED','intake_id',q.id,'batch_id',q.batch_id,'member_published',false);
 end if;
 if p_op='CLAIM' then
  if q.state='SOURCED' then return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'SOURCED');end if;
  if q.business_date<>(at_time at time zone 'Asia/Taipei')::date then return jsonb_build_object('state','EXPIRED','intake_id',q.id,'member_published',false);end if;
  if q.state='RUNNING' and q.lease_until>at_time then return jsonb_build_object('state','BUSY','intake_id',q.id,'member_published',false);end if;
  if q.attempts>=3 then return jsonb_build_object('state','EXHAUSTED','intake_id',q.id,'member_published',false);end if;
  if q.base_inputs is null then
   select * into prior from vnext_runtime.ai_stock_intakes where id<>q.id and state in('SOURCED','COMPLETE')
    and cutoff<=at_time and business_date<q.business_date order by cutoff desc limit 1;
   select * into r from vnext_runtime.runs where source_revision ~ '^[a-f0-9]{64}$'
    and checkpoint->'acquired'->>'snapshot_hash'=source_revision and jsonb_typeof(checkpoint->'acquired'->'inputs')='array'
    and jsonb_array_length(checkpoint->'acquired'->'inputs')=72
    and (checkpoint->'acquired'->>'evidence_cutoff')::timestamptz<=at_time order by business_date desc,updated_at desc limit 1;
   if prior.id is not null and (r.id is null or prior.cutoff>=(r.checkpoint->'acquired'->>'evidence_cutoff')::timestamptz) then
    q.source_kind:='ASOF_INTAKE';q.source_id:=prior.id;q.source_revision:=prior.snapshot_hash;
    q.source_cutoff:=prior.cutoff_text;q.source_business_date:=prior.business_date;
    base:=vnext_runtime.project_daily_stock_ai_inputs_v1(prior.inputs);companies:=prior.companies;q.source_issues:=prior.source_issues;
   elsif r.id is not null then
    q.source_kind:='VNEXT_ACQUIRED';q.source_id:=r.id;q.source_revision:=r.source_revision;
    q.source_cutoff:=r.checkpoint->'acquired'->>'evidence_cutoff';q.source_business_date:=r.business_date;
    base:=vnext_runtime.project_daily_stock_ai_inputs_v1(r.checkpoint->'acquired'->'inputs');
    q.source_issues:=coalesce(r.checkpoint->'acquired'->'source_issues','[]'::jsonb);
    select coalesce(jsonb_agg(x),'[]'::jsonb) into dirs from vnext_runtime.run_sources rs
     join vnext_runtime.source_revisions sr on sr.id=rs.source_id,
     lateral jsonb_array_elements(sr.receipt->'payload'->'rows')x
     where rs.run_id=r.id and sr.receipt->'task'->>'kind'='DIRECTORY' and sr.receipt->>'status'='OK';
    select jsonb_agg(jsonb_build_object('symbol',i->>'symbol','company',i->>'company','exchange',d.exchange) order by i->>'symbol') into companies
     from jsonb_array_elements(base)i cross join lateral(select min(x->>'exchange') exchange from jsonb_array_elements(dirs)x
      where x->>'symbol'=i->>'symbol' having count(distinct x->>'exchange')=1 and min(x->>'exchange') in('TWSE','TPEX'))d;
   else return jsonb_build_object('state','SOURCE_UNAVAILABLE','intake_id',q.id,'member_published',false);end if;
   if jsonb_array_length(companies) is distinct from 72 or (select count(distinct x->>'symbol') from jsonb_array_elements(base)x)<>72 then raise exception 'AI_INTAKE_BASE_UNIVERSE';end if;
   q.base_inputs:=base;q.companies:=companies;
  end if;
  update vnext_runtime.ai_stock_intakes set state='RUNNING',attempts=attempts+1,lease=gen_random_uuid(),lease_until=at_time+interval '120 seconds',
   source_kind=q.source_kind,source_id=q.source_id,source_revision=q.source_revision,source_cutoff=q.source_cutoff,source_business_date=q.source_business_date,
   base_inputs=q.base_inputs,companies=q.companies,source_issues=q.source_issues,intake_gaps='["RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED","FINANCIAL_DATA_RETAINED_NOT_REFRESHED","INSTITUTIONAL_FLOW_NOT_REFRESHED","CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY"]',
   last_code=null,updated_at=at_time where id=q.id;
  return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'ACQUIRED');
 end if;
 if p_lease is null or p_lease is distinct from q.lease then raise exception 'AI_INTAKE_LEASE';end if;
 if p_op='COMPLETE' then
  if q.state<>'SOURCED' or p_batch_id is null then raise exception 'AI_INTAKE_NOT_SOURCED';end if;
  select * into strict b from vnext_runtime.ai_stock_batches where id=p_batch_id;
  if b.cutoff<>q.cutoff or jsonb_array_length(b.payload->'packets')<>72 or b.payload->>'through' is distinct from q.inputs->0->>'through'
   or b.payload->'source_handoff' is not null
   or b.payload->'source_intake' is distinct from jsonb_build_object('intake_id',q.id,'snapshot_hash',q.snapshot_hash,
    'source_kind',q.source_kind,'source_id',q.source_id,'source_revision',q.source_revision,'source_cutoff',q.source_cutoff,
    'source_business_date',q.source_business_date,'projection','DAILY_AI_RETAINED_INPUT_PROJECTION_V1')
   or exists(select from jsonb_array_elements(b.payload->'packets')p where not exists(select from jsonb_array_elements(q.inputs)i
    where i->>'symbol'=p->>'symbol' and i->>'company'=p->>'company' and i->>'cutoff'=p->>'cutoff')) then raise exception 'AI_INTAKE_BATCH_CONFLICT';end if;
  for packet in select * from jsonb_array_elements(b.payload->'packets') loop
   select i into strict item from jsonb_array_elements(q.inputs)i where i->>'symbol'=packet->>'symbol';
   if jsonb_typeof(packet->'data_gaps') is distinct from 'array' or not(packet->'data_gaps' @> q.intake_gaps)
    or not(packet->'data_gaps' @> coalesce(q.gaps_by_symbol->(packet->>'symbol'),'[]'::jsonb)) then raise exception 'AI_INTAKE_GAPS_OMITTED';end if;
   -- Projection facts are already in the compiler's bounded kind/period order.
   -- Match its last20 session bars + facts, with the same84 company-row cap.
   with observations as(
    select (item->>'symbol')||':PRICE:'||(bar->>'id') eid,session.ordinality rank
     from jsonb_array_elements_text(item->'expected_sessions') with ordinality session(date,ordinality),jsonb_array_elements(item->'bars')bar
     where bar->>'date'=session.date and session.ordinality>greatest(jsonb_array_length(item->'expected_sessions')-20,0)
    union all select (item->>'symbol')||':FINANCIAL:'||(fact.value->>'id'),1000+fact.ordinality
     from jsonb_array_elements(item->'facts') with ordinality fact(value,ordinality)
   ),selected as(select eid from observations order by rank limit 84)
   select coalesce(jsonb_agg(eid order by eid),'[]') into expected_company_ids from selected;
   select coalesce(jsonb_agg(e->>'id' order by e->>'id'),'[]') into actual_company_ids from jsonb_array_elements(packet->'evidence')e where e->>'kind' in('PRICE','FINANCIAL');
   if actual_company_ids is distinct from expected_company_ids then raise exception 'AI_INTAKE_EVIDENCE_CONFLICT';end if;
   select coalesce(jsonb_agg(m->>'id' order by m->>'id'),'[]') into expected_market_ids from jsonb_array_elements(q.market)m;
   select coalesce(jsonb_agg(m->>'id' order by m->>'id'),'[]') into actual_market_ids from jsonb_array_elements(packet->'evidence')m where m->>'kind'='MARKET';
   if actual_market_ids is distinct from expected_market_ids then raise exception 'AI_INTAKE_EVIDENCE_CONFLICT';end if;
   for ev in select * from jsonb_array_elements(packet->'evidence') loop
    if ev->>'kind'='NEWS' then
     if not exists(select from jsonb_array_elements(q.news)n where n=ev and (n->'symbol'='null'::jsonb or n->>'symbol'=packet->>'symbol')) then raise exception 'AI_INTAKE_EVIDENCE_CONFLICT';end if;
    elsif ev->>'kind'='MARKET' then
     if not exists(select from jsonb_array_elements(q.market)m where m=ev) then raise exception 'AI_INTAKE_EVIDENCE_CONFLICT';end if;
    elsif not vnext_runtime.daily_ai_intake_company_evidence_v1(ev,item) then raise exception 'AI_INTAKE_EVIDENCE_CONFLICT';end if;
   end loop;
  end loop;
  update vnext_runtime.ai_stock_intakes set state='COMPLETE',batch_id=b.id,updated_at=clock_timestamp() where id=q.id;
  return jsonb_build_object('state','COMPLETE','intake_id',q.id,'batch_id',b.id,'member_published',false);
 end if;
 if q.state='SOURCED' and p_op='SOURCE' then return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'SOURCED');end if;
 if q.state<>'RUNNING' or q.lease_until<=at_time then raise exception 'AI_INTAKE_LEASE';end if;
 if p_op='FAIL' then
  if p_code is null or p_code !~ '^AI_INTAKE_[A-Z0-9_]{1,80}$' then raise exception 'AI_INTAKE_CODE';end if;
  update vnext_runtime.ai_stock_intakes set state='FAILED',last_code=p_code,lease_until=at_time,updated_at=at_time where id=q.id;
  return jsonb_build_object('state','FAILED','intake_id',q.id,'member_published',false);
 end if;
 if jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72 or octet_length(p_inputs::text)>8000000
  or (select count(distinct x->>'symbol') from jsonb_array_elements(p_inputs)x)<>72
  or jsonb_typeof(coalesce(p_gaps,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_gaps,'[]'::jsonb))>30
  or exists(select from jsonb_array_elements(coalesce(p_gaps,'[]'::jsonb))g where jsonb_typeof(g)<>'string' or (g#>>'{}') !~ '^[A-Z][A-Z0-9_]{0,99}$')
  or jsonb_typeof(coalesce(p_symbol_gaps,'{}'::jsonb))<>'object' then raise exception 'AI_INTAKE_INPUTS';end if;
 if p_symbol_gaps is not null and p_symbol_gaps<>'{}'::jsonb and ((select count(*) from jsonb_object_keys(p_symbol_gaps))<>72
  or exists(select from jsonb_each(p_symbol_gaps)sg where not exists(select from jsonb_array_elements(q.base_inputs)i where i->>'symbol'=sg.key)
   or jsonb_typeof(sg.value)<>'array' or jsonb_array_length(sg.value)>20 or exists(select from jsonb_array_elements(sg.value)g
    where jsonb_typeof(g)<>'string' or (g#>>'{}') !~ '^[A-Z][A-Z0-9_]{0,99}$'))) then raise exception 'AI_INTAKE_SYMBOL_GAPS';end if;
 for item in select * from jsonb_array_elements(p_inputs) loop
  select x into strict old_item from jsonb_array_elements(q.base_inputs)x where x->>'symbol'=item->>'symbol';
  if item->>'company' is distinct from old_item->>'company'
   or coalesce(item->>'through','') !~ '^\d{4}-\d\d-\d\d$' or item->>'through'<old_item->>'through' or item->>'through'>(q.business_date::text)
   or jsonb_typeof(item->'expected_sessions') is distinct from 'array' or jsonb_array_length(item->'expected_sessions')>250
   or jsonb_typeof(item->'bars') is distinct from 'array' or jsonb_array_length(item->'bars')>250
   or exists(select from jsonb_array_elements(old_item->'bars')ob where item->'expected_sessions' ? (ob->>'date')
    and not exists(select from jsonb_array_elements(item->'bars')nb where nb=ob)) then raise exception 'AI_INTAKE_RETAINED_BYTES';end if;
 end loop;
 if (select count(distinct i->>'through') from jsonb_array_elements(p_inputs)i)<>1 then raise exception 'AI_INTAKE_THROUGH';end if;
 frozen:=vnext_runtime.freeze_daily_stock_ai_news_v1(p_inputs);cutoff_value:=(frozen->>'cutoff')::timestamptz;
 if (cutoff_value at time zone 'Asia/Taipei')::date<>q.business_date then raise exception 'AI_INTAKE_DATE_EXPIRED';end if;
 financial_proof:=vnext_runtime.validate_daily_ai_financial_refresh_v3(q.base_inputs,p_inputs,p_financial_refresh,cutoff_value,q.business_date);
 if not vnext_runtime.validate_daily_ai_market_v1(coalesce(p_market,'[]'::jsonb),cutoff_value,q.business_date) then raise exception 'AI_INTAKE_MARKET';end if;
 if exists(select from jsonb_array_elements(p_inputs)i,jsonb_array_elements((i->'bars')||(i->'facts'))tr
  where tr->>'available_at' is null or not isfinite((tr->>'available_at')::timestamptz) or (tr->>'available_at')::timestamptz>cutoff_value)
  then raise exception 'AI_INTAKE_FUTURE_RECEIPT';end if;
 select jsonb_agg(i||jsonb_build_object('cutoff',frozen->>'cutoff') order by i->>'symbol') into final_inputs from jsonb_array_elements(p_inputs)i;
 final_inputs:=vnext_runtime.project_daily_stock_ai_inputs_v1(final_inputs);
 select jsonb_agg(to_jsonb(code) order by code) into gaps from(select distinct value#>>'{}' code from jsonb_array_elements(q.intake_gaps||coalesce(p_gaps,'[]'::jsonb)||
  '["NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE","NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS","NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES","NEWS_COMPANY_ASSOCIATION_REQUIRES_VERIFICATION"]'::jsonb||
  case when jsonb_array_length(coalesce(p_market,'[]'::jsonb))=0 then '["MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE"]'::jsonb else '[]'::jsonb end||
  case when jsonb_array_length(frozen->'news')=0 then '["NEWS_NONE_AVAILABLE_WITHIN_48H"]'::jsonb else '[]'::jsonb end))all_gaps;
 update vnext_runtime.ai_stock_intakes set state='SOURCED',financial_refresh=financial_proof,inputs=final_inputs,news=frozen->'news',market=coalesce(p_market,'[]'::jsonb),cutoff=cutoff_value,cutoff_text=frozen->>'cutoff',intake_gaps=gaps,
  gaps_by_symbol=coalesce(p_symbol_gaps,'{}'::jsonb),snapshot_hash=encode(sha256(convert_to(jsonb_build_object(
   'schema','DAILY_AI_INTAKE_SNAPSHOT_V1','financial_refresh',financial_proof,'inputs',final_inputs,'news',frozen->'news','market',coalesce(p_market,'[]'::jsonb),'cutoff',frozen->>'cutoff',
   'intake_gaps',gaps,'gaps_by_symbol',coalesce(p_symbol_gaps,'{}'::jsonb),'source_issues',q.source_issues,
   'source_kind',q.source_kind,'source_id',q.source_id,'source_revision',q.source_revision,'source_cutoff',q.source_cutoff)::text,'UTF8')),'hex'),updated_at=clock_timestamp() where id=q.id;
 return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'SOURCED');
end $$;
revoke all on function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb) to service_role;
commit;
