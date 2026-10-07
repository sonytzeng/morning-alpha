-- Candidate only. Additive Owner research; no Core data, Cron, secrets or
-- existing access policy changes. Existing locks are explicitly LEGACY.
begin;
alter table public.recommendation_shadow_v2_runs
 add column evaluation_phase text not null default 'LEGACY'
 check(evaluation_phase in ('LEGACY','PREMARKET','09:00','09:30','10:30','13:00','14:10','14:30')),
 add column source_batch_id uuid,
 add column daily_snapshot jsonb;
alter table public.recommendation_shadow_v2_predictions
 add column evaluation_phase text not null default 'LEGACY'
 check(evaluation_phase in ('LEGACY','PREMARKET','09:00','09:30','10:30','13:00','14:10','14:30')),
 add column source_batch_id uuid,
 add column invalidation jsonb,
 add column risk jsonb,
 add column confidence numeric,
 add column confidence_basis text,
 add column target_horizon integer[];
-- Replace only the reviewed identity constraint; no row is changed/deleted.
do $$ declare c text; n integer; begin
 select count(*),min(conname) into n,c from pg_constraint
 where conrelid='public.recommendation_shadow_v2_predictions'::regclass
  and contype='u' and pg_get_constraintdef(oid)='UNIQUE (business_date, symbol, methodology_version)';
 if n<>1 then raise exception 'V2_FORWARD_PREDECESSOR_CONSTRAINT_DRIFT'; end if;
 execute format('alter table public.recommendation_shadow_v2_predictions drop constraint %I',c);
end $$;
alter table public.recommendation_shadow_v2_predictions add constraint recommendation_v2_phase_identity
 unique(business_date,symbol,methodology_version,evaluation_phase);

-- Operational research reservations, not predictions or business lifecycle.
-- Private schema, no browser grants; tokens contain no credentials.
create table research_private.recommendation_v2_forward_jobs (
 id uuid primary key default gen_random_uuid(),
 business_date date not null,
 evaluation_phase text not null check(evaluation_phase in ('PREMARKET','09:00','09:30','10:30','13:00','14:10','14:30')),
 source_batch_id uuid not null,
 source_revision text not null unique,
 lease_id uuid not null default gen_random_uuid(),
 lease_until timestamptz not null,
 attempts integer not null default 1 check(attempts between 1 and 2),
 state text not null check(state in ('RUNNING','COMPLETE','FAILED','SKIPPED_NO_WATCH')),
 run_id uuid references public.recommendation_shadow_v2_runs(id),
 reason text,
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 outcome_lease_until timestamptz,
 outcome_complete boolean not null default false,
 unique(business_date,evaluation_phase)
);
alter table research_private.recommendation_v2_forward_jobs enable row level security;
revoke all on research_private.recommendation_v2_forward_jobs from public,anon,authenticated,service_role;

create function public.claim_recommendation_v2_forward(p_date date,p_phase text,p_batch uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_local timestamp:=v_now at time zone 'Asia/Taipei';
 v_start time; v_end time; v_checkpoint text; v_rows integer; v_distinct integer;
 v_job research_private.recommendation_v2_forward_jobs%rowtype;
begin
 if p_date is null or p_batch is null or p_phase is null or p_phase not in ('PREMARKET','09:00','09:30','10:30','13:00','14:10','14:30')
  or p_date<>v_local::date or not public.market_calendar_session_v1('TW',p_date)
 then raise exception 'V2_FORWARD_TRIGGER_IDENTITY'; end if;
 v_start:=case when p_phase='PREMARKET' then '07:00'::time else p_phase::time end;
 v_end:=case p_phase when 'PREMARKET' then '08:45'::time when '09:00' then '09:30'::time
  when '09:30' then '10:30'::time when '10:30' then '13:00'::time when '13:00' then '14:10'::time
  when '14:10' then '14:30'::time else '15:00'::time end;
 if v_local::time<v_start or v_local::time>=v_end then return jsonb_build_object('status','OUTSIDE_NATURAL_PHASE'); end if;
 v_checkpoint:=case when p_phase='PREMARKET' then p_phase else replace(p_phase,':','') end;
 if not exists(select 1 from public.market_checkpoint_batches b where b.batch_id=p_batch
   and b.business_date=p_date and b.checkpoint=v_checkpoint and b.status='COMMITTED'
   and b.expected_provider_count=11 and b.committed_provider_count=11 and b.committed_at<=v_now)
 then raise exception 'V2_FORWARD_ATOMIC_NOT_READY'; end if;
 select count(*),count(distinct batch_id) into v_rows,v_distinct
 from public.read_committed_market_checkpoint_batch_v1(p_date,v_checkpoint)
 where batch_id=p_batch;
 if v_rows<>11 or v_distinct<>1 then raise exception 'V2_FORWARD_ATOMIC_LINEAGE'; end if;
 perform pg_advisory_xact_lock(hashtextextended('V2_FORWARD:'||p_date::text||':'||p_phase,0));
 select * into v_job from research_private.recommendation_v2_forward_jobs where business_date=p_date and evaluation_phase=p_phase for update;
 if found then
  if v_job.source_batch_id<>p_batch then raise exception 'V2_FORWARD_BATCH_CONFLICT'; end if;
  if v_job.state in ('COMPLETE','SKIPPED_NO_WATCH') then return jsonb_build_object('status',v_job.state,'run_id',v_job.run_id,'job_id',v_job.id,'lease_id',v_job.lease_id); end if;
  if v_job.state='RUNNING' and v_job.lease_until>v_now then return jsonb_build_object('status','IN_PROGRESS'); end if;
  if v_job.attempts>=2 then return jsonb_build_object('status','EXHAUSTED'); end if;
  update research_private.recommendation_v2_forward_jobs set state='RUNNING',attempts=attempts+1,
   lease_id=gen_random_uuid(),lease_until=v_now+interval '6 minutes',reason=null
   where id=v_job.id returning * into v_job;
 else
  insert into research_private.recommendation_v2_forward_jobs(business_date,evaluation_phase,source_batch_id,source_revision,lease_until,state)
   values(p_date,p_phase,p_batch,'V2_FORWARD:'||p_date::text||':'||replace(p_phase,':','')||':'||p_batch::text,v_now+interval '6 minutes','RUNNING') returning * into v_job;
 end if;
 return jsonb_build_object('status','ACQUIRED','job_id',v_job.id,'lease_id',v_job.lease_id,'source_revision',v_job.source_revision,
  'evaluation_phase',p_phase,'source_batch_id',p_batch);
end $$;
revoke all on function public.claim_recommendation_v2_forward(date,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_recommendation_v2_forward(date,text,uuid) to service_role;

-- The static store implementation and Owner read projection follow below.
create function public.store_recommendation_shadow_v2(p_evidence_text text,p_result jsonb,p_phase text,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_input jsonb; v_now timestamptz:=clock_timestamp(); v_cutoff timestamptz;
 v_date date; v_hash text; v_existing public.recommendation_shadow_v2_runs%rowtype;
 v_job research_private.recommendation_v2_forward_jobs%rowtype;
 v_id uuid; v_candidate jsonb; v_entry jsonb; v_symbols text[]; v_expected text[];
begin
 if p_phase is null or p_phase not in ('LEGACY','PREMARKET','09:00','09:30','10:30','13:00','14:10','14:30') then raise exception 'V2_FORWARD_PHASE_INVALID'; end if;
 if p_phase<>'LEGACY' then
  select * into strict v_job from research_private.recommendation_v2_forward_jobs where source_revision=p_result->>'source_revision';
  if v_job.evaluation_phase<>p_phase or v_job.state not in ('RUNNING','COMPLETE')
   or (v_job.state='RUNNING' and v_job.lease_until<clock_timestamp())
   or p_snapshot is null or p_snapshot->'counts' is distinct from p_result->'counts'
   or p_snapshot->>'business_date' is distinct from p_result->>'business_date'
   or p_snapshot->>'methodology_version' is distinct from p_result->>'methodology_version'
   or p_snapshot->>'universe_kind' is distinct from 'RESEARCH_UNIVERSE_72'
   or p_snapshot->>'scanned' is distinct from '72' or p_snapshot->>'production_eligible' is distinct from 'false'
  then raise exception 'V2_FORWARD_SNAPSHOT_LINEAGE'; end if;
 end if;
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
 if p_phase<>'LEGACY' and (v_date is distinct from v_job.business_date
  or v_cutoff<v_job.created_at or not exists(select 1 from public.market_checkpoint_batches b
    where b.batch_id=v_job.source_batch_id and b.committed_at<=v_cutoff)
  or (v_now at time zone 'Asia/Taipei')::time >= case p_phase
    when 'PREMARKET' then time '08:45' when '09:00' then time '09:30'
    when '09:30' then time '10:30' when '10:30' then time '13:00'
    when '13:00' then time '14:10' when '14:10' then time '14:30' else time '15:00' end)
 then raise exception 'V2_FORWARD_PHASE_OBSERVATION_WINDOW'; end if;
 -- Serialize the daily authoritative prediction set, including concurrent
 -- distinct report retry identities. Never overwrite the first locked WATCH or READY; later evaluations never promote it.
 perform pg_advisory_xact_lock(hashtextextended('RECOMMENDATION_V2:'||v_date::text,0));
 select * into v_existing from public.recommendation_shadow_v2_runs where source_revision=p_result->>'source_revision';
 if found then
  if v_existing.input_sha256<>v_hash or v_existing.result<>p_result then raise exception 'SHADOW_V2_IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('status','ALREADY_STORED','run_id',v_existing.id);
 end if;
 insert into public.recommendation_shadow_v2_runs(business_date,source_revision,methodology_version,cutoff,locked_at,input_sha256,evidence,result,evaluation_phase,source_batch_id,daily_snapshot)
 values(v_date,p_result->>'source_revision',p_result->>'methodology_version',v_cutoff,v_now,v_hash,v_input,p_result,p_phase,v_job.source_batch_id,
  case when p_phase='LEGACY' then null else p_snapshot||jsonb_build_object(
   'expected_trading_dates',(select jsonb_agg(d order by d) from (select v_date-i as d from generate_series(0,60) i
    where public.market_calendar_session_v1('TW',v_date-i) order by d desc limit 20) q),
   'company_names',(select jsonb_object_agg(symbol,stock_name) from public.sector_stock_map where is_active)) end) returning id into v_id;
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
   insert into public.recommendation_shadow_v2_predictions(run_id,business_date,symbol,methodology_version,locked_at,cutoff,input_sha256,status,entry,evaluation_phase,source_batch_id,invalidation,risk,confidence,confidence_basis,target_horizon)
   values(v_id,v_date,v_candidate->>'symbol',p_result->>'methodology_version',v_now,v_cutoff,v_hash,v_candidate->>'status',v_entry,p_phase,v_job.source_batch_id,
    jsonb_build_object('price',v_entry->'invalidation_price','basis','LOCKED_FIVE_COMPLETED_SESSION_LOW'),v_candidate#>'{evidence,risk}',
    null,'FORWARD_CALIBRATION_REQUIRED',array[1,3,5,10,20])
   on conflict(business_date,symbol,methodology_version,evaluation_phase) do nothing;
  end if;
 end loop;
 return jsonb_build_object('status','STORED','run_id',v_id);
end $$;

revoke all on function public.store_recommendation_shadow_v2(text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.store_recommendation_shadow_v2(text,jsonb,text,jsonb) to service_role;
create or replace function public.store_recommendation_shadow_v2(p_evidence_text text,p_result jsonb)
returns jsonb language sql security definer set search_path='' as $$
 select public.store_recommendation_shadow_v2(p_evidence_text,p_result,'LEGACY',null);
$$;

create function public.finish_recommendation_v2_forward(p_job uuid,p_lease uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j research_private.recommendation_v2_forward_jobs%rowtype; r public.recommendation_shadow_v2_runs%rowtype;
begin
 select * into strict j from research_private.recommendation_v2_forward_jobs where id=p_job for update;
 if j.lease_id<>p_lease then raise exception 'V2_FORWARD_LEASE_MISMATCH'; end if;
 if j.state='COMPLETE' then return jsonb_build_object('status','ALREADY_COMPLETE'); end if;
 if p_status not in ('COMPLETE','FAILED','SKIPPED_NO_WATCH') or p_status is null then raise exception 'V2_FORWARD_FINISH_INVALID'; end if;
 if p_status='SKIPPED_NO_WATCH' and (j.evaluation_phase='PREMARKET' or not exists(select 1 from public.recommendation_shadow_v2_runs
  where business_date=j.business_date and evaluation_phase='PREMARKET' and result#>>'{counts,WATCH}'='0' and result#>>'{counts,BLOCKED}'='0'))
 then raise exception 'V2_FORWARD_SKIP_WITHOUT_COMPLETE_PREMARKET'; end if;
 if p_status='COMPLETE' then
  select * into strict r from public.recommendation_shadow_v2_runs where source_revision=j.source_revision;
  if r.evaluation_phase<>j.evaluation_phase or r.business_date<>j.business_date or r.source_batch_id is distinct from j.source_batch_id
  then raise exception 'V2_FORWARD_FINISH_LINEAGE'; end if;
 end if;
 update research_private.recommendation_v2_forward_jobs set state=p_status,run_id=r.id,
  reason=case when p_status='FAILED' then 'BOUNDED_RESEARCH_EXECUTION_UNAVAILABLE' end,finished_at=clock_timestamp()
 where id=j.id;
 return jsonb_build_object('status',p_status,'run_id',r.id);
end $$;
revoke all on function public.finish_recommendation_v2_forward(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_recommendation_v2_forward(uuid,uuid,text) to service_role;

-- Existing Owner/RLS identity is reused; no new access path or policy.
create function public.get_owner_recommendation_v2_forward() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_base jsonb; v_date date:=(clock_timestamp() at time zone 'Asia/Taipei')::date;
begin
 if not public.is_research_owner_v1() then raise exception 'RESEARCH_OWNER_REQUIRED' using errcode='42501'; end if;
 v_base:=public.get_owner_recommendation_shadow_v2();
 return v_base||jsonb_build_object(
  'latest_run_id',(select id from public.recommendation_shadow_v2_runs order by locked_at desc limit 1),
  'performance_all',coalesce((select jsonb_agg(to_jsonb(metrics) order by prediction_status,horizon) from (
   select p.status as prediction_status,o.horizon,
    count(*) filter(where o.result->>'state'='OBSERVED') as observed,
    count(*) filter(where o.result->>'state'='NOT_ENTERED') as not_entered,
    avg((o.result->>'return')::numeric) filter(where o.result->>'state'='OBSERVED') as mean_return,
    avg((o.result->>'mfe')::numeric) filter(where o.result->>'state'='OBSERVED') as mean_mfe,
    avg((o.result->>'mae')::numeric) filter(where o.result->>'state'='OBSERVED') as mean_mae,
    count(*) filter(where o.result->>'invalidation_hit'='true') as invalidation_hits,
    count(*) filter(where o.result->>'invalidation_hit' is null) as invalidation_unavailable
   from public.recommendation_shadow_v2_predictions p join public.recommendation_shadow_v2_outcomes o on o.prediction_id=p.id
   where p.methodology_version='RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0' and p.observation_kind='FORWARD'
   group by p.status,o.horizon) metrics),'[]'::jsonb),
  'completed_forward_dates',(select count(*) from (
   select p.business_date from public.recommendation_shadow_v2_predictions p
   where p.methodology_version='RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0' and p.observation_kind='FORWARD'
   group by p.business_date having bool_and(p.locked_at>=p.cutoff and p.locked_at<((p.entry->>'not_before')||'T09:00:00+08:00')::timestamptz
    and (select count(*) from public.recommendation_shadow_v2_outcomes o where o.prediction_id=p.id and o.horizon in (1,3,5,10,20))=5)) complete_dates),
  'history',coalesce((select jsonb_agg(daily_snapshot||jsonb_build_object('evaluation_phase',evaluation_phase,'locked_at',locked_at) order by locked_at desc)
   from (select distinct on (business_date) daily_snapshot,evaluation_phase,locked_at from public.recommendation_shadow_v2_runs
    where business_date>=v_date-45 and daily_snapshot is not null order by business_date desc,locked_at desc limit 20) daily),'[]'::jsonb),
  'expected_trading_dates',coalesce((select daily_snapshot->'expected_trading_dates' from public.recommendation_shadow_v2_runs
    where daily_snapshot is not null order by locked_at desc limit 1),'[]'::jsonb),
  'calendar_as_of',(select business_date from public.recommendation_shadow_v2_runs where daily_snapshot is not null order by locked_at desc limit 1),
  'company_names',coalesce((select daily_snapshot->'company_names' from public.recommendation_shadow_v2_runs
    where daily_snapshot is not null order by locked_at desc limit 1),'{}'::jsonb),
  'phase_predictions',coalesce((select jsonb_agg(to_jsonb(p) order by p.locked_at desc) from (
   select id,business_date,symbol,evaluation_phase,locked_at as prediction_at,status,entry,invalidation,risk,confidence,confidence_basis,
    input_sha256 as evidence_snapshot_hash,methodology_version,target_horizon,source_batch_id,locked_at
   from public.recommendation_shadow_v2_predictions where business_date=v_date order by locked_at desc limit 600
  ) p),'[]'::jsonb),
  'methodology_frozen',true,'public_product_approval',false);
end $$;
revoke all on function public.get_owner_recommendation_v2_forward() from public,anon;
grant execute on function public.get_owner_recommendation_v2_forward() to authenticated;

-- Reuse normalized source acquisition, not a cached Decision. Every caller
-- rebuilds its own unchanged V1/V2 contracts with original evidence timestamps.
create table research_private.recommendation_v2_acquisition_cache (
 id uuid primary key default gen_random_uuid(),business_date date not null,phase text not null,
 lease_until timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,payload jsonb,
 check(phase in ('PREMARKET','0900','0930','1030','1300','1410','1430'))
);
create index recommendation_v2_acquisition_latest on research_private.recommendation_v2_acquisition_cache(business_date,phase,completed_at desc);
alter table research_private.recommendation_v2_acquisition_cache enable row level security;
revoke all on research_private.recommendation_v2_acquisition_cache from public,anon,authenticated,service_role;
create function public.claim_recommendation_v2_acquisition(p_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t timestamp:=clock_timestamp() at time zone 'Asia/Taipei'; p text; c research_private.recommendation_v2_acquisition_cache%rowtype;
begin
 if p_date is null or p_date<>t::date or not public.market_calendar_session_v1('TW',p_date) then raise exception 'V2_ACQUISITION_DATE'; end if;
 p:=case when t::time<'09:00' then 'PREMARKET' when t::time<'09:30' then '0900' when t::time<'10:30' then '0930'
  when t::time<'13:00' then '1030' when t::time<'14:10' then '1300' when t::time<'14:30' then '1410' else '1430' end;
 perform pg_advisory_xact_lock(hashtextextended('V2_SHARED_ACQUISITION',0));
 select * into c from research_private.recommendation_v2_acquisition_cache where business_date=p_date and phase=p
  and completed_at>=clock_timestamp()-interval '2 minutes' and payload is not null order by completed_at desc limit 1;
 if found then return jsonb_build_object('status','CACHED','payload',c.payload); end if;
 if exists(select 1 from research_private.recommendation_v2_acquisition_cache where completed_at is null and lease_until>clock_timestamp())
  or exists(select 1 from research_private.recommendation_v2_forward_jobs where outcome_lease_until>clock_timestamp())
 then return jsonb_build_object('status','IN_PROGRESS'); end if;
 insert into research_private.recommendation_v2_acquisition_cache(business_date,phase,lease_until)
 values(p_date,p,clock_timestamp()+interval '250 seconds') returning * into c;
 return jsonb_build_object('status','ACQUIRED','lease_id',c.id);
end $$;
create function public.finish_recommendation_v2_acquisition(p_lease uuid,p_payload jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare c research_private.recommendation_v2_acquisition_cache%rowtype;
begin
 select * into strict c from research_private.recommendation_v2_acquisition_cache where id=p_lease for update;
 if c.payload is not null then
  if c.payload is distinct from p_payload then raise exception 'V2_ACQUISITION_IMMUTABLE'; end if;
  return 'ALREADY_STORED';
 end if;
 if c.lease_until<clock_timestamp() or (p_payload is not null and (octet_length(p_payload::text)>6000000
  or (p_payload->>'business_date') is distinct from c.business_date::text
  or jsonb_typeof(p_payload->'captures') is distinct from 'array'
  or (p_payload->>'acquisition_cutoff')::timestamptz>clock_timestamp())) then raise exception 'V2_ACQUISITION_PAYLOAD'; end if;
 update research_private.recommendation_v2_acquisition_cache set payload=p_payload,completed_at=clock_timestamp(),lease_until=clock_timestamp() where id=p_lease;
 return 'STORED';
end $$;
revoke all on function public.claim_recommendation_v2_acquisition(date),public.finish_recommendation_v2_acquisition(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_recommendation_v2_acquisition(date),public.finish_recommendation_v2_acquisition(uuid,jsonb) to service_role;

-- Outcome observations are independently captured and immutable. They cannot
-- be used by the prediction engine or change an already locked decision.
create table research_private.recommendation_v2_outcome_sources (
 source_revision text primary key,observed_at timestamptz not null,
 evidence_sha256 text not null,evidence jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table research_private.recommendation_v2_outcome_sources enable row level security;
revoke all on research_private.recommendation_v2_outcome_sources from public,anon,authenticated,service_role;
create trigger recommendation_v2_outcome_sources_immutable before update or delete on research_private.recommendation_v2_outcome_sources
 for each statement execute function research_private.reject_recommendation_shadow_v2_mutation();
create trigger recommendation_v2_outcome_sources_no_truncate before truncate on research_private.recommendation_v2_outcome_sources
 for each statement execute function research_private.reject_recommendation_shadow_v2_mutation();
create function public.store_recommendation_v2_outcome_source(p_text text) returns text
language plpgsql security definer set search_path='' as $$
declare e jsonb; c jsonb; s text; h text; old text; t timestamptz;
begin
 if p_text is null or octet_length(p_text)>6000000 then raise exception 'V2_OUTCOME_SOURCE_LIMIT'; end if;
 e:=p_text::jsonb;s:=e->>'source_revision';t:=(e->>'observed_at')::timestamptz;
 if s is null or s!~'^V2_OUTCOME:[a-f0-9-]{36}:[a-f0-9-]{36}$' or t is null or t>clock_timestamp() or t<clock_timestamp()-interval '5 minutes'
  or jsonb_typeof(e->'captures') is distinct from 'array' or jsonb_array_length(e->'captures')>72
 then raise exception 'V2_OUTCOME_SOURCE_IDENTITY'; end if;
 if not exists(select 1 from research_private.recommendation_v2_forward_jobs where id=split_part(s,':',2)::uuid
  and lease_id=split_part(s,':',3)::uuid and business_date=(clock_timestamp() at time zone 'Asia/Taipei')::date
  and state in ('COMPLETE','SKIPPED_NO_WATCH')) then raise exception 'V2_OUTCOME_SOURCE_JOB'; end if;
 for c in select value from jsonb_array_elements(e->'captures') loop
  if c->>'endpoint' is distinct from 'historical/candles' or not exists(select 1 from public.sector_stock_map where symbol=c->>'symbol' and is_active)
   or nullif(c->>'received_at','') is null or (c->>'received_at')::timestamptz>t
   or (c->>'received_at')::timestamptz<t-interval '4 minutes'
   or nullif(c->>'status','') is null
   or jsonb_typeof(c->'rows') is distinct from 'array' or jsonb_array_length(c->'rows')>90
  then raise exception 'V2_OUTCOME_SOURCE_CONTRACT'; end if;
 end loop;
 if (select count(distinct item->>'symbol') from jsonb_array_elements(e->'captures') item)<>jsonb_array_length(e->'captures')
 then raise exception 'V2_OUTCOME_DUPLICATE_SOURCE'; end if;
 h:=encode(extensions.digest(convert_to(p_text,'UTF8'),'sha256'),'hex');
 select evidence_sha256 into old from research_private.recommendation_v2_outcome_sources where source_revision=s;
 if found then if old<>h then raise exception 'V2_OUTCOME_SOURCE_IMMUTABLE'; end if;return 'ALREADY_STORED';end if;
 insert into research_private.recommendation_v2_outcome_sources(source_revision,observed_at,evidence_sha256,evidence) values(s,t,h,e);
 return 'STORED';
end $$;
revoke all on function public.store_recommendation_v2_outcome_source(text) from public,anon,authenticated;
grant execute on function public.store_recommendation_v2_outcome_source(text) to service_role;

create function public.claim_recommendation_v2_outcome_work(p_job uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j research_private.recommendation_v2_forward_jobs%rowtype; e jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('V2_SHARED_ACQUISITION',0));
 select * into strict j from research_private.recommendation_v2_forward_jobs where id=p_job for update;
 if j.lease_id<>p_lease or j.business_date<>(clock_timestamp() at time zone 'Asia/Taipei')::date or j.state not in ('COMPLETE','SKIPPED_NO_WATCH')
 then raise exception 'V2_OUTCOME_JOB_INVALID'; end if;
 if j.outcome_complete then return jsonb_build_object('status','ALREADY_COMPLETE'); end if;
 if j.outcome_lease_until>clock_timestamp() then return jsonb_build_object('status','IN_PROGRESS'); end if;
 -- Research catch-up does not compete with the premarket Report acquisition.
 if (clock_timestamp() at time zone 'Asia/Taipei')::time<time '09:30'
  or exists(select 1 from research_private.recommendation_v2_acquisition_cache where completed_at is null and lease_until>clock_timestamp())
  or exists(select 1 from research_private.recommendation_v2_forward_jobs where id<>j.id and outcome_lease_until>clock_timestamp())
 then return jsonb_build_object('status','DEFERRED_TO_NEXT_NATURAL_CHECKPOINT'); end if;
 update research_private.recommendation_v2_forward_jobs set outcome_lease_until=clock_timestamp()+interval '4 minutes' where id=j.id;
 select evidence into e from research_private.recommendation_v2_outcome_sources where source_revision='V2_OUTCOME:'||j.id::text||':'||j.lease_id::text;
 return jsonb_build_object('status','ACQUIRED','evidence',e,'source_revision','V2_OUTCOME:'||j.id::text||':'||j.lease_id::text,'business_date',j.business_date);
end $$;
create function public.finish_recommendation_v2_outcome_work(p_job uuid,p_lease uuid,p_complete boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 update research_private.recommendation_v2_forward_jobs set outcome_complete=p_complete,outcome_lease_until=null where id=p_job and lease_id=p_lease;
 if not found then raise exception 'V2_OUTCOME_JOB_INVALID'; end if;
end $$;
revoke all on function public.claim_recommendation_v2_outcome_work(uuid,uuid),public.finish_recommendation_v2_outcome_work(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_recommendation_v2_outcome_work(uuid,uuid),public.finish_recommendation_v2_outcome_work(uuid,uuid,boolean) to service_role;

-- Only matured horizons enter the bounded oldest-first queue. Future horizons
-- cannot fill the queue and starve today's Close observations.
create or replace function public.pending_recommendation_shadow_v2() returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(payload),'[]'::jsonb) from (
  select to_jsonb(p)||jsonb_build_object('completed_horizons',coalesce((select jsonb_agg(o.horizon) from public.recommendation_shadow_v2_outcomes o where o.prediction_id=p.id),'[]'::jsonb)) as payload
  from public.recommendation_shadow_v2_predictions p
  where p.business_date>=(clock_timestamp() at time zone 'Asia/Taipei')::date-65
  and exists(select 1 from unnest(array[1,3,5,10,20]) h where not exists(select 1 from public.recommendation_shadow_v2_outcomes o where o.prediction_id=p.id and o.horizon=h)
   and h<=(select count(*) from generate_series(0,65) i where public.market_calendar_session_v1('TW',(p.entry->>'not_before')::date+i)
    and (((p.entry->>'not_before')::date+i)::text||'T13:30:00+08:00')::timestamptz<=clock_timestamp()))
  order by p.business_date,p.locked_at,p.symbol limit 1800
 ) q
$$;

-- Outcome validator definition follows; legacy source lookup remains supported.
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
 select evidence into v_source from public.recommendation_shadow_v2_runs where source_revision=v_e->>'source_revision';
 if v_source is null then
  select evidence into strict v_source from research_private.recommendation_v2_outcome_sources where source_revision=v_e->>'source_revision';
 end if;
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
 if p_result ? 'invalidation_hit' and p_result->'invalidation_hit' is distinct from
  (case when v_state='OBSERVED' then to_jsonb(v_stopped) else 'null'::jsonb end)
 then raise exception 'V2_OUTCOME_INVALIDATION_DIFF'; end if;
 if p_result ? 'target_hit' and (p_result->'target_hit' is distinct from 'null'::jsonb or p_result->>'target_reason' is distinct from 'NO_LOCKED_PRICE_TARGET')
 then raise exception 'V2_OUTCOME_TARGET_NOT_LOCKED'; end if;
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

-- Owner experiments use the existing journal RLS, but a distinct immutable kind.
-- Existing system/live write contract explicitly rejects this new kind.
alter table public.owner_lab_trades drop constraint owner_lab_trades_kind_check;
alter table public.owner_lab_trades add constraint owner_lab_trades_kind_check
 check(kind in ('SYSTEM_SIMULATION','SONY_LIVE_TRADE','OWNER_EXPERIMENT'));

create or replace function public.owner_lab_record_trade_v1(p_owner uuid,p_request uuid,p_trade jsonb,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.owner_lab_trades; old public.owner_lab_trades; canonical jsonb; shadow jsonb; q public.market_quotes;
 at_time timestamptz:=clock_timestamp(); asof timestamptz; key_kind text; sid uuid; aid uuid;
begin
 perform research_private.lab_require_owner(p_owner);
 if p_trade->>'kind' is null or p_trade->>'kind' not in ('SYSTEM_SIMULATION','SONY_LIVE_TRADE') then raise exception 'OWNER_EXPERIMENT_REQUIRES_DEDICATED_CONTRACT'; end if;
 if p_request is null or jsonb_typeof(p_trade) is distinct from 'object' or jsonb_typeof(p_snapshot) is distinct from 'object' then raise exception 'INPUT_INVALID'; end if;
 -- Serialize duplicate clicks without updating the original snapshot or returning a different request.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_request::text,0));
 select * into old from public.owner_lab_trades where owner_id=p_owner and request_id=p_request;
 if found then
  if (case when old.system_snapshot ? 'client_request' then old.system_snapshot->'client_request' is distinct from p_snapshot->'client_request'
   else old.system_snapshot->'request' is distinct from p_trade end) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('status','ALREADY_RECORDED','id',old.id);
 end if;
 if p_snapshot->>'version' is distinct from 'OWNER_TRADING_LAB_V1' or p_snapshot->>'production_eligible' is distinct from 'false' then raise exception 'SNAPSHOT_CONTRACT'; end if;
 asof:=(p_snapshot->>'as_of')::timestamptz;
 if asof is null or asof>at_time or asof<at_time-interval '5 minutes' then raise exception 'SNAPSHOT_TIME_INVALID'; end if;
 sid:=nullif(p_snapshot->'canonical'->>'id','')::uuid;
 if sid is not null then
  select to_jsonb(d) into canonical from public.decision_snapshots d where d.id=sid and d.created_at<=asof;
  if canonical is null or canonical is distinct from p_snapshot->'canonical' then raise exception 'CANONICAL_LINEAGE_MISMATCH'; end if;
 end if;
 aid:=nullif(p_snapshot->'shadow'->>'id','')::uuid;
 if aid is not null then
  select jsonb_build_object('id',a.id,'analysis',a.analysis,'prediction_hash',a.prediction_hash) into shadow
  from public.research_daily_analysis a where a.id=aid and a.created_at<=asof and a.analysis_cutoff_at<=asof;
  if shadow is null or shadow is distinct from p_snapshot->'shadow' then raise exception 'SHADOW_LINEAGE_MISMATCH'; end if;
 end if;
 t:=jsonb_populate_record(null::public.owner_lab_trades,p_trade);
 if t.entered_at is null or t.entered_at>at_time then raise exception 'FUTURE_ENTRY_DENIED'; end if;
 if t.kind='SYSTEM_SIMULATION' then
  if t.entered_at<asof or t.entered_at<at_time-interval '5 minutes' or canonical->>'status' is distinct from 'READY'
   or canonical->>'report_date' is distinct from (at_time at time zone 'Asia/Taipei')::date::text
   or p_snapshot->'candidate'->>'symbol' is distinct from t.symbol
   or p_snapshot->'candidate'->>'status' is distinct from 'WATCHLIST'
   or t.stop_price is null then raise exception 'PAPER_ENTRY_NOT_ELIGIBLE'; end if;
  key_kind:='PROSPECTIVE_PAPER';
  select * into q from public.market_quotes where id=(p_snapshot->>'paper_quote_id')::uuid;
  if q.id is null or q.symbol is distinct from t.symbol or q.value is distinct from t.entry_price
   or q.trading_date is distinct from (asof at time zone 'Asia/Taipei')::date or q.phase is distinct from 'intraday'
   or q.quality_status is distinct from 'verified' or q.freshness_status is null or q.freshness_status not in ('fresh','provider_returned')
   or q.captured_at is null or q.ingested_at is null or q.captured_at>asof or q.captured_at<asof-interval '5 minutes' or q.ingested_at>asof then
   raise exception 'PAPER_QUOTE_INVALID'; end if;
 else key_kind:=case when t.entered_at<at_time-interval '5 minutes' then 'RETROSPECTIVE_JOURNAL' else 'SELF_REPORTED_CURRENT' end;
 end if;
 insert into public.owner_lab_trades(owner_id,request_id,kind,symbol,entered_at,entry_price,quantity,entry_condition,stop_price,horizon,notes,system_snapshot,snapshot_hash,recording_kind)
 values(p_owner,p_request,t.kind,t.symbol,t.entered_at,t.entry_price,t.quantity,t.entry_condition,t.stop_price,t.horizon,coalesce(t.notes,''),
  p_snapshot||jsonb_build_object('request',p_trade),md5((p_snapshot||jsonb_build_object('request',p_trade))::text),key_kind) returning * into t;
 return jsonb_build_object('status','RECORDED','id',t.id);
end $$;

create function public.owner_lab_record_experiment_v1(p_owner uuid,p_request uuid,p_trade jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.recommendation_shadow_v2_runs%rowtype; c jsonb; q jsonb; n integer;
 old public.owner_lab_trades%rowtype; at_time timestamptz:=clock_timestamp(); s jsonb; trade jsonb; created uuid;
begin
 perform research_private.lab_require_owner(p_owner);
 if p_request is null or p_trade->>'kind' is distinct from 'OWNER_EXPERIMENT'
  or jsonb_typeof(p_trade) is distinct from 'object'
  or nullif(p_trade->>'symbol','') is null then raise exception 'OWNER_EXPERIMENT_CONTRACT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_request::text,0));
 select * into old from public.owner_lab_trades where owner_id=p_owner and request_id=p_request;
 if found then
  if old.kind<>'OWNER_EXPERIMENT' or old.system_snapshot->'client_request' is distinct from p_trade then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('status','ALREADY_RECORDED','id',old.id);
 end if;
 if (at_time at time zone 'Asia/Taipei')::time<time '09:00'
  or (at_time at time zone 'Asia/Taipei')::time>=time '13:30' then raise exception 'OWNER_EXPERIMENT_MARKET_CLOSED'; end if;
 select * into strict r from public.recommendation_shadow_v2_runs where id=(p_trade->>'research_run_id')::uuid;
 if r.business_date<>(at_time at time zone 'Asia/Taipei')::date or r.locked_at>at_time or r.locked_at<at_time-interval '5 minutes'
 then raise exception 'OWNER_EXPERIMENT_STALE_RESEARCH'; end if;
 select count(*) into n from jsonb_array_elements(r.result->'candidates') item where item->>'symbol'=p_trade->>'symbol' and item->>'status' in ('NONE','WATCH','READY');
 if n<>1 then raise exception 'OWNER_EXPERIMENT_CANDIDATE'; end if;
 select item into c from jsonb_array_elements(r.result->'candidates') item where item->>'symbol'=p_trade->>'symbol';
 select count(*) into n from jsonb_array_elements(r.evidence->'captures') capture,lateral jsonb_array_elements(capture->'rows') row
 where capture->>'symbol'=p_trade->>'symbol' and capture->>'endpoint'='intraday/quote' and capture->>'status'='PASS';
 if n<>1 then raise exception 'OWNER_EXPERIMENT_QUOTE_MISSING'; end if;
 select row into q from jsonb_array_elements(r.evidence->'captures') capture,lateral jsonb_array_elements(capture->'rows') row
 where capture->>'symbol'=p_trade->>'symbol' and capture->>'endpoint'='intraday/quote' and capture->>'status'='PASS';
 if q->>'symbol' is distinct from p_trade->>'symbol' or q->>'phase' is distinct from 'intraday'
  or q->>'trading_date' is distinct from r.business_date::text or q->>'quality_status' is distinct from 'verified'
  or q->>'freshness_status' is null or q->>'freshness_status' not in ('fresh','provider_returned')
  or nullif(q->>'captured_at','') is null or nullif(q->>'ingested_at','') is null
  or (q->>'captured_at')::timestamptz>at_time or (q->>'captured_at')::timestamptz<at_time-interval '5 minutes'
  or (q->>'ingested_at')::timestamptz>r.cutoff or coalesce((q->>'value')::numeric,0)<=0
  or coalesce((p_trade->>'stop_price')::numeric,0)<=0 or (p_trade->>'stop_price')::numeric>=(q->>'value')::numeric
  or length(coalesce(p_trade->>'entry_condition','')) not between 1 and 2000
 then raise exception 'OWNER_EXPERIMENT_CURRENT_QUOTE_OR_PLAN_REQUIRED'; end if;
 trade:=jsonb_build_object('kind','OWNER_EXPERIMENT','symbol',p_trade->>'symbol','entered_at',at_time,'entry_price',q->'value',
  'quantity',p_trade->'quantity','entry_condition',p_trade->>'entry_condition','stop_price',p_trade->'stop_price','horizon',p_trade->>'horizon','notes',coalesce(p_trade->>'notes',''));
 s:=jsonb_build_object('version','OWNER_EXPERIMENT_V1','production_eligible',false,'v2_performance_eligible',false,
  'source_kind','OWNER_EXPERIMENT_NOT_SYSTEM_READY','as_of',at_time,'client_request',p_trade,'request',trade,
  'research_run_id',r.id,'methodology_version',r.methodology_version,'input_sha256',r.input_sha256,'candidate',c,'paper_quote',q);
 insert into public.owner_lab_trades(owner_id,request_id,kind,symbol,entered_at,entry_price,quantity,entry_condition,stop_price,horizon,notes,system_snapshot,snapshot_hash,recording_kind)
 values(p_owner,p_request,'OWNER_EXPERIMENT',p_trade->>'symbol',at_time,(q->>'value')::numeric,(p_trade->>'quantity')::numeric,
  p_trade->>'entry_condition',(p_trade->>'stop_price')::numeric,p_trade->>'horizon',coalesce(p_trade->>'notes',''),s,
  encode(extensions.digest(convert_to(s::text,'UTF8'),'sha256'),'hex'),'PROSPECTIVE_PAPER') returning id into created;
 return jsonb_build_object('status','RECORDED','id',created,'v2_performance_eligible',false);
end $$;
revoke all on function public.owner_lab_record_experiment_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.owner_lab_record_experiment_v1(uuid,uuid,jsonb) to service_role;

-- Paper experiments stay in the existing Owner journal, never V2 predictions.
-- A normalized outcome capture can back an event without inserting market data.
alter table public.owner_lab_trade_events add column research_source_revision text
 references research_private.recommendation_v2_outcome_sources(source_revision);
do $$ declare name text;n integer;begin
 select count(*),min(conname) into n,name from pg_constraint where conrelid='public.owner_lab_trade_events'::regclass
  and contype='c' and pg_get_constraintdef(oid) like '%OUTCOME%' and pg_get_constraintdef(oid) like '%quote_id%';
 if n<>1 then raise exception 'OWNER_EVENT_PREDECESSOR_DRIFT';end if;
 execute format('alter table public.owner_lab_trade_events drop constraint %I',name);
end $$;
alter table public.owner_lab_trade_events add constraint owner_lab_event_source_contract check(
 (event_type='EXIT' and event_key='EXIT' and quote_id is null and research_source_revision is null)
 or (event_type='OUTCOME' and event_key in ('CLOSE','1D','3D','5D') and target_date is not null
  and ((quote_id is not null and research_source_revision is null) or (quote_id is null and research_source_revision is not null))));
create function public.pending_owner_v2_experiments() returns jsonb
language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(payload),'[]'::jsonb) from (
  select jsonb_build_object('id',t.id,'symbol',t.symbol,'targets',public.owner_lab_target_sessions_v1(t.entered_at),
   'completed_horizons',coalesce((select jsonb_agg(event_key) from public.owner_lab_trade_events e where e.trade_id=t.id),'[]'::jsonb)) payload
  from public.owner_lab_trades t where t.kind='OWNER_EXPERIMENT' and t.entered_at>=clock_timestamp()-interval '65 days'
   and exists(select 1 from jsonb_each_text(public.owner_lab_target_sessions_v1(t.entered_at)) h
    where (h.value||'T13:30:00+08:00')::timestamptz<=clock_timestamp()
    and not exists(select 1 from public.owner_lab_trade_events e where e.trade_id=t.id and e.event_key=h.key))
  order by t.entered_at limit 200
 ) q
$$;
create function public.store_owner_v2_experiment_outcome(p_trade uuid,p_horizon text,p_source text) returns text
language plpgsql security definer set search_path='' as $$
declare t public.owner_lab_trades%rowtype; s research_private.recommendation_v2_outcome_sources%rowtype;
 d date;q jsonb;n integer;price numeric;before public.owner_lab_trade_events%rowtype;
begin
 select * into strict t from public.owner_lab_trades where id=p_trade and kind='OWNER_EXPERIMENT';
 perform research_private.lab_require_owner(t.owner_id);
 if p_horizon is null or p_horizon not in ('CLOSE','1D','3D','5D') then raise exception 'OWNER_EXPERIMENT_HORIZON';end if;
 d:=(public.owner_lab_target_sessions_v1(t.entered_at)->>p_horizon)::date;
 select * into strict s from research_private.recommendation_v2_outcome_sources where source_revision=p_source;
 if d is null or s.observed_at<(d::text||'T13:30:00+08:00')::timestamptz or s.observed_at>clock_timestamp() then raise exception 'OWNER_EXPERIMENT_FUTURE_OUTCOME';end if;
 select count(*) into n from jsonb_array_elements(s.evidence->'captures') c,lateral jsonb_array_elements(c->'rows') r
 where c->>'symbol'=t.symbol and c->>'status'='PASS' and c->>'endpoint'='historical/candles' and r->>'trading_date'=d::text;
 if n<>1 then raise exception 'OWNER_EXPERIMENT_OUTCOME_SOURCE';end if;
 select r into q from jsonb_array_elements(s.evidence->'captures') c,lateral jsonb_array_elements(c->'rows') r
 where c->>'symbol'=t.symbol and c->>'status'='PASS' and c->>'endpoint'='historical/candles' and r->>'trading_date'=d::text;
 price:=(q#>>'{raw_payload,close}')::numeric;
 if price is null or price<=0 or nullif(q->>'ingested_at','') is null or (q->>'ingested_at')::timestamptz>s.observed_at
  or (q->>'ingested_at')::timestamptz<(d::text||'T13:30:00+08:00')::timestamptz
 then raise exception 'OWNER_EXPERIMENT_OUTCOME_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(t.id::text||p_horizon,0));
 select * into before from public.owner_lab_trade_events where trade_id=t.id and event_key=p_horizon;
 if found then if before.price<>price then raise exception 'OWNER_EXPERIMENT_OUTCOME_CONFLICT';end if;return 'ALREADY_RECORDED';end if;
 insert into public.owner_lab_trade_events(trade_id,event_key,event_type,occurred_at,price,target_date,payload,research_source_revision)
 values(t.id,p_horizon,'OUTCOME',(d::text||'T13:30:00+08:00')::timestamptz,price,d,
  jsonb_build_object('return_percent',(price/t.entry_price-1)*100,'source_kind','OWNER_EXPERIMENT_NOT_SYSTEM_READY',
   'v2_performance_eligible',false,'gross_of_costs',true,'source_ref',q->>'id','mfe',null,'mae',null),p_source);
 return 'RECORDED';
end $$;
revoke all on function public.pending_owner_v2_experiments(),public.store_owner_v2_experiment_outcome(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pending_owner_v2_experiments(),public.store_owner_v2_experiment_outcome(uuid,text,text) to service_role;

commit;
