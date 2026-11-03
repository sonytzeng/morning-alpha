-- One reviewed recovery request per exact immutable batch/stock. Never resets
-- an original job, retries unknown provider work, stages, publishes or continues.
begin;
do $guard$
declare item record;oid_value oid;
begin
 for item in select * from (values
  ('public.daily_stock_ai_job_v1(text,text,text,jsonb,jsonb,uuid,text)','2a055e4746a570d3a4ab3c9324b5f7272d4798ca80164249252a53ce71662e98'),
  ('public.stage_daily_ai_research_edition_v1(text,text[],timestamptz)','651467f9f66872cd17d1eaa9855e789f35a0b88ad8836bd0a04acff8a9f35efb'),
  ('public.dispatch_daily_stock_ai_batch_v1(text)','d0c3395e030c92b8cd55cedb53882fbb86cc07b37ac57c0d4b007db623467878')
 ) pins(signature,definition_hash) loop
  oid_value:=pg_catalog.to_regprocedure(item.signature);
  if oid_value is null then raise exception 'AI_RATE_LIMIT_RECOVERY_DEPENDENCY_MISSING';end if;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(oid_value),'UTF8')),'hex')<>item.definition_hash
   then raise exception 'AI_RATE_LIMIT_RECOVERY_DEPENDENCY_DRIFT';end if;
  if not exists(select from pg_catalog.pg_proc p where p.oid=oid_value
   and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.provolatile='v'
   and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
   and p.prokind='f' and not p.proisstrict and not p.proleakproof and p.proparallel='u'
   and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')) then raise exception 'AI_RATE_LIMIT_RECOVERY_PRIVILEGE_DRIFT';end if;
 end loop;
 if pg_catalog.to_regclass('vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1') is not null
  or pg_catalog.to_regprocedure('vnext_runtime.daily_stock_ai_rate_limit_recovery_context_v1(text,text)') is not null
  or pg_catalog.to_regprocedure('public.dispatch_daily_stock_ai_rate_limit_recovery_v1(text,text,text)') is not null
  or pg_catalog.to_regprocedure('public.load_daily_stock_ai_rate_limit_recovery_v1(text,text,text)') is not null
  or pg_catalog.to_regprocedure('public.load_daily_stock_ai_rate_limit_recovery_progress_v1(text)') is not null
  or pg_catalog.to_regprocedure('public.daily_stock_ai_rate_limit_recovery_job_v1(text,text,text,text,text,text,jsonb,jsonb,uuid,text)') is not null
  or pg_catalog.to_regprocedure('vnext_runtime.seal_daily_stock_ai_rate_limit_recovery_receipt_v1()') is not null
  then raise exception 'AI_RATE_LIMIT_RECOVERY_ALREADY_EXISTS';end if;
end $guard$;

create table vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1(
 batch_id text not null references vnext_runtime.ai_stock_batches(id),symbol text not null check(symbol ~ '^\d{4,6}$'),
 review_document_hash text not null check(review_document_hash ~ '^[a-f0-9]{64}$'),
 input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),cutoff timestamptz not null,
 original_job_key text not null check(original_job_key ~ '^[a-f0-9]{64}$'),
 recovery_job_key text not null check(recovery_job_key ~ '^[a-f0-9]{64}$'),
 model_revision text not null check(model_revision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low:recovery-1'),
 dispatch_request_id bigint not null unique check(dispatch_request_id>0),created_at timestamptz not null default clock_timestamp(),
 primary key(batch_id,symbol)
);
alter table vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 enable row level security;
alter table vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 force row level security;
revoke all on vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 from public,anon,authenticated,service_role;
create function vnext_runtime.seal_daily_stock_ai_rate_limit_recovery_receipt_v1() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'AI_RATE_LIMIT_RECOVERY_RECEIPT_IMMUTABLE';end $$;
revoke all on function vnext_runtime.seal_daily_stock_ai_rate_limit_recovery_receipt_v1() from public,anon,authenticated,service_role;
create trigger immutable before update or delete on vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1
 for each row execute function vnext_runtime.seal_daily_stock_ai_rate_limit_recovery_receipt_v1();
create trigger immutable_truncate before truncate on vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1
 for each statement execute function vnext_runtime.seal_daily_stock_ai_rate_limit_recovery_receipt_v1();

create function vnext_runtime.daily_stock_ai_rate_limit_recovery_context_v1(p_batch_id text,p_symbol text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b vnext_runtime.ai_stock_batches;packet jsonb;packet_text text;input_hash text;original_key text;new_key text;
 original_revision constant text:='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low';
 recovery_revision constant text:='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low:recovery-1';
begin
 if p_batch_id is distinct from '0524783a79af043a70be593d2e019c435bc067f168a5b2567a831e32d78b4ddc'
  or p_symbol is null or p_symbol !~ '^\d{4,6}$' then raise exception 'AI_RATE_LIMIT_RECOVERY_SCOPE';end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=p_batch_id;
 if b.payload->>'schema' is distinct from 'DAILY_AI_BATCH_INPUT_V1' or not isfinite(b.cutoff) or b.cutoff>clock_timestamp()
  or encode(sha256(convert_to(b.payload_text,'UTF8')),'hex') is distinct from b.id
  or b.payload is distinct from (b.payload_text::jsonb)||jsonb_build_object('packets',(
   select jsonb_agg(x.value::jsonb order by x.key) from jsonb_each_text(b.payload_text::jsonb->'packet_texts')x))
  or jsonb_array_length(b.payload->'packets') is distinct from 72
  or (select count(*) from jsonb_object_keys(b.payload->'packet_hashes'))<>72 then raise exception 'AI_RATE_LIMIT_RECOVERY_BATCH';end if;
 packet_text:=b.payload->'packet_texts'->>p_symbol;input_hash:=b.payload->'packet_hashes'->>p_symbol;
 select p into strict packet from jsonb_array_elements(b.payload->'packets')p where p->>'symbol'=p_symbol;
 if input_hash is null or input_hash !~ '^[a-f0-9]{64}$' or packet_text is null
  or encode(sha256(convert_to(packet_text,'UTF8')),'hex') is distinct from input_hash or packet_text::jsonb is distinct from packet
  or packet->>'symbol' is distinct from p_symbol or (packet->>'cutoff')::timestamptz is distinct from b.cutoff then raise exception 'AI_RATE_LIMIT_RECOVERY_PACKET';end if;
 original_key:=encode(sha256(convert_to('{"input_hash":"'||input_hash||'","model_revision":"'||original_revision||'","version":"DAILY_AI_BATCH_1"}','UTF8')),'hex');
 new_key:=encode(sha256(convert_to('{"input_hash":"'||input_hash||'","model_revision":"'||recovery_revision||'","version":"DAILY_AI_BATCH_1"}','UTF8')),'hex');
 return jsonb_build_object('batch_id',b.id,'symbol',p_symbol,'input_hash',input_hash,'cutoff',b.payload->>'cutoff',
  'original_job_key',original_key,'job_key',new_key,'model_revision',recovery_revision,'member_published',false);
end $$;
revoke all on function vnext_runtime.daily_stock_ai_rate_limit_recovery_context_v1(text,text) from public,anon,authenticated,service_role;

create function public.dispatch_daily_stock_ai_rate_limit_recovery_v1(p_batch_id text,p_symbol text,p_review_document_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;prior vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1;j vnext_runtime.ai_stock_jobs;original vnext_runtime.ai_stock_jobs;
 token text;request_id bigint;at_time timestamptz:=clock_timestamp();
begin
 if p_review_document_hash is null or p_review_document_hash !~ '^[a-f0-9]{64}$' then raise exception 'AI_RATE_LIMIT_RECOVERY_REVIEW';end if;
 perform 1 from vnext_runtime.ai_stock_batches where id=p_batch_id for update;
 if not found then raise exception 'AI_RATE_LIMIT_RECOVERY_BATCH_MISSING';end if;
 at_time:=clock_timestamp();
 context:=vnext_runtime.daily_stock_ai_rate_limit_recovery_context_v1(p_batch_id,p_symbol);
 select * into prior from vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 where batch_id=p_batch_id and symbol=p_symbol;
 if found and prior.review_document_hash<>p_review_document_hash then raise exception 'AI_RATE_LIMIT_RECOVERY_REVIEW_CONFLICT';end if;
 select * into original from vnext_runtime.ai_stock_jobs where id=context->>'original_job_key';
 if found and original.symbol=p_symbol and original.input_hash=context->>'input_hash' and original.cutoff=(context->>'cutoff')::timestamptz
  and original.model_revision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low' and original.state='COMPLETE'
  then return context||jsonb_build_object('state','CACHED');end if;
 if original.id is null or original.state<>'FAILED' or original.attempts<>3 or original.code is distinct from 'STOCK_AI_PROVIDER_HTTP_429'
  or original.symbol is distinct from p_symbol or original.input_hash is distinct from context->>'input_hash'
  or original.cutoff is distinct from (context->>'cutoff')::timestamptz
  or original.model_revision is distinct from 'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low'
  then raise exception 'AI_RATE_LIMIT_RECOVERY_ORIGINAL_INELIGIBLE';end if;
 if exists(select from vnext_runtime.ai_stock_batches b cross join lateral jsonb_each_text(b.payload->'packet_hashes') p
  left join vnext_runtime.ai_stock_jobs old on old.id=encode(sha256(convert_to('{"input_hash":"'||p.value||'","model_revision":"gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low","version":"DAILY_AI_BATCH_1"}','UTF8')),'hex')
  where b.id=p_batch_id and (old.id is null or old.symbol is distinct from p.key or old.input_hash is distinct from p.value or old.cutoff is distinct from b.cutoff
   or old.model_revision is distinct from 'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low'
   or (old.state='COMPLETE' or old.state='FAILED' and old.attempts=3 and old.code='STOCK_AI_PROVIDER_HTTP_429') is distinct from true))
  then raise exception 'AI_RATE_LIMIT_RECOVERY_ORIGINAL_BATCH_NOT_CLOSED';end if;
 if least((context->>'cutoff')::timestamptz+interval '72 hours','2026-11-02T05:30:00Z'::timestamptz)<=at_time then raise exception 'AI_RATE_LIMIT_RECOVERY_EXPIRED';end if;
 if exists(select from vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 r join vnext_runtime.ai_stock_jobs n on n.id=r.recovery_job_key where r.batch_id=p_batch_id and n.state='FAILED')
  then return context||jsonb_build_object('state','STOPPED');end if;
 if exists(select from vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 r join vnext_runtime.ai_stock_jobs n on n.id=r.recovery_job_key where r.batch_id=p_batch_id and n.state='RUNNING' and n.lease_until<=at_time)
  then return context||jsonb_build_object('state','STOPPED_UNKNOWN');end if;
 if exists(select from vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 r left join vnext_runtime.ai_stock_jobs n on n.id=r.recovery_job_key where r.batch_id=p_batch_id and (n.id is null or n.state='RUNNING'))
  then return context||jsonb_build_object('state','BUSY');end if;
 if prior.batch_id is not null then
  select * into strict j from vnext_runtime.ai_stock_jobs where id=prior.recovery_job_key;
  if j.state='COMPLETE' then return context||jsonb_build_object('state','CACHED');end if;
  raise exception 'AI_RATE_LIMIT_RECOVERY_PRIOR_STATE';
 end if;
 if exists(select from vnext_runtime.ai_stock_jobs where id=context->>'job_key') then raise exception 'AI_RATE_LIMIT_RECOVERY_UNRECEIPTED_JOB';end if;
 -- Explicit separate recovery authorization: one receipt per eligible target,
 -- at most54. Historical normal216 remains unchanged; all new transports still
 -- enter its shared audit table without erasing or rebating an old attempt.
 if (select count(*) from vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 where batch_id=p_batch_id)>=54 then return context||jsonb_build_object('state','RECOVERY_BUDGET_EXHAUSTED');end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='morning_alpha_daily_delivery_token' order by created_at desc limit 1;
 if token is null or length(token) not between 24 and 512 then raise exception 'AI_DISPATCH_CREDENTIAL_UNAVAILABLE';end if;
 select net.http_post(url:='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1',
  headers:=jsonb_build_object('Content-Type','application/json','x-daily-delivery-token',token),
  body:=jsonb_build_object('batch_id',p_batch_id,'recovery_symbol',p_symbol,'review_document_hash',p_review_document_hash),timeout_milliseconds:=60000) into request_id;
 if request_id is null or request_id<=0 then raise exception 'AI_RATE_LIMIT_RECOVERY_DISPATCH_UNCONFIRMED';end if;
 insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id) values(request_id,p_batch_id);
 insert into vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1(batch_id,symbol,review_document_hash,input_hash,cutoff,original_job_key,recovery_job_key,model_revision,dispatch_request_id)
 values(p_batch_id,p_symbol,p_review_document_hash,context->>'input_hash',(context->>'cutoff')::timestamptz,context->>'original_job_key',context->>'job_key',context->>'model_revision',request_id);
 return context||jsonb_build_object('state','DISPATCHED','review_document_hash',p_review_document_hash,'request_id',request_id);
end $$;
revoke all on function public.dispatch_daily_stock_ai_rate_limit_recovery_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_daily_stock_ai_rate_limit_recovery_v1(text,text,text) to service_role;

create function public.load_daily_stock_ai_rate_limit_recovery_v1(p_batch_id text,p_symbol text,p_review_document_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare context jsonb;r vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1;
begin
 if p_review_document_hash is null or p_review_document_hash !~ '^[a-f0-9]{64}$' then raise exception 'AI_RATE_LIMIT_RECOVERY_REVIEW';end if;
 context:=vnext_runtime.daily_stock_ai_rate_limit_recovery_context_v1(p_batch_id,p_symbol);
 select * into strict r from vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 where batch_id=p_batch_id and symbol=p_symbol;
 if r.review_document_hash<>p_review_document_hash then raise exception 'AI_RATE_LIMIT_RECOVERY_REVIEW_CONFLICT';end if;
 if r.input_hash is distinct from context->>'input_hash' or r.cutoff is distinct from (context->>'cutoff')::timestamptz
  or r.original_job_key is distinct from context->>'original_job_key' or r.recovery_job_key is distinct from context->>'job_key'
  or r.model_revision is distinct from context->>'model_revision' or r.dispatch_request_id<=0
  or not exists(select from vnext_runtime.ai_stock_dispatches d where d.request_id=r.dispatch_request_id and d.batch_id=r.batch_id)
  then raise exception 'AI_RATE_LIMIT_RECOVERY_RECEIPT';end if;
 return context||jsonb_build_object('state','READY','review_document_hash',r.review_document_hash,'dispatch_request_id',r.dispatch_request_id);
end $$;
revoke all on function public.load_daily_stock_ai_rate_limit_recovery_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_rate_limit_recovery_v1(text,text,text) to service_role;

create function public.daily_stock_ai_rate_limit_recovery_job_v1(p_batch_id text,p_symbol text,p_review_document_hash text,p_op text,p_key text,
 p_identity_text text default null,p_context jsonb default null,p_result jsonb default null,p_lease uuid default null,p_code text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;original vnext_runtime.ai_stock_jobs;j vnext_runtime.ai_stock_jobs;identity_text text;at_time timestamptz:=clock_timestamp();
begin
 if p_op is null or p_op not in('CLAIM','COMPLETE','FAIL') then raise exception 'AI_RATE_LIMIT_RECOVERY_OPERATION';end if;
 perform 1 from vnext_runtime.ai_stock_batches where id=p_batch_id for update;
 if not found then raise exception 'AI_RATE_LIMIT_RECOVERY_BATCH_MISSING';end if;
 at_time:=clock_timestamp();
 context:=public.load_daily_stock_ai_rate_limit_recovery_v1(p_batch_id,p_symbol,p_review_document_hash);
 if p_key is distinct from context->>'job_key' then raise exception 'AI_RATE_LIMIT_RECOVERY_KEY';end if;
 if p_op='CLAIM' then
  identity_text:='{"input_hash":"'||(context->>'input_hash')||'","model_revision":"'||(context->>'model_revision')||'","version":"DAILY_AI_BATCH_1"}';
  if p_identity_text is distinct from identity_text or p_context is distinct from jsonb_build_object('input_hash',context->>'input_hash','model_revision',context->>'model_revision','symbol',p_symbol,'cutoff',context->>'cutoff')
   then raise exception 'AI_RATE_LIMIT_RECOVERY_IDENTITY';end if;
  select * into strict original from vnext_runtime.ai_stock_jobs where id=context->>'original_job_key';
  if original.symbol is distinct from p_symbol or original.input_hash is distinct from context->>'input_hash'
   or original.cutoff is distinct from (context->>'cutoff')::timestamptz
   or original.model_revision is distinct from 'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low'
   then raise exception 'AI_RATE_LIMIT_RECOVERY_ORIGINAL_INELIGIBLE';end if;
  if original.state='COMPLETE' then return jsonb_build_object('state','CACHED','result',original.result);end if;
  if original.state<>'FAILED' or original.attempts<>3 or original.code is distinct from 'STOCK_AI_PROVIDER_HTTP_429'
   or original.symbol is distinct from p_symbol or original.input_hash is distinct from context->>'input_hash'
   or original.cutoff is distinct from (context->>'cutoff')::timestamptz
   or original.model_revision is distinct from 'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low'
   then raise exception 'AI_RATE_LIMIT_RECOVERY_ORIGINAL_INELIGIBLE';end if;
  select * into j from vnext_runtime.ai_stock_jobs where id=p_key;
  if found then
   if j.symbol is distinct from p_symbol or j.input_hash is distinct from context->>'input_hash'
    or j.cutoff is distinct from (context->>'cutoff')::timestamptz or j.model_revision is distinct from context->>'model_revision'
    then raise exception 'AI_RATE_LIMIT_RECOVERY_JOB_CONFLICT';end if;
   if j.state='COMPLETE' then return jsonb_build_object('state','CACHED','result',j.result);end if;
   if j.state='RUNNING' and j.lease_until>at_time then return jsonb_build_object('state','BUSY');end if;
   return jsonb_build_object('state','EXHAUSTED');
  end if;
  if exists(select from vnext_runtime.ai_stock_batches b cross join lateral jsonb_each_text(b.payload->'packet_hashes') p
   left join vnext_runtime.ai_stock_jobs old on old.id=encode(sha256(convert_to('{"input_hash":"'||p.value||'","model_revision":"gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low","version":"DAILY_AI_BATCH_1"}','UTF8')),'hex')
   where b.id=p_batch_id and (old.id is null or old.symbol is distinct from p.key or old.input_hash is distinct from p.value or old.cutoff is distinct from b.cutoff
    or old.model_revision is distinct from 'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low'
    or (old.state='COMPLETE' or old.state='FAILED' and old.attempts=3 and old.code='STOCK_AI_PROVIDER_HTTP_429') is distinct from true))
   then raise exception 'AI_RATE_LIMIT_RECOVERY_ORIGINAL_BATCH_NOT_CLOSED';end if;
  if least((context->>'cutoff')::timestamptz+interval '72 hours','2026-11-02T05:30:00Z'::timestamptz)<=at_time then raise exception 'AI_RATE_LIMIT_RECOVERY_EXPIRED';end if;
  if exists(select from vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 r join vnext_runtime.ai_stock_jobs n on n.id=r.recovery_job_key where r.batch_id=p_batch_id and r.symbol<>p_symbol
   and (n.state='FAILED' or n.state='RUNNING' and n.lease_until<=at_time)) then return jsonb_build_object('state','EXHAUSTED');end if;
  if exists(select from vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 r left join vnext_runtime.ai_stock_jobs n on n.id=r.recovery_job_key where r.batch_id=p_batch_id and r.symbol<>p_symbol
   and (n.id is null or n.state='RUNNING')) then return jsonb_build_object('state','BUSY');end if;
 end if;
 -- Existing SQL validates the lease/result; the only writable key here is the
 -- fixed new recovery job. No original key can reach COMPLETE or FAIL.
 return public.daily_stock_ai_job_v1(p_op,p_key,p_identity_text,p_context,p_result,p_lease,p_code);
end $$;
revoke all on function public.daily_stock_ai_rate_limit_recovery_job_v1(text,text,text,text,text,text,jsonb,jsonb,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.daily_stock_ai_rate_limit_recovery_job_v1(text,text,text,text,text,text,jsonb,jsonb,uuid,text) to service_role;

create function public.load_daily_stock_ai_rate_limit_recovery_progress_v1(p_batch_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b vnext_runtime.ai_stock_batches;item record;context jsonb;original vnext_runtime.ai_stock_jobs;recovery vnext_runtime.ai_stock_jobs;
 keys text[]:='{}';original_done integer:=0;recovery_done integer:=0;first_symbol text;packet jsonb;original_key text;recovery_key text;
begin
 if p_batch_id is null or p_batch_id !~ '^[a-f0-9]{64}$' then raise exception 'AI_RATE_LIMIT_RECOVERY_SCOPE';end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=p_batch_id;
 select min(key) into first_symbol from jsonb_each_text(b.payload->'packet_hashes');
 if first_symbol is null then raise exception 'AI_RATE_LIMIT_RECOVERY_BATCH';end if;
 -- Verify the full immutable5MB commitment once, then each individual packet.
 context:=vnext_runtime.daily_stock_ai_rate_limit_recovery_context_v1(p_batch_id,first_symbol);
 for item in select key,value from jsonb_each_text(b.payload->'packet_hashes') order by key loop
  packet:=(b.payload->'packet_texts'->>item.key)::jsonb;
  if item.value !~ '^[a-f0-9]{64}$' or encode(sha256(convert_to(b.payload->'packet_texts'->>item.key,'UTF8')),'hex') is distinct from item.value
   or packet->>'symbol' is distinct from item.key or (packet->>'cutoff')::timestamptz is distinct from b.cutoff then raise exception 'AI_RATE_LIMIT_RECOVERY_PACKET';end if;
  original_key:=encode(sha256(convert_to('{"input_hash":"'||item.value||'","model_revision":"gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low","version":"DAILY_AI_BATCH_1"}','UTF8')),'hex');
  recovery_key:=encode(sha256(convert_to('{"input_hash":"'||item.value||'","model_revision":"gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low:recovery-1","version":"DAILY_AI_BATCH_1"}','UTF8')),'hex');
  select * into original from vnext_runtime.ai_stock_jobs where id=original_key;
  if found and original.state='COMPLETE' and original.symbol=item.key and original.input_hash=item.value and original.cutoff=b.cutoff
   and original.model_revision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low' then keys:=array_append(keys,original.id);original_done:=original_done+1;continue;end if;
  select j.* into recovery from vnext_runtime.ai_stock_jobs j join vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1 r on r.recovery_job_key=j.id
   join vnext_runtime.ai_stock_dispatches d on d.request_id=r.dispatch_request_id and d.batch_id=r.batch_id
   where r.batch_id=p_batch_id and r.symbol=item.key and r.input_hash=item.value and r.cutoff=b.cutoff
    and r.original_job_key=original_key and r.recovery_job_key=recovery_key and r.model_revision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low:recovery-1'
    and j.state='COMPLETE' and j.symbol=item.key and j.input_hash=item.value and j.cutoff=b.cutoff and j.model_revision=r.model_revision;
  if found then keys:=array_append(keys,recovery.id);recovery_done:=recovery_done+1;end if;
 end loop;
 return jsonb_build_object('schema','DAILY_AI_RATE_LIMIT_RECOVERY_PROGRESS_V1','batch_id',p_batch_id,
  'original_model_revision','gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low',
  'recovery_model_revision','gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low:recovery-1',
  'complete',cardinality(keys)=72,'counts',jsonb_build_object('original_complete',original_done,'recovery_complete',recovery_done,'remaining',72-cardinality(keys)),
  'job_keys',to_jsonb(keys),'member_published',false);
end $$;
revoke all on function public.load_daily_stock_ai_rate_limit_recovery_progress_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_rate_limit_recovery_progress_v1(text) to service_role;
commit;
