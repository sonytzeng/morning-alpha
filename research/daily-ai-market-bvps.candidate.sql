-- LOCAL CANDIDATE. Independently validate reported BVPS / peer-derived P/B.
-- This adds no review, source license, price plan, approval or publication.
-- Install after action-evidence-id, reference-chunks and reference-capacity.
begin;
do $$begin
 if to_regprocedure('vnext_market.price_validate_raw_binding_v2(text,timestamptz,text,jsonb)') is null
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.validate_action_evidence(jsonb,text,text)'))
    is distinct from 'ca53ecd8cd502a4255b7c46602460fd0'
  or to_regclass('vnext_market.bvps_verified_inputs') is not null
  then raise exception 'MARKET_BVPS_BASELINE';end if;
end $$;

-- A plan/cutoff and exact input hash are part of every cache key. Only the
-- private validators below can insert after checking retained originals.
create table vnext_market.bvps_verified_inputs(
 plan_id text not null references vnext_market.work_plans(id),
 validation_kind text not null check(validation_kind in('OBSERVATION','ACTIONS','QUALITY')),
 security_id text not null,subject_hash text not null check(subject_hash~'^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(plan_id,validation_kind,security_id,subject_hash)
);
alter table vnext_market.bvps_verified_inputs enable row level security;
alter table vnext_market.bvps_verified_inputs force row level security;
revoke all on table vnext_market.bvps_verified_inputs from public,anon,authenticated,service_role;
create trigger market_bvps_verified_immutable before update or delete on vnext_market.bvps_verified_inputs
 for each row execute function vnext_market.immutable();
create table vnext_market.bvps_reference_packet_bindings(
 plan_id text not null references vnext_market.work_plans(id),security_id text not null,
 horizon text not null check(horizon in('MEDIUM','LONG')),reference_hash text not null check(reference_hash~'^[a-f0-9]{64}$'),
 body jsonb not null,recorded_at timestamptz not null default clock_timestamp(),primary key(plan_id,security_id,horizon)
);
alter table vnext_market.bvps_reference_packet_bindings enable row level security;
alter table vnext_market.bvps_reference_packet_bindings force row level security;
revoke all on table vnext_market.bvps_reference_packet_bindings from public,anon,authenticated,service_role;
create trigger market_bvps_packet_binding_immutable before update or delete on vnext_market.bvps_reference_packet_bindings
 for each row execute function vnext_market.immutable();

create function vnext_market.bvps_number(p_text text) returns numeric
language plpgsql immutable set search_path='' as $$
declare s text:=btrim(p_text);n numeric;begin
 if s is null or s in('','--','---','-','N/A','NA','不適用') then return null;end if;
 if s~'^\([0-9,.]+\)$' then s:='-'||substr(s,2,length(s)-2);end if;
 if s!~'^[+-]?([0-9]+|[0-9]{1,3}(,[0-9]{3})+)(\.[0-9]+)?$' then return null;end if;
 n:=replace(s,',','')::numeric;if abs(n)>9007199254740991 then return null;end if;return n;
end $$;
create function vnext_market.bvps_near(p_value jsonb,p_expected numeric) returns boolean
language sql immutable set search_path='' as $$
 select case when p_expected is null then p_value='null'::jsonb
  when jsonb_typeof(p_value)='number' then abs((p_value#>>'{}')::numeric-p_expected)<=0.000000001*greatest(1,abs(p_expected))
  else false end
$$;
create function vnext_market.bvps_field(p_header jsonb,p_row jsonb,p_names text[]) returns text
language plpgsql immutable set search_path='' as $$
declare n text;idx integer;hits integer;begin
 foreach n in array p_names loop
  select count(*)::integer,min(ord-1)::integer into hits,idx from jsonb_array_elements_text(p_header) with ordinality t(name,ord)
   where regexp_replace(name,'\s','','g')=regexp_replace(n,'\s','','g');
  if hits>1 then raise exception 'MARKET_BVPS_DUPLICATE_FIELD';end if;
  if hits=1 then return p_row->>idx;end if;
 end loop;return null;
end $$;

create function vnext_market.bvps_financial_row(p_plan_id text,p_security_id text,p_binding jsonb,p_family text,p_period text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p record;c record;raw_row jsonb;header jsonb;fields jsonb;receipt jsonb;meta record;year_number integer;quarter_number integer;period_end date;
begin
 if p_family not in('INCOME','BALANCE','CASHFLOW') or coalesce(p_period,'')!~'^20[0-9]{2}Q[1-4]$'
  or p_binding->>'symbol_field' is distinct from '3' or jsonb_array_length(p_binding->'row_path') is distinct from 1
  or (p_binding->>'row_index')::integer<1 then raise exception 'MARKET_BVPS_FINANCIAL_SCOPE';end if;
 select universe_id,cutoff into strict p from vnext_market.work_plans where id=p_plan_id;
 select market,symbol into strict c from vnext_market.companies where universe_id=p.universe_id and security_id=p_security_id;
 perform vnext_market.price_validate_raw_binding_v2(p.universe_id,p.cutoff,p_security_id,p_binding);
 select * into strict meta from vnext_market.source_metadata(p_binding->>'capture_id');
 select x.receipt into strict receipt from vnext_market.captures x join vnext_market.encoded_origins o on o.capture_id=x.id where x.id=meta.id;
 if c.market<>'TPEX' or meta.source_id!~('^MOPS_'||p_family||'_TPEX_'||p_period||'_CSV_[0-9]{8}_[0-9]{6,12}$')
  or p_binding->>'encoding' is distinct from 'CP950' or p_binding->>'decoded_text_sha256' is distinct from receipt->>'decoded_text_sha256'
  or p_binding->>'parent_html_sha256' is distinct from receipt->>'parent_html_sha256'
  or p_binding->>'csv_filename' is distinct from receipt->'request_form'->>'filename'
  then raise exception 'MARKET_BVPS_FINANCIAL_SOURCE';end if;
 select row_body into strict raw_row from vnext_market.capture_rows where capture_id=meta.id and row_path=array[p_binding->>'row_index'];
 select row_body into strict header from vnext_market.capture_rows where capture_id=meta.id and row_path=array['0'];
 year_number:=left(p_period,4)::integer;quarter_number:=right(p_period,1)::integer;
 period_end:=(make_date(year_number,quarter_number*3,1)+interval'1 month'-interval'1 day')::date;
 if p_binding->>'header_row_hash' is distinct from vnext_market.hash(header)
  or header->>1 is distinct from '年度' or header->>2 is distinct from '季別' or header->>3 is distinct from '公司代號'
  or btrim(raw_row->>1) is distinct from (year_number-1911)::text or btrim(raw_row->>2) is distinct from quarter_number::text
  or btrim(raw_row->>3) is distinct from c.symbol
  or meta.received_at<(period_end::text||'T23:59:59+08:00')::timestamptz
  or (select count(distinct name) from jsonb_array_elements_text(header)name)<>jsonb_array_length(header)
  then raise exception 'MARKET_BVPS_FINANCIAL_PERIOD';end if;
 select jsonb_object_agg(name,raw_row->(ord-1)::integer) into fields
  from jsonb_array_elements_text(header) with ordinality t(name,ord) where ord>=4;
 return jsonb_build_object('header',header,'row',raw_row,'fields',fields);
end $$;

create function vnext_market.bvps_validate_observation(p_plan_id text,p_security_id text,p_observation jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare p record;balance jsonb;record_body jsonb;quote_binding jsonb;balance_binding jsonb;raw_quote jsonb;header jsonb;
 cap record;path text[];quote_day date;period_end date;raw_bvps text;raw_price numeric;bvps numeric;h text:=vnext_market.hash(p_observation);s text;
begin
 if exists(select from vnext_market.bvps_verified_inputs where plan_id=p_plan_id and validation_kind='OBSERVATION' and security_id=p_security_id and subject_hash=h) then return;end if;
 if not coalesce(vnext_market.exact(p_observation,array['quote_date','current_price','financial_period','financial_period_end','reported_bvps','reported_bvps_raw','derived_pb','source_captures','balance_record','balance_record_hash']),false)
  or not coalesce(vnext_market.exact(p_observation->'source_captures',array['quote','balance']),false)
  or coalesce(p_observation->>'quote_date','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
  or coalesce(p_observation->>'financial_period','')!~'^20[0-9]{2}Q[1-4]$' then raise exception 'MARKET_BVPS_OBSERVATION_SCOPE';end if;
 select universe_id,cutoff,business_date into strict p from vnext_market.work_plans where id=p_plan_id;
 balance_binding:=p_observation->'source_captures'->'balance';quote_binding:=p_observation->'source_captures'->'quote';
 balance:=vnext_market.bvps_financial_row(p_plan_id,p_security_id,balance_binding,'BALANCE',p_observation->>'financial_period');
 raw_bvps:=vnext_market.bvps_field(balance->'header',balance->'row',array['每股參考淨值']);bvps:=vnext_market.bvps_number(raw_bvps);
 record_body:=p_observation->'balance_record';
 if jsonb_typeof(record_body) is distinct from 'object' or record_body->>'record_hash' is distinct from vnext_market.hash(record_body-'record_hash')
  or p_observation->>'balance_record_hash' is distinct from record_body->>'record_hash'
  or record_body->>'security_id' is distinct from p_security_id or record_body->>'market' is distinct from 'TPEX'
  or record_body->>'symbol' is distinct from split_part(p_security_id,':',2) or record_body->>'family' is distinct from 'BALANCE'
  or record_body->>'period' is distinct from p_observation->>'financial_period'
  or record_body->>'period_basis' is distinct from 'POINT_IN_TIME_AS_REPORTED' or record_body->>'period_scope' is distinct from 'POINT_IN_TIME'
  or record_body->>'period_identity_basis' is distinct from 'CSV_RESPONSE_YEAR_QUARTER_MATCHED_PARENT_REQUEST'
  or record_body->>'amount_unit' is distinct from 'TWD_THOUSANDS' or record_body->>'amount_unit_basis' is distinct from 'MATCHED_PARENT_HTML_EXPLICIT_UNIT'
  or record_body->'fields' is distinct from balance->'fields' or record_body->'source_capture' is distinct from balance_binding
  or record_body->'source_cells_matched_parent_html' is distinct from 'true'::jsonb
  or record_body->>'source_url' is distinct from balance_binding->>'source_url'
  or record_body->>'available_at' is distinct from balance_binding->>'received_at' or record_body->>'first_seen_at' is distinct from balance_binding->>'received_at'
  or record_body->'published_at' is distinct from 'null'::jsonb
  or coalesce(record_body->'field_units'->>'每股參考淨值','') not in('PER_SHARE_UNIT_NOT_EXPLICIT','TWD_PER_SHARE')
  or record_body->'forecast' is distinct from 'false'::jsonb or record_body->'fcfe_inferred' is distinct from 'false'::jsonb
  or bvps is null or bvps<=0 or p_observation->>'reported_bvps_raw' is distinct from raw_bvps
  or p_observation->'reported_bvps' is distinct from to_jsonb(bvps)
  then raise exception 'MARKET_BVPS_BALANCE_VALUE';end if;
 period_end:=(make_date(left(p_observation->>'financial_period',4)::integer,right(p_observation->>'financial_period',1)::integer*3,1)+interval'1 month'-interval'1 day')::date;
 quote_day:=(p_observation->>'quote_date')::date;
 if p_observation->>'financial_period_end' is distinct from period_end::text or period_end>quote_day or quote_day-period_end>180 or quote_day>p.business_date
  or (balance_binding->>'received_at')::timestamptz<(period_end::text||'T23:59:59+08:00')::timestamptz
  or (quote_binding->>'received_at')::timestamptz<(quote_day::text||'T13:30:00+08:00')::timestamptz
  or (quote_day::text||'T13:30:00+08:00')::timestamptz>p.cutoff then raise exception 'MARKET_BVPS_OBSERVATION_DATE';end if;
 perform vnext_market.price_validate_raw_binding_v2(p.universe_id,p.cutoff,p_security_id,quote_binding);
 select source_id,parsed into strict cap from vnext_market.captures where id=quote_binding->>'capture_id';
 path:=array(select x#>>'{}' from jsonb_array_elements(quote_binding->'row_path')x);
 select row_body into strict raw_quote from vnext_market.capture_rows where capture_id=quote_binding->>'capture_id' and row_path=path;
 if cap.source_id='tpex_prices' then
  if jsonb_typeof(raw_quote) is distinct from 'object' or quote_binding->>'symbol_field' is distinct from 'SecuritiesCompanyCode' then raise exception 'MARKET_BVPS_QUOTE_LAYOUT';end if;
  s:=btrim(raw_quote->>'Date');
  if s~'^[0-9]{7}$' then s:=(left(s,3)::integer+1911)::text||'-'||substr(s,4,2)||'-'||right(s,2);
  elsif s~'^[0-9]{8}$' then s:=left(s,4)||'-'||substr(s,5,2)||'-'||right(s,2);
  else raise exception 'MARKET_BVPS_QUOTE_DATE';end if;
  if s::date is distinct from quote_day then raise exception 'MARKET_BVPS_QUOTE_DATE';end if;
  raw_price:=vnext_market.bvps_number(raw_quote->>'Close');
 elsif cap.source_id='TPEX_DAILY_'||to_char(quote_day,'YYYYMMDD') then
  if cardinality(path)<>4 or path[1]<>'tables' or path[2]<>'0' or path[3]<>'data'
   or quote_binding->>'symbol_field' is distinct from '0' or cap.parsed->>'date' is distinct from to_char(quote_day,'YYYYMMDD')
   or cap.parsed->>'stat' is distinct from 'ok' then raise exception 'MARKET_BVPS_QUOTE_LAYOUT';end if;
  header:=cap.parsed#>'{tables,0,fields}';raw_price:=vnext_market.bvps_number(vnext_market.bvps_field(header,raw_quote,array['收盤']));
 else raise exception 'MARKET_BVPS_QUOTE_SOURCE';end if;
 if raw_price is null or raw_price<=0 or p_observation->'current_price' is distinct from to_jsonb(raw_price)
  or not coalesce(vnext_market.bvps_near(p_observation->'derived_pb',raw_price/bvps),false) then raise exception 'MARKET_BVPS_QUOTE_VALUE';end if;
 insert into vnext_market.bvps_verified_inputs(plan_id,validation_kind,security_id,subject_hash) values(p_plan_id,'OBSERVATION',p_security_id,h) on conflict do nothing;
end $$;

create function vnext_market.bvps_validate_actions(p_plan_id text,p_security_id text,p_proof jsonb,p_from date,p_through date) returns void
language plpgsql security definer set search_path='' as $$
declare h text:=vnext_market.hash(jsonb_build_object('proof',p_proof,'from',p_from,'through',p_through));e jsonb;d jsonb;
 hashes jsonb:='[]';docs jsonb:='[]';all_events jsonb:='[]';expected_cash jsonb;seen_until date:=p_from-1;start_day date;end_day date;latest_time timestamptz;
begin
 if exists(select from vnext_market.bvps_verified_inputs where plan_id=p_plan_id and validation_kind='ACTIONS' and security_id=p_security_id and subject_hash=h) then return;end if;
 if not coalesce(vnext_market.exact(p_proof,array['coverage_hashes','coverage_evidence','window_from','window_through','available_at','cash_dividend_events','share_change_events']),false)
  or p_proof->>'window_from' is distinct from p_from::text or p_proof->>'window_through' is distinct from p_through::text or p_from>p_through
  or jsonb_typeof(p_proof->'coverage_evidence') is distinct from 'array' or jsonb_array_length(p_proof->'coverage_evidence') not between 1 and 100
  or jsonb_typeof(p_proof->'coverage_hashes') is distinct from 'array' or p_proof->'share_change_events' is distinct from '[]'::jsonb
  then raise exception 'MARKET_BVPS_ACTION_SCOPE';end if;
 for e in select jsonb_array_elements(p_proof->'coverage_evidence') loop
  perform vnext_market.validate_action_evidence(e,p_security_id,p_plan_id);
  d:=(e->>'content')::jsonb;
  if d->'complete' is distinct from 'true'::jsonb or d->>'kind' is distinct from 'CORPORATE_ACTION_COVERAGE'
   or d->'issues' is distinct from '[]'::jsonb then raise exception 'MARKET_BVPS_ACTION_INCOMPLETE';end if;
  hashes:=hashes||jsonb_build_array(d->>'coverage_hash');docs:=docs||jsonb_build_array(d);all_events:=all_events||(d->'events');
  if latest_time is null or (e->>'available_at')::timestamptz>latest_time then latest_time:=(e->>'available_at')::timestamptz;end if;
 end loop;
 if hashes is distinct from p_proof->'coverage_hashes' or (select count(distinct x) from jsonb_array_elements(hashes)x)<>jsonb_array_length(hashes)
  or (p_proof->>'available_at')::timestamptz is distinct from latest_time then raise exception 'MARKET_BVPS_ACTION_BINDING';end if;
 for d in select x from jsonb_array_elements(docs)x order by x->>'from',x->>'through' loop
  start_day:=(d->>'from')::date;end_day:=(d->>'through')::date;
  if end_day<p_from or start_day>p_through then raise exception 'MARKET_BVPS_ACTION_UNUSED_COVERAGE';end if;
  if start_day>seen_until+1 then raise exception 'MARKET_BVPS_ACTION_WINDOW_GAP';end if;
  seen_until:=greatest(seen_until,end_day);
 end loop;
 if seen_until<p_through then raise exception 'MARKET_BVPS_ACTION_WINDOW_GAP';end if;
 if exists(select from jsonb_array_elements(all_events)x where (x->>'effective_date')::date>p_from and (x->>'effective_date')::date<=p_through
  and x->>'kind' in('STOCK_DIVIDEND','SPLIT','RIGHTS','CAPITAL_REDUCTION')) then raise exception 'MARKET_BVPS_SHARE_CHANGE';end if;
 select coalesce(jsonb_agg(value order by value->>'effective_date',value->>'event_id'),'[]'::jsonb) into expected_cash from
  (select distinct jsonb_build_object('event_id',x->>'event_id','effective_date',x->>'effective_date','source_capture',x->'source_capture') value
   from jsonb_array_elements(all_events)x where x->>'kind'='CASH_DIVIDEND' and (x->>'effective_date')::date>p_from and (x->>'effective_date')::date<=p_through)t;
 if p_proof->'cash_dividend_events' is distinct from expected_cash then raise exception 'MARKET_BVPS_CASH_EVENT_BINDING';end if;
 insert into vnext_market.bvps_verified_inputs(plan_id,validation_kind,security_id,subject_hash) values(p_plan_id,'ACTIONS',p_security_id,h) on conflict do nothing;
end $$;

create function vnext_market.bvps_validate_quality(p_plan_id text,p_security_id text,p_quality jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare h text:=vnext_market.hash(p_quality);cutoff_year integer;annual jsonb;income jsonb;balance jsonb;cashflow jsonb;
 n integer:=0;year_number integer;profit numeric;parent_profit numeric;equity numeric;assets numeric;ocf numeric;ocf_sum numeric:=0;positive_ocf integer:=0;
 opening numeric;closing numeric;change numeric;previous_closing numeric;within_year boolean;cross_year boolean;reconciliation jsonb;
 parent_reported integer:=0;parent_missing jsonb:='[]';
begin
 if exists(select from vnext_market.bvps_verified_inputs where plan_id=p_plan_id and validation_kind='QUALITY' and security_id=p_security_id and subject_hash=h) then return;end if;
 if not coalesce(vnext_market.exact(p_quality,array['eligible','reasons','annuals','operating_cashflow_sum','parent_profit_disclosure']),false)
  or p_quality->'eligible' is distinct from 'true'::jsonb or p_quality->'reasons' is distinct from '[]'::jsonb
  or jsonb_typeof(p_quality->'annuals') is distinct from 'array' or jsonb_array_length(p_quality->'annuals') is distinct from 3
  then raise exception 'MARKET_BVPS_QUALITY_SCOPE';end if;
 select extract(year from cutoff at time zone 'Asia/Taipei')::integer into strict cutoff_year from vnext_market.work_plans where id=p_plan_id;
 for annual in select jsonb_array_elements(p_quality->'annuals') loop
  year_number:=cutoff_year-3+n;n:=n+1;
  if annual->'year' is distinct from to_jsonb(year_number) or annual->'period_verified' is distinct from 'true'::jsonb
   or annual->'unit_verified' is distinct from 'true'::jsonb
   or not coalesce(vnext_market.exact(annual->'source_captures',array['income','balance','cashflow']),false) then raise exception 'MARKET_BVPS_QUALITY_PERIOD';end if;
  income:=vnext_market.bvps_financial_row(p_plan_id,p_security_id,annual->'source_captures'->'income','INCOME',year_number::text||'Q4');
  balance:=vnext_market.bvps_financial_row(p_plan_id,p_security_id,annual->'source_captures'->'balance','BALANCE',year_number::text||'Q4');
  cashflow:=vnext_market.bvps_financial_row(p_plan_id,p_security_id,annual->'source_captures'->'cashflow','CASHFLOW',year_number::text||'Q4');
  profit:=vnext_market.bvps_number(vnext_market.bvps_field(income->'header',income->'row',array['本期淨利（淨損）','本期淨利(淨損)','本期稅後淨利（淨損）']));
  parent_profit:=vnext_market.bvps_number(vnext_market.bvps_field(income->'header',income->'row',array['淨利（淨損）歸屬於母公司業主','淨利（損）歸屬於母公司業主']));
  equity:=vnext_market.bvps_number(vnext_market.bvps_field(balance->'header',balance->'row',array['權益總計','權益總額']));
  assets:=vnext_market.bvps_number(vnext_market.bvps_field(balance->'header',balance->'row',array['資產總計','資產總額']));
  ocf:=vnext_market.bvps_number(vnext_market.bvps_field(cashflow->'header',cashflow->'row',array['營業活動之淨現金流入（流出）','營業活動之淨現金流入(流出)','營業活動之淨現金流量']));
  if profit is null or profit<=0 or parent_profit<0 or equity is null or assets is null or equity<=0 or assets<equity or ocf is null
   or annual->'net_profit' is distinct from to_jsonb(profit) or annual->'parent_net_profit' is distinct from coalesce(to_jsonb(parent_profit),'null'::jsonb)
   or annual->'equity' is distinct from to_jsonb(equity) or annual->'assets' is distinct from to_jsonb(assets)
   or annual->'operating_cashflow' is distinct from to_jsonb(ocf) then raise exception 'MARKET_BVPS_QUALITY_RAW_VALUES';end if;
  opening:=vnext_market.bvps_number(vnext_market.bvps_field(cashflow->'header',cashflow->'row',array['期初現金及約當現金餘額']));
  closing:=vnext_market.bvps_number(vnext_market.bvps_field(cashflow->'header',cashflow->'row',array['期末現金及約當現金餘額']));
  change:=vnext_market.bvps_number(vnext_market.bvps_field(cashflow->'header',cashflow->'row',array['本期現金及約當現金增加（減少）數','本期現金及約當現金增加(減少)數']));
  within_year:=case when opening is null or change is null or closing is null then null else abs(opening+change-closing)<=2 end;
  cross_year:=case when opening is null or previous_closing is null then null else abs(opening-previous_closing)<=2 end;
  reconciliation:=jsonb_build_object('within_year',within_year,'opening_matches_previous_closing',cross_year,'tolerance_twd_thousands',2,
   'interpretation','MISMATCH_REQUIRES_RESTATEMENT_OR_RECLASSIFICATION_REVIEW_NOT_FRAUD_INFERENCE');
  if within_year=false or cross_year=false or annual->'cashflow_reconciliation' is distinct from reconciliation then raise exception 'MARKET_BVPS_QUALITY_CASH_RECONCILIATION';end if;
  previous_closing:=closing;ocf_sum:=ocf_sum+ocf;if ocf>0 then positive_ocf:=positive_ocf+1;end if;
  if parent_profit is null then parent_missing:=parent_missing||jsonb_build_array(year_number);else parent_reported:=parent_reported+1;end if;
 end loop;
 if positive_ocf<2 or ocf_sum<=0 or not coalesce(vnext_market.bvps_near(p_quality->'operating_cashflow_sum',ocf_sum),false)
  or p_quality->'parent_profit_disclosure' is distinct from jsonb_build_object('reported_years',parent_reported,'missing_years',parent_missing,'profit_filter_basis','CONSOLIDATED_NET_PROFIT_AS_REPORTED')
  then raise exception 'MARKET_BVPS_QUALITY_POLICY';end if;
 insert into vnext_market.bvps_verified_inputs(plan_id,validation_kind,security_id,subject_hash) values(p_plan_id,'QUALITY',p_security_id,h) on conflict do nothing;
end $$;

-- Main reference validator and guarded public entry-point extension follow.
-- Exact TW dates copied from market-calendar-data.json at the named version.
-- Unknown future dates fail closed; changing this calendar requires a new patch.
create function vnext_market.bvps_completed_session(p_cutoff timestamptz) returns date
language plpgsql immutable set search_path='' as $$
declare d date:=(p_cutoff at time zone 'Asia/Taipei')::date;n integer:=0;
 closed date[]:=array['2025-01-01','2025-01-23','2025-01-24','2025-01-27','2025-01-28','2025-01-29','2025-01-30','2025-01-31',
 '2025-02-28','2025-04-03','2025-04-04','2025-05-01','2025-05-30','2025-05-31','2025-09-28','2025-09-29','2025-10-06','2025-10-10',
 '2025-10-24','2025-10-25','2025-12-25','2026-01-01','2026-02-12','2026-02-13','2026-02-15','2026-02-16','2026-02-17','2026-02-18',
 '2026-02-19','2026-02-20','2026-02-27','2026-02-28','2026-04-03','2026-04-04','2026-04-05','2026-04-06','2026-05-01','2026-06-19',
 '2026-07-10','2026-09-25','2026-09-28','2026-10-09','2026-10-10','2026-10-23','2026-10-25','2026-10-26','2026-12-25']::date[];
begin
 if d not between date'2025-01-01' and date'2026-12-31' then return null;end if;
 if (p_cutoff at time zone 'Asia/Taipei')::time<time'17:05:00' then d:=d-1;end if;
 while n<30 loop
  if d<date'2025-01-01' then return null;end if;
  if extract(isodow from d) between 1 and 5 and not(d=any(closed)) then return d;end if;
  d:=d-1;n:=n+1;
 end loop;return null;
end $$;

create function vnext_market.bvps_validate_reference(p_reference jsonb,p_horizon text,p_plan_id text) returns void
language plpgsql security definer set search_path='' as $$
declare p record;c record;pc record;prior_binding record;r jsonb:=p_reference;peer jsonb;binding jsonb;observation jsonb;sid text;seen text[]:='{}';
 multiples numeric[]:='{}';ordered numeric[];n integer;idx integer;position numeric;q numeric;expected numeric;issuer_bvps numeric;expected_date date;
 unit_hash constant text:='05ef8a0a682599f8bca1b199afee4f6a3efedeee85ce177ad1a1b2bbf0958782';
 policy_hash constant text:='0f9dc529f09b32757f26141e0f8018e75c5b4664fa902efa13753c00ac8440c1';
 binding_keys constant text[]:=array['quote_date','current_price','financial_period','financial_period_end','reported_bvps','reported_bvps_raw','reported_bvps_field','derived_pb',
  'issuer_balance_record','issuer_balance_record_hash','issuer_source_captures','issuer_action_proof','issuer_quality','issuer_quality_hash','peer_count','peers','issuer_excluded_from_peer_sample','peer_quantiles'];
begin
 select universe_id,cutoff,business_date into strict p from vnext_market.work_plans where id=p_plan_id;
 select market,symbol,body into strict c from vnext_market.companies where universe_id=p.universe_id and security_id=r->>'security_id';
 expected_date:=vnext_market.bvps_completed_session(p.cutoff);
 if not coalesce(vnext_market.exact(r,array['schema','method_version','method','security_id','horizon','market','industry_code','cutoff','expected_quote_date','calendar_version','currency',
  'policy','policy_hash','unit_proof','unit_proof_hash','research_only','methodology_approved','production_eligible','buy_ready','member_published','forecast','performance_available',
  'review','source_use_review','range_meaning','limitations','quote_date','current_price','financial_period','financial_period_end','reported_bvps','reported_bvps_raw','reported_bvps_field','derived_pb',
  'issuer_balance_record','issuer_balance_record_hash','issuer_source_captures','issuer_action_proof','issuer_quality','issuer_quality_hash','peer_count','peers','issuer_excluded_from_peer_sample',
  'peer_quantiles','input_hash','state','metric','multiple_scenarios','price_scenarios','arithmetic','reference_hash']),false)
  or p_horizon not in('MEDIUM','LONG') or r->>'horizon' is distinct from p_horizon
  or r->>'schema' is distinct from 'TAIWAN_REPORTED_BVPS_PEER_REFERENCE_V1'
  or r->>'method_version' is distinct from 'TAIWAN_REPORTED_BVPS_PEER_V1'
  or r->>'method' is distinct from (case when p_horizon='MEDIUM' then 'CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB' else 'CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB' end)
  or c.market is distinct from 'TPEX' or r->>'market' is distinct from c.market
  or c.body->>'instrument_kind' is distinct from 'ORDINARY_COMPANY_EQUITY'
  or r->>'industry_code' is distinct from c.body->>'industry_code' or length(coalesce(r->>'industry_code',''))=0
  or (p_horizon='LONG' and r->>'industry_code'='17')
  or (r->>'cutoff')::timestamptz is distinct from p.cutoff or expected_date is null
  or r->>'calendar_version' is distinct from 'OFFICIAL_MARKET_CALENDAR_20261023_EXCEPTION_V1'
  or r->>'expected_quote_date' is distinct from expected_date::text or r->>'quote_date' is distinct from expected_date::text
  or r->>'currency' is distinct from 'TWD' or r->>'state' is distinct from 'CALCULATED_RESEARCH_ONLY' or r->>'metric' is distinct from 'DERIVED_PB'
  or r->>'policy_hash' is distinct from policy_hash or vnext_market.hash(r->'policy') is distinct from policy_hash
  or r->>'unit_proof_hash' is distinct from unit_hash or vnext_market.hash(r->'unit_proof') is distinct from unit_hash
  or r->>'reported_bvps_field' is distinct from '每股參考淨值'
  or r->'research_only' is distinct from 'true'::jsonb or r->'methodology_approved' is distinct from 'false'::jsonb
  or r->'production_eligible' is distinct from 'false'::jsonb or r->'buy_ready' is distinct from 'false'::jsonb
  or r->'member_published' is distinct from 'false'::jsonb or r->'forecast' is distinct from 'false'::jsonb or r->'performance_available' is distinct from 'false'::jsonb
  or r->'review' is distinct from 'null'::jsonb or r->'source_use_review' is distinct from 'null'::jsonb
  or r->'issuer_excluded_from_peer_sample' is distinct from 'true'::jsonb or r->'peer_quantiles' is distinct from '[0.25,0.5,0.75]'::jsonb
  or jsonb_typeof(r->'peers') is distinct from 'array' or jsonb_array_length(r->'peers') not between 5 and 10000
  or r->'peer_count' is distinct from to_jsonb(jsonb_array_length(r->'peers'))
  or jsonb_typeof(r->'multiple_scenarios') is distinct from 'array' or jsonb_array_length(r->'multiple_scenarios') is distinct from 3
  or r->'arithmetic' is distinct from jsonb_build_object('peer_pb','peer_current_close / peer_reported_bvps','price','issuer_reported_bvps * peer_derived_pb_quantile','rounding','NONE_RESEARCH_VALUES_NOT_ORDER_TICKS')
  then raise exception 'MARKET_BVPS_REFERENCE_SCOPE';end if;
 select jsonb_object_agg(k,r->k) into binding from unnest(binding_keys)k;
 if r->>'input_hash' is distinct from vnext_market.hash(jsonb_build_object('security_id',r->>'security_id','horizon',p_horizon,'cutoff',r->>'cutoff',
  'policy_hash',policy_hash,'unit_proof_hash',unit_hash)||binding) then raise exception 'MARKET_BVPS_INPUT_HASH';end if;
 observation:=jsonb_build_object('quote_date',r->'quote_date','current_price',r->'current_price','financial_period',r->'financial_period','financial_period_end',r->'financial_period_end',
  'reported_bvps',r->'reported_bvps','reported_bvps_raw',r->'reported_bvps_raw','derived_pb',r->'derived_pb','source_captures',r->'issuer_source_captures',
  'balance_record',r->'issuer_balance_record','balance_record_hash',r->'issuer_balance_record_hash');
 perform vnext_market.bvps_validate_observation(p_plan_id,r->>'security_id',observation);
 perform vnext_market.bvps_validate_actions(p_plan_id,r->>'security_id',r->'issuer_action_proof',(r->>'financial_period_end')::date,expected_date);
 if p_horizon='LONG' then
  if r->>'issuer_quality_hash' is distinct from vnext_market.hash(r->'issuer_quality') then raise exception 'MARKET_BVPS_QUALITY_HASH';end if;
  perform vnext_market.bvps_validate_quality(p_plan_id,r->>'security_id',r->'issuer_quality');
 elsif r->'issuer_quality' is distinct from 'null'::jsonb or r->'issuer_quality_hash' is distinct from 'null'::jsonb then raise exception 'MARKET_BVPS_MEDIUM_QUALITY_SCOPE';end if;
 for peer in select jsonb_array_elements(r->'peers') loop
  sid:=peer->>'security_id';
  if sid=r->>'security_id' or sid=any(seen) then raise exception 'MARKET_BVPS_PEER_DUPLICATE_OR_ISSUER';end if;
  if cardinality(seen)>0 and (sid collate "C")<=(seen[cardinality(seen)] collate "C") then raise exception 'MARKET_BVPS_PEER_ORDER';end if;
  seen:=array_append(seen,sid);
  select market,symbol,body into strict pc from vnext_market.companies where universe_id=p.universe_id and security_id=sid;
  if not coalesce(vnext_market.exact(peer,array['security_id','market','industry_code','quote_date','current_price','financial_period','financial_period_end','reported_bvps','reported_bvps_raw','derived_pb',
    'balance_record','balance_record_hash','source_captures','action_proof','annual_quality','quality_result_hash']),false)
   or pc.market is distinct from c.market or peer->>'market' is distinct from c.market
   or pc.body->>'instrument_kind' is distinct from 'ORDINARY_COMPANY_EQUITY' or pc.body->>'industry_code' is distinct from c.body->>'industry_code'
   or peer->>'industry_code' is distinct from c.body->>'industry_code' or peer->'quote_date' is distinct from r->'quote_date'
   or peer->'financial_period' is distinct from r->'financial_period' or peer->'financial_period_end' is distinct from r->'financial_period_end'
   then raise exception 'MARKET_BVPS_PEER_COHORT';end if;
  observation:=peer-'security_id'-'market'-'industry_code'-'action_proof'-'annual_quality'-'quality_result_hash';
  perform vnext_market.bvps_validate_observation(p_plan_id,sid,observation);
  perform vnext_market.bvps_validate_actions(p_plan_id,sid,peer->'action_proof',(r->>'financial_period_end')::date,expected_date);
  if p_horizon='LONG' then
   if peer->>'quality_result_hash' is distinct from vnext_market.hash(peer->'annual_quality') then raise exception 'MARKET_BVPS_QUALITY_HASH';end if;
   perform vnext_market.bvps_validate_quality(p_plan_id,sid,peer->'annual_quality');
  elsif peer->'annual_quality' is distinct from 'null'::jsonb or peer->'quality_result_hash' is distinct from 'null'::jsonb then raise exception 'MARKET_BVPS_MEDIUM_QUALITY_SCOPE';end if;
  multiples:=array_append(multiples,(peer->>'current_price')::numeric/(peer->>'reported_bvps')::numeric);
 end loop;
 select array_agg(value order by value) into ordered from unnest(multiples)value;n:=cardinality(ordered);issuer_bvps:=(r->>'reported_bvps')::numeric;
 for idx in 0..2 loop
  q:=(r->'peer_quantiles'->>idx)::numeric;position:=(n-1)*q;
  expected:=ordered[floor(position)::integer+1]+(ordered[ceil(position)::integer+1]-ordered[floor(position)::integer+1])*(position-floor(position));
  if not coalesce(vnext_market.bvps_near(r->'multiple_scenarios'->idx,expected),false)
   or not coalesce(vnext_market.bvps_near(r->'price_scenarios'->idx,issuer_bvps*expected),false) then raise exception 'MARKET_BVPS_ARITHMETIC';end if;
 end loop;
 binding:=jsonb_build_object('financial_period',r->>'financial_period',
  'quote',jsonb_build_object('capture_id',r->'issuer_source_captures'->'quote'->>'capture_id','source_row_hash',r->'issuer_source_captures'->'quote'->>'source_row_hash'),
  'balance',jsonb_build_object('capture_id',r->'issuer_source_captures'->'balance'->>'capture_id','source_row_hash',r->'issuer_source_captures'->'balance'->>'source_row_hash'),
  'action_evidence_hashes',(select jsonb_agg(e->>'evidence_hash' order by ord) from jsonb_array_elements(r->'issuer_action_proof'->'coverage_evidence') with ordinality t(e,ord)));
 select reference_hash,body into prior_binding from vnext_market.bvps_reference_packet_bindings where plan_id=p_plan_id and security_id=r->>'security_id' and horizon=p_horizon;
 if found then
  if prior_binding.reference_hash is distinct from r->>'reference_hash' or prior_binding.body is distinct from binding then raise exception 'MARKET_BVPS_REFERENCE_REPLAY';end if;
 else
  insert into vnext_market.bvps_reference_packet_bindings(plan_id,security_id,horizon,reference_hash,body) values(p_plan_id,r->>'security_id',p_horizon,r->>'reference_hash',binding);
 end if;
end $$;

create function vnext_market.bvps_validate_projection(p_plan_id text,p_security_id text,p_refs jsonb,p_packet_text text,p_packet_hash text) returns void
language plpgsql stable security definer set search_path='' as $$
declare horizon_name text;bound record;packet jsonb;e jsonb;body jsonb;h text;seen_hashes text[]:='{}';quote_found boolean;balance_found boolean;
begin
 foreach horizon_name in array array['MEDIUM','LONG'] loop
  if p_refs->horizon_name->>'method_version' is distinct from 'TAIWAN_REPORTED_BVPS_PEER_V1' then continue;end if;
  if p_packet_text is null or p_packet_hash is distinct from vnext_market.digest(p_packet_text) then raise exception 'MARKET_BVPS_PACKET_HASH';end if;
  packet:=p_packet_text::jsonb;
  select b.reference_hash,b.body into bound from vnext_market.bvps_reference_packet_bindings b
   where b.plan_id=p_plan_id and b.security_id=p_security_id and b.horizon=horizon_name;
  if not found or bound.reference_hash is distinct from p_refs->horizon_name->>'reference_hash' or packet->>'symbol' is distinct from split_part(p_security_id,':',2)
   then raise exception 'MARKET_BVPS_PACKET_REFERENCE';end if;
  seen_hashes:='{}';quote_found:=false;balance_found:=false;
  for e in select jsonb_array_elements(packet->'evidence') loop
   h:=e->>'evidence_hash';body:=(e->>'content')::jsonb;
   if h=any(array(select x#>>'{}' from jsonb_array_elements(bound.body->'action_evidence_hashes')x)) then
    if not exists(select from vnext_market.action_evidence a where a.evidence_hash=h and a.security_id=p_security_id and a.content_text=e->>'content'
      and a.body=e) then raise exception 'MARKET_BVPS_PACKET_ACTION';end if;
    seen_hashes:=array_append(seen_hashes,h);
   end if;
   if body->'source_capture'->>'capture_id'=bound.body->'quote'->>'capture_id'
    and body->'source_capture'->>'source_row_hash'=bound.body->'quote'->>'source_row_hash' and e->>'kind'='PRICE'
    and body->>'date'=p_refs->horizon_name->>'quote_date' and body->'close'=p_refs->horizon_name->'current_price' then quote_found:=true;end if;
   if body->'source_capture'->>'capture_id'=bound.body->'balance'->>'capture_id'
    and body->'source_capture'->>'source_row_hash'=bound.body->'balance'->>'source_row_hash' and e->>'kind'='FINANCIAL'
    and body->>'period'=bound.body->>'financial_period' then balance_found:=true;end if;
  end loop;
  if cardinality(seen_hashes)<>jsonb_array_length(bound.body->'action_evidence_hashes') or not quote_found or not balance_found then raise exception 'MARKET_BVPS_PACKET_ISSUER_EVIDENCE';end if;
 end loop;
end $$;

do $patch$declare definition text;begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.stage_daily_ai_market_price_references_v2(text,text,text)')) is distinct from 'c4afbf11bf17d4b418df812d063aa43d'
  then raise exception 'MARKET_BVPS_REFERENCE_BASELINE';end if;
 definition:=pg_get_functiondef('public.stage_daily_ai_market_price_references_v2(text,text,text)'::regprocedure);
 definition:=replace(definition,'or (ref_horizon=''MEDIUM'' and (coalesce(method,'''') not in(''CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE'',''CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'') or version is distinct from ''TAIWAN_PEER_RERATING_V1''))','or (ref_horizon=''MEDIUM'' and not coalesce((coalesce(method,'''') in(''CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE'',''CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'') and version=''TAIWAN_PEER_RERATING_V1'') or (method=''CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB'' and version=''TAIWAN_REPORTED_BVPS_PEER_V1''),false))');
 definition:=replace(definition,'or (ref_horizon=''LONG'' and (method is distinct from ''CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'' or version is distinct from ''TAIWAN_LONG_QUALITY_PEER_PB_V1''))','or (ref_horizon=''LONG'' and not coalesce((method=''CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'' and version=''TAIWAN_LONG_QUALITY_PEER_PB_V1'') or (method=''CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB'' and version=''TAIWAN_REPORTED_BVPS_PEER_V1''),false))');
 definition:=replace(definition,'  expected:=jsonb_build_object(''schema'',''DAILY_AI_MARKET_RESEARCH_REFERENCE_V1''','  if version=''TAIWAN_REPORTED_BVPS_PEER_V1'' then perform vnext_market.bvps_validate_reference(full_ref,ref_horizon,p.id);end if;
  expected:=jsonb_build_object(''schema'',''DAILY_AI_MARKET_RESEARCH_REFERENCE_V1''');
 execute definition;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.stage_daily_ai_market_price_references_v2(text,text,text)')) is distinct from '71fe131c114760f4373f0b7cc5881d40'
  then raise exception 'MARKET_BVPS_REFERENCE_PATCH_RESULT';end if;
end $patch$;
do $projection$declare definition text;begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.reference_projection(text,text,text,text,text,text)')) is distinct from '780f953c71839db6d80a4fdbbb6be006' then raise exception 'MARKET_BVPS_PROJECTION_BASELINE';end if;
 definition:=pg_get_functiondef('vnext_market.reference_projection(text,text,text,text,text,text)'::regprocedure);
 execute replace(definition,' end if;return refs;',' end if;
 perform vnext_market.bvps_validate_projection(p_plan_hash,p_security_id,refs,p_packet_text,p_packet_hash);
 return refs;');
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.reference_projection(text,text,text,text,text,text)')) is distinct from '886c09fa20182876261b9b28f6d1dd97' then raise exception 'MARKET_BVPS_PROJECTION_PATCH_RESULT';end if;
end $projection$;
revoke all on function vnext_market.bvps_number(text),
 vnext_market.bvps_near(jsonb,numeric),
 vnext_market.bvps_field(jsonb,jsonb,text[]),
 vnext_market.bvps_financial_row(text,text,jsonb,text,text),
 vnext_market.bvps_validate_observation(text,text,jsonb),
 vnext_market.bvps_validate_actions(text,text,jsonb,date,date),
 vnext_market.bvps_validate_quality(text,text,jsonb),
 vnext_market.bvps_completed_session(timestamptz),
 vnext_market.bvps_validate_reference(jsonb,text,text),
 vnext_market.bvps_validate_projection(text,text,jsonb,text,text),
 vnext_market.reference_projection(text,text,text,text,text,text)
 from public,anon,authenticated,service_role;
revoke all on function public.stage_daily_ai_market_price_references_v2(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_market_price_references_v2(text,text,text) to service_role;
commit;
