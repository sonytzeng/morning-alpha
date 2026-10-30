begin;
-- Completed-session research is an immutable Owner document. It is never a
-- vnext_runtime prediction, public observation, publication review or outcome.
create table vnext_runtime.completed_research_snapshots (
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 data_through date not null,
 evaluated_at timestamptz not null,
 stored_at timestamptz not null default clock_timestamp(),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 payload_text text not null check(octet_length(payload_text) between 2 and 1000000),
 check(encode(sha256(convert_to(payload_text,'UTF8')),'hex')=id),
 check(evaluated_at >= (data_through::text||'T13:30:00+08:00')::timestamptz),
 check(evaluated_at <= stored_at)
);
alter table vnext_runtime.completed_research_snapshots enable row level security;
alter table vnext_runtime.completed_research_snapshots force row level security;
revoke all on vnext_runtime.completed_research_snapshots from public,anon,authenticated,service_role;
create index completed_research_latest on vnext_runtime.completed_research_snapshots(data_through desc,evaluated_at desc,id);
create trigger completed_research_immutable before update or delete on vnext_runtime.completed_research_snapshots
 for each row execute function vnext_runtime.immutable();

create function public.store_completed_research_v1(p_text text,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb;r jsonb;f jsonb;q jsonb;data_date date;analysis_time timestamptz;inserted integer;
begin
 if p_text is null or octet_length(p_text) not between 2 and 1000000 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
  or encode(sha256(convert_to(p_text,'UTF8')),'hex')<>p_hash then raise exception 'COMPLETED_HASH';end if;
 v:=p_text::jsonb;
 if jsonb_typeof(v) is distinct from 'object' or v->>'schema' is distinct from 'VNEXT_COMPLETED_RESEARCH_V1'
  or v->>'mode' is distinct from 'AS_OF_RESEARCH' or v->'owner_only' is distinct from 'true'::jsonb
  or v->'member_published' is distinct from 'false'::jsonb or v->'forward_sample' is distinct from '0'::jsonb
  or v->'outcome_sample' is distinct from '0'::jsonb or coalesce(v->>'source_hash','') !~ '^[a-f0-9]{64}$'
  or coalesce(v->>'data_through','') !~ '^\d{4}-\d\d-\d\d$'
  or jsonb_typeof(v->'rows') is distinct from 'array' or jsonb_typeof(v->'focus') is distinct from 'array'
 then raise exception 'COMPLETED_SCOPE';end if;
 data_date:=(v->>'data_through')::date;analysis_time:=(v->>'evaluated_at')::timestamptz;
 if analysis_time is null or analysis_time>clock_timestamp() or analysis_time<(data_date::text||'T13:30:00+08:00')::timestamptz
  or public.market_calendar_session_v1('TW',data_date) is distinct from true then raise exception 'COMPLETED_TIME';end if;
 if jsonb_array_length(v->'rows')<>216 or jsonb_array_length(v->'focus')>72
  or (select count(distinct x->>'symbol') from jsonb_array_elements(v->'rows')x)<>72
  or (select count(distinct (x->>'symbol')||':'||(x->>'horizon')) from jsonb_array_elements(v->'rows')x)<>216
 then raise exception 'COMPLETED_UNIVERSE';end if;
 for r in select * from jsonb_array_elements(v->'rows') loop
  if coalesce(r->>'symbol','') !~ '^\d{4,6}$' or coalesce(r->>'horizon','') not in('SHORT','MEDIUM','LONG')
   or coalesce(r->>'state','') not in('QUALIFIED','REJECTED','INSUFFICIENT')
   or jsonb_typeof(r->'close') is distinct from 'number' or (r->>'close')::numeric<=0
   or exists(select from unnest(array['company','reason','confirmation','invalidation','risk'])k where jsonb_typeof(r->k) is distinct from 'string' or length(btrim(r->>k)) not between 1 and 3000)
   or jsonb_typeof(r->'gaps') is distinct from 'array' or jsonb_typeof(r->'sources') is distinct from 'array'
  then raise exception 'COMPLETED_ROW';end if;
  if jsonb_array_length(r->'sources') not between 1 and 100 then raise exception 'COMPLETED_SOURCE';end if;
 end loop;
 if exists(select from jsonb_array_elements(v->'rows')x group by x->>'symbol' having count(distinct (x->>'company')||':'||(x->>'close'))<>1)
 then raise exception 'COMPLETED_COMPANY';end if;
 if (select count(distinct x->>'symbol') from jsonb_array_elements(v->'focus')x)<>jsonb_array_length(v->'focus') then raise exception 'COMPLETED_FOCUS';end if;
 for f in select * from jsonb_array_elements(v->'focus') loop
  if not exists(select from jsonb_array_elements(v->'rows')row_value where row_value->>'symbol'=f->>'symbol')
   or jsonb_typeof(f->'horizons') is distinct from 'array' or jsonb_typeof(f->'sources') is distinct from 'array'
   or exists(select from unnest(array['decision','reason','confirmation','invalidation','risk'])k where jsonb_typeof(f->k) is distinct from 'string' or length(btrim(f->>k)) not between 1 and 3000)
  then raise exception 'COMPLETED_FOCUS';end if;
  if f->'plan' is distinct from 'null'::jsonb then
   q:=f->'plan';
   if jsonb_typeof(q) is distinct from 'object' or q->>'status' is distinct from 'WAIT_CONFIRMATION'
    or jsonb_typeof(q->'range') is distinct from 'array' or jsonb_typeof(q->'pending') is distinct from 'array'
   then raise exception 'COMPLETED_PLAN';end if;
   if jsonb_array_length(q->'range')<>2 or jsonb_array_length(q->'pending')<1
    or ((q->'range'->>0)::numeric>0 and (q->>'stop')::numeric>0 and (q->>'stop')::numeric<(q->'range'->>0)::numeric
     and (q->'range'->>0)::numeric<=(q->'range'->>1)::numeric and (q->>'no_chase')::numeric>(q->'range'->>1)::numeric
     and (q->>'scenario')::numeric>(q->'range'->>1)::numeric and (q->>'reward_risk')::numeric>=2
     and (q->>'valid_from')::timestamptz>analysis_time and (q->>'valid_until')::timestamptz>(q->>'valid_from')::timestamptz) is distinct from true
   then raise exception 'COMPLETED_PLAN';end if;
  end if;
 end loop;
 insert into vnext_runtime.completed_research_snapshots(id,data_through,evaluated_at,source_hash,payload_text)
 values(p_hash,data_date,analysis_time,v->>'source_hash',p_text) on conflict(id) do nothing;
 get diagnostics inserted=row_count;
 return jsonb_build_object('status',case when inserted=1 then 'STORED' else 'ALREADY_STORED' end,'snapshot_hash',p_hash,'member_published',false);
end $$;
revoke all on function public.store_completed_research_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.store_completed_research_v1(text,text) to service_role;

create function public.get_owner_completed_research_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare latest vnext_runtime.completed_research_snapshots;
begin
 if public.is_research_owner_v1() is distinct from true or academy_private.access_v11() is distinct from 'owner'
 then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 select * into latest from vnext_runtime.completed_research_snapshots order by data_through desc,evaluated_at desc,id limit 1;
 return jsonb_build_object('schema','VNEXT_COMPLETED_OWNER_V1','owner_only',true,'snapshot_hash',latest.id,'snapshot_text',latest.payload_text);
end $$;
revoke all on function public.get_owner_completed_research_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_owner_completed_research_v1() to authenticated;
commit;
