-- Targeted citation repair of an immutable completed prompt-7 observation.
-- The same Edge function and the existing per-batch 216 transport budget are
-- reused. No old result, edition, source, secret or schedule is changed.
begin;
alter table vnext_runtime.ai_stock_dispatches add column repair_symbol text;
alter table vnext_runtime.ai_stock_dispatches add column review_document_hash text;
alter table vnext_runtime.ai_stock_dispatches add column original_job_key text;
alter table vnext_runtime.ai_stock_dispatches add constraint ai_citation_repair_receipt_v1 check(
 (repair_symbol is null and review_document_hash is null and original_job_key is null)
 or (repair_symbol is not null and review_document_hash is not null and original_job_key is not null
  and repair_symbol ~ '^\d{4,6}$' and review_document_hash ~ '^[a-f0-9]{64}$' and original_job_key ~ '^[a-f0-9]{64}$'));
create index ai_citation_repair_latest_v1 on vnext_runtime.ai_stock_dispatches(batch_id,repair_symbol,created_at desc)
 where repair_symbol is not null;

create function vnext_runtime.seal_daily_ai_citation_repair_receipt_v1() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.repair_symbol is not null or (tg_op='UPDATE' and new.repair_symbol is not null) then raise exception 'AI_CITATION_REPAIR_RECEIPT_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function vnext_runtime.seal_daily_ai_citation_repair_receipt_v1() from public,anon,authenticated,service_role;
create trigger ai_citation_repair_seal_v1 before update or delete on vnext_runtime.ai_stock_dispatches
 for each row execute function vnext_runtime.seal_daily_ai_citation_repair_receipt_v1();

-- Match the same canonical identity text used by the existing Node job store.
-- This helper is private: selectors cannot declare an arbitrary model revision.
create function vnext_runtime.daily_ai_citation_repair_context_v1(p_batch_id text,p_symbol text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b vnext_runtime.ai_stock_batches;j vnext_runtime.ai_stock_jobs;packet jsonb;input_hash text;packet_text text;original_key text;repair_key text;
 original_revision constant text:='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low';
 repair_revision constant text:='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low';
begin
 if p_batch_id is null or p_batch_id !~ '^[a-f0-9]{64}$' or p_symbol is null or p_symbol !~ '^\d{4,6}$' then raise exception 'AI_CITATION_REPAIR_SCOPE';end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=p_batch_id;
 if b.payload->>'schema' is distinct from 'DAILY_AI_BATCH_INPUT_V1' or jsonb_array_length(b.payload->'packets') is distinct from 72 then raise exception 'AI_CITATION_REPAIR_BATCH';end if;
 packet_text:=b.payload->'packet_texts'->>p_symbol;input_hash:=b.payload->'packet_hashes'->>p_symbol;
 select p into strict packet from jsonb_array_elements(b.payload->'packets')p where p->>'symbol'=p_symbol;
 if input_hash is null or input_hash !~ '^[a-f0-9]{64}$' or packet_text is null
  or encode(sha256(convert_to(packet_text,'UTF8')),'hex') is distinct from input_hash or packet_text::jsonb is distinct from packet
  or packet->>'symbol' is distinct from p_symbol or (packet->>'cutoff')::timestamptz is distinct from b.cutoff then raise exception 'AI_CITATION_REPAIR_PACKET';end if;
 original_key:=encode(sha256(convert_to('{"input_hash":"'||input_hash||'","model_revision":"'||original_revision||'","version":"DAILY_AI_BATCH_1"}','UTF8')),'hex');
 repair_key:=encode(sha256(convert_to('{"input_hash":"'||input_hash||'","model_revision":"'||repair_revision||'","version":"DAILY_AI_BATCH_1"}','UTF8')),'hex');
 select * into strict j from vnext_runtime.ai_stock_jobs where id=original_key;
 if j.state<>'COMPLETE' or j.model_revision<>original_revision or j.symbol<>p_symbol or j.input_hash<>input_hash or j.cutoff<>b.cutoff
  or j.result->>'schema' is distinct from 'DAILY_AI_STOCK_ANALYSIS_V1' or j.result->>'input_hash' is distinct from input_hash
  or j.result->>'symbol' is distinct from p_symbol or (j.result->>'cutoff')::timestamptz is distinct from b.cutoff
  or j.result->'model_generated' is distinct from 'true'::jsonb or j.result->'member_published' is distinct from 'false'::jsonb
  then raise exception 'AI_CITATION_REPAIR_ORIGINAL';end if;
 return jsonb_build_object('batch_id',b.id,'symbol',p_symbol,'input_hash',input_hash,'cutoff',b.payload->>'cutoff',
  'original_job_key',original_key,'job_key',repair_key,'model_revision',repair_revision);
end $$;
revoke all on function vnext_runtime.daily_ai_citation_repair_context_v1(text,text) from public,anon,authenticated,service_role;

create function public.dispatch_daily_stock_ai_citation_repair_v1(p_batch_id text,p_symbol text,p_review_document_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;j vnext_runtime.ai_stock_jobs;prior vnext_runtime.ai_stock_dispatches;token text;request bigint;at_time timestamptz:=clock_timestamp();
begin
 if p_review_document_hash is null or p_review_document_hash !~ '^[a-f0-9]{64}$' then raise exception 'AI_CITATION_REPAIR_REVIEW';end if;
 -- The original dispatcher takes this exact row lock, so normal and repair
 -- transports cannot race the shared 216-row budget.
 perform 1 from vnext_runtime.ai_stock_batches where id=p_batch_id for update;
 if not found then raise exception 'AI_CITATION_REPAIR_BATCH_MISSING';end if;
 context:=vnext_runtime.daily_ai_citation_repair_context_v1(p_batch_id,p_symbol);
 select * into j from vnext_runtime.ai_stock_jobs where id=context->>'job_key';
 if found then
  if j.model_revision is distinct from context->>'model_revision' or j.symbol is distinct from p_symbol
   or j.input_hash is distinct from context->>'input_hash' or j.cutoff is distinct from (context->>'cutoff')::timestamptz then raise exception 'AI_CITATION_REPAIR_JOB_CONFLICT';end if;
  if j.state='COMPLETE' then return context||jsonb_build_object('state','CACHED','member_published',false);end if;
  if j.state='RUNNING' and j.lease_until>at_time then return context||jsonb_build_object('state','BUSY','member_published',false);end if;
  if j.attempts>=3 then return context||jsonb_build_object('state','EXHAUSTED','member_published',false);end if;
 end if;
 select * into prior from vnext_runtime.ai_stock_dispatches where batch_id=p_batch_id and repair_symbol=p_symbol
  and created_at>at_time-interval '90 seconds' order by created_at desc,request_id desc limit 1;
 if found then return context||jsonb_build_object('state','ALREADY_DISPATCHED','request_id',prior.request_id,
  'review_document_hash',prior.review_document_hash,'member_published',false);end if;
 if (select count(*) from vnext_runtime.ai_stock_dispatches where batch_id=p_batch_id)>=216 then
  return context||jsonb_build_object('state','DISPATCH_BUDGET_EXHAUSTED','member_published',false);end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='morning_alpha_daily_delivery_token' order by created_at desc limit 1;
 if token is null or length(token) not between 24 and 512 then raise exception 'AI_DISPATCH_CREDENTIAL_UNAVAILABLE';end if;
 select net.http_post(url:='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1',
  headers:=jsonb_build_object('Content-Type','application/json','x-daily-delivery-token',token),
  body:=jsonb_build_object('batch_id',p_batch_id,'repair_symbol',p_symbol,'review_document_hash',p_review_document_hash),timeout_milliseconds:=60000) into request;
 if request is null or request<=0 then raise exception 'AI_CITATION_REPAIR_DISPATCH_UNCONFIRMED';end if;
 insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id,repair_symbol,review_document_hash,original_job_key)
  values(request,p_batch_id,p_symbol,p_review_document_hash,context->>'original_job_key');
 return context||jsonb_build_object('state','DISPATCHED','request_id',request,'review_document_hash',p_review_document_hash,'member_published',false);
end $$;
revoke all on function public.dispatch_daily_stock_ai_citation_repair_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_daily_stock_ai_citation_repair_v1(text,text,text) to service_role;

-- The Edge handler must call this before claiming prompt 8. A valid delivery
-- token alone cannot invent a repair review or retarget an ordinary dispatch.
create function public.load_daily_stock_ai_citation_repair_v1(p_batch_id text,p_symbol text,p_review_document_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare context jsonb;receipt vnext_runtime.ai_stock_dispatches;
begin
 if p_review_document_hash is null or p_review_document_hash !~ '^[a-f0-9]{64}$' then raise exception 'AI_CITATION_REPAIR_REVIEW';end if;
 context:=vnext_runtime.daily_ai_citation_repair_context_v1(p_batch_id,p_symbol);
 select * into strict receipt from vnext_runtime.ai_stock_dispatches where batch_id=p_batch_id and repair_symbol=p_symbol
  and request_id>0 and review_document_hash=p_review_document_hash and original_job_key=context->>'original_job_key'
  order by created_at desc,request_id desc limit 1;
 return context||jsonb_build_object('state','READY','review_document_hash',receipt.review_document_hash,
  'dispatch_request_id',receipt.request_id,'member_published',false);
end $$;
revoke all on function public.load_daily_stock_ai_citation_repair_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_citation_repair_v1(text,text,text) to service_role;
commit;
