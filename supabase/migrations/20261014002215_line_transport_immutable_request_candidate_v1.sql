-- CANDIDATE ONLY. No historical backfill, no existing ACL/policy/cron changes.
begin;
create schema line_transport_private;
revoke all on schema line_transport_private from public,anon,authenticated;
create table line_transport_private.requests(
 id uuid primary key default gen_random_uuid(),report_date date not null,
 snapshot_id uuid,push_type text not null,retry_key uuid not null unique default gen_random_uuid(),
 body_text text not null,payload_sha256 text not null,message_preview text not null,
 created_at timestamptz not null default clock_timestamp(),
 retry_expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
 state text not null default 'PENDING' check(state in('PENDING','PROCESSING','ACCEPTED','FAILED','EXPIRED')),
 lease_token uuid,lease_expires_at timestamptz,next_retry_at timestamptz not null default clock_timestamp(),
 accepted_request_id text,last_error text,
 check(payload_sha256=encode(sha256(convert_to(body_text,'UTF8')),'hex'))
);
create table line_transport_private.members(
 outbox_id uuid primary key references public.line_delivery_outbox(id),
 request_id uuid not null references line_transport_private.requests(id),
 subscriber_id uuid not null,line_user_id text not null,idempotency_key text not null,
 ordinal integer not null check(ordinal between 1 and 500),unique(request_id,ordinal)
);
create index requests_due on line_transport_private.requests(report_date,push_type,next_retry_at)
 where state in('PENDING','PROCESSING');
alter table line_transport_private.requests enable row level security;
alter table line_transport_private.requests force row level security;
alter table line_transport_private.members enable row level security;
alter table line_transport_private.members force row level security;
revoke all on all tables in schema line_transport_private from public,anon,authenticated;
create function line_transport_private.prevent_request_rewrite() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'TRANSPORT_APPEND_ONLY';end if;
 if tg_table_name='members' then raise exception 'TRANSPORT_MEMBERS_IMMUTABLE';end if;
 if row(new.id,new.report_date,new.snapshot_id,new.push_type,new.retry_key,new.body_text,new.payload_sha256,new.message_preview,new.created_at,new.retry_expires_at)
 is distinct from row(old.id,old.report_date,old.snapshot_id,old.push_type,old.retry_key,old.body_text,old.payload_sha256,old.message_preview,old.created_at,old.retry_expires_at)
 then raise exception 'TRANSPORT_REQUEST_IMMUTABLE';end if;
 return new;
end $$;
create trigger request_immutable before update or delete on line_transport_private.requests for each row execute function line_transport_private.prevent_request_rewrite();
create trigger members_immutable before update or delete on line_transport_private.members for each row execute function line_transport_private.prevent_request_rewrite();

-- A legacy Sender rollback must NEVER retry a bound group with a different key.
-- Only the new transactional request RPC may move a bound queue item.
create function line_transport_private.guard_bound_outbox() returns trigger
language plpgsql security definer set search_path='' as $$
declare bound uuid;begin
 select request_id into bound from line_transport_private.members where outbox_id=old.id;
 if not found then return new;end if;
 if row(new.id,new.report_date,new.decision_snapshot_id,new.line_subscriber_id,new.line_user_id,new.push_type,new.idempotency_key,new.payload)
 is distinct from row(old.id,old.report_date,old.decision_snapshot_id,old.line_subscriber_id,old.line_user_id,old.push_type,old.idempotency_key,old.payload)
 then raise exception 'TRANSPORT_BOUND_OUTBOX_IMMUTABLE';end if;
 if current_setting('ma.line_transport_request',true) is distinct from bound::text
 then raise exception 'TRANSPORT_BOUND_OUTBOX_REQUIRES_NEW_WORKER';end if;
 return new;
end $$;
create trigger line_transport_bound_guard before update on public.line_delivery_outbox for each row execute function line_transport_private.guard_bound_outbox();

-- Entire immutable multicast groups are leased, never partial regrouped subsets.
create function public.claim_line_transport_request_v1(p_report_date date,p_decision_snapshot_id uuid,p_push_type text,p_limit integer default 1000,p_lease_seconds integer default 180)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb='[]';r line_transport_private.requests;ids uuid[];body text;preview text;
 total integer=0;n integer;lease uuid;row_record record;messages jsonb;
begin
 if p_report_date is null or p_push_type not in('daily_report','data_incident','market_closed_typhoon')
 or p_limit not between 1 and 1000 or p_lease_seconds<>180 then raise exception 'TRANSPORT_SCOPE_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('LINE_TRANSPORT_V1:'||p_report_date||':'||p_push_type,0));
 -- Existing request leases are recoverable even after the HTTP caller crashes.
 for r in select * from line_transport_private.requests t where t.report_date=p_report_date and t.push_type=p_push_type
 and t.snapshot_id is not distinct from p_decision_snapshot_id
 and ((t.state='PENDING' and t.next_retry_at<=clock_timestamp()) or(t.state='PROCESSING' and t.lease_expires_at<=clock_timestamp()))
 order by t.created_at,t.id for update skip locked loop
  if r.retry_expires_at<=clock_timestamp() then
   update line_transport_private.requests set state='EXPIRED',last_error='RETRY_KEY_WINDOW_EXPIRED_NO_RESEND' where id=r.id;continue;
  end if;
  select array_agg(m.outbox_id order by m.ordinal),count(*) into ids,n from line_transport_private.members m where m.request_id=r.id;
  if total+n>p_limit then continue;end if;
  -- Uncertain legacy/externally changed queue state must not generate a new key.
  if exists(select 1 from public.line_delivery_outbox o where o.id=any(ids)
    and(o.status not in('PENDING','PROCESSING') or o.attempt_count>=o.max_attempts))
  then raise exception 'TRANSPORT_QUEUE_STATE_REQUIRES_REVIEW';end if;
  lease=gen_random_uuid();
  perform set_config('ma.line_transport_request',r.id::text,true);
  update line_transport_private.requests set state='PROCESSING',lease_token=lease,lease_expires_at=clock_timestamp()+interval '180 seconds' where id=r.id;
  update public.line_delivery_outbox set status='PROCESSING',attempt_count=attempt_count+1,lease_expires_at=clock_timestamp()+interval '180 seconds',updated_at=clock_timestamp() where id=any(ids);
  result=result||jsonb_build_array(jsonb_build_object('request_id',r.id,'lease_token',lease,'retry_key',r.retry_key,'body_text',r.body_text,'payload_sha256',r.payload_sha256,'message_preview',r.message_preview,
    'members',(select jsonb_agg(jsonb_build_object('id',m.subscriber_id,'line_user_id',m.line_user_id,'outbox_id',m.outbox_id,'idempotency_key',m.idempotency_key) order by m.ordinal) from line_transport_private.members m where m.request_id=r.id)));
  total=total+n;
 end loop;
 while total<p_limit loop
  -- Never migrate an already-attempted legacy request into a fresh retry identity.
  select o.payload->'message' into messages from public.line_delivery_outbox o
   where o.report_date=p_report_date and o.push_type=p_push_type and o.decision_snapshot_id is not distinct from p_decision_snapshot_id
   and o.status='PENDING' and o.attempt_count=0 and o.next_retry_at<=clock_timestamp()
   and not exists(select 1 from line_transport_private.members m where m.outbox_id=o.id)
   order by o.created_at,o.id limit 1 for update;
  if not found then exit;end if;
  if messages is null or jsonb_typeof(messages)<>'object' then raise exception 'TRANSPORT_PAYLOAD_REQUIRED';end if;
  select array_agg(q.id order by q.id) into ids from(
   select o.id from public.line_delivery_outbox o where o.report_date=p_report_date and o.push_type=p_push_type
   and o.decision_snapshot_id is not distinct from p_decision_snapshot_id and o.status='PENDING' and o.attempt_count=0
   and o.next_retry_at<=clock_timestamp() and o.payload->'message'=messages
   and not exists(select 1 from line_transport_private.members m where m.outbox_id=o.id)
   order by o.id limit least(500,p_limit-total) for update skip locked)q;
  if ids is null then exit;end if;n=cardinality(ids);
  select jsonb_build_object('to',jsonb_agg(o.line_user_id order by o.id),'messages',jsonb_build_array(messages),
   'customAggregationUnits',jsonb_build_array('ma_daily_'||replace(p_report_date::text,'-','')))::text,
   min(coalesce(o.payload->>'message_preview','')) into body,preview from public.line_delivery_outbox o where o.id=any(ids);
  lease=gen_random_uuid();
  insert into line_transport_private.requests(report_date,snapshot_id,push_type,body_text,payload_sha256,message_preview,state,lease_token,lease_expires_at)
   values(p_report_date,p_decision_snapshot_id,p_push_type,body,encode(sha256(convert_to(body,'UTF8')),'hex'),preview,'PROCESSING',lease,clock_timestamp()+interval '180 seconds') returning * into r;
  insert into line_transport_private.members select o.id,r.id,o.line_subscriber_id,o.line_user_id,o.idempotency_key,row_number()over(order by o.id)
   from public.line_delivery_outbox o where o.id=any(ids);
  perform set_config('ma.line_transport_request',r.id::text,true);
  update public.line_delivery_outbox set status='PROCESSING',attempt_count=attempt_count+1,lease_expires_at=clock_timestamp()+interval '180 seconds',updated_at=clock_timestamp() where id=any(ids);
  result=result||jsonb_build_array(jsonb_build_object('request_id',r.id,'lease_token',lease,'retry_key',r.retry_key,'body_text',r.body_text,'payload_sha256',r.payload_sha256,'message_preview',r.message_preview,
    'members',(select jsonb_agg(jsonb_build_object('id',m.subscriber_id,'line_user_id',m.line_user_id,'outbox_id',m.outbox_id,'idempotency_key',m.idempotency_key) order by m.ordinal) from line_transport_private.members m where m.request_id=r.id)));
  total=total+n;
 end loop;
 return result;
end $$;

-- Acceptance/outbox/logging are one fenced transaction, not a second send.
create function public.complete_line_transport_request_v1(p_request uuid,p_lease uuid,p_status text,p_error text,p_accepted_request_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r line_transport_private.requests;ids uuid[];n integer;completion_state text;
begin
 select * into r from line_transport_private.requests where id=p_request for update;
 if not found or r.state<>'PROCESSING' or r.lease_token is distinct from p_lease or r.lease_expires_at<=clock_timestamp()
 then raise exception 'TRANSPORT_LEASE_FENCED';end if;
 if p_status not in('SENT','RETRY','FAILED') or length(coalesce(p_error,''))>500
 or(p_accepted_request_id is not null and p_accepted_request_id!~'^[A-Za-z0-9_-]{1,128}$') then raise exception 'TRANSPORT_COMPLETION_INVALID';end if;
 select array_agg(outbox_id order by ordinal),count(*) into ids,n from line_transport_private.members where request_id=r.id;
 perform set_config('ma.line_transport_request',r.id::text,true);
 perform public.mark_line_delivery_outbox_v1(ids,p_status,p_error,60);
 completion_state=case when p_status='SENT' then 'ACCEPTED' when p_status='FAILED'
 or exists(select 1 from public.line_delivery_outbox o where o.id=any(ids) and o.status='DEAD_LETTERED') then 'FAILED' else 'PENDING' end;
 update line_transport_private.requests set state=completion_state,lease_token=null,lease_expires_at=null,next_retry_at=clock_timestamp()+interval '60 seconds',
 accepted_request_id=p_accepted_request_id,last_error=p_error where id=r.id;
 insert into public.line_push_logs(line_user_id,push_type,report_date,status,message_preview,error_message)
 select line_user_id,r.push_type,r.report_date,case when p_status='SENT' then 'success' else 'failed' end,r.message_preview,p_error
 from line_transport_private.members where request_id=r.id;
 if p_status='SENT' then update public.line_subscribers set last_pushed_at=clock_timestamp(),updated_at=clock_timestamp()
 where id in(select subscriber_id from line_transport_private.members where request_id=r.id);end if;
 return jsonb_build_object('status',completion_state,'count',n,'request_id',r.id);
end $$;
revoke all on function line_transport_private.prevent_request_rewrite() from public,anon,authenticated,service_role;
revoke all on function line_transport_private.guard_bound_outbox() from public,anon,authenticated,service_role;
revoke all on function public.claim_line_transport_request_v1(date,uuid,text,integer,integer),
 public.complete_line_transport_request_v1(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_line_transport_request_v1(date,uuid,text,integer,integer),
 public.complete_line_transport_request_v1(uuid,uuid,text,text,text) to service_role;
commit;
