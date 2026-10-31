-- Match the independently reviewed Astra low-effort prompt7 runtime.
-- Existing jobs/receipts and transport budgets are preserved.
begin;
create or replace function public.resume_daily_stock_ai_intake_v1(p_intake_id uuid) returns jsonb
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
commit;
