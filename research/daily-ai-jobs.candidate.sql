begin;
create table vnext_runtime.ai_stock_jobs(
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
 model_revision text not null check(length(model_revision) between 1 and 200),
 symbol text not null check(symbol ~ '^\d{4,6}$'),cutoff timestamptz not null,
 state text not null check(state in('RUNNING','FAILED','COMPLETE')),
 attempts integer not null check(attempts between 1 and 3),lease uuid not null,lease_until timestamptz not null,
 result jsonb,code text,created_at timestamptz not null default clock_timestamp(),
 check((state='COMPLETE')=(result is not null))
);
alter table vnext_runtime.ai_stock_jobs enable row level security;
alter table vnext_runtime.ai_stock_jobs force row level security;
revoke all on vnext_runtime.ai_stock_jobs from public,anon,authenticated,service_role;

create function public.daily_stock_ai_job_v1(p_op text,p_key text,p_identity_text text default null,
 p_context jsonb default null,p_result jsonb default null,p_lease uuid default null,p_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j vnext_runtime.ai_stock_jobs;identity jsonb;at_time timestamptz:=clock_timestamp();h jsonb;
begin
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_op is null or p_op not in('CLAIM','COMPLETE','FAIL') then raise exception 'AI_JOB_SCOPE';end if;
 if p_op='CLAIM' then
  if p_identity_text is null or octet_length(p_identity_text)>2000
   or encode(sha256(convert_to(p_identity_text,'UTF8')),'hex')<>p_key then raise exception 'AI_JOB_IDENTITY';end if;
  identity:=p_identity_text::jsonb;
  if identity->>'version' is distinct from 'DAILY_AI_BATCH_1'
   or identity->>'input_hash' is distinct from p_context->>'input_hash'
   or identity->>'model_revision' is distinct from p_context->>'model_revision'
   or jsonb_typeof(p_context) is distinct from 'object'
   or (p_context->>'cutoff')::timestamptz>at_time
   or not isfinite((p_context->>'cutoff')::timestamptz) then raise exception 'AI_JOB_CONTEXT';end if;
  insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until)
   values(p_key,p_context->>'input_hash',p_context->>'model_revision',p_context->>'symbol',(p_context->>'cutoff')::timestamptz,
    'RUNNING',1,gen_random_uuid(),at_time+interval '90 seconds') on conflict do nothing;
  if found then
   select * into strict j from vnext_runtime.ai_stock_jobs where id=p_key;
   return jsonb_build_object('state','ACQUIRED','lease',j.lease);
  end if;
 end if;
 select * into strict j from vnext_runtime.ai_stock_jobs where id=p_key for update;
 at_time:=clock_timestamp();
 if p_op='CLAIM' then
  if j.input_hash is distinct from p_context->>'input_hash' or j.model_revision is distinct from p_context->>'model_revision'
   or j.symbol is distinct from p_context->>'symbol' or j.cutoff is distinct from (p_context->>'cutoff')::timestamptz
   then raise exception 'AI_JOB_CONFLICT';end if;
  if j.state='COMPLETE' then return jsonb_build_object('state','CACHED','result',j.result);end if;
  if j.state='RUNNING' and j.lease_until>at_time then return jsonb_build_object('state','BUSY');end if;
  if j.attempts>=3 then return jsonb_build_object('state','EXHAUSTED');end if;
  update vnext_runtime.ai_stock_jobs set state='RUNNING',attempts=attempts+1,lease=gen_random_uuid(),lease_until=at_time+interval '90 seconds',code=null where id=p_key returning * into j;
  return jsonb_build_object('state','ACQUIRED','lease',j.lease);
 end if;
 if p_lease is null or p_lease<>j.lease or j.state<>'RUNNING' or j.lease_until<=at_time then raise exception 'AI_JOB_LEASE';end if;
 if p_op='FAIL' then
  if p_code is null or p_code !~ '^(AI_ANALYSIS|AI_BATCH|STOCK_AI)_[A-Z0-9_]{1,80}$' then raise exception 'AI_JOB_CODE';end if;
  update vnext_runtime.ai_stock_jobs set state='FAILED',code=p_code where id=p_key;
 else
  if octet_length(p_result::text)>512000 or p_result->>'schema' is distinct from 'DAILY_AI_STOCK_ANALYSIS_V1'
   or p_result->>'symbol' is distinct from j.symbol or p_result->>'input_hash' is distinct from j.input_hash
   or (p_result->>'cutoff')::timestamptz is distinct from j.cutoff
   or p_result->'member_published' is distinct from 'false'::jsonb
   or p_result->'publication_ready' is distinct from 'false'::jsonb
   or p_result->'model_generated' is distinct from 'true'::jsonb
   or jsonb_typeof(p_result->'horizons') is distinct from 'array'
   or jsonb_array_length(p_result->'horizons')<>3
   or (select count(distinct x->>'horizon') from jsonb_array_elements(p_result->'horizons')x where x->>'horizon' in('SHORT','MEDIUM','LONG'))<>3
   or coalesce(p_result->'receipt'->>'response_id','')='' or coalesce(p_result->'receipt'->>'model','')=''
   then raise exception 'AI_JOB_RESULT';end if;
  for h in select * from jsonb_array_elements(p_result->'horizons') loop
   if coalesce(h->>'status','') not in('WATCH','WAIT','AVOID','INSUFFICIENT') or coalesce(h->'reason'->>'text','')=''
    or jsonb_typeof(h->'reason'->'evidence_ids') is distinct from 'array' or jsonb_array_length(h->'reason'->'evidence_ids')=0
    then raise exception 'AI_JOB_ANALYSIS';end if;
  end loop;
  update vnext_runtime.ai_stock_jobs set state='COMPLETE',result=p_result,code=null where id=p_key;
 end if;
 return jsonb_build_object('state','STORED','member_published',false);
end $$;
revoke all on function public.daily_stock_ai_job_v1(text,text,text,jsonb,jsonb,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.daily_stock_ai_job_v1(text,text,text,jsonb,jsonb,uuid,text) to service_role;
commit;
