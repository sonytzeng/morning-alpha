-- Unapplied continuation candidate. Install only after price workflow SQL and
-- the compatible draft worker are ready. The existing Cron/window/calendar,
-- source acquisition, author budget, reviews and publication gates stay intact.
begin;
do $guard$
begin
 if to_regprocedure('vnext_private.daily_ai_price_work_key_v1(text)') is null
  or to_regprocedure('public.finish_daily_ai_price_work_v1(text,text,text,text)') is null
  or to_regclass('vnext_private.ai_price_work_results_v1') is null
  or to_regclass('vnext_private.zero_paid_draft_runs_v1') is null
  or to_regclass('vnext_private.zero_paid_draft_delivery_v1') is null
  or to_regclass('vnext_private.reviewed_analysis_snapshots_v1') is null
  or to_regclass('vnext_runtime.ai_stock_intakes') is null
  then raise exception 'PRICE_RESUME_PREREQUISITES';end if;
 if to_regclass('vnext_private.ai_price_work_dispatches_v1') is not null
  or to_regprocedure('vnext_private.resume_daily_ai_price_work_v1()') is not null
  then raise exception 'PRICE_RESUME_ALREADY_EXISTS';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p
   where p.oid=to_regprocedure('vnext_private.resume_zero_paid_stock_draft_v1()'))
   is distinct from '7ebe6088ff2e24dbfb316d55306672b9'
  then raise exception 'PRICE_RESUME_BASELINE_DRIFT';end if;
end $guard$;

-- Price retries have their own bounded budget and immutable attempt history.
-- They cannot consume the existing draft author's three attempts.
create table vnext_private.ai_price_work_dispatches_v1(
 edition_id text not null references vnext_private.ai_research_editions(id),
 work_key text not null check(work_key ~ '^[a-f0-9]{64}$'),
 attempt integer not null check(attempt between 1 and 3),
 attempted_at timestamptz not null default clock_timestamp(),
 state text not null check(state in('DISPATCHED','ENQUEUE_FAILED')),
 request_id bigint,
 primary key(edition_id,work_key,attempt),
 check((state='DISPATCHED')=(request_id is not null))
);
alter table vnext_private.ai_price_work_dispatches_v1 enable row level security;
alter table vnext_private.ai_price_work_dispatches_v1 force row level security;
revoke all on vnext_private.ai_price_work_dispatches_v1 from public,anon,authenticated,service_role;
create trigger immutable before update or delete on vnext_private.ai_price_work_dispatches_v1
 for each row execute function vnext_private.immutable_record();

create function vnext_private.resume_daily_ai_price_work_v1() returns jsonb
language plpgsql security definer set search_path='' as $$
declare edition text;batch text;key text;attempts integer;last_attempt timestamptz;token text;request bigint;
 at_time timestamptz:=clock_timestamp();local_date date:=(clock_timestamp() at time zone 'Asia/Taipei')::date;
 author constant text:='ZERO_PAID_DAILY_AUTHOR_1.0.0; deterministic author only; independent review pending';
begin
 if not pg_try_advisory_xact_lock(hashtextextended('daily-ai-price-work-delivery',0)) then
  return jsonb_build_object('state','PRICE_WORK_BUSY','model_calls',0,'member_published',false);end if;
 select e.id,b.id,vnext_private.daily_ai_price_work_key_v1(e.id) into edition,batch,key
 from vnext_runtime.ai_stock_intakes q join vnext_runtime.ai_stock_batches b on b.id=q.batch_id
 join vnext_private.zero_paid_draft_runs_v1 r on r.batch_id=b.id
 join vnext_private.reviewed_analysis_snapshots_v1 s on s.batch_id=b.id and s.author_ref=author
  and (s.body->>'prepared_at')::timestamptz=r.prepared_at and (s.body->>'expires_at')::timestamptz=r.expires_at
 join vnext_private.ai_research_editions e on e.batch_id=b.id and e.reviewed_snapshot_hash=s.snapshot_hash
 where q.business_date=local_date and q.state='COMPLETE'
  and q.id=(select x.id from vnext_runtime.ai_stock_intakes x where x.business_date=local_date order by x.requested_at desc,x.id desc limit 1)
  and b.cutoff<=at_time and b.cutoff+interval '24 hours'>at_time
  and e.created_at<=at_time and e.expires_at>at_time and vnext_private.ai_edition_integrity_v1(e.id)
  and not exists(select from vnext_private.ai_price_work_results_v1 done
   where done.edition_id=e.id and done.work_key=vnext_private.daily_ai_price_work_key_v1(e.id))
 order by e.created_at desc,e.id desc limit 1;
 if edition is null then return jsonb_build_object('state','NO_PENDING_PRICE_WORK','model_calls',0,'member_published',false);end if;
 select count(*)::integer,max(attempted_at) into attempts,last_attempt from vnext_private.ai_price_work_dispatches_v1
  where edition_id=edition and work_key=key;
 if attempts>=3 then return jsonb_build_object('state','PRICE_WORK_EXHAUSTED','edition_id',edition,'work_key',key,'model_calls',0,'member_published',false);end if;
 if last_attempt>at_time-interval '5 minutes' then return jsonb_build_object('state','PRICE_WORK_ALREADY_DISPATCHED',
  'edition_id',edition,'work_key',key,'model_calls',0,'member_published',false);end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='morning_alpha_daily_delivery_token' order by created_at desc limit 1;
 if token is null or length(token) not between 24 and 512 then
  return jsonb_build_object('state','PRICE_WORK_CREDENTIAL_UNAVAILABLE','model_calls',0,'member_published',false);end if;
 begin
  select net.http_post(url:='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1',
   headers:=jsonb_build_object('Content-Type','application/json','x-daily-delivery-token',token),
   body:=jsonb_build_object('draft_batch_id',batch),timeout_milliseconds:=35000) into request;
  if request is null then raise exception 'PRICE_WORK_DISPATCH_UNCONFIRMED';end if;
  insert into vnext_private.ai_price_work_dispatches_v1(edition_id,work_key,attempt,attempted_at,state,request_id)
   values(edition,key,attempts+1,at_time,'DISPATCHED',request);
 exception when others then
  insert into vnext_private.ai_price_work_dispatches_v1(edition_id,work_key,attempt,attempted_at,state,request_id)
   values(edition,key,attempts+1,at_time,'ENQUEUE_FAILED',null);
  return jsonb_build_object('state','PRICE_WORK_ENQUEUE_FAILED','edition_id',edition,'work_key',key,'model_calls',0,'member_published',false);
 end;
 return jsonb_build_object('state','PRICE_WORK_DISPATCHED','edition_id',edition,'batch_id',batch,'work_key',key,
  'request_id',request,'attempt',attempts+1,'model_calls',0,'member_published',false);
end $$;
revoke all on function vnext_private.resume_daily_ai_price_work_v1() from public,anon,authenticated,service_role;

-- The exact saved production resumer follows. Its only changed branch calls
-- the price continuation when no draft needs work. Original ACL is preserved.
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
 if batch is null then return vnext_private.resume_daily_ai_price_work_v1();end if;
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
commit;
