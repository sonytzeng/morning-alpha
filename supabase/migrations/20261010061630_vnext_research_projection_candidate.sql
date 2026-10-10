-- CANDIDATE ONLY. No Production application authorized. Additive private schema.
-- Reuses company_events/news_events as upstream references; never alters them.
begin;
create schema vnext_private;
revoke all on schema vnext_private from public,anon,authenticated;
grant usage on schema vnext_private to authenticated,service_role;

create table vnext_private.source_licenses(
 id text primary key, source text not null, document_url text not null check(document_url like 'https://%'),
 reviewed_at timestamptz not null, expires_at timestamptz,
 storage_allowed boolean not null default false, derived_allowed boolean not null default false,
 commercial_allowed boolean not null default false, redistribution_allowed boolean not null default false,
 attribution text not null check(length(attribution)>0), unique(id,source),
 check(expires_at is null or expires_at>reviewed_at)
);
create table vnext_private.event_sources(
 id text primary key, symbol text not null, kind text not null, source text not null, source_ref text not null,
 license_id text not null, published_at timestamptz not null, first_seen_at timestamptz not null,
 available_at timestamptz not null, as_of timestamptz not null, last_verified_at timestamptz not null,
 valid_until timestamptz not null, snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 classification text not null check(classification in ('CONFIRMED_FACT','REPORTED_CLAIM','INFERENCE','UNVERIFIED')),
 quality text not null check(quality in ('PASS','INSUFFICIENT','REJECTED')), relevant boolean not null,
 summary text not null, foreign key(license_id,source) references vnext_private.source_licenses(id,source),
 check(as_of<=published_at and published_at<=available_at and first_seen_at<=available_at and available_at<=last_verified_at and last_verified_at<valid_until),
 check(source_ref ~ '^https://' and source_ref !~* '(token|secret|api_key|authorization|email)=')
);
create table vnext_private.market_events(
 event_id text not null, revision integer not null check(revision>0), source text not null, source_event_id text not null,
 published_at timestamptz not null, first_seen_at timestamptz not null, available_at timestamptz not null,
 last_verified_at timestamptz not null, title text not null, affected_companies text[] not null,
 expected_horizons text[] not null check(expected_horizons <@ array['SHORT','MEDIUM','LONG']),
 invalidation text not null check(length(invalidation)>0), evidence_ids text[] not null check(cardinality(evidence_ids)>0),
 classification text not null check(classification in ('CONFIRMED_FACT','REPORTED_CLAIM','INFERENCE','UNVERIFIED')),
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 primary key(event_id,revision), unique(source,source_event_id,revision),
 check(published_at<=available_at and first_seen_at<=available_at and available_at<=last_verified_at)
);
create table vnext_private.supply_chain_relations(
 id text primary key, from_entity text not null, to_entity text not null,
 relation_type text not null check(relation_type in ('CUSTOMER','SUPPLIER','COMPETITOR','PRODUCT','INDUSTRY')),
 source text not null, evidence_ids text[] not null check(cardinality(evidence_ids)>0),
 valid_from timestamptz not null, valid_to timestamptz, observed_at timestamptz not null, available_at timestamptz not null,
 confidence text not null check(confidence in ('DOCUMENTED','CLAIMED','UNKNOWN')),
 revenue_exposure numeric check(revenue_exposure between 0 and 1),
 verification_status text not null check(verification_status in ('VERIFIED','UNVERIFIED')),
 check(from_entity<>to_entity and observed_at<=available_at and (valid_to is null or valid_to>valid_from))
);
create table vnext_private.stock_horizon_observations(
 id text primary key, symbol text not null, company text not null,
 horizon text not null check(horizon in ('SHORT','MEDIUM','LONG')),
 created_at timestamptz not null, as_of timestamptz not null, available_at timestamptz not null,
 last_verified_at timestamptz not null, next_review_at timestamptz not null, expires_at timestamptz not null,
 reason text not null check(length(reason)>0), strategy_version text not null,
 mode text not null check(mode in ('HISTORICAL_REPLAY','FORWARD_SHADOW')),
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 status text not null check(status in ('WATCHING','CONDITION_MET','INVALIDATED','EXPIRED')),
 confirmation_conditions jsonb not null check(jsonb_typeof(confirmation_conditions)='array' and jsonb_array_length(confirmation_conditions)>0),
 invalidation_conditions jsonb not null check(jsonb_typeof(invalidation_conditions)='array' and jsonb_array_length(invalidation_conditions)>0),
 locked_at timestamptz not null default transaction_timestamp(),
 lock_transaction bigint not null default txid_current(),
 unique(symbol,horizon,created_at,strategy_version),
 check(as_of<=available_at and available_at<=last_verified_at and last_verified_at<=created_at and created_at<next_review_at and created_at<expires_at),
 check(mode='HISTORICAL_REPLAY' or created_at=locked_at)
);
create table vnext_private.observation_evidence(
 observation_id text references vnext_private.stock_horizon_observations(id),
 evidence_id text references vnext_private.event_sources(id), primary key(observation_id,evidence_id)
);
create table vnext_private.observation_outcomes(
 observation_id text references vnext_private.stock_horizon_observations(id), horizon_days integer not null,
 observed_at timestamptz not null, evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 state text not null check(state in ('NOT_MATURED','NOT_ENTERED','UNCONFIRMED','MEASURED')),
 cost_model_version text not null, adjustment_source text, executable_price_source text,
 net_return numeric, benchmark_return numeric, mfe numeric, mae numeric, maximum_drawdown numeric,
 primary key(observation_id,horizon_days),
 check((state='MEASURED' and adjustment_source is not null and executable_price_source is not null
   and net_return is not null and benchmark_return is not null and mfe is not null and mae is not null and maximum_drawdown is not null)
   or (state<>'MEASURED' and net_return is null and benchmark_return is null and mfe is null and mae is null and maximum_drawdown is null))
);
create table vnext_private.publication_audit(
 id bigint generated always as identity primary key,
 observation_id text not null references vnext_private.stock_horizon_observations(id),
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 audience text not null check(audience in ('free','premium')), approved boolean not null default false,
 content_kind text not null check(content_kind='RESEARCH_OBSERVATION'),
 reviewed_at timestamptz not null default clock_timestamp(), reviewer_ref text not null,
 license_review_ref text not null, gate_version text not null check(gate_version='VNEXT_PUBLICATION_1')
);
create index vnext_event_time on vnext_private.market_events(available_at,event_id,revision);
create index vnext_evidence_symbol on vnext_private.event_sources(symbol,kind,available_at);
create index vnext_relation_time on vnext_private.supply_chain_relations(from_entity,available_at);
create index vnext_observation_time on vnext_private.stock_horizon_observations(horizon,created_at);
create index vnext_evidence_reverse on vnext_private.observation_evidence(evidence_id);
create index vnext_publication_latest on vnext_private.publication_audit(observation_id,id desc);

create function vnext_private.immutable_record() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'VNEXT_APPEND_ONLY'; end $$;
revoke all on function vnext_private.immutable_record() from public,anon,authenticated,service_role;
do $$ declare n text; begin
 foreach n in array array['source_licenses','event_sources','market_events','supply_chain_relations','stock_horizon_observations','observation_evidence','observation_outcomes','publication_audit'] loop
  execute format('alter table vnext_private.%I enable row level security',n);
  execute format('alter table vnext_private.%I force row level security',n);
  execute format('revoke all on vnext_private.%I from public,anon,authenticated',n);
  execute format('grant select on vnext_private.%I to authenticated',n);
  execute format('grant select,insert on vnext_private.%I to service_role',n);
  execute format('create policy owner_read on vnext_private.%I for select to authenticated using ((select public.is_research_owner_v1()))',n);
  execute format('create trigger immutable before update or delete on vnext_private.%I for each row execute function vnext_private.immutable_record()',n);
 end loop;
end $$;
grant usage,select on all sequences in schema vnext_private to service_role;

-- Evidence membership seals in the same transaction as the immutable prediction.
-- No later insert may silently change the snapshot's evidence set.
create function vnext_private.validate_append() returns trigger
language plpgsql set search_path='' as $$
declare o vnext_private.stock_horizon_observations; e vnext_private.event_sources; prior vnext_private.market_events;
begin
 if tg_table_name='stock_horizon_observations' then
  if new.locked_at<>transaction_timestamp() or new.lock_transaction<>txid_current() then raise exception 'LOCK_IDENTITY_INVALID'; end if;
 elsif tg_table_name='observation_evidence' then
  select * into strict o from vnext_private.stock_horizon_observations where id=new.observation_id;
  select * into strict e from vnext_private.event_sources where id=new.evidence_id;
  if o.lock_transaction<>txid_current() then raise exception 'EVIDENCE_SET_SEALED'; end if;
  if e.symbol<>o.symbol or e.available_at>o.created_at or e.last_verified_at>o.created_at then raise exception 'EVIDENCE_POINT_IN_TIME_INVALID'; end if;
 elsif tg_table_name='market_events' then
  perform pg_advisory_xact_lock(hashtextextended(new.source||':'||new.source_event_id,0));
  select * into prior from vnext_private.market_events where event_id=new.event_id order by revision desc limit 1;
  if found and (prior.source<>new.source or prior.source_event_id<>new.source_event_id
    or new.revision<>prior.revision+1 or new.available_at<prior.available_at) then raise exception 'EVENT_REVISION_INVALID'; end if;
  if exists(select from vnext_private.market_events where source=new.source and source_event_id=new.source_event_id and event_id<>new.event_id)
    or cardinality(new.expected_horizons)=0 or cardinality(new.affected_companies)=0
    or exists(select from unnest(new.evidence_ids) x where not exists(select from vnext_private.event_sources s where s.id=x and s.available_at<=new.available_at)) then raise exception 'EVENT_LINEAGE_INVALID'; end if;
 elsif tg_table_name='observation_outcomes' then
  select * into strict o from vnext_private.stock_horizon_observations where id=new.observation_id;
  if new.horizon_days<>all(case o.horizon when 'SHORT' then array[1,5,10] when 'MEDIUM' then array[20,40,60] else array[120,180,250] end)
    or new.observed_at<o.created_at or new.observed_at>clock_timestamp() then raise exception 'OUTCOME_HORIZON_OR_TIME_INVALID'; end if;
  -- Actual execution path, trading calendar and adjustments need a separately
  -- verified producer. Strings claiming an execution source cannot prove a fill.
  if new.state='MEASURED' then raise exception 'MEASURED_OUTCOME_PRODUCER_NOT_ENABLED'; end if;
 end if;
 return new;
end $$;
revoke all on function vnext_private.validate_append() from public,anon,authenticated,service_role;
do $$ declare n text; begin
 foreach n in array array['stock_horizon_observations','observation_evidence','market_events','observation_outcomes'] loop
  execute format('create trigger validate_append before insert on vnext_private.%I for each row execute function vnext_private.validate_append()',n);
 end loop;
end $$;

-- DB gate independently enforces point-in-time, per-horizon coverage and rights.
create function vnext_private.publication_allowed(p_id text,p_now timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select from vnext_private.stock_horizon_observations o
 cross join lateral(select * from vnext_private.publication_audit a where a.observation_id=o.id order by a.id desc limit 1) a
 where o.id=p_id and o.mode='FORWARD_SHADOW' and o.status in ('WATCHING','CONDITION_MET')
 and o.created_at<=p_now and o.next_review_at>p_now and o.expires_at>p_now
 and a.approved and a.snapshot_hash=o.snapshot_hash and a.reviewed_at between o.created_at and p_now
 and a.content_kind='RESEARCH_OBSERVATION' and a.gate_version='VNEXT_PUBLICATION_1'
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
revoke all on function vnext_private.publication_allowed(text,timestamptz) from public,anon,authenticated,service_role;

-- Definer projects minimal approved copy, not a raw research table. Entitlement
-- comes from the existing server resolver, never a tier supplied in the request.
create function public.get_vnext_observations_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tier text; answer jsonb;
begin
 tier:=academy_private.access_v11();
 if tier not in ('owner','free','premium') then raise exception 'MEMBER_REQUIRED' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) into answer from (
  select o.id,o.symbol,o.company,o.horizon,o.status,o.reason,o.next_review_at,
    (select jsonb_agg(c->>'text') from jsonb_array_elements(o.confirmation_conditions)c) as confirmation,
    (select jsonb_agg(c->>'text') from jsonb_array_elements(o.invalidation_conditions)c) as invalidation,
    (select coalesce(jsonb_agg(jsonb_build_object('summary',e.summary,'source',e.source,'source_ref',e.source_ref,
      'available_at',e.available_at,'classification',e.classification)),'[]'::jsonb)
     from vnext_private.observation_evidence x join vnext_private.event_sources e on e.id=x.evidence_id where x.observation_id=o.id) as evidence
  from vnext_private.stock_horizon_observations o
  where (tier='owner' or (vnext_private.publication_allowed(o.id,now()) and
    (tier='premium' or (select a.audience from vnext_private.publication_audit a where a.observation_id=o.id order by a.id desc limit 1)='free')))
  order by o.created_at desc,o.id limit case when tier='free' then 3 else 100 end
 ) row;
 return jsonb_build_object('schema','VNEXT_PROJECTION_V1','tier',tier,'observations',answer,'research_only',true);
end $$;
revoke all on function public.get_vnext_observations_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_vnext_observations_v1() to authenticated;
comment on schema vnext_private is 'Unreleased VNext research candidate. No Production writers, Cron, or automatic publication.';
commit;
