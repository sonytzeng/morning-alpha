-- Owner Cockpit additive journal. Existing trades, policies and predictions untouched.
begin;
create table research_private.owner_cockpit_ledger (
 id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity unique,
 owner_id uuid not null references public.profiles(id), request_id uuid not null,
 method text not null default 'MOVING_AVERAGE_V1' check(method='MOVING_AVERAGE_V1'),
 book text not null check(book in ('LIVE','PAPER')), symbol text not null check(symbol ~ '^[0-9]{4,6}$'),
 action text not null check(action in ('BUY','SELL','VOID')),
 quantity numeric, price numeric, fee numeric, tax numeric, other_cost numeric,
 occurred_at timestamptz not null, recorded_at timestamptz not null default clock_timestamp(),
 replaces uuid references research_private.owner_cockpit_ledger(id),
 reason text not null default '' check(length(reason)<=2000),
 request jsonb not null, unique(owner_id,request_id), unique(replaces),
 check(occurred_at<=recorded_at),
 check((action='VOID' and replaces is not null and quantity is null and price is null) or
       (action in ('BUY','SELL') and quantity is not null and price is not null and quantity>0 and quantity<100000000 and quantity=trunc(quantity)
        and price>0 and price<10000000)),
 check(fee is null or (fee>=0 and fee<1000000000)),
 check(tax is null or (tax>=0 and tax<1000000000)),
 check(other_cost is null or (other_cost>=0 and other_cost<1000000000))
);
create index owner_cockpit_owner_sequence on research_private.owner_cockpit_ledger(owner_id,sequence);
alter table research_private.owner_cockpit_ledger enable row level security;
alter table research_private.owner_cockpit_ledger force row level security;
revoke all on research_private.owner_cockpit_ledger from public,anon,authenticated,service_role;
create trigger owner_cockpit_immutable before update or delete on research_private.owner_cockpit_ledger
 for each row execute function research_private.reject_mutation();
create trigger owner_cockpit_no_truncate before truncate on research_private.owner_cockpit_ledger
 for each statement execute function research_private.reject_mutation();

-- Pure versioned numeric reducer. Exact decimal accounting; round only for display.
create function research_private.cockpit_account_v1(p_rows jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb; positions jsonb:='{}'; fills jsonb:='[]'; s jsonb; k text;
 qty numeric; cost numeric; gross numeric; realized numeric; realized_gross numeric;
 n numeric; p numeric; expenses numeric; allocated numeric; allocated_gross numeric; profit numeric;
begin
 for r in select value from jsonb_array_elements(p_rows) loop
  k:=(r->>'book')||':'||(r->>'symbol');s:=positions->k;
  qty:=coalesce((s->>'quantity')::numeric,0);gross:=coalesce((s->>'gross_cost')::numeric,0);
  cost:=case when s is null then 0 else (s->>'cost')::numeric end;
  realized:=case when s is null then 0 else (s->>'realized')::numeric end;
  realized_gross:=coalesce((s->>'realized_gross')::numeric,0);
  n:=(r->>'quantity')::numeric;p:=(r->>'price')::numeric;
  expenses:=(r->>'fee')::numeric+(r->>'tax')::numeric+(r->>'other_cost')::numeric;
  if n is null or p is null or n<=0 or p<=0 then raise exception 'LEDGER_INPUT_INVALID';end if;
  allocated:=null;profit:=null;
  if r->>'action'='BUY' then
   cost:=cost+n*p+expenses;gross:=gross+n*p;qty:=qty+n;
  elsif r->>'action'='SELL' then
   if n>qty then raise exception 'OVERSELL' using errcode='22023';end if;
   allocated:=cost*n/qty;allocated_gross:=gross*n/qty;
   profit:=n*p-expenses-allocated;realized:=realized+profit;
   realized_gross:=realized_gross+n*p-allocated_gross;
   cost:=cost-allocated;gross:=gross-allocated_gross;qty:=qty-n;
   if qty=0 then cost:=0;gross:=0;end if;
  else raise exception 'LEDGER_ACTION_INVALID';end if;
  positions:=jsonb_set(positions,array[k],jsonb_build_object('book',r->>'book','symbol',r->>'symbol',
   'quantity',qty,'cost',cost,'gross_cost',gross,'average_cost',case when qty>0 then cost/qty else null end,
   'realized',realized,'realized_gross',realized_gross));
  fills:=fills||jsonb_build_array(r||jsonb_build_object('allocated_cost',allocated,'realized',profit,'remaining_quantity',qty));
 end loop;
 return jsonb_build_object('method','MOVING_AVERAGE_V1','positions',coalesce((select jsonb_agg(value order by key) from jsonb_each(positions)),'[]'), 'fills',fills);
end $$;
revoke all on function research_private.cockpit_account_v1(jsonb) from public,anon,authenticated,service_role;

create function public.owner_cockpit_read_v1(p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; audit jsonb; result jsonb;
begin
 perform research_private.lab_require_owner(p_owner);
 if (select count(*) from research_private.owner_cockpit_ledger where owner_id=p_owner)>10000 then raise exception 'JOURNAL_LIMIT';end if;
 select coalesce(jsonb_agg(to_jsonb(t) - 'owner_id' - 'request' order by t.occurred_at,t.sequence),'[]') into rows
 from research_private.owner_cockpit_ledger t where owner_id=p_owner and action<>'VOID'
 and not exists(select 1 from research_private.owner_cockpit_ledger x where x.replaces=t.id);
 select coalesce(jsonb_agg((to_jsonb(t)-'owner_id'-'request')||jsonb_build_object('superseded',exists(select 1 from research_private.owner_cockpit_ledger x where x.replaces=t.id)) order by t.sequence desc),'[]') into audit
 from research_private.owner_cockpit_ledger t where owner_id=p_owner;
 result:=research_private.cockpit_account_v1(rows);
 return result||jsonb_build_object('version','OWNER_COCKPIT_LEDGER_V1','audit',audit,'as_of',clock_timestamp(),
  'legacy_policy','READ_ONLY_SEPARATE_UNKNOWN_FEES','broker_verified',false);
end $$;
revoke all on function public.owner_cockpit_read_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_cockpit_read_v1(uuid) to service_role;

create function public.owner_cockpit_record_v1(p_owner uuid,p_request uuid,p_fill jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous research_private.owner_cockpit_ledger; target research_private.owner_cockpit_ledger;
 inserted research_private.owner_cockpit_ledger; result jsonb; ref uuid; a text; b text; sym text; at_time timestamptz;
begin
 perform research_private.lab_require_owner(p_owner);
 if p_request is null or jsonb_typeof(p_fill) is distinct from 'object' then raise exception 'INPUT_INVALID';end if;
 if exists(select 1 from jsonb_object_keys(p_fill) k where k not in ('book','symbol','action','quantity','price','fee','tax','other_cost','occurred_at','replaces','reason')) then raise exception 'UNEXPECTED_FIELD';end if;
 -- One owner journal lock also serializes cross-symbol request IDs and corrections.
 perform pg_advisory_xact_lock(hashtextextended('OWNER_COCKPIT_V1:'||p_owner::text,0));
 select * into previous from research_private.owner_cockpit_ledger where owner_id=p_owner and request_id=p_request;
 if found then
  if previous.request is distinct from p_fill then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('status','ALREADY_RECORDED','id',previous.id);
 end if;
 a:=p_fill->>'action';b:=p_fill->>'book';sym:=p_fill->>'symbol';
 at_time:=(p_fill->>'occurred_at')::timestamptz;ref:=nullif(p_fill->>'replaces','')::uuid;
 if at_time is null or at_time>clock_timestamp() then raise exception 'FUTURE_OR_MISSING_TIME';end if;
 if ref is not null then
  select * into target from research_private.owner_cockpit_ledger where id=ref and owner_id=p_owner;
  if not found or target.action='VOID' or exists(select 1 from research_private.owner_cockpit_ledger where replaces=ref)
   or target.book is distinct from b or target.symbol is distinct from sym or length(trim(coalesce(p_fill->>'reason','')))=0 then raise exception 'CORRECTION_INVALID';end if;
 end if;
 if a='VOID' and ref is null then raise exception 'CORRECTION_INVALID';end if;
 if exists(select 1 from jsonb_each_text(p_fill) e where key in ('price','quantity','fee','tax','other_cost') and value is not null and value !~ '^[0-9]+(\.[0-9]{1,8})?$') then raise exception 'DECIMAL_INVALID';end if;
 insert into research_private.owner_cockpit_ledger(owner_id,request_id,book,symbol,action,quantity,price,fee,tax,other_cost,occurred_at,replaces,reason,request)
 values(p_owner,p_request,b,sym,a,(p_fill->>'quantity')::numeric,(p_fill->>'price')::numeric,(p_fill->>'fee')::numeric,(p_fill->>'tax')::numeric,
 (p_fill->>'other_cost')::numeric,at_time,ref,coalesce(p_fill->>'reason',''),p_fill) returning * into inserted;
 -- Re-check all effective chronological entries, including backdated corrections.
 -- Any oversell exception rolls back BOTH correction and replacement atomically.
 result:=public.owner_cockpit_read_v1(p_owner);
 return jsonb_build_object('status','RECORDED','id',inserted.id,'method','MOVING_AVERAGE_V1');
end $$;
revoke all on function public.owner_cockpit_record_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.owner_cockpit_record_v1(uuid,uuid,jsonb) to service_role;
commit;
