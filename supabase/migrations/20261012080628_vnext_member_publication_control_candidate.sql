-- CANDIDATE ONLY. Requires both earlier VNext candidates; never applies itself.
-- Independent server review -> explicit Owner approval -> published projection.
begin;
create table vnext_private.publication_reviews(
 id uuid primary key default gen_random_uuid(),
 observation_id text not null references vnext_private.stock_horizon_observations(id),
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 review_hash text not null unique check(review_hash ~ '^[a-f0-9]{64}$'),
 review_version text not null check(length(review_version)>0),
 reviewer_ref text not null check(length(reviewer_ref)>0),
 quality text not null check(quality in ('PASS','FAIL','PENDING')),
 time_status text not null check(time_status in ('PASS','FAIL','PENDING')),
 licensing text not null check(licensing in ('PASS','FAIL','PENDING')),
 quality_document_hash text not null check(quality_document_hash ~ '^[a-f0-9]{64}$'),
 time_document_hash text not null check(time_document_hash ~ '^[a-f0-9]{64}$'),
 license_document_hash text not null check(license_document_hash ~ '^[a-f0-9]{64}$'),
 evidence_set_hash text not null check(evidence_set_hash ~ '^[a-f0-9]{64}$'),
 free_allowed boolean not null default false, premium_allowed boolean not null default false,
 reason text not null check(length(reason)>0), primary_risk text not null check(length(primary_risk)>0),
 supporting_ids text[] not null, contradicting_ids text[] not null,
 event_ids text[] not null default '{}', relation_ids text[] not null default '{}',
 reviewed_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null, recorded_at timestamptz not null default clock_timestamp(),
 check(reviewed_at<=recorded_at and expires_at>reviewed_at)
);
create table vnext_private.owner_publication_events(
 id bigint generated always as identity primary key,
 request_key uuid not null unique,
 observation_id text not null references vnext_private.stock_horizon_observations(id),
 review_id uuid not null references vnext_private.publication_reviews(id),
 actor uuid not null references auth.users(id),
 action text not null check(action in ('APPROVE','REVOKE')),
 audience text not null check(audience in ('free','premium')),
 publication_id bigint not null unique references vnext_private.publication_audit(id),
 occurred_at timestamptz not null default clock_timestamp()
);
create index vnext_review_latest on vnext_private.publication_reviews(observation_id,recorded_at desc,id);
create index vnext_owner_publication_latest on vnext_private.owner_publication_events(observation_id,id desc);
do $$ declare n text; begin
 foreach n in array array['publication_reviews','owner_publication_events'] loop
  execute format('alter table vnext_private.%I enable row level security',n);
  execute format('alter table vnext_private.%I force row level security',n);
  execute format('revoke all on vnext_private.%I from public,anon,authenticated,service_role',n);
  execute format('create trigger immutable before update or delete on vnext_private.%I for each row execute function vnext_private.immutable_record()',n);
 end loop;
end $$;
-- Registry importer is a trusted server process, not the selector or browser.
-- No grants/approvals, synthetic records or historical cards are seeded here.
grant select,insert on vnext_private.publication_reviews to service_role;

create function vnext_private.publication_evidence_hash(p_id text) returns text
language sql stable security definer set search_path='' as $$
 select encode(sha256(convert_to(coalesce(string_agg(e.id||':'||e.snapshot_hash,',' order by e.id),''),'UTF8')),'hex')
 from vnext_private.observation_evidence x join vnext_private.event_sources e on e.id=x.evidence_id
 where x.observation_id=p_id;
$$;
revoke all on function vnext_private.publication_evidence_hash(text) from public,anon,authenticated,service_role;
create function vnext_private.validate_publication_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare o vnext_private.stock_horizon_observations;
begin
 perform pg_advisory_xact_lock(hashtextextended('vnext-member-publication',0));
 select * into strict o from vnext_private.stock_horizon_observations where id=new.observation_id;
 if new.recorded_at>clock_timestamp() or new.reviewed_at<o.created_at
  or new.reviewer_ref=o.strategy_version or new.snapshot_hash<>o.snapshot_hash
  or new.evidence_set_hash<>vnext_private.publication_evidence_hash(o.id)
  or cardinality(new.supporting_ids)=0 or cardinality(new.contradicting_ids)=0
  or new.supporting_ids && new.contradicting_ids
  or exists(select from unnest(new.supporting_ids||new.contradicting_ids) eid where not exists(
   select from vnext_private.observation_evidence x where x.observation_id=o.id and x.evidence_id=eid))
 then raise exception 'INDEPENDENT_REVIEW_INVALID'; end if;
 -- Server receipt time is authoritative; caller cannot backdate revision order.
 new.recorded_at:=clock_timestamp();
 return new;
end $$;
revoke all on function vnext_private.validate_publication_review() from public,anon,authenticated,service_role;
create trigger validate_review before insert on vnext_private.publication_reviews
 for each row execute function vnext_private.validate_publication_review();

-- Non-approval checks are identical to the existing conservative gate.
create function vnext_private.publication_preflight(p_id text,p_now timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select from vnext_private.stock_horizon_observations o
 where o.id=p_id and o.mode='FORWARD_SHADOW' and o.status in ('WATCHING','CONDITION_MET')
 and o.created_at<=p_now and o.next_review_at>p_now and o.expires_at>p_now
 and o.reason !~ '(保證|穩賺|必漲|必賺|高勝率|正式推薦|買進訊號)'
 and not exists(select from jsonb_array_elements(o.confirmation_conditions||o.invalidation_conditions) c
   where coalesce(c->>'text','')='' or c->>'text' ~ '(保證|穩賺|必漲|必賺|高勝率|正式推薦|買進訊號)'
   or coalesce(c->>'state','') not in ('CONFIRMED','NOT_MET','UNKNOWN')
   or jsonb_typeof(c->'evidence_ids') is distinct from 'array'
   or coalesce(jsonb_array_length(c->'evidence_ids'),0)=0
   or exists(select from jsonb_array_elements_text(c->'evidence_ids') cid where not exists(
     select from vnext_private.observation_evidence x where x.observation_id=o.id and x.evidence_id=cid)))
 and not exists(select from jsonb_array_elements(o.invalidation_conditions) c where c->>'state'='CONFIRMED')
 and (o.status<>'CONDITION_MET' or (not exists(select from jsonb_array_elements(o.confirmation_conditions) c where c->>'state'<>'CONFIRMED')
   and not exists(select from jsonb_array_elements(o.invalidation_conditions) c where c->>'state'<>'NOT_MET')))
 and exists(select from vnext_private.observation_evidence x where x.observation_id=o.id)
 and not exists(select from vnext_private.observation_evidence x join vnext_private.event_sources e on e.id=x.evidence_id
   join vnext_private.source_licenses l on l.id=e.license_id where x.observation_id=o.id and
   (e.symbol<>o.symbol or e.quality<>'PASS' or not e.relevant or e.available_at>o.created_at or e.last_verified_at>o.created_at
    or e.valid_until<=o.created_at or not l.storage_allowed or not l.derived_allowed or not l.commercial_allowed
    or not l.redistribution_allowed or l.reviewed_at>p_now or (l.expires_at is not null and l.expires_at<=p_now)))
 and not exists(select from unnest(case o.horizon
   when 'SHORT' then array['PRICE_VOLUME','INSTITUTIONAL','NEWS','TECHNICAL_STRUCTURE']
   when 'MEDIUM' then array['REVENUE','ORDERS','GUIDANCE','INSTITUTIONAL','INDUSTRY_EVENT']
   else array['DEMAND','MOAT','SUPPLY_CHAIN','EPS','MARGIN','CAPEX','VALUATION'] end) k
   where not exists(select from vnext_private.observation_evidence x join vnext_private.event_sources e on e.id=x.evidence_id
     where x.observation_id=o.id and e.kind=k and e.classification='CONFIRMED_FACT')));
$$;
revoke all on function vnext_private.publication_preflight(text,timestamptz) from public,anon,authenticated,service_role;

-- The old gate remains intact, including quality, source rights and chronology.
alter function vnext_private.member_allowed(text,boolean) rename to legacy_member_allowed;
create function vnext_private.member_allowed(p_id text,p_history boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select vnext_private.legacy_member_allowed(p_id,p_history) and exists(
  select from vnext_private.publication_reviews r
  join vnext_private.owner_publication_events a on a.review_id=r.id and a.observation_id=r.observation_id
  join vnext_private.member_copy c on c.publication_id=a.publication_id
  where r.observation_id=p_id and r.id=(select id from vnext_private.publication_reviews where observation_id=p_id order by recorded_at desc,id desc limit 1)
   and a.id=(select id from vnext_private.owner_publication_events where observation_id=p_id order by id desc limit 1)
   and a.action='APPROVE' and r.quality='PASS' and r.time_status='PASS' and r.licensing='PASS'
   and r.expires_at>now() and r.reviewed_at<=a.occurred_at
   and r.evidence_set_hash=vnext_private.publication_evidence_hash(p_id)
   and case a.audience when 'free' then r.free_allowed and r.premium_allowed else r.premium_allowed end);
$$;
revoke all on function vnext_private.member_allowed(text,boolean) from public,anon,authenticated,service_role;

create function public.review_vnext_publication_candidate_v1(p_observation_id text,p_review_id uuid,p_action text,p_audience text,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r vnext_private.publication_reviews; o vnext_private.stock_horizon_observations;
 old vnext_private.owner_publication_events; pid bigint; event_id bigint; next_slot integer;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
 if p_request_key is null or p_review_id is null or p_action is null or p_action not in('APPROVE','REVOKE')
  or p_audience is null or p_audience not in('free','premium') then raise exception 'REQUEST_INVALID'; end if;
 -- Serializes replay keys and the daily free edition; bounded tiny transaction.
 perform pg_advisory_xact_lock(hashtextextended('vnext-member-publication',0));
 select * into old from vnext_private.owner_publication_events where request_key=p_request_key;
 if found then
  if old.actor<>auth.uid() or old.observation_id<>p_observation_id or old.review_id<>p_review_id or old.action<>p_action or old.audience<>p_audience then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('event_id',old.id,'action',old.action,'replayed',true);
 end if;
 select * into strict o from vnext_private.stock_horizon_observations where id=p_observation_id;
 select * into strict r from vnext_private.publication_reviews where observation_id=o.id order by recorded_at desc,id desc limit 1;
 if r.id<>p_review_id then raise exception 'REVIEW_CHANGED'; end if;
 if p_action='APPROVE' and (r.quality<>'PASS' or r.time_status<>'PASS' or r.licensing<>'PASS'
  or r.expires_at<=now() or r.snapshot_hash<>o.snapshot_hash or r.evidence_set_hash<>vnext_private.publication_evidence_hash(o.id)
  or not r.premium_allowed or (p_audience='free' and not r.free_allowed)
  or not vnext_private.publication_preflight(o.id,now())) then raise exception 'PREREQUISITES_NOT_MET'; end if;
 insert into vnext_private.publication_audit(observation_id,snapshot_hash,audience,approved,content_kind,reviewer_ref,license_review_ref,gate_version)
 values(o.id,o.snapshot_hash,p_audience,p_action='APPROVE','RESEARCH_OBSERVATION',auth.uid()::text,r.license_document_hash,'VNEXT_PUBLICATION_1') returning id into pid;
 if p_action='APPROVE' then
  if exists(select from vnext_private.member_copy where observation_id=o.id) then raise exception 'NEW_IMMUTABLE_RESEARCH_VERSION_REQUIRED'; end if;
  -- Trigger independently checks unchanged evidence, publication and source gate.
  insert into vnext_private.member_copy(observation_id,publication_id,primary_risk,supporting_ids,contradicting_ids,event_ids,relation_ids)
  values(o.id,pid,r.primary_risk,r.supporting_ids,r.contradicting_ids,r.event_ids,r.relation_ids);
  if p_audience='free' and not exists(select from vnext_private.member_daily_edition where business_date=(now() at time zone 'Asia/Taipei')::date and symbol=o.symbol) then
   select coalesce(max(slot),0)+1 into next_slot from vnext_private.member_daily_edition where business_date=(now() at time zone 'Asia/Taipei')::date;
   if next_slot<=3 then insert into vnext_private.member_daily_edition(business_date,slot,symbol) values((now() at time zone 'Asia/Taipei')::date,next_slot,o.symbol); end if;
  end if;
 end if;
 insert into vnext_private.owner_publication_events(request_key,observation_id,review_id,actor,action,audience,publication_id)
 values(p_request_key,o.id,r.id,auth.uid(),p_action,p_audience,pid) returning id into event_id;
 return jsonb_build_object('event_id',event_id,'action',p_action,'replayed',false);
end $$;
revoke all on function public.review_vnext_publication_candidate_v1(text,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.review_vnext_publication_candidate_v1(text,uuid,text,text,uuid) to authenticated;

create function public.get_owner_vnext_publication_review_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
  select o.id,o.symbol,o.company,o.horizon,o.reason,o.created_at,o.next_review_at,
   r.id as review_id,r.quality,r.time_status,r.licensing,r.reason as review_reason,r.primary_risk,
   coalesce(r.quality='PASS' and r.time_status='PASS' and r.licensing='PASS' and r.expires_at>now() and o.next_review_at>now() and o.expires_at>now()
    and o.mode='FORWARD_SHADOW' and r.premium_allowed and vnext_private.publication_preflight(o.id,now()),false) as prerequisites_ready,
   coalesce(r.free_allowed,false) as free_allowed,
   vnext_private.member_allowed(o.id,false) as published
  from vnext_private.stock_horizon_observations o left join lateral(
   select * from vnext_private.publication_reviews where observation_id=o.id order by recorded_at desc,id desc limit 1)r on true
  order by o.created_at desc,o.id limit 216
 )x;
 return jsonb_build_object('rows',rows,'publication_requires_owner',true);
end $$;
revoke all on function public.get_owner_vnext_publication_review_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_owner_vnext_publication_review_v1() to authenticated;

-- Additive endpoint: older member readers keep their original response shape.
-- Free history is only the brief from the exact originally approved free
-- edition, not all old research or Premium evidence. Rights/revocation are
-- checked again on every read, including after subscription changes.
create function public.get_vnext_free_history_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare history jsonb;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'free' then
  raise exception 'FREE_MEMBER_REQUIRED' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(vnext_private.member_card(x.id,false) order by x.created_at desc,x.id),'[]') into history
 from (
  select o.id,o.created_at from vnext_private.stock_horizon_observations o
  join vnext_private.member_copy c on c.observation_id=o.id
  where not vnext_private.member_allowed(o.id,false) and vnext_private.member_allowed(o.id,true)
  and exists(select from vnext_private.owner_publication_events a
   join vnext_private.member_daily_edition d on d.business_date=(a.occurred_at at time zone 'Asia/Taipei')::date and d.symbol=o.symbol
   where a.observation_id=o.id and a.publication_id=c.publication_id and a.action='APPROVE' and a.audience='free')
  order by o.created_at desc,o.id limit 100
 )x;
 return jsonb_build_object('schema','VNEXT_FREE_HISTORY_V1','history',history);
end $$;
revoke all on function public.get_vnext_free_history_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_vnext_free_history_v1() to authenticated;
commit;
