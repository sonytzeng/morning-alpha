-- Forward-only WATCH observation lock; WATCH is not a qualified READY.
-- No historical backfill, promotion, RLS, grants, roles, auth or Product V1 changes.
-- CREATE OR REPLACE preserves existing function ownership and execute grants.
-- Reapplicable: only this known status constraint and three existing RPC bodies.
begin;
alter table public.recommendation_shadow_v2_predictions
 drop constraint recommendation_shadow_v2_predictions_status_check;
alter table public.recommendation_shadow_v2_predictions
 add constraint recommendation_shadow_v2_predictions_status_check check(status in ('WATCH','READY'));

create or replace function public.store_recommendation_shadow_v2(p_evidence_text text,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_input jsonb; v_now timestamptz:=clock_timestamp(); v_cutoff timestamptz;
 v_date date; v_hash text; v_existing public.recommendation_shadow_v2_runs%rowtype;
 v_id uuid; v_candidate jsonb; v_entry jsonb; v_symbols text[]; v_expected text[];
begin
 if octet_length(p_evidence_text)>6000000 or octet_length(p_result::text)>2000000 then raise exception 'SHADOW_V2_INPUT_LIMIT'; end if;
 v_input:=p_evidence_text::jsonb;
 v_hash:=encode(extensions.digest(convert_to(p_evidence_text,'UTF8'),'sha256'),'hex');
 v_cutoff:=(p_result->>'cutoff')::timestamptz; v_date:=(p_result->>'business_date')::date;
 if p_result->>'methodology_version' is distinct from 'RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0'
  or v_cutoff is null or v_date is null or nullif(p_result->>'source_revision','') is null
  or p_result->>'input_sha256' is distinct from v_hash
  or p_result->>'shadow_only' is distinct from 'true'
  or p_result->>'owner_only' is distinct from 'true'
  or p_result->>'production_eligible' is distinct from 'false'
  or p_result->>'promotion_allowed' is distinct from 'false'
  or p_result->>'same_universe_cutoff' is distinct from 'true'
  or v_input#>>'{identity,report_date}' is distinct from v_date::text
  or (v_input#>>'{identity,generated_at}')::timestamptz is distinct from v_cutoff
  or v_input#>>'{identity,revision_id}' is distinct from p_result->>'source_revision'
  or v_input#>>'{v1,report_date}' is distinct from v_date::text
  or (v_input#>>'{v1,generated_at}')::timestamptz is distinct from v_cutoff
  or jsonb_typeof(p_result->'candidates') is distinct from 'array'
  or jsonb_array_length(p_result->'candidates')<>72
 then raise exception 'SHADOW_V2_IDENTITY_INVALID'; end if;
 select array_agg(c->>'symbol' order by c->>'symbol') into v_symbols from jsonb_array_elements(p_result->'candidates') c;
 select array_agg(symbol order by symbol) into v_expected from public.sector_stock_map where is_active;
 if cardinality(v_expected)<>72 or v_symbols is distinct from v_expected then raise exception 'SHADOW_V2_UNIVERSE_INVALID'; end if;
 -- Retry of the same immutable capsule is allowed later, but a new capsule
 -- cannot use an old date/cutoff and pretend to be a prospective observation.
 select * into v_existing from public.recommendation_shadow_v2_runs where source_revision=p_result->>'source_revision';
 if found then
  if v_existing.input_sha256<>v_hash or v_existing.result<>p_result then raise exception 'SHADOW_V2_IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('status','ALREADY_STORED','run_id',v_existing.id);
 end if;
 if v_cutoff>v_now or v_cutoff<v_now-interval '5 minutes' or v_date<>(v_now at time zone 'Asia/Taipei')::date
  or not public.market_calendar_session_v1('TW',v_date) then raise exception 'SHADOW_V2_NOT_FORWARD_AVAILABLE_NOW'; end if;
 -- Serialize the daily authoritative prediction set, including concurrent
 -- distinct report retry identities. Never overwrite the first locked WATCH or READY; later evaluations never promote it.
 perform pg_advisory_xact_lock(hashtextextended('RECOMMENDATION_V2:'||v_date::text,0));
 select * into v_existing from public.recommendation_shadow_v2_runs where source_revision=p_result->>'source_revision';
 if found then
  if v_existing.input_sha256<>v_hash or v_existing.result<>p_result then raise exception 'SHADOW_V2_IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('status','ALREADY_STORED','run_id',v_existing.id);
 end if;
 insert into public.recommendation_shadow_v2_runs(business_date,source_revision,methodology_version,cutoff,locked_at,input_sha256,evidence,result)
 values(v_date,p_result->>'source_revision',p_result->>'methodology_version',v_cutoff,v_now,v_hash,v_input,p_result) returning id into v_id;
 for v_candidate in select value from jsonb_array_elements(p_result->'candidates') loop
  if coalesce(v_candidate->>'status','') not in ('READY','WATCH','NONE','BLOCKED') then raise exception 'SHADOW_V2_STATUS_INVALID'; end if;
  if v_candidate->>'status' in ('WATCH','READY') then
   v_entry:=v_candidate->'entry';
   if jsonb_typeof(v_entry) is distinct from 'object'
    or jsonb_typeof(v_entry->'trigger_price') is distinct from 'number'
    or jsonb_typeof(v_entry->'invalidation_price') is distinct from 'number'
    or nullif(v_entry->>'not_before','') is null
    or (v_entry->>'not_before')::date<=v_date
    or (v_entry->>'not_before')::date>v_date+30
    or not public.market_calendar_session_v1('TW',(v_entry->>'not_before')::date)
    or public.previous_market_session_v1('TW',(v_entry->>'not_before')::date) is distinct from v_date
    or ((v_entry->>'not_before')||'T09:00:00+08:00')::timestamptz<=v_now
    or (v_entry->>'trigger_price')::numeric<=0
    or (v_entry->>'invalidation_price')::numeric<=0
    or (v_entry->>'invalidation_price')::numeric>=(v_entry->>'trigger_price')::numeric
    or v_entry->>'condition' is distinct from 'NEXT_SESSION_TRADE_STRICTLY_ABOVE_20_SESSION_HIGH'
   then raise exception 'SHADOW_V2_ENTRY_INVALID'; end if;
   insert into public.recommendation_shadow_v2_predictions(run_id,business_date,symbol,methodology_version,locked_at,cutoff,input_sha256,status,entry)
   values(v_id,v_date,v_candidate->>'symbol',p_result->>'methodology_version',v_now,v_cutoff,v_hash,v_candidate->>'status',v_entry)
   on conflict(business_date,symbol,methodology_version) do nothing;
  end if;
 end loop;
 return jsonb_build_object('status','STORED','run_id',v_id);
end $$;

create or replace function public.store_recommendation_shadow_v2_outcome(p_result jsonb,p_evidence_text text) returns text
language plpgsql security definer set search_path='' as $$
declare v_p public.recommendation_shadow_v2_predictions%rowtype; v_h integer:=(p_result->>'horizon')::integer;
 v_id uuid:=(p_result->>'prediction_id')::uuid; v_hash text; v_before jsonb;
 v_e jsonb; v_source jsonb; v_observed timestamptz; v_dates date[]; v_day date; v_b jsonb; v_quote jsonb;
 v_count integer; v_index integer:=0; v_trigger numeric; v_stop numeric; v_entry numeric;
 v_exit numeric; v_max numeric; v_min numeric; v_return numeric; v_state text:='OBSERVED';
 v_entry_date date; v_exit_date date; v_stopped boolean:=false;
begin
 if p_evidence_text is null or p_result is null or v_id is null or v_h is null
  or octet_length(p_evidence_text)>500000 or coalesce(p_result->>'state','') not in ('OBSERVED','NOT_ENTERED') or v_h not in (1,3,5,10,20)
  or p_result->>'methodology_version' is distinct from 'RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0'
  or p_result->>'gross_of_costs' is distinct from 'true' or p_result->>'ordering' is distinct from 'CONSERVATIVE_STOP_FIRST'
 then raise exception 'SHADOW_V2_OUTCOME_INVALID'; end if;
 select * into strict v_p from public.recommendation_shadow_v2_predictions where id=v_id;
 -- READY outcomes written before this migration may omit the additive status.
 -- WATCH must always be explicit; neither a payload nor a retry can promote it.
 if coalesce(p_result->>'prediction_status','READY') is distinct from v_p.status
 then raise exception 'SHADOW_V2_OUTCOME_STATUS'; end if;
 v_e:=p_evidence_text::jsonb; v_observed:=(v_e->>'observed_at')::timestamptz;
 if v_e#>>'{prediction,id}' is distinct from v_id::text
  or v_e#>>'{prediction,status}' is distinct from v_p.status
  or v_e#>>'{prediction,symbol}' is distinct from v_p.symbol
  or v_e#>>'{prediction,input_sha256}' is distinct from v_p.input_sha256
  or (v_e->>'horizon')::integer is distinct from v_h
  or v_observed is null or v_observed>clock_timestamp()
  or jsonb_typeof(v_e->'bars') is distinct from 'array'
 then raise exception 'SHADOW_V2_OUTCOME_LINEAGE'; end if;
 select evidence into strict v_source from public.recommendation_shadow_v2_runs where source_revision=v_e->>'source_revision';
 v_entry_date:=(v_p.entry->>'not_before')::date;
 select array_agg(d order by d) into v_dates from (
  select v_entry_date+i as d from generate_series(0,50) i
  where public.market_calendar_session_v1('TW',v_entry_date+i) order by d limit v_h
 ) dates;
 if cardinality(v_dates)<>v_h or v_dates[1]<>v_entry_date
  or v_observed<(v_dates[v_h]::text||'T13:30:00+08:00')::timestamptz
 then raise exception 'SHADOW_V2_FUTURE_OUTCOME'; end if;
 v_trigger:=(v_p.entry->>'trigger_price')::numeric; v_stop:=(v_p.entry->>'invalidation_price')::numeric;
 foreach v_day in array v_dates loop
  v_index:=v_index+1;
  select count(*) into v_count from jsonb_array_elements(v_e->'bars') b where b->>'date'=v_day::text;
  if v_count<>1 then raise exception 'SHADOW_V2_OUTCOME_SESSION'; end if;
  select b into v_b from jsonb_array_elements(v_e->'bars') b where b->>'date'=v_day::text;
  select count(*) into v_count from jsonb_array_elements(v_source->'captures') c,
   lateral jsonb_array_elements(c->'rows') r
   where c->>'symbol'=v_p.symbol and c->>'endpoint'='historical/candles' and c->>'status'='PASS'
    and r->>'id'=v_b->>'source_ref' and r->>'trading_date'=v_day::text;
  if v_count<>1 then raise exception 'SHADOW_V2_OUTCOME_SOURCE_MISSING'; end if;
  select r into v_quote from jsonb_array_elements(v_source->'captures') c,
   lateral jsonb_array_elements(c->'rows') r
   where c->>'symbol'=v_p.symbol and c->>'endpoint'='historical/candles' and c->>'status'='PASS'
    and r->>'id'=v_b->>'source_ref' and r->>'trading_date'=v_day::text;
  if (v_b->>'available_at')::timestamptz is distinct from (v_quote->>'ingested_at')::timestamptz
   or (v_b->>'available_at')::timestamptz>v_observed
   or (v_b->>'available_at')::timestamptz<(v_day::text||'T13:30:00+08:00')::timestamptz
   or v_b->'open' is distinct from v_quote#>'{raw_payload,open}'
   or v_b->'high' is distinct from v_quote#>'{raw_payload,high}'
   or v_b->'low' is distinct from v_quote#>'{raw_payload,low}'
   or v_b->'close' is distinct from v_quote#>'{raw_payload,close}'
   or v_b->'volume' is distinct from v_quote#>'{raw_payload,volume_shares}'
   or v_b->'amount' is distinct from v_quote#>'{raw_payload,amount_twd}'
   or coalesce((v_b->>'volume')::numeric,0)<=0 or coalesce((v_b->>'amount')::numeric,0)<=0
   or least((v_b->>'open')::numeric,(v_b->>'high')::numeric,(v_b->>'low')::numeric,(v_b->>'close')::numeric)<=0
   or (v_b->>'high')::numeric<greatest((v_b->>'open')::numeric,(v_b->>'close')::numeric)
   or (v_b->>'low')::numeric>least((v_b->>'open')::numeric,(v_b->>'close')::numeric)
  then raise exception 'SHADOW_V2_OUTCOME_BAR_INVALID'; end if;
  if v_index=1 then
   v_entry:=greatest((v_b->>'open')::numeric,v_trigger);v_max:=v_entry;v_min:=v_entry;
   if (v_b->>'high')::numeric<=v_trigger or (v_entry-v_stop)/v_entry>0.08 then v_state:='NOT_ENTERED'; end if;
  end if;
  if not v_stopped and v_state='OBSERVED' then
   if (v_b->>'low')::numeric<=v_stop then
    v_exit:=case when v_index>1 and (v_b->>'open')::numeric<v_stop then (v_b->>'open')::numeric else v_stop end;
    v_min:=least(v_min,v_exit);v_exit_date:=v_day;v_stopped:=true;
   else
    if v_index>1 then v_max:=greatest(v_max,(v_b->>'high')::numeric);end if;
    v_min:=least(v_min,(v_b->>'low')::numeric);v_exit:=(v_b->>'close')::numeric;v_exit_date:=v_day;
   end if;
  end if;
 end loop;
 if p_result->>'state' is distinct from v_state then raise exception 'SHADOW_V2_OUTCOME_CALCULATION'; end if;
 if v_state='NOT_ENTERED' then
  if p_result->'return' is distinct from 'null'::jsonb or p_result->'mfe' is distinct from 'null'::jsonb
   or p_result->'mae' is distinct from 'null'::jsonb or p_result->'win_loss' is distinct from 'null'::jsonb
  then raise exception 'SHADOW_V2_NOT_ENTERED_IS_NOT_PERFORMANCE'; end if;
 else
  v_return:=v_exit/v_entry-1;
  if jsonb_typeof(p_result->'return') is distinct from 'number' or jsonb_typeof(p_result->'mfe') is distinct from 'number' or jsonb_typeof(p_result->'mae') is distinct from 'number'
   or abs((p_result->>'return')::numeric-v_return)>0.000000001
   or abs((p_result->>'mfe')::numeric-(v_max/v_entry-1))>0.000000001
   or abs((p_result->>'mae')::numeric-(v_min/v_entry-1))>0.000000001
   or p_result->>'entry_at' is distinct from v_entry_date::text
   or p_result->>'exit_at' is distinct from v_exit_date::text
   or p_result->>'win_loss' is distinct from (case when v_return>0 then 'WIN' when v_return<0 then 'LOSS' else 'FLAT' end)
  then raise exception 'SHADOW_V2_OUTCOME_CALCULATION'; end if;
 end if;
 v_hash:=encode(extensions.digest(convert_to(p_evidence_text,'UTF8'),'sha256'),'hex');
 select result into v_before from public.recommendation_shadow_v2_outcomes where prediction_id=v_id and horizon=v_h;
 if found then
  if (v_before||jsonb_build_object('prediction_status',v_p.status))<>(p_result||jsonb_build_object('prediction_status',v_p.status)) then raise exception 'SHADOW_V2_OUTCOME_CONFLICT'; end if;
  return 'ALREADY_STORED';
 end if;
 insert into public.recommendation_shadow_v2_outcomes(prediction_id,horizon,evidence_sha256,result) values(v_id,v_h,v_hash,p_result)
 on conflict do nothing;
 select result into v_before from public.recommendation_shadow_v2_outcomes where prediction_id=v_id and horizon=v_h;
 if (v_before||jsonb_build_object('prediction_status',v_p.status))<>(p_result||jsonb_build_object('prediction_status',v_p.status)) then raise exception 'SHADOW_V2_OUTCOME_CONFLICT'; end if;
 return 'STORED';
end $$;

-- Project status from the immutable prediction, including legacy READY outcomes.
create or replace function public.get_owner_recommendation_shadow_v2() returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if not public.is_research_owner_v1() then raise exception 'RESEARCH_OWNER_REQUIRED' using errcode='42501'; end if;
 return jsonb_build_object('version','RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0','shadow_only',true,'promotion_allowed',false,
  'read_at',clock_timestamp(),'today_date',(clock_timestamp() at time zone 'Asia/Taipei')::date,
  'latest',(select result from public.recommendation_shadow_v2_runs order by locked_at desc limit 1),
  'forward_sample',(select count(distinct business_date) from public.recommendation_shadow_v2_predictions),
  'forward_dates',coalesce((select jsonb_agg(d.business_date order by d.business_date) from (select distinct business_date from public.recommendation_shadow_v2_predictions) d),'[]'::jsonb),
  'outcome_sample',(select count(distinct prediction_id) from public.recommendation_shadow_v2_outcomes where result->>'state'='OBSERVED'),
  'outcomes',coalesce((select jsonb_agg(result) from (select o.result||jsonb_build_object('symbol',p.symbol,'prediction_date',p.business_date,'prediction_status',p.status) as result from public.recommendation_shadow_v2_outcomes o join public.recommendation_shadow_v2_predictions p on p.id=o.prediction_id order by o.observed_at desc limit 1000) q),'[]'::jsonb),
  'outcomes_truncated',(select count(*)>1000 from public.recommendation_shadow_v2_outcomes),
  'forward_dates_by_status',jsonb_build_object(
   'READY',coalesce((select jsonb_agg(d.business_date order by d.business_date) from (select distinct business_date from public.recommendation_shadow_v2_predictions where status='READY') d),'[]'::jsonb),
   'WATCH',coalesce((select jsonb_agg(d.business_date order by d.business_date) from (select distinct business_date from public.recommendation_shadow_v2_predictions where status='WATCH') d),'[]'::jsonb)),
  'analysis_value','INSUFFICIENT_SAMPLE');
end $$;
commit;
