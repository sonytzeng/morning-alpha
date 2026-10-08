-- CANDIDATE ONLY. Additive independent research; no existing policies or rows change.
begin;
create table public.entry_opportunity_runs (
 id uuid primary key default gen_random_uuid(),
 source_run_id uuid not null references public.recommendation_shadow_v2_runs(id),
 version text not null check(version='ENTRY_OPPORTUNITY_1.0.0'),
 mode text not null check(mode in ('HISTORICAL_REPLAY','FORWARD')),
 business_date date not null,
 evaluation_time timestamptz not null,
 locked_at timestamptz not null default clock_timestamp(),
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 evidence jsonb not null, result jsonb not null,
 unique(source_run_id,version,mode)
);
create index entry_opportunity_runs_date on public.entry_opportunity_runs(business_date desc,locked_at desc);
create table public.entry_opportunity_predictions (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.entry_opportunity_runs(id),
 symbol text not null check(symbol ~ '^[0-9]{4,6}$'),
 strategy_version text not null check(strategy_version in ('OVERSOLD_REVERSAL_1.0.0','PULLBACK_ENTRY_1.0.0','BREAKOUT_CONTINUATION_1.0.0')),
 status text not null check(status in ('ENTRY_READY','WAIT_CONFIRMATION','AVOID_ENTRY','INSUFFICIENT_EVIDENCE')),
 prediction jsonb not null, unique(run_id,symbol,strategy_version)
);
create table public.entry_opportunity_outcomes (
 prediction_id uuid not null references public.entry_opportunity_predictions(id),
 horizon integer not null check(horizon in (1,3,5,10,20)),
 observed_at timestamptz not null, stored_at timestamptz not null default clock_timestamp(),
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 evidence jsonb not null, result jsonb not null, primary key(prediction_id,horizon)
);
alter table public.entry_opportunity_runs enable row level security;
alter table public.entry_opportunity_predictions enable row level security;
alter table public.entry_opportunity_outcomes enable row level security;
create policy entry_runs_owner_read on public.entry_opportunity_runs for select to authenticated using ((select public.is_research_owner_v1()));
create policy entry_predictions_owner_read on public.entry_opportunity_predictions for select to authenticated using ((select public.is_research_owner_v1()));
create policy entry_outcomes_owner_read on public.entry_opportunity_outcomes for select to authenticated using ((select public.is_research_owner_v1()));
revoke all on public.entry_opportunity_runs,public.entry_opportunity_predictions,public.entry_opportunity_outcomes from public,anon,authenticated,service_role;
grant select on public.entry_opportunity_runs,public.entry_opportunity_predictions,public.entry_opportunity_outcomes to authenticated,service_role;
create function research_private.reject_entry_opportunity_mutation() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'ENTRY_IMMUTABLE' using errcode='23514'; end $$;
revoke all on function research_private.reject_entry_opportunity_mutation() from public,anon,authenticated,service_role;
create trigger entry_runs_immutable before update or delete or truncate on public.entry_opportunity_runs for each statement execute function research_private.reject_entry_opportunity_mutation();
create trigger entry_predictions_immutable before update or delete or truncate on public.entry_opportunity_predictions for each statement execute function research_private.reject_entry_opportunity_mutation();
create trigger entry_outcomes_immutable before update or delete or truncate on public.entry_opportunity_outcomes for each statement execute function research_private.reject_entry_opportunity_mutation();

create function public.store_entry_opportunity_v1(p_source uuid,p_evidence_text text,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.recommendation_shadow_v2_runs%rowtype; old public.entry_opportunity_runs%rowtype;
 e jsonb; h text; id uuid; c jsonb; n integer; at timestamptz; m text; plan jsonb;
begin
 if p_source is null or p_evidence_text is null or p_result is null or octet_length(p_evidence_text)>4000000 then raise exception 'ENTRY_INPUT_LIMIT'; end if;
 select * into strict s from public.recommendation_shadow_v2_runs where recommendation_shadow_v2_runs.id=p_source;
 e:=p_evidence_text::jsonb;h:=encode(extensions.digest(p_evidence_text,'sha256'),'hex');
 at:=(e->>'evaluation_time')::timestamptz;m:=e->>'mode';
 if m is null or m not in ('HISTORICAL_REPLAY','FORWARD') or at is distinct from s.cutoff or at>clock_timestamp()
  or e->>'source_revision' is distinct from s.source_revision or e->>'source_evidence_hash' is distinct from s.input_sha256
  or (e->>'business_date')::date is distinct from s.business_date or e->>'provenance' is distinct from 'REAL_RETAINED'
  or p_result->>'version' is distinct from 'ENTRY_OPPORTUNITY_1.0.0' or p_result->>'evidence_hash' is distinct from h
  or p_result->>'mode' is distinct from m or (p_result->>'evaluation_time')::timestamptz is distinct from at
  or p_result->>'source_evidence_hash' is distinct from s.input_sha256 or p_result->>'source_revision' is distinct from s.source_revision
  or (p_result->>'business_date')::date is distinct from s.business_date
  or p_result->>'owner_only' is distinct from 'true' or p_result->>'shadow_only' is distinct from 'true'
  or p_result->>'production_eligible' is distinct from 'false'
  or jsonb_typeof(e->'stocks') is distinct from 'array' or jsonb_typeof(p_result->'candidates') is distinct from 'array'
 then raise exception 'ENTRY_LINEAGE_INVALID';end if;
 n:=jsonb_array_length(e->'stocks');
 if n<1 or n>72 or (select count(distinct x->>'symbol') from jsonb_array_elements(e->'stocks') x)<>n
  or jsonb_array_length(p_result->'candidates')<>3*n or (p_result->>'universe')::integer is distinct from n
  or (p_result->>'scanned')::integer is distinct from n then raise exception 'ENTRY_UNIVERSE_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('ENTRY:'||p_source::text||':'||m,0));
 select * into old from public.entry_opportunity_runs where source_run_id=p_source and version='ENTRY_OPPORTUNITY_1.0.0' and mode=m;
 if found then
  if old.evidence_hash<>h or old.result<>p_result then raise exception 'ENTRY_IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('status','ALREADY_STORED','run_id',old.id);
 end if;
 if m='FORWARD' and (at<clock_timestamp()-interval '5 minutes' or s.business_date<>(clock_timestamp() at time zone 'Asia/Taipei')::date)
 then raise exception 'ENTRY_FORWARD_NOT_CURRENT';end if;
 insert into public.entry_opportunity_runs(source_run_id,version,mode,business_date,evaluation_time,evidence_hash,evidence,result)
 values(p_source,'ENTRY_OPPORTUNITY_1.0.0',m,s.business_date,at,h,e,p_result) returning entry_opportunity_runs.id into id;
 for c in select value from jsonb_array_elements(p_result->'candidates') loop
  if not exists(select from jsonb_array_elements(e->'stocks') x where x->>'symbol'=c->>'symbol')
   or c->>'strategy_version' is distinct from (c->>'strategy')||'_1.0.0'
   or c->'horizons' is distinct from '[1,3,5,10,20]'::jsonb or c#>'{evidence_confidence,probability}' is distinct from 'null'::jsonb
  then raise exception 'ENTRY_PREDICTION_INVALID';end if;
  plan:=c->'plan';
  if c->>'status'='ENTRY_READY' then
   if jsonb_typeof(plan) is distinct from 'object' or coalesce((plan->>'stop')::numeric,0)<=0
    or coalesce((plan->>'trigger')::numeric,0)<=(plan->>'stop')::numeric
    or coalesce((plan#>>'{reference_range,1}')::numeric,0)<(plan->>'trigger')::numeric
    or coalesce((plan->>'target')::numeric,0)<=(plan#>>'{reference_range,1}')::numeric
    or coalesce((plan->>'reward_risk')::numeric,0)<2
    or public.previous_market_session_v1('TW',(plan->>'not_before')::date) is distinct from s.business_date
    or plan->>'not_before' is distinct from plan->>'expires_on'
    or (m='FORWARD' and ((plan->>'not_before')||'T09:00:00+08:00')::timestamptz<=clock_timestamp())
   then raise exception 'ENTRY_PLAN_INVALID';end if;
  end if;
  insert into public.entry_opportunity_predictions(run_id,symbol,strategy_version,status,prediction)
  values(id,c->>'symbol',c->>'strategy_version',c->>'status',c);
 end loop;
 return jsonb_build_object('status','STORED','run_id',id);
end $$;
revoke all on function public.store_entry_opportunity_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.store_entry_opportunity_v1(uuid,text,jsonb) to service_role;

create function public.get_owner_entry_opportunity_v1() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare latest jsonb;
begin
 if public.is_research_owner_v1() is not true then raise exception 'RESEARCH_OWNER_REQUIRED' using errcode='42501';end if;
 select result||jsonb_build_object('locked_at',locked_at) into latest from public.entry_opportunity_runs order by evaluation_time desc,locked_at desc limit 1;
 return jsonb_build_object('owner_only',true,'shadow_only',true,'production_eligible',false,'latest',latest,
 'today_date',(now() at time zone 'Asia/Taipei')::date,
 'forward_sample',(select count(distinct business_date) from public.entry_opportunity_runs where mode='FORWARD'),
 'historical_replay_count',(select count(*) from public.entry_opportunity_runs where mode='HISTORICAL_REPLAY'),
 'outcome_sample',(select count(*) from public.entry_opportunity_outcomes),
 'analysis_value','INSUFFICIENT_SAMPLE');
end $$;
revoke all on function public.get_owner_entry_opportunity_v1() from public,anon;
grant execute on function public.get_owner_entry_opportunity_v1() to authenticated;
-- Outcome writes intentionally remain unavailable in this draft candidate.
-- Existing saved sources lack verified adjustment/executability lineage.
-- A boolean supplied by the caller must never create a real performance sample.
-- No role has INSERT/UPDATE/DELETE on the outcome table; no write RPC is granted.
commit;
