-- Additive, separately reviewed price-plan sidecar. Existing AI results,
-- edition payloads, member Reader and entitlement logic are unchanged.
-- A plan importer commits to the exact canonical body text used by snapshotHash;
-- PostgreSQL jsonb::text is never presented as the JavaScript plan hash.
-- This migration creates no plan, review, approval, license or model request.
begin;
create table vnext_private.ai_price_plans_v1(
 registration_id bigint generated always as identity unique,
 plan_hash text primary key check(plan_hash ~ '^[a-f0-9]{64}$'),
 edition_id text not null references vnext_private.ai_research_editions(id),
 symbol text not null check(symbol ~ '^[0-9]{4,6}$'),
 horizon text not null check(horizon in('SHORT','MEDIUM','LONG')),
 body_text text not null check(octet_length(body_text) between 2 and 16000),
 body jsonb not null,
 as_of timestamptz not null,expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 check(encode(sha256(convert_to(body_text,'UTF8')),'hex')=plan_hash),
 check(body=body_text::jsonb),
 check(isfinite(as_of) and isfinite(expires_at) and isfinite(created_at)
  and as_of<=created_at and expires_at>created_at)
);
create table vnext_private.ai_price_plan_reviews_v1(
 review_sequence bigint generated always as identity unique,
 id uuid primary key default gen_random_uuid(),
 plan_hash text not null references vnext_private.ai_price_plans_v1(plan_hash),
 reviewer_ref text not null check(length(btrim(reviewer_ref)) between 1 and 200),
 quality text not null check(quality in('PASS','FAIL','PENDING')),
 time_status text not null check(time_status in('PASS','FAIL','PENDING')),
 source_use text not null check(source_use in('PASS','FAIL','PENDING')),
 methodology text not null check(methodology in('PASS','FAIL','PENDING')),
 document_hash text not null check(document_hash ~ '^[a-f0-9]{64}$'),
 source_document_hash text not null check(source_document_hash ~ '^[a-f0-9]{64}$'),
 method_document_hash text not null check(method_document_hash ~ '^[a-f0-9]{64}$'),
 time_document_hash text not null check(time_document_hash ~ '^[a-f0-9]{64}$'),
 reason text not null check(length(btrim(reason)) between 30 and 3000),
 reviewed_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 check(isfinite(reviewed_at) and isfinite(recorded_at) and isfinite(expires_at)
  and reviewed_at<=recorded_at and expires_at>recorded_at)
);
create table vnext_private.ai_price_plan_publication_events_v1(
 id bigint generated always as identity primary key,request_key uuid not null unique,
 plan_hash text not null references vnext_private.ai_price_plans_v1(plan_hash),
 review_id uuid not null references vnext_private.ai_price_plan_reviews_v1(id),
 actor uuid not null references auth.users(id),
 action text not null check(action in('APPROVE','REVOKE')),
 occurred_at timestamptz not null default clock_timestamp()
);
create index ai_price_plan_edition_card_v1 on vnext_private.ai_price_plans_v1(edition_id,symbol,horizon,registration_id desc);
create index ai_price_plan_latest_review_v1 on vnext_private.ai_price_plan_reviews_v1(plan_hash,review_sequence desc);
create index ai_price_plan_latest_publication_v1 on vnext_private.ai_price_plan_publication_events_v1(plan_hash,id desc);
do $$declare n text;begin
 foreach n in array array['ai_price_plans_v1','ai_price_plan_reviews_v1','ai_price_plan_publication_events_v1'] loop
  execute format('alter table vnext_private.%I enable row level security',n);
  execute format('alter table vnext_private.%I force row level security',n);
  execute format('revoke all on vnext_private.%I from public,anon,authenticated,service_role',n);
  execute format('create trigger immutable before update or delete on vnext_private.%I for each row execute function vnext_private.immutable_record()',n);
 end loop;
end $$;
revoke all on sequence vnext_private.ai_price_plans_v1_registration_id_seq,
 vnext_private.ai_price_plan_reviews_v1_review_sequence_seq,
 vnext_private.ai_price_plan_publication_events_v1_id_seq from public,anon,authenticated,service_role;
grant usage on schema vnext_private to service_role;
grant select on vnext_private.ai_price_plan_reviews_v1 to service_role;
-- A trusted review importer can set only business fields, never the sequence
-- used to establish the latest review (even with OVERRIDING SYSTEM VALUE).
grant insert(id,plan_hash,reviewer_ref,quality,time_status,source_use,methodology,
 document_hash,source_document_hash,method_document_hash,time_document_hash,reason,reviewed_at,expires_at)
 on vnext_private.ai_price_plan_reviews_v1 to service_role;

-- The importer must use the exact JS canonical body text, not a body including
-- plan_hash/review. A browser cannot register a plan or mark its review PASS.
create function public.stage_daily_ai_price_plan_v1(p_body_text text,p_plan_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;e vnext_private.ai_research_editions;c jsonb;packet jsonb;ref jsonb;
 range_low numeric;range_high numeric;wait_above numeric;stop_price numeric;
 asof_time timestamptz;expiry timestamptz;at_time timestamptz:=clock_timestamp();
 expected_keys text[]:=array['schema','edition_id','symbol','horizon','status','currency','method','basis',
  'entry_range','wait_above','stop_kind','stop','stop_evidence_ids','invalidation','evidence_ids','as_of','expires_at','buy_ready'];
begin
 if p_body_text is null or octet_length(p_body_text) not between 2 and 16000
  or p_plan_hash is null or p_plan_hash !~ '^[a-f0-9]{64}$'
  or encode(sha256(convert_to(p_body_text,'UTF8')),'hex') is distinct from p_plan_hash
  then raise exception 'AI_PRICE_PLAN_HASH';end if;
 v:=p_body_text::jsonb;
 if jsonb_typeof(v) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(v))<>cardinality(expected_keys)
  or not v ?& expected_keys
  or v->>'schema' is distinct from 'DAILY_AI_PRICE_PLAN_V1'
  or jsonb_typeof(v->'edition_id') is distinct from 'string' or jsonb_typeof(v->'symbol') is distinct from 'string'
  or coalesce(v->>'edition_id','') !~ '^[a-f0-9]{64}$'
  or coalesce(v->>'symbol','') !~ '^[0-9]{4,6}$'
  or coalesce(v->>'horizon','') not in('SHORT','MEDIUM','LONG')
  or v->>'status' is distinct from 'VERIFIED' or v->>'currency' is distinct from 'TWD'
  or v->'buy_ready' is distinct from 'false'::jsonb
  or jsonb_typeof(v->'method') is distinct from 'string' or length(btrim(v->>'method')) not between 1 and 200
  or jsonb_typeof(v->'basis') is distinct from 'string' or length(btrim(v->>'basis')) not between 1 and 1500
  or jsonb_typeof(v->'invalidation') is distinct from 'string' or length(btrim(v->>'invalidation')) not between 1 and 1500
  then raise exception 'AI_PRICE_PLAN_SCOPE';end if;
 select * into e from vnext_private.ai_research_editions where id=v->>'edition_id';
 if not found or e.created_at>at_time or e.expires_at<=at_time then raise exception 'AI_PRICE_PLAN_EDITION';end if;
 select card into c from jsonb_array_elements(e.payload->'cards')card
  where card->>'symbol'=v->>'symbol' and card->>'horizon'=v->>'horizon';
 if c is null or c->>'status' not in('WATCH','WAIT') then raise exception 'AI_PRICE_PLAN_CARD';end if;
 select pkt into strict packet from vnext_runtime.ai_stock_batches b,
  jsonb_array_elements(b.payload->'packets')pkt where b.id=e.batch_id and pkt->>'symbol'=v->>'symbol';
 if jsonb_typeof(v->'entry_range') is distinct from 'array' or jsonb_array_length(v->'entry_range')<>2
  or exists(select from jsonb_array_elements(v->'entry_range')x where jsonb_typeof(x)<>'number')
  or jsonb_typeof(v->'wait_above') is distinct from 'number'
  or coalesce(v->>'stop_kind','') not in('PRICE','EVENT') then raise exception 'AI_PRICE_PLAN_RANGE';end if;
 range_low:=(v->'entry_range'->>0)::numeric;range_high:=(v->'entry_range'->>1)::numeric;wait_above:=(v->>'wait_above')::numeric;
 if range_low<=0 or range_high<range_low or wait_above<range_high
  then raise exception 'AI_PRICE_PLAN_RANGE';end if;
 if jsonb_typeof(v->'evidence_ids') is distinct from 'array' or jsonb_array_length(v->'evidence_ids') not between 1 and 100
  or jsonb_typeof(v->'stop_evidence_ids') is distinct from 'array' or jsonb_array_length(v->'stop_evidence_ids') not between 1 and 100
  or exists(select from jsonb_array_elements(v->'evidence_ids'||v->'stop_evidence_ids')x
   where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 200)
  or (select count(distinct id) from jsonb_array_elements_text(v->'evidence_ids')x(id))<>jsonb_array_length(v->'evidence_ids')
  or (select count(distinct id) from jsonb_array_elements_text(v->'stop_evidence_ids')x(id))<>jsonb_array_length(v->'stop_evidence_ids')
  or exists(select from jsonb_array_elements_text(v->'stop_evidence_ids')x(id) where not v->'evidence_ids' ? x.id)
  or exists(select from jsonb_array_elements_text(v->'evidence_ids')x(id) where not exists(
   select from jsonb_array_elements(packet->'evidence')s where s->>'id'=x.id))
  or not exists(select from jsonb_array_elements(packet->'evidence')s where v->'evidence_ids' ? (s->>'id') and s->>'kind'='PRICE')
  then raise exception 'AI_PRICE_PLAN_EVIDENCE';end if;
 if v->>'stop_kind'='PRICE' then
  if jsonb_typeof(v->'stop') is distinct from 'number' then raise exception 'AI_PRICE_PLAN_STOP';end if;
  stop_price:=(v->>'stop')::numeric;
  if stop_price<=0 or stop_price>=range_low or not exists(select from jsonb_array_elements(packet->'evidence')s
   where v->'stop_evidence_ids' ? (s->>'id') and s->>'kind'='PRICE') then raise exception 'AI_PRICE_PLAN_STOP';end if;
 elsif v->'stop' is distinct from 'null'::jsonb or not exists(select from jsonb_array_elements(packet->'evidence')s
  where v->'stop_evidence_ids' ? (s->>'id') and s->>'kind'<>'PRICE') then raise exception 'AI_PRICE_PLAN_STOP';end if;
 if jsonb_typeof(v->'as_of') is distinct from 'string' or jsonb_typeof(v->'expires_at') is distinct from 'string'
  or v->>'as_of' !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
  or v->>'expires_at' !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
  then raise exception 'AI_PRICE_PLAN_TIME';end if;
 asof_time:=(v->>'as_of')::timestamptz;expiry:=(v->>'expires_at')::timestamptz;
 if not isfinite(asof_time) or not isfinite(expiry) or asof_time<e.cutoff or asof_time>at_time
  or expiry<=at_time or expiry<=asof_time or expiry>e.expires_at then raise exception 'AI_PRICE_PLAN_TIME';end if;
 for ref in select s from jsonb_array_elements(packet->'evidence')s where v->'evidence_ids' ? (s->>'id') loop
  if (ref->>'available_at')::timestamptz>e.cutoff or not e.payload->'source_urls' ? (ref->>'source')
   then raise exception 'AI_PRICE_PLAN_EVIDENCE';end if;
 end loop;
 insert into vnext_private.ai_price_plans_v1(plan_hash,edition_id,symbol,horizon,body_text,body,as_of,expires_at)
 values(p_plan_hash,e.id,v->>'symbol',v->>'horizon',p_body_text,v,asof_time,expiry) on conflict do nothing;
 return jsonb_build_object('schema','DAILY_AI_PRICE_PLAN_STAGED_V1','plan_hash',p_plan_hash,'review_required',true,'member_published',false);
end $$;
revoke all on function public.stage_daily_ai_price_plan_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_price_plan_v1(text,text) to service_role;

create function vnext_private.validate_ai_price_plan_review_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare p vnext_private.ai_price_plans_v1;e vnext_private.ai_research_editions;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai-member-price-plans',0));
 select * into strict p from vnext_private.ai_price_plans_v1 where plan_hash=new.plan_hash;
 select * into strict e from vnext_private.ai_research_editions where id=p.edition_id;
 new.recorded_at:=clock_timestamp();
 if new.reviewed_at<p.as_of or new.reviewed_at<e.created_at or new.reviewed_at>new.recorded_at
  or new.expires_at is distinct from p.expires_at or new.expires_at<=new.recorded_at
  or exists(select from vnext_runtime.ai_stock_jobs j where j.id=any(e.job_keys)
   and new.reviewer_ref in(j.model_revision,j.result->'receipt'->>'model'))
  then raise exception 'AI_PRICE_PLAN_REVIEW_INVALID';end if;
 -- Edition rights cover its complete original input source_urls, not only
 -- sources cited by a prose card. This sidecar also needs its own source-use
 -- review/document; the older research review is never a numeric-plan review.
 if new.source_use='PASS' and not vnext_private.ai_edition_rights_v1(e.id,new.recorded_at)
  then raise exception 'AI_PRICE_PLAN_RIGHTS';end if;
 return new;
end $$;
revoke all on function vnext_private.validate_ai_price_plan_review_v1() from public,anon,authenticated,service_role;
create trigger validate_review before insert on vnext_private.ai_price_plan_reviews_v1
 for each row execute function vnext_private.validate_ai_price_plan_review_v1();

-- An existing edition approval never grants permission for arbitrary future
-- numeric sidecars. The actual Owner separately binds this immutable plan/hash.
create function public.review_daily_ai_price_plan_v1(p_plan_hash text,p_review_id uuid,p_action text,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p vnext_private.ai_price_plans_v1;e vnext_private.ai_research_editions;
 r vnext_private.ai_price_plan_reviews_v1;prior vnext_private.ai_price_plan_publication_events_v1;event_id bigint;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' or not public.is_research_owner_v1()
  then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if p_plan_hash is null or p_plan_hash !~ '^[a-f0-9]{64}$' or p_review_id is null or p_request_key is null
  or p_action is null or p_action not in('APPROVE','REVOKE') then raise exception 'AI_PRICE_PLAN_REVIEW_SCOPE';end if;
 perform pg_advisory_xact_lock(hashtextextended('ai-member-price-plans',0));
 select * into prior from vnext_private.ai_price_plan_publication_events_v1 where request_key=p_request_key;
 if found then
  if prior.actor is distinct from auth.uid() or prior.plan_hash is distinct from p_plan_hash
   or prior.review_id is distinct from p_review_id or prior.action is distinct from p_action
   then raise exception 'AI_PRICE_PLAN_REPLAY_CONFLICT';end if;
  return jsonb_build_object('event_id',prior.id,'action',prior.action,'replayed',true);
 end if;
 select * into strict p from vnext_private.ai_price_plans_v1 where plan_hash=p_plan_hash;
 select * into strict e from vnext_private.ai_research_editions where id=p.edition_id;
 select * into strict r from vnext_private.ai_price_plan_reviews_v1 where plan_hash=p.plan_hash order by review_sequence desc limit 1;
 if r.id is distinct from p_review_id then raise exception 'AI_PRICE_PLAN_REVIEW_CHANGED';end if;
 if p_action='APPROVE' and (r.quality<>'PASS' or r.time_status<>'PASS' or r.source_use<>'PASS' or r.methodology<>'PASS'
  or r.expires_at<=clock_timestamp() or p.expires_at<=clock_timestamp() or e.expires_at<=clock_timestamp()
  or not vnext_private.ai_edition_rights_v1(e.id,clock_timestamp())) then raise exception 'AI_PRICE_PLAN_PREREQUISITES';end if;
 insert into vnext_private.ai_price_plan_publication_events_v1(request_key,plan_hash,review_id,actor,action)
 values(p_request_key,p.plan_hash,r.id,auth.uid(),p_action) returning id into event_id;
 return jsonb_build_object('event_id',event_id,'action',p_action,'replayed',false);
end $$;
revoke all on function public.review_daily_ai_price_plan_v1(text,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.review_daily_ai_price_plan_v1(text,uuid,text,uuid) to authenticated;

-- Minimal read-only addition to the existing Owner publication page. A preview
-- cannot approve a plan, manufacture a review or reveal packet/model content.
create function public.get_daily_ai_owner_price_plans_v1(p_edition_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e vnext_private.ai_research_editions;p vnext_private.ai_price_plans_v1;
 r vnext_private.ai_price_plan_reviews_v1;a vnext_private.ai_price_plan_publication_events_v1;
 plans jsonb:='[]';at_time timestamptz:=now();rights_ready boolean;can_approve boolean;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' or not public.is_research_owner_v1()
  then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if p_edition_id is null or p_edition_id !~ '^[a-f0-9]{64}$' then raise exception 'AI_PRICE_PLAN_SCOPE';end if;
 select * into e from vnext_private.ai_research_editions where id=p_edition_id;
 if not found then raise exception 'AI_PRICE_PLAN_EDITION';end if;
 rights_ready:=vnext_private.ai_edition_rights_v1(e.id,at_time);
 for p in select distinct on(symbol,horizon) q.* from vnext_private.ai_price_plans_v1 q
  where edition_id=e.id order by symbol,horizon,registration_id desc loop
  select * into r from vnext_private.ai_price_plan_reviews_v1 where plan_hash=p.plan_hash order by review_sequence desc limit 1;
  select * into a from vnext_private.ai_price_plan_publication_events_v1 where plan_hash=p.plan_hash order by id desc limit 1;
  can_approve:=coalesce(r.id is not null and r.quality='PASS' and r.time_status='PASS' and r.source_use='PASS' and r.methodology='PASS'
   and r.expires_at>at_time and p.expires_at>at_time and e.expires_at>at_time and rights_ready,false);
  plans:=plans||jsonb_build_array(jsonb_build_object('plan_hash',p.plan_hash,'body',p.body,
   'review',case when r.id is null then null else jsonb_build_object('id',r.id,'quality',r.quality,'time_status',r.time_status,
    'source_use',r.source_use,'methodology',r.methodology,'document_hash',r.document_hash,
    'reviewed_at',to_char(r.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expires_at',to_char(r.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end,
   'publication',case when a.id is null then null else jsonb_build_object('id',a.id,'review_id',a.review_id,'action',a.action,
    'occurred_at',to_char(a.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end,
   'can_approve',can_approve));
 end loop;
 return jsonb_build_object('schema','VNEXT_AI_OWNER_PRICE_PLANS_V1','edition_id',e.id,'subject_user_id',auth.uid(),
  'research_only',true,'preview_only',true,'plans',plans);
end $$;
revoke all on function public.get_daily_ai_owner_price_plans_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_owner_price_plans_v1(text) to authenticated;

create function public.get_daily_ai_member_price_plans_v1(p_edition_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare member jsonb;current_id text;tier text;plans jsonb:='[]';source_sets jsonb:='[]';card jsonb;batch_packets jsonb;
 p vnext_private.ai_price_plans_v1;r vnext_private.ai_price_plan_reviews_v1;
 a vnext_private.ai_price_plan_publication_events_v1;
begin
 -- This remains the single authority for the currently readable edition,
 -- latest rights/publication/review state and the real server entitlement.
 member:=public.get_daily_ai_member_research_v1();
 tier:=member->>'tier';current_id:=member->'edition'->>'id';
 if p_edition_id is null or p_edition_id !~ '^[a-f0-9]{64}$' then raise exception 'AI_PRICE_PLAN_SCOPE';end if;
 if current_id is distinct from p_edition_id then current_id:=null;
 elsif tier in('premium','owner') then
  for card in select * from jsonb_array_elements(member->'cards')c where c->>'status' in('WATCH','WAIT') loop
   -- The newest registered version suppresses old versions even while its
   -- review/Owner approval is pending. FAIL/REVOKE/expiry never revive prices.
   select q.* into p from vnext_private.ai_price_plans_v1 q
    where q.edition_id=current_id and q.symbol=card->>'symbol' and q.horizon=card->>'horizon'
    order by q.registration_id desc limit 1;
   if not found then continue;end if;
   select * into a from vnext_private.ai_price_plan_publication_events_v1
    where plan_hash=p.plan_hash order by id desc limit 1;
   if not found then continue;end if;
   select * into r from vnext_private.ai_price_plan_reviews_v1 where plan_hash=p.plan_hash order by review_sequence desc limit 1;
   if a.action='APPROVE' and a.review_id=r.id and r.quality='PASS' and r.time_status='PASS'
    and r.source_use='PASS' and r.methodology='PASS' and r.expires_at>now() and r.reviewed_at<=now()
    and r.recorded_at<=now() and p.expires_at>now() and p.created_at<=now() then
    plans:=plans||jsonb_build_array(p.body||jsonb_build_object('plan_hash',p.plan_hash,'review',jsonb_build_object(
     'status','PASS','plan_hash',p.plan_hash,'reviewed_at',to_char(r.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'document_hash',r.document_hash)));
   end if;
  end loop;
  -- Emit only metadata for the actual plan references, including legitimate
  -- original packet refs not used by the prose claim (e.g. twenty daily bars).
  -- Merge horizons by symbol/id; never return packet content, prompts or jobs.
  if jsonb_array_length(plans)>0 then
  select b.payload->'packets' into batch_packets from vnext_private.ai_research_editions e
   join vnext_runtime.ai_stock_batches b on b.id=e.batch_id where e.id=current_id;
  select coalesce(jsonb_agg(jsonb_build_object('symbol',sets.symbol,'sources',sets.sources) order by sets.symbol),'[]') into source_sets
   from(select refs.symbol,jsonb_agg(refs.source order by refs.source->>'id') sources from(
    select distinct pl->>'symbol' symbol,jsonb_build_object('id',ev->>'id','source',ev->>'source','kind',ev->>'kind',
     'published_at',ev->>'published_at','available_at',ev->>'available_at','time_basis',coalesce(ev->>'time_basis','PUBLISHED'),
     'first_seen_at',ev->>'first_seen_at','as_of',ev->>'as_of','evidence_hash',ev->>'evidence_hash') source
    from jsonb_array_elements(plans)pl join jsonb_array_elements(batch_packets)pkt on pkt->>'symbol'=pl->>'symbol',
     jsonb_array_elements(pkt->'evidence')ev where pl->'evidence_ids' ? (ev->>'id')
   )refs group by refs.symbol)sets;
  end if;
 end if;
 return jsonb_build_object('schema','VNEXT_AI_MEMBER_PRICE_PLANS_V1','edition_id',current_id,'tier',tier,
  'subject_user_id',auth.uid(),'research_only',true,'plans',plans,'source_sets',source_sets);
end $$;
revoke all on function public.get_daily_ai_member_price_plans_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_member_price_plans_v1(text) to authenticated;
commit;
