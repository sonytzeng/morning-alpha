-- Independent daily AS_OF queue. No Forward gate, existing Cron or secret changes.
-- Apply after batches, dispatch, handoff, member, use-review (and existing jobs).
-- Resume requires the member edition table + private staging function. Apply
-- the separate intake-cron candidate LAST, only after explicit schedule review.
begin;
create table vnext_runtime.ai_stock_intakes(
 id uuid primary key default gen_random_uuid(),business_date date not null unique,
 requested_at timestamptz not null default clock_timestamp(),
 state text not null default 'QUEUED' check(state in('QUEUED','RUNNING','FAILED','SOURCED','COMPLETE')),
 attempts integer not null default 0 check(attempts between 0 and 3),lease uuid,lease_until timestamptz,
 source_kind text check(source_kind in('VNEXT_ACQUIRED','ASOF_INTAKE')),source_id uuid,
 source_revision text check(source_revision ~ '^[a-f0-9]{64}$'),source_cutoff text,source_business_date date,
 base_inputs jsonb,companies jsonb,source_issues jsonb not null default '[]',
 inputs jsonb,news jsonb,market jsonb not null default '[]',cutoff timestamptz,cutoff_text text,snapshot_hash text,
 intake_gaps jsonb not null default '[]',gaps_by_symbol jsonb not null default '{}',
 batch_id text references vnext_runtime.ai_stock_batches(id),last_code text,
 updated_at timestamptz not null default clock_timestamp(),
 check((business_date=(requested_at at time zone 'Asia/Taipei')::date)),
 check(cutoff is null or cutoff_text::timestamptz=cutoff),
 check(state not in('SOURCED','COMPLETE') or (jsonb_array_length(inputs)=72 and cutoff is not null and snapshot_hash ~ '^[a-f0-9]{64}$')),
 check(state<>'COMPLETE' or batch_id is not null)
);
create table vnext_runtime.ai_stock_intake_delivery(
 intake_id uuid primary key references vnext_runtime.ai_stock_intakes(id),
 attempts integer not null default 0 check(attempts between 0 and 3),request_id bigint,
 last_code text not null default 'DISPATCH_PENDING',updated_at timestamptz not null default clock_timestamp()
);
create index ai_stock_intake_source_latest on vnext_runtime.ai_stock_intakes(cutoff desc)
 where state in('SOURCED','COMPLETE');
alter table vnext_runtime.ai_stock_intakes enable row level security;
alter table vnext_runtime.ai_stock_intakes force row level security;
alter table vnext_runtime.ai_stock_intake_delivery enable row level security;
alter table vnext_runtime.ai_stock_intake_delivery force row level security;
revoke all on vnext_runtime.ai_stock_intakes,vnext_runtime.ai_stock_intake_delivery from public,anon,authenticated,service_role;

create function vnext_runtime.seal_daily_stock_ai_intake_v1() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.state='COMPLETE' then raise exception 'AI_INTAKE_IMMUTABLE';end if;
 if tg_op='UPDATE' and old.state='SOURCED' and new.state='COMPLETE'
  and not vnext_runtime.validate_daily_ai_market_v1(new.market,new.cutoff,new.business_date) then raise exception 'AI_INTAKE_MARKET_POLICY';end if;
 if old.state='SOURCED' and (tg_op='DELETE' or new.state<>'COMPLETE'
  or (to_jsonb(new)-array['state','batch_id','updated_at']) is distinct from (to_jsonb(old)-array['state','batch_id','updated_at']))
  then raise exception 'AI_INTAKE_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function vnext_runtime.seal_daily_stock_ai_intake_v1() from public,anon,authenticated,service_role;
create trigger ai_stock_intake_seal before update or delete on vnext_runtime.ai_stock_intakes
 for each row execute function vnext_runtime.seal_daily_stock_ai_intake_v1();

create function vnext_runtime.daily_stock_ai_intake_view_v1(p_id uuid,p_state text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema','DAILY_AI_INTAKE_SOURCE_V1','state',p_state,'intake_id',q.id,'lease',q.lease,
  'business_date',q.business_date,'requested_at',to_char(q.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'projection','DAILY_AI_RETAINED_INPUT_PROJECTION_V1','source_kind',q.source_kind,'source_id',q.source_id,
  'source_revision',q.source_revision,'source_cutoff',q.source_cutoff,'source_business_date',q.source_business_date,'snapshot_hash',q.snapshot_hash,
  'companies',q.companies,'inputs',case when q.state in('SOURCED','COMPLETE') then q.inputs else q.base_inputs end,
  'source_issues',q.source_issues,'cutoff',q.cutoff_text,'news',coalesce(q.news,'[]'::jsonb),'market',q.market,
  'intake_gaps',q.intake_gaps,'gaps_by_symbol',q.gaps_by_symbol,'member_published',false)
 from vnext_runtime.ai_stock_intakes q where q.id=p_id;
$$;
revoke all on function vnext_runtime.daily_stock_ai_intake_view_v1(uuid,text) from public,anon,authenticated,service_role;

-- Independently prove that each compiled company observation is an unchanged
-- selected source row, rather than trusting a matching symbol and cutoff.
create function vnext_runtime.daily_ai_intake_company_evidence_v1(p_e jsonb,p_input jsonb) returns boolean
language sql immutable set search_path='' as $$
 select exists(select from jsonb_array_elements(case when p_e->>'kind'='PRICE' then p_input->'bars'
  when p_e->>'kind'='FINANCIAL' then p_input->'facts' else '[]'::jsonb end)x where
  p_e-'content'=jsonb_build_object('id',(p_input->>'symbol')||':'||(p_e->>'kind')||':'||(x->>'id'),'symbol',p_input->>'symbol',
   'kind',p_e->>'kind','source',x->>'source','published_at',x->'published_at','available_at',x->>'available_at',
   'first_seen_at',x->>'first_seen_at','as_of',x->>'as_of','evidence_hash',x->>'evidence_hash',
   'time_basis',case when x->'published_at'='null'::jsonb then 'OBSERVED_AFTER_RECEIPT' else 'PUBLISHED' end)
  and (p_e->>'content')::jsonb=case when p_e->>'kind'='PRICE' then
   jsonb_build_object('date',x->'date','open',x->'open','high',x->'high','low',x->'low','close',x->'close',
    'volume',x->'volume','amount',x->'amount','original_id',x->'id')||case when x?'session_scope' then jsonb_build_object('session_scope',x->'session_scope') else '{}'::jsonb end
   else jsonb_build_object('kind',x->'kind','values',x->'values','original_id',x->'id')
    ||case when x?'period' then jsonb_build_object('period',x->'period') else '{}'::jsonb end
    ||case when x?'basis' then jsonb_build_object('basis',x->'basis') else '{}'::jsonb end end);
$$;
revoke all on function vnext_runtime.daily_ai_intake_company_evidence_v1(jsonb,jsonb) from public,anon,authenticated,service_role;

-- These are captured macro facts, not issuer evidence or forecasts. Original
-- publication remains unknown; the actual receipt and content digest are exact.
create function vnext_runtime.validate_daily_ai_market_v1(p_market jsonb,p_cutoff timestamptz,p_business_date date) returns boolean
language plpgsql immutable set search_path='' as $$
declare e jsonb;c jsonb;native_symbol text;seen text[]:='{}';tenor text;source_month text;prior_month text;ny_receipt date;
begin
 if jsonb_typeof(p_market) is distinct from 'array' or jsonb_array_length(p_market)>2 or octet_length(p_market::text)>60000
  or (select count(distinct m->>'id') from jsonb_array_elements(p_market)m)<>jsonb_array_length(p_market) then return false;end if;
 for e in select * from jsonb_array_elements(p_market) loop
  if (select count(*) from jsonb_object_keys(e))<>11 or jsonb_typeof(e->'id') is distinct from 'string'
   or coalesce(btrim(e->>'id'),'')='' or length(e->>'id')>200 or jsonb_typeof(e->'source') is distinct from 'string'
   or e->>'kind' is distinct from 'MARKET' or e->'symbol' is distinct from 'null'::jsonb
   or e->'published_at' is distinct from 'null'::jsonb or e->>'time_basis' is distinct from 'OBSERVED_AFTER_RECEIPT'
   or coalesce(e->>'available_at','') !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$'
   or not isfinite((e->>'available_at')::timestamptz) or (e->>'available_at')::timestamptz>p_cutoff
   or e->>'first_seen_at' is distinct from e->>'available_at' or e->>'as_of' is distinct from e->>'available_at'
   or jsonb_typeof(e->'content') is distinct from 'string' or length(e->>'content') not between 1 and 12000
   or e->>'evidence_hash' is distinct from encode(sha256(convert_to(e->>'content','UTF8')),'hex') then return false;end if;
  c:=(e->>'content')::jsonb;
  if jsonb_typeof(c) is distinct from 'object' or c->>'schema' is distinct from 'DAILY_AI_GLOBAL_MARKET_FACT_V1'
   or c->>'research_business_date' is distinct from p_business_date::text
   or c->>'timestamp_basis' is distinct from 'RECEIPT_ONLY_PUBLICATION_UNKNOWN'
   or c->>'received_at' is distinct from e->>'available_at'
   or coalesce(c->>'source_response_sha256','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(c->'source_response_bytes') is distinct from 'number' or (c->>'source_response_bytes')::numeric not between 1 and 2000000
   or coalesce(c->>'comparison_basis','')='' or coalesce(c->>'calendar_version','')=''
   or coalesce(c->>'session_date','') !~ '^\d{4}-\d\d-\d\d$' or (c->>'session_date')::date>p_business_date
   or coalesce(c->>'trading_date','') !~ '^\d{4}-\d\d-\d\d$' then return false;end if;
  native_symbol:=c->>'native_symbol';
  if native_symbol=any(seen) then return false;end if;seen:=array_append(seen,native_symbol);
  if c->>'kind'='US_TREASURY_PAR_YIELD_CURVE' then
   source_month:=replace(substring(c->>'session_date' from 1 for 7),'-','');
   prior_month:=to_char(date_trunc('month',p_business_date::timestamp)-interval '1 month','YYYYMM');
   ny_receipt:=((e->>'available_at')::timestamptz at time zone 'America/New_York')::date;
   if native_symbol is distinct from 'UST_PAR_YIELD_CURVE' or c->>'market' is distinct from 'US' or c->>'session' is distinct from 'DAILY_OBSERVATION'
    or c->>'currency' is distinct from 'USD' or c->>'unit' is distinct from 'PERCENT'
    or c->>'freshness' is distinct from 'LATEST_AVAILABLE_TREASURY_OBSERVATION'
    or c->>'calendar_version' is distinct from 'TREASURY_XML_ACTUAL_DATES_V1'
    or c->>'comparison_basis' is distinct from 'PREVIOUS_AVAILABLE_TREASURY_OBSERVATION'
    or c->>'rate_model' is distinct from 'NOMINAL_CONSTANT_MATURITY_PAR_YIELD'
    or c->>'source_row_date_basis' is distinct from 'NEW_DATE_DATE_COORDINATE_NOT_PUBLICATION'
    or c->>'observation_date_coordinate' is distinct from (c->>'session_date')||'T00:00:00'
    or c->>'trading_date' is distinct from c->>'session_date' or (c->>'session_date')::date>ny_receipt
    or ny_receipt-(c->>'session_date')::date not between 0 and 7
    or jsonb_typeof(c->'observation_age_calendar_days') is distinct from 'number'
    or (c->>'observation_age_calendar_days')::numeric<>ny_receipt-(c->>'session_date')::date
    or source_month not in(to_char(p_business_date,'YYYYMM'),prior_month)
    or e->>'source' is distinct from 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month='||source_month
    or c ?| array['close','change_points','change_percent','prior_close','source_bar_at','prior_bar_at','bar_timestamp_basis']
    or not(c?'prior_session_date') then return false;end if;
   foreach tenor in array array['2y','10y','30y'] loop
    if jsonb_typeof(c->('yield_'||tenor)) is distinct from 'number' or abs((c->>('yield_'||tenor))::numeric)>100 then return false;end if;
    if c->'prior_session_date'='null'::jsonb then
     if c->('prior_yield_'||tenor) is distinct from 'null'::jsonb or c->('change_'||tenor||'_bp') is distinct from 'null'::jsonb then return false;end if;
    else
     if coalesce(c->>'prior_session_date','') !~ '^\d{4}-\d\d-\d\d$' or (c->>'prior_session_date')::date>=(c->>'session_date')::date
      or replace(substring(c->>'prior_session_date' from 1 for 7),'-','')<>source_month
      or jsonb_typeof(c->('prior_yield_'||tenor)) is distinct from 'number' or abs((c->>('prior_yield_'||tenor))::numeric)>100
      or jsonb_typeof(c->('change_'||tenor||'_bp')) is distinct from 'number'
      or abs((c->>('change_'||tenor||'_bp'))::numeric-((c->>('yield_'||tenor))::numeric-(c->>('prior_yield_'||tenor))::numeric)*100)>0.000001 then return false;end if;
    end if;
   end loop;
  elsif c->>'kind'='TAIWAN_NIGHT_FUTURE' then
   -- Friday night can be attributed by the exchange to Monday. It remains a
   -- received AFTERHOURS observation; do not relabel that native trading date.
   if native_symbol is distinct from 'TX' or c->>'market' is distinct from 'TW' or c->>'session' is distinct from 'AFTERHOURS'
    or c->>'unit' is distinct from 'INDEX_POINTS' or c->>'freshness' is distinct from 'LATEST_COMPLETED_SESSION'
    or jsonb_typeof(c->'close') is distinct from 'number' or (c->>'close')::numeric<=0
    or jsonb_typeof(c->'change_points') is distinct from 'number' or jsonb_typeof(c->'change_percent') is distinct from 'number'
    or c->>'currency' is distinct from 'TWD' or not(coalesce(e->>'source','')='https://openapi.taifex.com.tw/v1/DailyMarketReportFut'
     or coalesce(e->>'source','')='https://www.taifex.com.tw/cht/3/futDailyMarketReport?queryType=2&marketCode=1&queryDate='||replace(c->>'trading_date','-','%2F')||'&commodity_id=TX') then return false;end if;
  else return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function vnext_runtime.validate_daily_ai_market_v1(jsonb,timestamptz,date) from public,anon,authenticated,service_role;

create function public.daily_stock_ai_intake_v1(p_op text,p_intake_id uuid,p_lease uuid default null,
 p_inputs jsonb default null,p_gaps jsonb default null,p_batch_id text default null,p_code text default null,p_symbol_gaps jsonb default null,p_market jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q vnext_runtime.ai_stock_intakes;prior vnext_runtime.ai_stock_intakes;r vnext_runtime.runs;
 base jsonb;dirs jsonb;companies jsonb;frozen jsonb;final_inputs jsonb;gaps jsonb;item jsonb;old_item jsonb;packet jsonb;ev jsonb;expected_company_ids jsonb;actual_company_ids jsonb;expected_market_ids jsonb;actual_market_ids jsonb;b vnext_runtime.ai_stock_batches;
 at_time timestamptz:=clock_timestamp();cutoff_value timestamptz;
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
  if item->>'company' is distinct from old_item->>'company' or item->'facts' is distinct from old_item->'facts'
   or coalesce(item->>'through','') !~ '^\d{4}-\d\d-\d\d$' or item->>'through'<old_item->>'through' or item->>'through'>(q.business_date::text)
   or jsonb_typeof(item->'expected_sessions') is distinct from 'array' or jsonb_array_length(item->'expected_sessions')>250
   or jsonb_typeof(item->'bars') is distinct from 'array' or jsonb_array_length(item->'bars')>250
   or exists(select from jsonb_array_elements(old_item->'bars')ob where item->'expected_sessions' ? (ob->>'date')
    and not exists(select from jsonb_array_elements(item->'bars')nb where nb=ob)) then raise exception 'AI_INTAKE_RETAINED_BYTES';end if;
 end loop;
 if (select count(distinct i->>'through') from jsonb_array_elements(p_inputs)i)<>1 then raise exception 'AI_INTAKE_THROUGH';end if;
 frozen:=vnext_runtime.freeze_daily_stock_ai_news_v1(p_inputs);cutoff_value:=(frozen->>'cutoff')::timestamptz;
 if (cutoff_value at time zone 'Asia/Taipei')::date<>q.business_date then raise exception 'AI_INTAKE_DATE_EXPIRED';end if;
 if not vnext_runtime.validate_daily_ai_market_v1(coalesce(p_market,'[]'::jsonb),cutoff_value,q.business_date) then raise exception 'AI_INTAKE_MARKET';end if;
 if exists(select from jsonb_array_elements(p_inputs)i,jsonb_array_elements((i->'bars')||(i->'facts'))tr
  where tr->>'available_at' is null or not isfinite((tr->>'available_at')::timestamptz) or (tr->>'available_at')::timestamptz>cutoff_value)
  then raise exception 'AI_INTAKE_FUTURE_RECEIPT';end if;
 select jsonb_agg(i||jsonb_build_object('cutoff',frozen->>'cutoff') order by i->>'symbol') into final_inputs from jsonb_array_elements(p_inputs)i;
 select jsonb_agg(to_jsonb(code) order by code) into gaps from(select distinct value#>>'{}' code from jsonb_array_elements(q.intake_gaps||coalesce(p_gaps,'[]'::jsonb)||
  '["NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE","NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS","NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES","NEWS_COMPANY_ASSOCIATION_REQUIRES_VERIFICATION"]'::jsonb||
  case when jsonb_array_length(coalesce(p_market,'[]'::jsonb))=0 then '["MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE"]'::jsonb else '[]'::jsonb end||
  case when jsonb_array_length(frozen->'news')=0 then '["NEWS_NONE_AVAILABLE_WITHIN_48H"]'::jsonb else '[]'::jsonb end))all_gaps;
 update vnext_runtime.ai_stock_intakes set state='SOURCED',inputs=final_inputs,news=frozen->'news',market=coalesce(p_market,'[]'::jsonb),cutoff=cutoff_value,cutoff_text=frozen->>'cutoff',intake_gaps=gaps,
  gaps_by_symbol=coalesce(p_symbol_gaps,'{}'::jsonb),snapshot_hash=encode(sha256(convert_to(jsonb_build_object(
   'schema','DAILY_AI_INTAKE_SNAPSHOT_V1','inputs',final_inputs,'news',frozen->'news','market',coalesce(p_market,'[]'::jsonb),'cutoff',frozen->>'cutoff',
   'intake_gaps',gaps,'gaps_by_symbol',coalesce(p_symbol_gaps,'{}'::jsonb),'source_issues',q.source_issues,
   'source_kind',q.source_kind,'source_id',q.source_id,'source_revision',q.source_revision,'source_cutoff',q.source_cutoff)::text,'UTF8')),'hex'),updated_at=clock_timestamp() where id=q.id;
 return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'SOURCED');
end $$;
revoke all on function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb) to service_role;

create function public.dispatch_daily_stock_ai_intake_v1(p_intake_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q vnext_runtime.ai_stock_intakes;d vnext_runtime.ai_stock_intake_delivery;token text;request bigint;
begin
 select * into strict q from vnext_runtime.ai_stock_intakes where id=p_intake_id;
 if q.state='COMPLETE' then return jsonb_build_object('state','CACHED','intake_id',q.id,'batch_id',q.batch_id);end if;
 if q.state='RUNNING' and q.lease_until>clock_timestamp() then return jsonb_build_object('state','BUSY','intake_id',q.id);end if;
 if q.state in('RUNNING','FAILED') and q.attempts>=3 then return jsonb_build_object('state','EXHAUSTED','intake_id',q.id);end if;
 insert into vnext_runtime.ai_stock_intake_delivery(intake_id) values(q.id) on conflict do nothing;
 select * into strict d from vnext_runtime.ai_stock_intake_delivery where intake_id=q.id for update;
 if d.attempts>=3 then return jsonb_build_object('state','EXHAUSTED','intake_id',q.id);end if;
 if d.last_code='DISPATCHED' and d.updated_at>clock_timestamp()-interval '5 minutes' then return jsonb_build_object('state','ALREADY_DISPATCHED','intake_id',q.id);end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='morning_alpha_daily_delivery_token' order by created_at desc limit 1;
 if token is null or length(token) not between 24 and 512 then return jsonb_build_object('state','CREDENTIAL_UNAVAILABLE','intake_id',q.id);end if;
 update vnext_runtime.ai_stock_intake_delivery set attempts=attempts+1,updated_at=clock_timestamp() where intake_id=q.id;
 begin
  select net.http_post(url:='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1',
   headers:=jsonb_build_object('Content-Type','application/json','x-daily-delivery-token',token),body:=jsonb_build_object('intake_id',q.id),timeout_milliseconds:=60000) into request;
  if request is null then raise exception 'AI_INTAKE_DISPATCH_UNCONFIRMED';end if;
  update vnext_runtime.ai_stock_intake_delivery set request_id=request,last_code='DISPATCHED',updated_at=clock_timestamp() where intake_id=q.id;
 exception when others then
  update vnext_runtime.ai_stock_intake_delivery set last_code='ENQUEUE_FAILED',updated_at=clock_timestamp() where intake_id=q.id;
  return jsonb_build_object('state','ENQUEUE_FAILED','intake_id',q.id);
 end;
 return jsonb_build_object('state','DISPATCHED','intake_id',q.id,'request_id',request,'member_published',false);
end $$;
revoke all on function public.dispatch_daily_stock_ai_intake_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_daily_stock_ai_intake_v1(uuid) to service_role;

-- Fixed to the same server model revision as daily-stock-ai-runner.ts. A future
-- model/prompt revision must update both contracts together.
create function public.resume_daily_stock_ai_intake_v1(p_intake_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q vnext_runtime.ai_stock_intakes;b vnext_runtime.ai_stock_batches;done integer;retryable integer;keys text[];receipt jsonb;
 target_revision constant text:='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low';at_time timestamptz:=clock_timestamp();
begin
 perform pg_advisory_xact_lock(hashtextextended('daily-ai-resume:'||p_intake_id::text,0));
 select * into strict q from vnext_runtime.ai_stock_intakes where id=p_intake_id;
 if q.state<>'COMPLETE' then return public.dispatch_daily_stock_ai_intake_v1(q.id);end if;
 if exists(select from vnext_private.ai_research_editions e where e.batch_id=q.batch_id) then
  return jsonb_build_object('state','EDITION_STAGED','intake_id',q.id,'batch_id',q.batch_id);end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=q.batch_id;
 if b.cutoff+interval '72 hours'<=at_time then return jsonb_build_object('state','BATCH_EXPIRED','intake_id',q.id,'batch_id',b.id);end if;
 select count(*),array_agg(j.id order by j.id) into done,keys from jsonb_each_text(b.payload->'packet_hashes')p
  join vnext_runtime.ai_stock_jobs j on j.symbol=p.key and j.input_hash=p.value and j.cutoff=b.cutoff
   and j.model_revision=target_revision and j.state='COMPLETE';
 if done=72 then
  -- SQL staging cannot incur a model call. It also recovers a failed final
  -- stage even if the 216 transport dispatches have already been consumed.
  begin
   receipt:=public.stage_daily_ai_research_edition_v1(b.id,keys,b.cutoff+interval '72 hours');
   return jsonb_build_object('state','EDITION_STAGED','intake_id',q.id,'batch_id',b.id,'edition_id',receipt->>'edition_id','member_published',false);
  exception when others then return jsonb_build_object('state','STAGING_PENDING','intake_id',q.id,'batch_id',b.id,'member_published',false);end;
 end if;
 if exists(select from jsonb_each_text(b.payload->'packet_hashes')p join vnext_runtime.ai_stock_jobs j
  on j.symbol=p.key and j.input_hash=p.value and j.cutoff=b.cutoff and j.model_revision=target_revision
  where j.state='RUNNING' and j.lease_until>at_time) then return jsonb_build_object('state','BUSY','intake_id',q.id,'batch_id',b.id);end if;
 select count(*) into retryable from jsonb_each_text(b.payload->'packet_hashes')p left join vnext_runtime.ai_stock_jobs j
  on j.symbol=p.key and j.input_hash=p.value and j.cutoff=b.cutoff and j.model_revision=target_revision
  where j.id is null or j.state<>'COMPLETE' and j.attempts<3;
 if retryable=0 then return jsonb_build_object('state','EXHAUSTED','intake_id',q.id,'batch_id',b.id);end if;
 if exists(select from vnext_runtime.ai_stock_dispatches where batch_id=b.id and created_at>at_time-interval '5 minutes') then
  return jsonb_build_object('state','COOLDOWN','intake_id',q.id,'batch_id',b.id);end if;
 receipt:=public.dispatch_daily_stock_ai_batch_v1(b.id);
 return jsonb_build_object('state',receipt->>'state','intake_id',q.id,'batch_id',b.id,'member_published',false);
end $$;
revoke all on function public.resume_daily_stock_ai_intake_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.resume_daily_stock_ai_intake_v1(uuid) to service_role;

create function public.enqueue_daily_stock_ai_intake_v1() returns jsonb
language plpgsql security definer set search_path='' as $$
declare q vnext_runtime.ai_stock_intakes;receipt jsonb;
begin
 insert into vnext_runtime.ai_stock_intakes(business_date) values((clock_timestamp() at time zone 'Asia/Taipei')::date) on conflict do nothing;
 select * into strict q from vnext_runtime.ai_stock_intakes where business_date=(clock_timestamp() at time zone 'Asia/Taipei')::date;
 begin receipt:=public.resume_daily_stock_ai_intake_v1(q.id);exception when others then receipt:='{"state":"DISPATCH_PENDING"}';end;
 return jsonb_build_object('state',q.state,'intake_id',q.id,'business_date',q.business_date,'dispatch',receipt,'member_published',false);
end $$;
revoke all on function public.enqueue_daily_stock_ai_intake_v1() from public,anon,authenticated,service_role;
grant execute on function public.enqueue_daily_stock_ai_intake_v1() to service_role;

-- One cheap tick every five minutes. Paid work is possible only within the
-- daily 06:50–09:00 Taipei recovery window; manual enqueue remains explicit.
create function public.tick_daily_stock_ai_intake_v1() returns jsonb
language plpgsql security definer set search_path='' as $$
declare local_time timestamp:=clock_timestamp() at time zone 'Asia/Taipei';minute_of_day integer;
begin
 minute_of_day:=extract(hour from local_time)::integer*60+extract(minute from local_time)::integer;
 if minute_of_day<410 or minute_of_day>540 then return jsonb_build_object('state','OUTSIDE_WINDOW','member_published',false);end if;
 return public.enqueue_daily_stock_ai_intake_v1();
end $$;
revoke all on function public.tick_daily_stock_ai_intake_v1() from public,anon,authenticated,service_role;
grant execute on function public.tick_daily_stock_ai_intake_v1() to service_role;

-- Successful and failed legacy refreshes both notify the independent queue.
create function vnext_runtime.intake_after_daily_refresh_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.job_name='daily_delivery' and new.checkpoint='daily_refresh' and new.dispatch_status in('SUCCEEDED','FAILED')
  and new.trading_date=(clock_timestamp() at time zone 'Asia/Taipei')::date then
  begin perform public.enqueue_daily_stock_ai_intake_v1();exception when others then null;end;
 end if;return new;
end $$;
revoke all on function vnext_runtime.intake_after_daily_refresh_v1() from public,anon,authenticated,service_role;
create trigger ai_stock_independent_refresh_intake after insert or update of dispatch_status on public.runtime_http_dispatches
 for each row execute function vnext_runtime.intake_after_daily_refresh_v1();
commit;
