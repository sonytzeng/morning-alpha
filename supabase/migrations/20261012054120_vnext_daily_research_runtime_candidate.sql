-- CANDIDATE ONLY. New private runtime; no Cron, existing policies or business writes.
begin;
create schema vnext_runtime;
revoke all on schema vnext_runtime from public,anon,authenticated,service_role;
create table vnext_runtime.runs(
 id uuid primary key default gen_random_uuid(),business_date date not null unique,
 upstream_batch uuid not null,upstream_phase text not null,created_at timestamptz not null default clock_timestamp(),
 actionable_at timestamptz not null,state text not null default 'QUEUED' check(state in('QUEUED','RUNNING','COMPLETE','BLOCKED','EXPIRED')),
 lease uuid,lease_until timestamptz,fence integer not null default 0 check(fence>=0),invocations integer not null default 0 check(invocations between 0 and 512),
 checkpoint jsonb not null default '{}',plan jsonb not null default '[]',cursor integer not null default 0 check(cursor>=0),
 source_revision text,reason text,updated_at timestamptz not null default clock_timestamp());
create table vnext_runtime.source_revisions(
 id text primary key check(id~'^[a-f0-9]{64}$'),task_key text not null,received_at timestamptz not null,
 source text not null,payload_text text not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 check(octet_length(payload_text)<=12000000));
create index vnext_source_cache on vnext_runtime.source_revisions(task_key,received_at desc);
create table vnext_runtime.run_sources(
 run_id uuid not null references vnext_runtime.runs(id),task_key text not null,attempts integer not null default 0 check(attempts between 0 and 3),
 source_id text references vnext_runtime.source_revisions(id),reason text,retry_at timestamptz,primary key(run_id,task_key));
create table vnext_runtime.predictions(
 id text primary key,run_id uuid not null references vnext_runtime.runs(id),symbol text not null,horizon text not null check(horizon in('SHORT','MEDIUM','LONG')),
 lock_hash text not null check(lock_hash~'^[a-f0-9]{64}$'),payload_text text not null,payload jsonb not null,
 locked_at timestamptz not null default clock_timestamp(),unique(run_id,symbol,horizon));
create table vnext_runtime.outcomes(
 id text primary key,prediction_id text not null references vnext_runtime.predictions(id),horizon integer not null,
 observed_at timestamptz not null,source_revision text not null,payload jsonb not null,
 check(payload->>'performance_eligible'='false'),unique(prediction_id,horizon,source_revision));
create index vnext_outcome_parent on vnext_runtime.outcomes(prediction_id,observed_at desc);
create table vnext_runtime.outcome_queue(
 prediction_id text primary key references vnext_runtime.predictions(id),last_checked date,
 next_due date not null,completed_horizons integer[] not null default '{}');
create table vnext_runtime.publication_status(
 prediction_id text primary key references vnext_runtime.predictions(id),status text not null default 'OWNER_REVIEW_REQUIRED' check(status='OWNER_REVIEW_REQUIRED'),
 licensing text not null default 'PENDING' check(licensing='PENDING'),approved boolean not null default false check(not approved));
create table vnext_runtime.audit(
 id bigint generated always as identity primary key,run_id uuid references vnext_runtime.runs(id),
 operation text not null,at timestamptz not null default clock_timestamp(),details jsonb not null default '{}');
create index vnext_audit_run on vnext_runtime.audit(run_id,id);
create function vnext_runtime.immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'VNEXT_RUNTIME_IMMUTABLE';end$$;
revoke all on function vnext_runtime.immutable() from public,anon,authenticated,service_role;
do $$declare n text;begin
 foreach n in array array['runs','source_revisions','run_sources','predictions','outcomes','outcome_queue','publication_status','audit'] loop
  execute format('alter table vnext_runtime.%I enable row level security',n);
  execute format('alter table vnext_runtime.%I force row level security',n);
  execute format('revoke all on vnext_runtime.%I from public,anon,authenticated,service_role',n);
 end loop;
 foreach n in array array['source_revisions','predictions','outcomes','publication_status','audit'] loop
  execute format('create trigger immutable before update or delete on vnext_runtime.%I for each row execute function vnext_runtime.immutable()',n);
 end loop;
end$$;

-- Admission reads a committed natural checkpoint, never a browser claim that
-- market_ready=true. A V2 failure does not wait on or become a VNext result.
create function public.enqueue_vnext_daily_research_v1(p_date date,p_phase text,p_batch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r vnext_runtime.runs;at_time timestamptz:=clock_timestamp();begin
 if p_date is null or p_date<>(at_time at time zone 'Asia/Taipei')::date or not public.market_calendar_session_v1('TW',p_date) then return jsonb_build_object('status','CLOSED_OR_WRONG_DATE');end if;
 if p_phase is null or p_phase not in('PREMARKET','09:00','09:30','10:30','13:00','14:10','14:30') or p_batch is null then raise exception 'CHECKPOINT_SCOPE';end if;
 if not exists(select from public.market_checkpoint_batches b where b.batch_id=p_batch and b.business_date=p_date
  and b.checkpoint=case when p_phase='PREMARKET' then p_phase else replace(p_phase,':','') end and b.status='COMMITTED'
  and b.expected_provider_count=11 and b.committed_provider_count=11 and b.committed_at<=at_time) then raise exception 'UPSTREAM_NOT_COMMITTED';end if;
 insert into vnext_runtime.runs(business_date,upstream_batch,upstream_phase,actionable_at)
 values(p_date,p_batch,p_phase,(p_date::text||' 09:00 Asia/Taipei')::timestamptz) on conflict(business_date) do nothing;
 select * into strict r from vnext_runtime.runs where business_date=p_date;
 return jsonb_build_object('status',r.state,'run_id',r.id,'business_date',r.business_date);
end$$;

create function public.claim_vnext_daily_research_v1(p_run uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare r vnext_runtime.runs;begin
 -- Global finite worker lease keeps provider pacing across concurrent invocations.
 if not pg_try_advisory_xact_lock(770230001) then return '{"status":"BUSY"}'::jsonb;end if;
 if exists(select from vnext_runtime.runs where lease_until>clock_timestamp()) then return '{"status":"BUSY"}'::jsonb;end if;
 select * into r from vnext_runtime.runs where id=p_run for update skip locked;
 if not found then return '{"status":"NOT_FOUND"}'::jsonb;end if;
 if r.business_date<>(clock_timestamp() at time zone 'Asia/Taipei')::date then return '{"status":"DATE_EXPIRED"}'::jsonb;end if;
 if r.invocations>=512 then
  update vnext_runtime.runs set state='BLOCKED',reason='INVOCATION_BUDGET_EXHAUSTED',lease=null,lease_until=null where id=r.id;
  return '{"status":"BUDGET_EXHAUSTED"}'::jsonb;
 end if;
 if r.state in('COMPLETE','EXPIRED') then return jsonb_build_object('status',r.state);end if;
 update vnext_runtime.runs set state='RUNNING',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '100 seconds',
 fence=fence+1,invocations=invocations+1,updated_at=clock_timestamp() where id=r.id returning * into r;
 insert into vnext_runtime.audit(run_id,operation,details) values(r.id,'CLAIM',jsonb_build_object('fence',r.fence));
 return jsonb_build_object('status','ACQUIRED','run',to_jsonb(r));
end$$;

-- All mutations take the run lock, verify fencing AND lease age. No provider
-- network call happens inside a database transaction.
create function public.vnext_daily_runtime_v1(p_run uuid,p_lease uuid,p_fence integer,p_op text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r vnext_runtime.runs;v_source vnext_runtime.source_revisions;v_task vnext_runtime.run_sources;
 row jsonb;v jsonb;id_hash text;txt text;result jsonb;old vnext_runtime.predictions;n integer;due date;steps integer;begin
 select * into strict r from vnext_runtime.runs where id=p_run for update;
 if p_lease is null or p_fence is null or r.lease is distinct from p_lease or r.fence<>p_fence or r.lease_until<=clock_timestamp() then raise exception 'LEASE_FENCED';end if;
 if p_op='PLAN' then
  if jsonb_typeof(p_data)<>'array' or jsonb_array_length(p_data)>1600 or jsonb_array_length(p_data)=0 then raise exception 'PLAN_INVALID';end if;
  if r.plan<>'[]' and r.plan is distinct from p_data then raise exception 'PLAN_IMMUTABLE';end if;
  update vnext_runtime.runs set plan=p_data where id=r.id;return '{"status":"STORED"}';
 elsif p_op='SOURCE_BEGIN' then
  insert into vnext_runtime.run_sources(run_id,task_key) values(r.id,p_data->>'key') on conflict do nothing;
  select * into strict v_task from vnext_runtime.run_sources where run_id=r.id and task_key=p_data->>'key';
  if v_task.source_id is not null then select * into v_source from vnext_runtime.source_revisions where id=v_task.source_id;return jsonb_build_object('status','CACHE','receipt',v_source.receipt);end if;
  select * into v_source from vnext_runtime.source_revisions where task_key=p_data->>'key' and received_at<=clock_timestamp()
   and received_at>=clock_timestamp()-make_interval(days=>least(7,greatest(0,(p_data->>'max_age_days')::integer)))
   and receipt->>'status'='OK' order by received_at desc limit 1;
  if found then update vnext_runtime.run_sources set source_id=v_source.id where run_id=r.id and task_key=v_task.task_key;return jsonb_build_object('status','CACHE','receipt',v_source.receipt);end if;
  if v_task.attempts>=3 then return jsonb_build_object('status','EXHAUSTED','reason',v_task.reason);end if;
  if v_task.retry_at>clock_timestamp() then return jsonb_build_object('status','WAIT_RETRY','retry_at',v_task.retry_at);end if;
  update vnext_runtime.run_sources set attempts=attempts+1 where run_id=r.id and task_key=v_task.task_key;
  return '{"status":"FETCH"}';
 elsif p_op='SOURCE_SAVE' then
  txt:=p_data->>'text';v:=txt::jsonb;id_hash:=encode(sha256(convert_to(txt,'UTF8')),'hex');
  if octet_length(txt)>12000000 or v->>'version'<>'VNEXT_DAILY_OFFICIAL_1' or (v->>'available_at')::timestamptz>clock_timestamp()
   or (v->>'first_seen_at')::timestamptz<>(v->>'available_at')::timestamptz or (v->>'first_seen_at')::timestamptz<r.created_at then raise exception 'SOURCE_TIME_INVALID';end if;
  if not exists(select from vnext_runtime.run_sources where run_id=r.id and task_key=v->'task'->>'key' and attempts>0 and source_id is null) then raise exception 'SOURCE_NOT_RESERVED';end if;
  insert into vnext_runtime.source_revisions(id,task_key,received_at,source,payload_text,receipt)
   values(id_hash,v->'task'->>'key',(v->>'available_at')::timestamptz,v->'task'->>'url',txt,v) on conflict(id) do nothing;
  update vnext_runtime.run_sources set source_id=id_hash,reason=null where run_id=r.id and task_key=v->'task'->>'key';
  return jsonb_build_object('status','STORED','source_revision',id_hash);
 elsif p_op='SOURCE_FAIL' then
  if coalesce(p_data->>'reason','')!~'^[A-Z0-9_]{1,100}$' then raise exception 'FAILURE_CLASS_INVALID';end if;
  update vnext_runtime.run_sources set reason=p_data->>'reason',retry_at=clock_timestamp()+make_interval(secs=>least(300,greatest(3,coalesce((p_data->>'retry_seconds')::integer,3)))) where run_id=r.id and task_key=p_data->>'key';
  return '{"status":"RECORDED"}';
 elsif p_op='CURSOR' then
  if (p_data->>'cursor')::integer<r.cursor or (p_data->>'cursor')::integer>jsonb_array_length(r.plan) then raise exception 'CURSOR_SCOPE';end if;
  update vnext_runtime.runs set cursor=(p_data->>'cursor')::integer where id=r.id;return '{"status":"STORED"}';
 elsif p_op='ENTRY_SOURCE' then
  select jsonb_build_object('evidence',s.evidence,'hash',s.input_sha256,'market',
   case when c.id is not null and jsonb_typeof(c.generated_text->'market_bias')='string' and c.market_regime is not null then
    jsonb_build_object('value',jsonb_build_object('direction',c.generated_text->>'market_bias','regime',c.market_regime),
     'source_ref',c.id::text,'observed_at',c.created_at,'available_at',c.created_at) else null end) into result
  from public.recommendation_shadow_v2_runs s left join lateral(select d.* from public.decision_snapshots d
   where d.report_date=r.business_date and d.session_type='PREMARKET' and d.status='READY' and d.created_at<=s.cutoff order by d.created_at desc limit 1)c on true
  where s.business_date=r.business_date and s.source_batch_id=r.upstream_batch and s.cutoff<=clock_timestamp() order by s.cutoff desc limit 1;
  return coalesce(result,'{}');
 elsif p_op='SOURCES' then
  select coalesce(jsonb_agg(s.receipt order by s.task_key),'[]') into result from vnext_runtime.run_sources t join vnext_runtime.source_revisions s on s.id=t.source_id where t.run_id=r.id;
  return result;
 elsif p_op='CHECKPOINT' then
  if octet_length(p_data::text)>30000000 then raise exception 'CHECKPOINT_SIZE';end if;
  if r.checkpoint->'locks' is not null and r.checkpoint->'locks' is distinct from p_data->'locks' then raise exception 'PREPARED_LOCKS_IMMUTABLE';end if;
  if r.source_revision is not null and r.source_revision is distinct from p_data->'acquired'->>'snapshot_hash' then raise exception 'SOURCE_REVISION_IMMUTABLE';end if;
  if p_data->'acquired' is not null and coalesce(p_data->'acquired'->>'snapshot_hash','')!~'^[a-f0-9]{64}$' then raise exception 'SOURCE_REVISION_INVALID';end if;
  update vnext_runtime.runs set checkpoint=p_data,source_revision=p_data->'acquired'->>'snapshot_hash' where id=r.id;return '{"status":"STORED"}';
 elsif p_op='PREDICTIONS' then
  if jsonb_typeof(p_data)<>'array' or jsonb_array_length(p_data)<>216 then raise exception 'PREDICTION_UNIVERSE';end if;
  select count(distinct (x->'body'->>'symbol')||':'||(x->'body'->>'horizon')) into n from jsonb_array_elements(p_data) x;
  if n<>216 then raise exception 'PREDICTION_DUPLICATES';end if;
  for row in select * from jsonb_array_elements(p_data) loop
   txt:=row->>'canonical';v:=row->'body';id_hash:=encode(sha256(convert_to(txt,'UTF8')),'hex');
   if txt is null or jsonb_typeof(v)<>'object' or txt::jsonb is distinct from (v-'lock_hash') or id_hash is distinct from v->>'lock_hash' then raise exception 'PREDICTION_HASH';end if;
   if r.source_revision is null or (r.checkpoint->'locks' @> jsonb_build_array(v)) is distinct from true then raise exception 'PREPARED_PREDICTION_REQUIRED';end if;
   select * into old from vnext_runtime.predictions where id=v->>'id';
   if found then if old.payload is distinct from v then raise exception 'IDEMPOTENCY_CONFLICT';end if;continue;end if;
   if not (v ?& array['id','symbol','horizon','generated_at','locked_at','evidence_cutoff','actionable_at','target_sessions','research','evidence_hash'])
    or v->>'mode' is distinct from 'FORWARD_SHADOW' or v->>'provenance' is distinct from 'RETAINED_REAL_EVIDENCE' or (v->>'business_date')::date is distinct from r.business_date
    or (v->>'actionable_at')::timestamptz is distinct from r.actionable_at or clock_timestamp()>=r.actionable_at
    or v->>'generated_at' is null or v->>'locked_at' is null or v->>'evidence_cutoff' is null
    or (v->>'locked_at')::timestamptz>clock_timestamp() or (v->>'locked_at')::timestamptz<r.created_at
    or (v->>'generated_at')::timestamptz>(v->>'locked_at')::timestamptz or (v->>'evidence_cutoff')::timestamptz>(v->>'generated_at')::timestamptz
    or (v->>'evidence_cutoff')::timestamptz<r.created_at then raise exception 'FORWARD_TIME_INVALID';end if;
   if v->>'strategy_version' is distinct from 'VNEXT_OBSERVATION_HYPOTHESIS_2.0.0' or v->>'entry_version' is distinct from 'ENTRY_OPPORTUNITY_1.0.0'
    or v->>'symbol' is distinct from v->'research'->>'symbol' or v->>'horizon' is distinct from v->'research'->>'horizon' then raise exception 'PREDICTION_VERSION_SCOPE';end if;
   if v->'target_sessions' is distinct from (case v->>'horizon' when 'SHORT' then '[1,5,10]'::jsonb when 'MEDIUM' then '[20,40,60]'::jsonb when 'LONG' then '[120,180,250]'::jsonb else '[]'::jsonb end)
    or v->>'evidence_cutoff' is distinct from r.checkpoint->'acquired'->>'evidence_cutoff' then raise exception 'PREDICTION_HORIZON_OR_CUTOFF';end if;
   insert into vnext_runtime.predictions(id,run_id,symbol,horizon,lock_hash,payload_text,payload) values(v->>'id',r.id,v->>'symbol',v->>'horizon',id_hash,txt,v);
   insert into vnext_runtime.outcome_queue(prediction_id,next_due) values(v->>'id',r.business_date);
   insert into vnext_runtime.publication_status(prediction_id) values(v->>'id');
  end loop;
  insert into vnext_runtime.audit(run_id,operation,details) values(r.id,'PREDICTION_LOCK',jsonb_build_object('count',216));return '{"status":"LOCKED"}';
 elsif p_op='DUE_OUTCOMES' then
  select coalesce(jsonb_agg(x.work),'[]') into result from(select jsonb_build_object('prediction',p.payload,'horizons',
   (select jsonb_agg(h.value) from jsonb_array_elements(p.payload->'target_sessions') h where not (h.value::text::integer=any(q.completed_horizons)))) as work
   from vnext_runtime.outcome_queue q join vnext_runtime.predictions p on p.id=q.prediction_id
   where (q.next_due::text||' 13:30 Asia/Taipei')::timestamptz<=clock_timestamp() and (q.last_checked is null or q.last_checked<(clock_timestamp() at time zone 'Asia/Taipei')::date)
   and cardinality(q.completed_horizons)<jsonb_array_length(p.payload->'target_sessions')
   order by q.next_due,p.id limit 24) x;return result;
 elsif p_op='OUTCOME' then
  v:=p_data->'result';select * into strict old from vnext_runtime.predictions where id=v->>'prediction_id';
  if v->>'prediction_hash' is distinct from old.lock_hash or v->>'performance_eligible' is distinct from 'false' or v->>'actual_fill_confirmed' is distinct from 'false'
   or v->'net_return' is distinct from 'null'::jsonb or v->'mfe' is distinct from 'null'::jsonb or v->'mae' is distinct from 'null'::jsonb
   or v->>'observed_at' is null or v->>'horizon' is null or v->>'state' is null or coalesce(v->>'outcome_source_hash','')!~'^[a-f0-9]{64}$'
   or (v->>'observed_at')::timestamptz>clock_timestamp()
   or (v->>'observed_at')::timestamptz<old.locked_at or not (old.payload->'target_sessions' @> jsonb_build_array((v->>'horizon')::integer))
   or v->>'state' not in('UNKNOWN','NOT_MATURED','OBSERVED_NOT_PERFORMANCE') then raise exception 'OUTCOME_CONTRACT';end if;
  if v->>'state'='OBSERVED_NOT_PERFORMANCE' then
   due:=(old.payload->>'business_date')::date;steps:=0;n:=0;
   while n<(v->>'horizon')::integer and steps<600 loop
    if public.market_calendar_session_v1('TW',due) then n:=n+1;end if;
    if n<(v->>'horizon')::integer then due:=due+1;end if;steps:=steps+1;
   end loop;
   if n<(v->>'horizon')::integer or (v->>'observed_at')::timestamptz<(due::text||' 13:30 Asia/Taipei')::timestamptz then raise exception 'OUTCOME_NOT_MATURED';end if;
  end if;
  if exists(select from vnext_runtime.outcomes where id=p_data->>'id' and payload is distinct from v) then raise exception 'OUTCOME_IDEMPOTENCY_CONFLICT';end if;
  insert into vnext_runtime.outcomes(id,prediction_id,horizon,observed_at,source_revision,payload) values(p_data->>'id',old.id,(v->>'horizon')::integer,(v->>'observed_at')::timestamptz,v->>'outcome_source_hash',v) on conflict(id) do nothing;
  return '{"status":"STORED"}';
 elsif p_op='OUTCOME_CHECKED' then
  update vnext_runtime.outcome_queue q set last_checked=(clock_timestamp() at time zone 'Asia/Taipei')::date,
   completed_horizons=array(select distinct o.horizon from vnext_runtime.outcomes o where o.prediction_id=q.prediction_id and o.payload->>'state'='OBSERVED_NOT_PERFORMANCE')
   where q.prediction_id=p_data->>'id';return '{"status":"STORED"}';
 elsif p_op='FINISH' then
  if p_data->>'status' not in('QUEUED','COMPLETE','BLOCKED','EXPIRED') then raise exception 'FINISH_STATE';end if;
  if p_data->>'status'='COMPLETE' and (select count(*) from vnext_runtime.predictions where run_id=r.id)<>216 then raise exception 'INCOMPLETE_LOCK';end if;
  update vnext_runtime.runs set state=p_data->>'status',lease=null,lease_until=null,reason=p_data->>'reason',updated_at=clock_timestamp() where id=r.id;
  insert into vnext_runtime.audit(run_id,operation,details) values(r.id,'FINISH',p_data);return '{"status":"STORED"}';
 end if;
 raise exception 'OPERATION_NOT_ALLOWED';
end$$;

create function public.get_owner_vnext_daily_v1(p_date date default (clock_timestamp() at time zone 'Asia/Taipei')::date) returns jsonb
language plpgsql security definer set search_path='' as $$declare r vnext_runtime.runs;rows jsonb;begin
 if not public.is_research_owner_v1() then raise exception 'RESEARCH_OWNER_REQUIRED' using errcode='42501';end if;
 select * into r from vnext_runtime.runs where business_date=p_date;
 select coalesce(jsonb_agg(p.payload order by p.symbol,p.horizon),'[]') into rows from vnext_runtime.predictions p where p.run_id=r.id;
 return jsonb_build_object('business_date',p_date,'state',coalesce(r.state,'NOT_OBSERVED'),'reason',r.reason,'predictions',rows,'member_published',0,
 'analysis_value','INSUFFICIENT_SAMPLE','performance_sample',0,'source_count',(select count(*) from vnext_runtime.run_sources where run_id=r.id and source_id is not null));
end$$;
revoke all on function public.enqueue_vnext_daily_research_v1(date,text,uuid),public.claim_vnext_daily_research_v1(uuid),public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb),public.get_owner_vnext_daily_v1(date) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_vnext_daily_research_v1(date,text,uuid),public.claim_vnext_daily_research_v1(uuid),public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb) to service_role;
grant execute on function public.get_owner_vnext_daily_v1(date) to authenticated;
comment on schema vnext_runtime is 'VNEXT_DAILY_CANDIDATE_1; Owner-only; no member publication; no schedule';
commit;
