-- Independent AS_OF intake. Does not change Forward admission, Cron or secrets.
begin;
create table vnext_runtime.ai_stock_handoffs(
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 source_run_id uuid not null references vnext_runtime.runs(id),
 source_revision text not null check(source_revision ~ '^[a-f0-9]{64}$'),
 business_date date not null,source_business_date date not null,source_cutoff text not null,
 cutoff timestamptz not null unique,cutoff_text text not null,
 inputs jsonb not null check(jsonb_typeof(inputs)='array' and jsonb_array_length(inputs)=72),
 source_issues jsonb not null default '[]' check(jsonb_typeof(source_issues)='array'),
 news jsonb not null check(jsonb_typeof(news)='array' and jsonb_array_length(news)<=868),
 created_at timestamptz not null default clock_timestamp(),
 unique(source_run_id,source_revision),check(cutoff<=created_at),
 check((cutoff_text)::timestamptz=cutoff),check(source_cutoff::timestamptz<=cutoff),check(octet_length(inputs::text)<=30000000)
);
create table vnext_runtime.ai_stock_handoff_delivery(
 handoff_id text primary key references vnext_runtime.ai_stock_handoffs(id),
 attempts integer not null default 0 check(attempts between 0 and 3),
 request_id bigint,last_code text not null default 'DISPATCH_PENDING'
  check(last_code in('DISPATCH_PENDING','DISPATCHED','CREDENTIAL_UNAVAILABLE','ENQUEUE_FAILED')),
 updated_at timestamptz not null default clock_timestamp()
);
alter table vnext_runtime.ai_stock_handoffs enable row level security;
alter table vnext_runtime.ai_stock_handoffs force row level security;
alter table vnext_runtime.ai_stock_handoff_delivery enable row level security;
alter table vnext_runtime.ai_stock_handoff_delivery force row level security;
revoke all on vnext_runtime.ai_stock_handoffs,vnext_runtime.ai_stock_handoff_delivery from public,anon,authenticated,service_role;
create trigger ai_stock_handoffs_immutable before update or delete on vnext_runtime.ai_stock_handoffs
 for each row execute function vnext_runtime.immutable();

-- The immutable handoff retains all original inputs. This declared read
-- projection bounds Edge memory while preserving every selected trace byte.
create function vnext_runtime.project_daily_stock_ai_inputs_v1(p_inputs jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare projected jsonb;
begin
 if jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72 then raise exception 'AI_HANDOFF_PROJECTION_SCOPE';end if;
 select jsonb_agg(i.value||jsonb_build_object('expected_sessions',sessions.dates,'bars',bars.rows,'facts',facts.rows) order by i.ordinality)
 into projected from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality)
 cross join lateral(select coalesce(jsonb_agg(s.value order by s.ordinality),'[]'::jsonb) dates
  from jsonb_array_elements(i.value->'expected_sessions') with ordinality s(value,ordinality)
  where s.ordinality>greatest(jsonb_array_length(i.value->'expected_sessions')-25,0)) sessions
 cross join lateral(select coalesce(jsonb_agg(b.value order by b.ordinality),'[]'::jsonb) rows
  from jsonb_array_elements(i.value->'bars') with ordinality b(value,ordinality)
  where sessions.dates @> jsonb_build_array(b.value->>'date')) bars
 cross join lateral(select coalesce(jsonb_agg(f.value order by f.kind_rank,f.kind,f.period,f.id),'[]'::jsonb) rows from(
  select value,value->>'kind' kind,coalesce(value->>'period','') period,value->>'id' id,
   case value->>'kind' when 'REVENUE' then 0 when 'INSTITUTIONAL' then 1 when 'EPS' then 2 when 'MARGIN' then 3
    when 'CAPEX' then 4 when 'DEMAND' then 5 when 'MOAT' then 6 when 'VALUATION' then 7 else 8 end kind_rank,
   row_number() over(partition by value->>'kind' order by coalesce(value->>'period','') desc,value->>'id' desc) rn
  from jsonb_array_elements(i.value->'facts')) f
  where f.rn<=case f.kind when 'REVENUE' then 36 when 'INSTITUTIONAL' then 10 when 'EPS' then 4 when 'MARGIN' then 4
   when 'CAPEX' then 4 when 'DEMAND' then 1 when 'MOAT' then 1 when 'VALUATION' then 1 else 2 end) facts;
 if octet_length(projected::text)>8000000 then raise exception 'AI_HANDOFF_PROJECTION_SIZE';end if;
 return projected;
end $$;
revoke all on function vnext_runtime.project_daily_stock_ai_inputs_v1(jsonb) from public,anon,authenticated,service_role;

-- Snapshot helper is private and reusable by independent AS_OF intake.
create function vnext_runtime.freeze_daily_stock_ai_news_v1(p_inputs jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare at_snapshot timestamptz;cutoff_text text;frozen_news jsonb;news jsonb;
begin
 if jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72 then raise exception 'AI_HANDOFF_NEWS_SCOPE';end if;
 if (select count(distinct i->>'symbol') from jsonb_array_elements(p_inputs)i where i->>'symbol' ~ '^\d{4,6}$')<>72
  or exists(select from jsonb_array_elements(p_inputs)i where length(btrim(coalesce(i->>'company',''))) not between 1 and 100)
  then raise exception 'AI_HANDOFF_NEWS_SCOPE';end if;
 -- Snapshot actual source headline/provider excerpts. Cached freshness labels,
 -- derived beneficiary tags and template impact summaries are not evidence.
 at_snapshot:=clock_timestamp();
 with eligible as materialized(
  select n.id,n.title,n.summary,n.source_name,n.provider,n.source_url,n.published_at,n.created_at,n.fingerprint
  from public.news_events n
  where n.published_at<=at_snapshot and n.published_at>=at_snapshot-interval '48 hours'
   and n.created_at<=at_snapshot and isfinite(n.published_at) and isfinite(n.created_at)
   and length(btrim(n.title)) between 1 and 1000 and length(coalesce(n.summary,''))<=6000
   and length(btrim(n.source_name)) between 1 and 300 and length(btrim(n.provider)) between 1 and 100
   and n.fingerprint ~ '^[a-f0-9]{64}$' and length(n.source_url)<=2048
   and n.source_url ~ '^https://[^/?#@[:space:]]+([/?]|$)' and n.source_url !~ '[#[:space:]]'
   and n.source_url !~* '[?&][^=]*(token|secret|key|auth|email)[^=]*='
  order by n.published_at desc,n.id limit 500
 ),matched as materialized(
  select n.*,i->>'symbol' symbol,row_number() over(partition by i->>'symbol' order by n.published_at desc,n.id) rn
  from eligible n cross join jsonb_array_elements(p_inputs) i
  where (n.title||' '||coalesce(n.summary,'')) ~ ('(^|[^0-9])'||(i->>'symbol')||'([^0-9]|$)')
   or length(btrim(i->>'company'))>1 and position(lower(i->>'company') in lower(n.title||' '||coalesce(n.summary,'')))>0
 ),selected as(
  select * from matched where rn<=12
 ),global_news as(
  select n.*,null::text symbol,0::bigint rn from eligible n
  where not exists(select from matched m where m.id=n.id)
  order by n.published_at desc,n.id limit 4
 ),scoped as(select * from selected union all select * from global_news),content as(
  select s.*,jsonb_build_object('coverage','HEADLINE_AND_PROVIDER_EXCERPT','title',title,
   'provider_excerpt',coalesce(summary,''),'source_name',source_name,'provider',provider,
   'first_ingested_at',created_at,'original_fingerprint',fingerprint)::text body from scoped s
 )
 select coalesce(jsonb_agg(jsonb_build_object('id','NEWS:'||id::text||':'||coalesce(symbol,'GLOBAL'),
  'symbol',symbol,'kind','NEWS','source',source_url,'published_at',published_at,
  'time_basis','PUBLISHED','content',body,'evidence_hash',encode(sha256(convert_to(body,'UTF8')),'hex'))
  order by published_at desc,id,symbol),'[]'::jsonb) into frozen_news from content where length(body)<=12000;
 -- Sample availability AFTER reading current mutable source bytes. This is a
 -- new AS_OF receipt, not a claim they existed at the earlier source cutoff.
 at_snapshot:=clock_timestamp();
 cutoff_text:=to_char(at_snapshot at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 with receipted as(select value||jsonb_build_object('available_at',cutoff_text,'first_seen_at',cutoff_text,'as_of',cutoff_text) value
  from jsonb_array_elements(frozen_news) where (value->>'published_at')::timestamptz>=at_snapshot-interval '48 hours'),bounded as(
  select value,sum(octet_length(value::text)+2) over(order by (value->>'published_at')::timestamptz desc,value->>'id') bytes from receipted)
 select coalesce(jsonb_agg(value order by (value->>'published_at')::timestamptz desc,value->>'id'),'[]'::jsonb)
  into news from bounded where bytes<=1500000;
 return jsonb_build_object('cutoff',cutoff_text,'news',news);
end $$;
revoke all on function vnext_runtime.freeze_daily_stock_ai_news_v1(jsonb) from public,anon,authenticated,service_role;

create function public.load_daily_stock_ai_handoff_v1(p_cutoff timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h vnext_runtime.ai_stock_handoffs;
begin
 if p_cutoff is null or not isfinite(p_cutoff) or p_cutoff>clock_timestamp() then raise exception 'AI_HANDOFF_SCOPE';end if;
 select * into h from vnext_runtime.ai_stock_handoffs where cutoff=p_cutoff;
 if not found then return null;end if;
 return jsonb_build_object('schema','DAILY_AI_SOURCE_HANDOFF_V1','handoff_id',h.id,
  'source_run_id',h.source_run_id,'source_revision',h.source_revision,'business_date',h.business_date,
  'source_business_date',h.source_business_date,'source_cutoff',h.source_cutoff,
  'cutoff',h.cutoff_text,'projection','DAILY_AI_RETAINED_INPUT_PROJECTION_V1',
  'inputs',vnext_runtime.project_daily_stock_ai_inputs_v1(h.inputs),'source_issues',h.source_issues,
  -- News bytes are frozen at this NEW receipt; their original publication
  -- times and the earlier acquired-data cutoff are never relabelled.
  'news',h.news,'market','[]'::jsonb,'intake_gaps',jsonb_build_array(
   'RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED',
   'NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE','NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS','NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES','NEWS_COMPANY_ASSOCIATION_REQUIRES_VERIFICATION',
   'MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE')||case when jsonb_array_length(h.news)=0 then
    jsonb_build_array('NEWS_NONE_AVAILABLE_WITHIN_48H') else '[]'::jsonb end,
  'member_published',false);
end $$;
revoke all on function public.load_daily_stock_ai_handoff_v1(timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_handoff_v1(timestamptz) to service_role;

-- Retrying an unknown HTTP outcome can only reread this immutable handoff.
-- Per-stock atomic leases own model idempotency; intake dispatch is bounded too.
create function public.dispatch_daily_stock_ai_handoff_v1(p_cutoff timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h vnext_runtime.ai_stock_handoffs;d vnext_runtime.ai_stock_handoff_delivery;token text;request bigint;
begin
 if p_cutoff is null or not isfinite(p_cutoff) or p_cutoff>clock_timestamp() then raise exception 'AI_HANDOFF_SCOPE';end if;
 select * into h from vnext_runtime.ai_stock_handoffs where cutoff=p_cutoff;
 if not found then raise exception 'AI_HANDOFF_MISSING';end if;
 insert into vnext_runtime.ai_stock_handoff_delivery(handoff_id) values(h.id) on conflict do nothing;
 select * into strict d from vnext_runtime.ai_stock_handoff_delivery where handoff_id=h.id for update;
 if d.attempts>=3 then return jsonb_build_object('state','HANDOFF_DISPATCH_BUDGET_EXHAUSTED','handoff_id',h.id);end if;
 select decrypted_secret into token from vault.decrypted_secrets
  where name='morning_alpha_daily_delivery_token' order by created_at desc limit 1;
 if token is null or length(token)<24 or length(token)>512 then
  update vnext_runtime.ai_stock_handoff_delivery set last_code='CREDENTIAL_UNAVAILABLE',updated_at=clock_timestamp() where handoff_id=h.id;
  return jsonb_build_object('state','HANDOFF_CREDENTIAL_UNAVAILABLE','handoff_id',h.id);
 end if;
 update vnext_runtime.ai_stock_handoff_delivery set attempts=attempts+1,updated_at=clock_timestamp() where handoff_id=h.id;
 begin
  select net.http_post(url:='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1',
   headers:=jsonb_build_object('Content-Type','application/json','x-daily-delivery-token',token),
   body:=jsonb_build_object('cutoff',h.cutoff_text),timeout_milliseconds:=60000) into request;
  if request is null then raise exception 'AI_HANDOFF_ENQUEUE_UNCONFIRMED';end if;
  update vnext_runtime.ai_stock_handoff_delivery set request_id=request,last_code='DISPATCHED',updated_at=clock_timestamp() where handoff_id=h.id;
 exception when others then
  update vnext_runtime.ai_stock_handoff_delivery set last_code='ENQUEUE_FAILED',updated_at=clock_timestamp() where handoff_id=h.id;
  return jsonb_build_object('state','HANDOFF_ENQUEUE_FAILED','handoff_id',h.id);
 end;
 return jsonb_build_object('state','HANDOFF_DISPATCHED','handoff_id',h.id,'request_id',request,'member_published',false);
end $$;
revoke all on function public.dispatch_daily_stock_ai_handoff_v1(timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_daily_stock_ai_handoff_v1(timestamptz) to service_role;

create function vnext_runtime.handoff_daily_stock_ai_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare a jsonb;at_cutoff timestamptz;at_snapshot timestamptz;cutoff_text text;handoff text;inserted integer;snapshot jsonb;news jsonb;
begin
 -- Compact stage updates retain the same acquired bytes and do not dispatch.
 if old.checkpoint->'acquired' is not distinct from new.checkpoint->'acquired'
  and old.source_revision is not distinct from new.source_revision then return new;end if;
 a:=new.checkpoint->'acquired';
 if jsonb_typeof(a) is distinct from 'object' or new.source_revision is null
  or new.source_revision !~ '^[a-f0-9]{64}$' or a->>'snapshot_hash' is distinct from new.source_revision
  or jsonb_typeof(a->'inputs') is distinct from 'array' or jsonb_array_length(a->'inputs')<>72
  or (select count(distinct x->>'symbol') from jsonb_array_elements(a->'inputs')x where x->>'symbol' ~ '^\d{4,6}$')<>72
  or a->>'evidence_cutoff' is null then return new;end if;
 at_cutoff:=(a->>'evidence_cutoff')::timestamptz;
 if not isfinite(at_cutoff) or at_cutoff>clock_timestamp()
  or (at_cutoff at time zone 'Asia/Taipei')::date<>new.business_date
  or exists(select from jsonb_array_elements(a->'inputs')x where x->>'cutoff' is distinct from a->>'evidence_cutoff')
  then return new;end if;
 handoff:=encode(sha256(convert_to(new.id::text||':'||new.source_revision,'UTF8')),'hex');
 if exists(select from vnext_runtime.ai_stock_handoffs where id=handoff) then return new;end if;
 snapshot:=vnext_runtime.freeze_daily_stock_ai_news_v1(a->'inputs');
 cutoff_text:=snapshot->>'cutoff';at_snapshot:=cutoff_text::timestamptz;news:=snapshot->'news';
 insert into vnext_runtime.ai_stock_handoffs(id,source_run_id,source_revision,business_date,source_business_date,source_cutoff,cutoff,cutoff_text,inputs,source_issues,news)
 values(handoff,new.id,new.source_revision,(at_snapshot at time zone 'Asia/Taipei')::date,new.business_date,a->>'evidence_cutoff',
  at_snapshot,cutoff_text,a->'inputs',coalesce(a->'source_issues','[]'::jsonb),news)
 on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=1 then
  -- Any independent dispatch failure is contained; the handoff is still durable
  -- and the existing CHECKPOINT/Forward transaction remains authoritative.
  begin perform public.dispatch_daily_stock_ai_handoff_v1(at_snapshot);
  exception when others then null;end;
 end if;
 return new;
exception when others then
 -- Intake must never roll back or relabel an existing acquired checkpoint.
 return new;
end $$;
revoke all on function vnext_runtime.handoff_daily_stock_ai_v1() from public,anon,authenticated,service_role;
create trigger ai_stock_acquired_handoff after update of checkpoint,source_revision on vnext_runtime.runs
 for each row execute function vnext_runtime.handoff_daily_stock_ai_v1();
commit;
