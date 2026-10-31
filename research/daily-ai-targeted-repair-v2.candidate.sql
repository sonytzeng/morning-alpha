-- Second and final bounded citation-repair round. Apply after targeted-repair-v1.
-- Historical jobs/results/receipts remain unchanged; legacy repair NULL means8.
-- This records the supplied review-document hash, never a SQL quality verdict.
begin;
alter table vnext_runtime.ai_stock_dispatches add column repair_model_revision text;
alter table vnext_runtime.ai_stock_dispatches add constraint ai_citation_repair_revision_v2 check(
 repair_model_revision is null or (repair_symbol is not null and repair_model_revision in(
  'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low',
  'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-9:reasoning-low')));

-- Successful BUSY/CACHED decisions also bind the document. Otherwise a retry
-- of that same document could silently become round9 after round8 completes.
create table vnext_runtime.ai_stock_citation_repair_reviews_v2(
 batch_id text not null references vnext_runtime.ai_stock_batches(id),symbol text not null check(symbol ~ '^\d{4,6}$'),
 review_document_hash text not null check(review_document_hash ~ '^[a-f0-9]{64}$'),
 model_revision text not null check(model_revision in('gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low','gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-9:reasoning-low')),
 original_job_key text not null check(original_job_key ~ '^[a-f0-9]{64}$'),prior_job_key text,
 created_at timestamptz not null default clock_timestamp(),primary key(batch_id,symbol,review_document_hash),
 check((model_revision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low' and prior_job_key is null)
  or (model_revision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-9:reasoning-low' and prior_job_key is not null and prior_job_key ~ '^[a-f0-9]{64}$'))
);
alter table vnext_runtime.ai_stock_citation_repair_reviews_v2 enable row level security;
alter table vnext_runtime.ai_stock_citation_repair_reviews_v2 force row level security;
revoke all on vnext_runtime.ai_stock_citation_repair_reviews_v2 from public,anon,authenticated,service_role;
create trigger immutable before update or delete on vnext_runtime.ai_stock_citation_repair_reviews_v2
 for each row execute function vnext_runtime.immutable();

create function vnext_runtime.daily_ai_citation_repair_context_v2(p_batch_id text,p_symbol text,p_model_revision text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b vnext_runtime.ai_stock_batches;j vnext_runtime.ai_stock_jobs;packet jsonb;input_hash text;packet_text text;original_key text;repair_key text;prior_key text;prior_job vnext_runtime.ai_stock_jobs;context jsonb;
 original_revision constant text:='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low';
 revision8 constant text:='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low';
 revision9 constant text:='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-9:reasoning-low';
begin
 if p_model_revision is null or p_model_revision not in(revision8,revision9) then raise exception 'AI_CITATION_REPAIR_REVISION';end if;
 if p_batch_id is null or p_batch_id !~ '^[a-f0-9]{64}$' or p_symbol is null or p_symbol !~ '^\d{4,6}$' then raise exception 'AI_CITATION_REPAIR_SCOPE';end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=p_batch_id;
 if b.payload->>'schema' is distinct from 'DAILY_AI_BATCH_INPUT_V1' or jsonb_array_length(b.payload->'packets') is distinct from 72 then raise exception 'AI_CITATION_REPAIR_BATCH';end if;
 packet_text:=b.payload->'packet_texts'->>p_symbol;input_hash:=b.payload->'packet_hashes'->>p_symbol;
 select p into strict packet from jsonb_array_elements(b.payload->'packets')p where p->>'symbol'=p_symbol;
 if input_hash is null or input_hash !~ '^[a-f0-9]{64}$' or packet_text is null
  or encode(sha256(convert_to(packet_text,'UTF8')),'hex') is distinct from input_hash or packet_text::jsonb is distinct from packet
  or packet->>'symbol' is distinct from p_symbol or (packet->>'cutoff')::timestamptz is distinct from b.cutoff then raise exception 'AI_CITATION_REPAIR_PACKET';end if;
 original_key:=encode(sha256(convert_to('{"input_hash":"'||input_hash||'","model_revision":"'||original_revision||'","version":"DAILY_AI_BATCH_1"}','UTF8')),'hex');
 repair_key:=encode(sha256(convert_to('{"input_hash":"'||input_hash||'","model_revision":"'||p_model_revision||'","version":"DAILY_AI_BATCH_1"}','UTF8')),'hex');
 select * into strict j from vnext_runtime.ai_stock_jobs where id=original_key;
 if j.state<>'COMPLETE' or j.model_revision<>original_revision or j.symbol<>p_symbol or j.input_hash<>input_hash or j.cutoff<>b.cutoff
  or j.result->>'schema' is distinct from 'DAILY_AI_STOCK_ANALYSIS_V1' or j.result->>'input_hash' is distinct from input_hash
  or j.result->>'symbol' is distinct from p_symbol or (j.result->>'cutoff')::timestamptz is distinct from b.cutoff
  or j.result->'model_generated' is distinct from 'true'::jsonb or j.result->'member_published' is distinct from 'false'::jsonb
  then raise exception 'AI_CITATION_REPAIR_ORIGINAL';end if;
 prior_key:=encode(sha256(convert_to('{"input_hash":"'||input_hash||'","model_revision":"'||revision8||'","version":"DAILY_AI_BATCH_1"}','UTF8')),'hex');
 if p_model_revision=revision9 then
  select * into strict prior_job from vnext_runtime.ai_stock_jobs where id=prior_key;
  if prior_job.state<>'COMPLETE' or prior_job.model_revision<>revision8 or prior_job.symbol<>p_symbol
   or prior_job.input_hash<>input_hash or prior_job.cutoff<>b.cutoff
   or prior_job.result->>'schema' is distinct from 'DAILY_AI_STOCK_ANALYSIS_V1' or prior_job.result->>'input_hash' is distinct from input_hash
   or prior_job.result->>'symbol' is distinct from p_symbol or (prior_job.result->>'cutoff')::timestamptz is distinct from b.cutoff
   or prior_job.result->'model_generated' is distinct from 'true'::jsonb or prior_job.result->'member_published' is distinct from 'false'::jsonb
   then raise exception 'AI_CITATION_REPAIR_PRIOR';end if;
 end if;
 context:=jsonb_build_object('batch_id',b.id,'symbol',p_symbol,'input_hash',input_hash,'cutoff',b.payload->>'cutoff',
  'original_job_key',original_key,'job_key',repair_key,'model_revision',p_model_revision);
 if p_model_revision=revision9 then context:=context||jsonb_build_object('prior_job_key',prior_key,'prior_model_revision',revision8,
  'prior_input_hash',prior_job.input_hash,'prior_cutoff',b.payload->>'cutoff');end if;
 return context;
end $$;
revoke all on function vnext_runtime.daily_ai_citation_repair_context_v2(text,text,text) from public,anon,authenticated,service_role;

create or replace function vnext_runtime.daily_ai_citation_repair_context_v1(p_batch_id text,p_symbol text) returns jsonb
language sql stable security definer set search_path='' as $$
 select vnext_runtime.daily_ai_citation_repair_context_v2(p_batch_id,p_symbol,'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low');
$$;
revoke all on function vnext_runtime.daily_ai_citation_repair_context_v1(text,text) from public,anon,authenticated,service_role;

create or replace function public.dispatch_daily_stock_ai_citation_repair_v1(p_batch_id text,p_symbol text,p_review_document_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;base jsonb;j vnext_runtime.ai_stock_jobs;prior vnext_runtime.ai_stock_dispatches;
 binding vnext_runtime.ai_stock_citation_repair_reviews_v2;selected_revision text;token text;request bigint;at_time timestamptz:=clock_timestamp();
 revision8 constant text:='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low';
 revision9 constant text:='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-9:reasoning-low';
begin
 if p_review_document_hash is null or p_review_document_hash !~ '^[a-f0-9]{64}$' then raise exception 'AI_CITATION_REPAIR_REVIEW';end if;
 perform 1 from vnext_runtime.ai_stock_batches where id=p_batch_id for update;
 if not found then raise exception 'AI_CITATION_REPAIR_BATCH_MISSING';end if;
 base:=vnext_runtime.daily_ai_citation_repair_context_v2(p_batch_id,p_symbol,revision8);
 select * into binding from vnext_runtime.ai_stock_citation_repair_reviews_v2 where batch_id=p_batch_id
  and symbol=p_symbol and review_document_hash=p_review_document_hash;
 if found then
  selected_revision:=binding.model_revision;
 else
  -- Old actual receipts predate the model column and always mean round8.
  -- A new document can select round9 only after the real round8 is COMPLETE.
  select * into prior from vnext_runtime.ai_stock_dispatches where batch_id=p_batch_id and repair_symbol=p_symbol
   and review_document_hash=p_review_document_hash and request_id>0 order by created_at,request_id limit 1;
  if found then
   if prior.original_job_key is distinct from base->>'original_job_key' then raise exception 'AI_CITATION_REPAIR_REVIEW_CONFLICT';end if;
   selected_revision:=coalesce(prior.repair_model_revision,revision8);
  else
   select * into j from vnext_runtime.ai_stock_jobs where id=base->>'job_key';
   selected_revision:=case when found and j.state='COMPLETE' then revision9 else revision8 end;
  end if;
  context:=vnext_runtime.daily_ai_citation_repair_context_v2(p_batch_id,p_symbol,selected_revision);
  insert into vnext_runtime.ai_stock_citation_repair_reviews_v2(batch_id,symbol,review_document_hash,model_revision,original_job_key,prior_job_key)
   values(p_batch_id,p_symbol,p_review_document_hash,selected_revision,context->>'original_job_key',context->>'prior_job_key') returning * into binding;
 end if;
 context:=vnext_runtime.daily_ai_citation_repair_context_v2(p_batch_id,p_symbol,selected_revision);
 if binding.original_job_key is distinct from context->>'original_job_key' or binding.prior_job_key is distinct from context->>'prior_job_key'
  then raise exception 'AI_CITATION_REPAIR_REVIEW_CONFLICT';end if;
 select * into j from vnext_runtime.ai_stock_jobs where id=context->>'job_key';
 if found then
  if j.model_revision is distinct from selected_revision or j.symbol is distinct from p_symbol
   or j.input_hash is distinct from context->>'input_hash' or j.cutoff is distinct from (context->>'cutoff')::timestamptz then raise exception 'AI_CITATION_REPAIR_JOB_CONFLICT';end if;
  if j.state='COMPLETE' then return context||jsonb_build_object('state','CACHED','review_document_hash',p_review_document_hash,'member_published',false);end if;
  if j.state='RUNNING' and j.lease_until>at_time then return context||jsonb_build_object('state','BUSY','review_document_hash',p_review_document_hash,'member_published',false);end if;
  if j.attempts>=3 then return context||jsonb_build_object('state','EXHAUSTED','review_document_hash',p_review_document_hash,'member_published',false);end if;
 end if;
 -- Independent rounds have independent cooldowns; a valid round9 does not
 -- wait for the completed round8 transport's clock. Both share the same budget.
 select * into prior from vnext_runtime.ai_stock_dispatches where batch_id=p_batch_id and repair_symbol=p_symbol
  and coalesce(repair_model_revision,revision8)=selected_revision and created_at>at_time-interval '90 seconds'
  order by created_at desc,request_id desc limit 1;
 if found then return context||jsonb_build_object('state','ALREADY_DISPATCHED','request_id',prior.request_id,
  'review_document_hash',prior.review_document_hash,'member_published',false);end if;
 if (select count(*) from vnext_runtime.ai_stock_dispatches where batch_id=p_batch_id)>=216 then
  return context||jsonb_build_object('state','DISPATCH_BUDGET_EXHAUSTED','review_document_hash',p_review_document_hash,'member_published',false);end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='morning_alpha_daily_delivery_token' order by created_at desc limit 1;
 if token is null or length(token) not between 24 and 512 then raise exception 'AI_DISPATCH_CREDENTIAL_UNAVAILABLE';end if;
 select net.http_post(url:='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1',
  headers:=jsonb_build_object('Content-Type','application/json','x-daily-delivery-token',token),
  body:=jsonb_build_object('batch_id',p_batch_id,'repair_symbol',p_symbol,'review_document_hash',p_review_document_hash),timeout_milliseconds:=60000) into request;
 if request is null or request<=0 then raise exception 'AI_CITATION_REPAIR_DISPATCH_UNCONFIRMED';end if;
 insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id,repair_symbol,review_document_hash,original_job_key,repair_model_revision)
  values(request,p_batch_id,p_symbol,p_review_document_hash,context->>'original_job_key',selected_revision);
 return context||jsonb_build_object('state','DISPATCHED','request_id',request,'review_document_hash',p_review_document_hash,'member_published',false);
end $$;
revoke all on function public.dispatch_daily_stock_ai_citation_repair_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_daily_stock_ai_citation_repair_v1(text,text,text) to service_role;

create or replace function public.load_daily_stock_ai_citation_repair_v1(p_batch_id text,p_symbol text,p_review_document_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare context jsonb;base jsonb;receipt vnext_runtime.ai_stock_dispatches;binding vnext_runtime.ai_stock_citation_repair_reviews_v2;selected_revision text;
 revision8 constant text:='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low';
begin
 if p_review_document_hash is null or p_review_document_hash !~ '^[a-f0-9]{64}$' then raise exception 'AI_CITATION_REPAIR_REVIEW';end if;
 base:=vnext_runtime.daily_ai_citation_repair_context_v2(p_batch_id,p_symbol,revision8);
 if (select count(distinct coalesce(repair_model_revision,revision8)) from vnext_runtime.ai_stock_dispatches where batch_id=p_batch_id
  and repair_symbol=p_symbol and review_document_hash=p_review_document_hash and request_id>0)>1 then raise exception 'AI_CITATION_REPAIR_REVIEW_CONFLICT';end if;
 select * into strict receipt from vnext_runtime.ai_stock_dispatches where batch_id=p_batch_id and repair_symbol=p_symbol
  and request_id>0 and review_document_hash=p_review_document_hash and original_job_key=base->>'original_job_key'
  order by created_at desc,request_id desc limit 1;
 selected_revision:=coalesce(receipt.repair_model_revision,revision8);
 context:=vnext_runtime.daily_ai_citation_repair_context_v2(p_batch_id,p_symbol,selected_revision);
 select * into binding from vnext_runtime.ai_stock_citation_repair_reviews_v2 where batch_id=p_batch_id
  and symbol=p_symbol and review_document_hash=p_review_document_hash;
 if found and (binding.model_revision is distinct from selected_revision or binding.original_job_key is distinct from context->>'original_job_key'
  or binding.prior_job_key is distinct from context->>'prior_job_key') then raise exception 'AI_CITATION_REPAIR_REVIEW_CONFLICT';end if;
 return context||jsonb_build_object('state','READY','review_document_hash',receipt.review_document_hash,
  'dispatch_request_id',receipt.request_id,'member_published',false);
end $$;
revoke all on function public.load_daily_stock_ai_citation_repair_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_citation_repair_v1(text,text,text) to service_role;
commit;

