-- Read-only production definition saved 2026-11-10.
-- pg_get_functiondef MD5: 7ebe6088ff2e24dbfb316d55306672b9.
-- Fixture only; no production execution or credential values are included.
CREATE OR REPLACE FUNCTION vnext_private.resume_zero_paid_stock_draft_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare batch text;d vnext_private.zero_paid_draft_delivery_v1;token text;request bigint;
 at_time timestamptz:=clock_timestamp();local_date date:=(clock_timestamp() at time zone 'Asia/Taipei')::date;
 author constant text:='ZERO_PAID_DAILY_AUTHOR_1.0.0; deterministic author only; independent review pending';
begin
 if not pg_try_advisory_xact_lock(hashtextextended('zero-paid-draft-delivery',0)) then
  return jsonb_build_object('state','BUSY','model_calls',0,'member_published',false);end if;
 select q.batch_id into batch from vnext_runtime.ai_stock_intakes q
 join vnext_runtime.ai_stock_batches b on b.id=q.batch_id
 left join vnext_private.zero_paid_draft_runs_v1 r on r.batch_id=b.id
 where q.business_date=local_date and q.state='COMPLETE'
  and q.id=(select x.id from vnext_runtime.ai_stock_intakes x where x.business_date=local_date order by x.requested_at desc,x.id desc limit 1)
  and b.cutoff<=at_time and b.cutoff+interval '24 hours'>at_time
  and (r.batch_id is null or r.attempts<3 and r.last_attempt_at+interval '45 seconds'<=at_time
   or exists(select from vnext_private.reviewed_analysis_snapshots_v1 s where s.batch_id=b.id and s.author_ref=author
    and (s.body->>'prepared_at')::timestamptz=r.prepared_at and (s.body->>'expires_at')::timestamptz=r.expires_at))
  and not exists(select from vnext_private.ai_research_editions e join vnext_private.reviewed_analysis_snapshots_v1 s
   on s.snapshot_hash=e.reviewed_snapshot_hash where s.batch_id=b.id and s.author_ref=author
   and (s.body->>'prepared_at')::timestamptz=r.prepared_at and (s.body->>'expires_at')::timestamptz=r.expires_at
   and e.expires_at>at_time and vnext_private.ai_edition_integrity_v1(e.id))
 order by q.requested_at desc,q.id desc limit 1;
 if batch is null then return jsonb_build_object('state','NO_PENDING_DRAFT','model_calls',0,'member_published',false);end if;
 insert into vnext_private.zero_paid_draft_delivery_v1(batch_id) values(batch) on conflict do nothing;
 select * into strict d from vnext_private.zero_paid_draft_delivery_v1 where batch_id=batch for update;
 if d.attempts>=3 then return jsonb_build_object('state','EXHAUSTED','model_calls',0,'member_published',false);end if;
 if d.updated_at>at_time-interval '5 minutes' then return jsonb_build_object('state','ALREADY_DISPATCHED','model_calls',0,'member_published',false);end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='morning_alpha_daily_delivery_token' order by created_at desc limit 1;
 if token is null or length(token) not between 24 and 512 then return jsonb_build_object('state','CREDENTIAL_UNAVAILABLE','model_calls',0,'member_published',false);end if;
 update vnext_private.zero_paid_draft_delivery_v1 set attempts=attempts+1,updated_at=at_time where batch_id=batch;
 begin
  select net.http_post(url:='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1',
   headers:=jsonb_build_object('Content-Type','application/json','x-daily-delivery-token',token),
   body:=jsonb_build_object('draft_batch_id',batch),timeout_milliseconds:=35000) into request;
  if request is null then raise exception 'ZERO_PAID_DRAFT_DISPATCH_UNCONFIRMED';end if;
  update vnext_private.zero_paid_draft_delivery_v1 set request_id=request,last_code='DISPATCHED' where batch_id=batch;
 exception when others then
  update vnext_private.zero_paid_draft_delivery_v1 set last_code='ENQUEUE_FAILED' where batch_id=batch;
  return jsonb_build_object('state','ENQUEUE_FAILED','model_calls',0,'member_published',false);
 end;
 return jsonb_build_object('state','DISPATCHED','batch_id',batch,'request_id',request,'model_calls',0,'member_published',false);
end $function$;
