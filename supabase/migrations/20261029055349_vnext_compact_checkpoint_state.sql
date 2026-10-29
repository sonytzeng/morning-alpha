-- Compact mutable stage state; retain pinned acquired and prepared locks server-side.
-- Baseline guard prevents reapplication and replacing a different deployed RPC.
-- No schema, grants, RLS, cutoff, prediction, outcome or publication changes.
begin;
do $guard$
begin
 if (select encode(sha256(convert_to(rtrim(pg_get_functiondef(p.oid),E'\n'),'UTF8')),'hex')
  from pg_proc p where p.oid='public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb)'::regprocedure)
  is distinct from 'fb287ce2ad6b32aaf946099754851c5c52951aff49176f052dd0b7e412932025' then
  raise exception 'CHECKPOINT_STATE_BASELINE_DRIFT';
 end if;
end;
$guard$;
CREATE OR REPLACE FUNCTION public.vnext_daily_runtime_v1(p_run uuid, p_lease uuid, p_fence integer, p_op text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_data->>'cutoff' is null or ((p_data->>'cutoff')::timestamptz at time zone 'Asia/Taipei')::date<>r.business_date
   or (p_data->>'cutoff')::timestamptz>clock_timestamp() then return '{}';end if;
  select jsonb_build_object('evidence',s.evidence,'hash',s.input_sha256,'market',
   case when c.id is not null and jsonb_typeof(c.generated_text->'market_bias')='string' and c.market_regime is not null then
    jsonb_build_object('value',jsonb_build_object('direction',c.generated_text->>'market_bias','regime',c.market_regime),
     'source_ref',c.id::text,'observed_at',c.created_at,'available_at',c.created_at) else null end) into result
  from (select 1) anchor left join lateral(select d.* from public.decision_snapshots d
   where d.report_date=r.business_date and d.session_type='PREMARKET' and d.status='READY'
    and d.created_at<=(p_data->>'cutoff')::timestamptz order by d.created_at desc limit 1)c on true
  left join lateral(select v.* from public.recommendation_shadow_v2_runs v
   where v.business_date=r.business_date and v.source_batch_id=r.upstream_batch and v.cutoff<=(p_data->>'cutoff')::timestamptz
   order by v.cutoff desc limit 1)s on true;
  return coalesce(result,'{}');
 elsif p_op='SOURCES' then
  select coalesce(jsonb_agg(s.receipt order by s.task_key),'[]') into result from vnext_runtime.run_sources t join vnext_runtime.source_revisions s on s.id=t.source_id where t.run_id=r.id;
  return result;
 elsif p_op in('CHECKPOINT','CHECKPOINT_STATE') then
  -- Compact stage checkpoints retain the previously pinned acquired bytes.
  -- The original complete CHECKPOINT protocol and every existing guard remain.
  if p_op='CHECKPOINT_STATE' then
   if jsonb_typeof(p_data) is distinct from 'object'
    or (p_data-array['source_revision','checkpoint'])<>'{}'::jsonb
    or jsonb_typeof(p_data->'source_revision') is distinct from 'string'
    or r.source_revision is null or p_data->>'source_revision' is distinct from r.source_revision
    or r.checkpoint->'acquired' is null
    or p_data->>'source_revision' is distinct from r.checkpoint#>>'{acquired,snapshot_hash}'
    or jsonb_typeof(p_data->'checkpoint') is distinct from 'object'
    or (p_data->'checkpoint')?'acquired' then raise exception 'CHECKPOINT_STATE_INVALID';end if;
   v:=p_data->'checkpoint';
   if r.checkpoint?'locks' and not(v?'locks') then
    v:=v||jsonb_build_object('locks',r.checkpoint->'locks');
   end if;
   p_data:=v||jsonb_build_object('acquired',r.checkpoint->'acquired');
  end if;
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
   insert into vnext_runtime.outcome_queue(prediction_id,next_due) values(v->>'id',coalesce(vnext_runtime.outcome_due_v1(v,(v->'target_sessions'->>0)::integer),r.business_date));
   insert into vnext_runtime.publication_status(prediction_id) values(v->>'id');
  end loop;
  insert into vnext_runtime.audit(run_id,operation,details) values(r.id,'PREDICTION_LOCK',jsonb_build_object('count',216));return '{"status":"LOCKED"}';
 elsif p_op='DUE_OUTCOMES' then
  select coalesce(jsonb_agg(x.work),'[]') into result from(select jsonb_build_object('prediction',p.payload,'horizons',m.horizons) as work
   from vnext_runtime.outcome_queue q join vnext_runtime.predictions p on p.id=q.prediction_id
   cross join lateral(select jsonb_agg(h.value) as horizons from jsonb_array_elements(p.payload->'target_sessions') h
     where not (h.value::text::integer=any(q.completed_horizons))
      and(vnext_runtime.outcome_due_v1(p.payload,h.value::text::integer)::text||' 13:30 Asia/Taipei')::timestamptz<=clock_timestamp()) m
   where (q.next_due::text||' 13:30 Asia/Taipei')::timestamptz<=clock_timestamp() and (q.last_checked is null or q.last_checked<(clock_timestamp() at time zone 'Asia/Taipei')::date)
   and m.horizons is not null
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
   due:=vnext_runtime.outcome_due_v1(old.payload,(v->>'horizon')::integer);
   if due is null or (v->>'observed_at')::timestamptz<(due::text||' 13:30 Asia/Taipei')::timestamptz then raise exception 'OUTCOME_NOT_MATURED';end if;
  end if;
  if exists(select from vnext_runtime.outcomes where id=p_data->>'id' and payload is distinct from v) then raise exception 'OUTCOME_IDEMPOTENCY_CONFLICT';end if;
  insert into vnext_runtime.outcomes(id,prediction_id,horizon,observed_at,source_revision,payload) values(p_data->>'id',old.id,(v->>'horizon')::integer,(v->>'observed_at')::timestamptz,v->>'outcome_source_hash',v) on conflict(id) do nothing;
  return '{"status":"STORED"}';
 elsif p_op='OUTCOME_CHECKED' then
  update vnext_runtime.outcome_queue q set last_checked=(clock_timestamp() at time zone 'Asia/Taipei')::date,
   completed_horizons=array(select distinct o.horizon from vnext_runtime.outcomes o where o.prediction_id=q.prediction_id and o.payload->>'state'='OBSERVED_NOT_PERFORMANCE')
   where q.prediction_id=p_data->>'id';
  update vnext_runtime.outcome_queue q set next_due=coalesce((select min(vnext_runtime.outcome_due_v1(p.payload,h.value::text::integer))
   from vnext_runtime.predictions p cross join lateral jsonb_array_elements(p.payload->'target_sessions') h
   where p.id=q.prediction_id and not(h.value::text::integer=any(q.completed_horizons))),q.next_due)
   where q.prediction_id=p_data->>'id';return '{"status":"STORED"}';
 elsif p_op='FINISH' then
  if p_data->>'status' not in('QUEUED','COMPLETE','BLOCKED','EXPIRED') then raise exception 'FINISH_STATE';end if;
  if p_data->>'status'='COMPLETE' and (select count(*) from vnext_runtime.predictions where run_id=r.id)<>216 then raise exception 'INCOMPLETE_LOCK';end if;
  update vnext_runtime.runs set state=p_data->>'status',lease=null,lease_until=null,reason=p_data->>'reason',updated_at=clock_timestamp() where id=r.id;
  insert into vnext_runtime.audit(run_id,operation,details) values(r.id,'FINISH',p_data);return '{"status":"STORED"}';
 end if;
 raise exception 'OPERATION_NOT_ALLOWED';
end$function$;


commit;
