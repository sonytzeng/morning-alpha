-- Additive Owner research journal. No existing rows, policy, trigger or Cron changes.
begin;
create table public.owner_lab_trades (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id),
 request_id uuid not null,
 kind text not null check(kind in ('SYSTEM_SIMULATION','SONY_LIVE_TRADE')),
 symbol text not null check(symbol ~ '^[0-9]{4,6}$'),
 entered_at timestamptz not null,
 entry_price numeric not null check(entry_price>0 and entry_price<10000000),
 quantity numeric not null check(quantity>0 and quantity<100000000),
 entry_condition text not null check(length(entry_condition) between 1 and 2000),
 stop_price numeric check(stop_price>0 and stop_price<entry_price),
 horizon text not null check(horizon in ('CLOSE','1D','3D','5D')),
 notes text not null default '' check(length(notes)<=2000),
 system_snapshot jsonb not null check(jsonb_typeof(system_snapshot)='object'),
 snapshot_hash text not null,
 recording_kind text not null check(recording_kind in ('PROSPECTIVE_PAPER','SELF_REPORTED_CURRENT','RETROSPECTIVE_JOURNAL')),
 created_at timestamptz not null default clock_timestamp(),
 unique(owner_id,request_id),check(entered_at<=created_at)
);
create index owner_lab_trades_owner_date on public.owner_lab_trades(owner_id,created_at desc);
create table public.owner_lab_trade_events (
 id uuid primary key default gen_random_uuid(),
 trade_id uuid not null references public.owner_lab_trades(id),
 event_key text not null,
 event_type text not null check(event_type in ('EXIT','OUTCOME')),
 occurred_at timestamptz not null,
 price numeric not null check(price>0 and price<10000000),
 quote_id uuid references public.market_quotes(id),
 target_date date,
 payload jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(trade_id,event_key),check(occurred_at<=created_at),
 check((event_type='EXIT' and event_key='EXIT' and quote_id is null) or
 (event_type='OUTCOME' and event_key in ('CLOSE','1D','3D','5D') and quote_id is not null and target_date is not null))
);
create index owner_lab_event_quote on public.owner_lab_trade_events(quote_id);
alter table public.owner_lab_trades enable row level security;
alter table public.owner_lab_trades force row level security;
alter table public.owner_lab_trade_events enable row level security;
alter table public.owner_lab_trade_events force row level security;
revoke all on public.owner_lab_trades,public.owner_lab_trade_events from public,anon,authenticated,service_role;
grant select on public.owner_lab_trades,public.owner_lab_trade_events to authenticated,service_role;
create policy owner_lab_trade_read on public.owner_lab_trades for select to authenticated
 using((select public.is_research_owner_v1()) and owner_id=(select auth.uid()));
create policy owner_lab_event_read on public.owner_lab_trade_events for select to authenticated
 using((select public.is_research_owner_v1()) and exists(select from public.owner_lab_trades t where t.id=trade_id and t.owner_id=(select auth.uid())));
create trigger owner_lab_trade_immutable before update or delete on public.owner_lab_trades
 for each row execute function research_private.reject_mutation();
create trigger owner_lab_trade_no_truncate before truncate on public.owner_lab_trades
 for each statement execute function research_private.reject_mutation();
create trigger owner_lab_event_immutable before update or delete on public.owner_lab_trade_events
 for each row execute function research_private.reject_mutation();
create trigger owner_lab_event_no_truncate before truncate on public.owner_lab_trade_events
 for each statement execute function research_private.reject_mutation();

-- Same existing owner enrollment, never user metadata or caller-supplied owner=true.
create function research_private.lab_require_owner(p_owner uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 if not exists(select from research_private.owner_access a join public.profiles p on p.id=a.principal_id
  where a.principal_id=p_owner and a.enabled and lower(p.role)='admin') then
  raise exception 'RESEARCH_OWNER_REQUIRED' using errcode='42501'; end if;
end $$;
revoke all on function research_private.lab_require_owner(uuid) from public,anon,authenticated,service_role;

create function public.owner_lab_target_sessions_v1(p_entry timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d date; dates date[]:='{}'; first_day date:=(p_entry at time zone 'Asia/Taipei')::date; i integer;
begin
 for i in 0..45 loop
  d:=first_day+i;
  if public.market_calendar_session_v1('TW',d) and (d>first_day or (p_entry at time zone 'Asia/Taipei')::time < time '13:30') then dates:=array_append(dates,d); end if;
  exit when cardinality(dates)=6;
 end loop;
 if cardinality(dates)<6 then raise exception 'CALENDAR_COVERAGE_UNAVAILABLE'; end if;
 return jsonb_build_object('CLOSE',dates[1],'1D',dates[2],'3D',dates[4],'5D',dates[6]);
end $$;
revoke all on function public.owner_lab_target_sessions_v1(timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.owner_lab_target_sessions_v1(timestamptz) to service_role;

create function public.owner_lab_record_trade_v1(p_owner uuid,p_request uuid,p_trade jsonb,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.owner_lab_trades; old public.owner_lab_trades; canonical jsonb; shadow jsonb; q public.market_quotes;
 at_time timestamptz:=clock_timestamp(); asof timestamptz; key_kind text; sid uuid; aid uuid;
begin
 perform research_private.lab_require_owner(p_owner);
 if p_request is null or jsonb_typeof(p_trade) is distinct from 'object' or jsonb_typeof(p_snapshot) is distinct from 'object' then raise exception 'INPUT_INVALID'; end if;
 -- Serialize duplicate clicks without updating the original snapshot or returning a different request.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_request::text,0));
 select * into old from public.owner_lab_trades where owner_id=p_owner and request_id=p_request;
 if found then
  if (case when old.system_snapshot ? 'client_request' then old.system_snapshot->'client_request' is distinct from p_snapshot->'client_request'
   else old.system_snapshot->'request' is distinct from p_trade end) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('status','ALREADY_RECORDED','id',old.id);
 end if;
 if p_snapshot->>'version' is distinct from 'OWNER_TRADING_LAB_V1' or p_snapshot->>'production_eligible' is distinct from 'false' then raise exception 'SNAPSHOT_CONTRACT'; end if;
 asof:=(p_snapshot->>'as_of')::timestamptz;
 if asof is null or asof>at_time or asof<at_time-interval '5 minutes' then raise exception 'SNAPSHOT_TIME_INVALID'; end if;
 sid:=nullif(p_snapshot->'canonical'->>'id','')::uuid;
 if sid is not null then
  select to_jsonb(d) into canonical from public.decision_snapshots d where d.id=sid and d.created_at<=asof;
  if canonical is null or canonical is distinct from p_snapshot->'canonical' then raise exception 'CANONICAL_LINEAGE_MISMATCH'; end if;
 end if;
 aid:=nullif(p_snapshot->'shadow'->>'id','')::uuid;
 if aid is not null then
  select jsonb_build_object('id',a.id,'analysis',a.analysis,'prediction_hash',a.prediction_hash) into shadow
  from public.research_daily_analysis a where a.id=aid and a.created_at<=asof and a.analysis_cutoff_at<=asof;
  if shadow is null or shadow is distinct from p_snapshot->'shadow' then raise exception 'SHADOW_LINEAGE_MISMATCH'; end if;
 end if;
 t:=jsonb_populate_record(null::public.owner_lab_trades,p_trade);
 if t.entered_at is null or t.entered_at>at_time then raise exception 'FUTURE_ENTRY_DENIED'; end if;
 if t.kind='SYSTEM_SIMULATION' then
  if t.entered_at<asof or t.entered_at<at_time-interval '5 minutes' or canonical->>'status' is distinct from 'READY'
   or canonical->>'report_date' is distinct from (at_time at time zone 'Asia/Taipei')::date::text
   or p_snapshot->'candidate'->>'symbol' is distinct from t.symbol
   or p_snapshot->'candidate'->>'status' is distinct from 'WATCHLIST'
   or t.stop_price is null then raise exception 'PAPER_ENTRY_NOT_ELIGIBLE'; end if;
  key_kind:='PROSPECTIVE_PAPER';
  select * into q from public.market_quotes where id=(p_snapshot->>'paper_quote_id')::uuid;
  if q.id is null or q.symbol is distinct from t.symbol or q.value is distinct from t.entry_price
   or q.trading_date is distinct from (asof at time zone 'Asia/Taipei')::date or q.phase is distinct from 'intraday'
   or q.quality_status is distinct from 'verified' or q.freshness_status is null or q.freshness_status not in ('fresh','provider_returned')
   or q.captured_at is null or q.ingested_at is null or q.captured_at>asof or q.captured_at<asof-interval '5 minutes' or q.ingested_at>asof then
   raise exception 'PAPER_QUOTE_INVALID'; end if;
 else key_kind:=case when t.entered_at<at_time-interval '5 minutes' then 'RETROSPECTIVE_JOURNAL' else 'SELF_REPORTED_CURRENT' end;
 end if;
 insert into public.owner_lab_trades(owner_id,request_id,kind,symbol,entered_at,entry_price,quantity,entry_condition,stop_price,horizon,notes,system_snapshot,snapshot_hash,recording_kind)
 values(p_owner,p_request,t.kind,t.symbol,t.entered_at,t.entry_price,t.quantity,t.entry_condition,t.stop_price,t.horizon,coalesce(t.notes,''),
  p_snapshot||jsonb_build_object('request',p_trade),md5((p_snapshot||jsonb_build_object('request',p_trade))::text),key_kind) returning * into t;
 return jsonb_build_object('status','RECORDED','id',t.id);
end $$;
revoke all on function public.owner_lab_record_trade_v1(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.owner_lab_record_trade_v1(uuid,uuid,jsonb,jsonb) to service_role;

create function public.owner_lab_append_event_v1(p_owner uuid,p_trade_id uuid,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.owner_lab_trades; old public.owner_lab_trade_events; q public.market_quotes; v_event_key text;
 event_type text:=p_event->>'event_type'; event_at timestamptz; price numeric; target date; quote uuid;
begin
 perform research_private.lab_require_owner(p_owner);
 select * into t from public.owner_lab_trades where id=p_trade_id and owner_id=p_owner;
 if not found then raise exception 'TRADE_NOT_FOUND'; end if;
 v_event_key:=case when event_type='EXIT' then 'EXIT' else p_event->>'horizon' end;
 if event_type is null or event_type not in ('EXIT','OUTCOME') or v_event_key is null then raise exception 'EVENT_CONTRACT_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_trade_id::text||v_event_key,0));
 select * into old from public.owner_lab_trade_events e where e.trade_id=p_trade_id and e.event_key=v_event_key;
 if found then
  if event_type='EXIT' and (old.price is distinct from (p_event->>'price')::numeric or old.occurred_at is distinct from (p_event->>'occurred_at')::timestamptz) then raise exception 'IMMUTABLE_EXIT_CONFLICT'; end if;
  return jsonb_build_object('status','ALREADY_RECORDED','id',old.id);
 end if;
 if event_type='OUTCOME' then
  target:=(public.owner_lab_target_sessions_v1(t.entered_at)->>v_event_key)::date;
  quote:=(p_event->>'quote_id')::uuid;
  select * into q from public.market_quotes where id=quote;
  if q.id is null or target is null or q.symbol is distinct from t.symbol or q.trading_date is distinct from target or q.phase is distinct from 'close'
   or q.quality_status is distinct from 'verified' or q.freshness_status is null or q.freshness_status not in ('fresh','provider_returned') or q.value is null or q.value<=0
   or q.captured_at is null or q.ingested_at is null
   or q.captured_at<=t.entered_at or q.captured_at>clock_timestamp() or q.ingested_at>clock_timestamp() then raise exception 'OUTCOME_EVIDENCE_INVALID'; end if;
  if exists(select from public.market_quotes x where x.symbol=t.symbol and x.trading_date=target and x.phase='close'
   and x.quality_status='verified' and x.freshness_status in ('fresh','provider_returned') and x.captured_at<=clock_timestamp()
   and x.ingested_at<=clock_timestamp() and x.value<>q.value) then raise exception 'OUTCOME_CONFLICT'; end if;
  price:=q.value;event_at:=q.captured_at;
 else
  if event_type<>'EXIT' or t.kind<>'SONY_LIVE_TRADE' then raise exception 'EXIT_REQUIRES_LIVE_TRADE'; end if;
  price:=(p_event->>'price')::numeric;event_at:=(p_event->>'occurred_at')::timestamptz;
 end if;
 if event_at is null or event_at<=t.entered_at or event_at>clock_timestamp() then raise exception 'EVENT_TIME_INVALID'; end if;
 insert into public.owner_lab_trade_events(trade_id,event_key,event_type,occurred_at,price,quote_id,target_date,payload)
 values(t.id,v_event_key,event_type,event_at,price,quote,target,jsonb_build_object('return_percent',(price/t.entry_price-1)*100,
 'mfe',null,'mae',null,'fees_included',false,'source',case when event_type='EXIT' then 'SONY_SELF_REPORTED' else 'market_quotes' end)) returning * into old;
 return jsonb_build_object('status','RECORDED','id',old.id);
end $$;
revoke all on function public.owner_lab_append_event_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.owner_lab_append_event_v1(uuid,uuid,jsonb) to service_role;
commit;
