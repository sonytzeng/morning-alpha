-- Candidate transport only. No source licenses, review decisions or approvals
-- are created. Apply only after isolated DB and exact production-schema checks.
begin;
alter table vnext_private.stock_horizon_observations
 add column origin_prediction_id text unique references vnext_runtime.predictions(id);

create function public.stage_vnext_daily_publication_v1(
 p_prediction_id text,p_expected_lock_hash text,p_evidence_ids text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare p vnext_runtime.predictions; o vnext_private.stock_horizon_observations;
 v jsonb; trace jsonb; ids text[]; evidence_hash text; observation_hash text;
 required text[]; missing text[]; cutoff timestamptz; expiry timestamptz; model_lock timestamptz; actionable timestamptz;
 evidence_as_of timestamptz; evidence_available timestamptz; evidence_verified timestamptz;
 oid text; now_at timestamptz:=transaction_timestamp();
begin
 if p_prediction_id is null or p_expected_lock_hash is null
  or p_expected_lock_hash !~ '^[a-f0-9]{64}$'
  or p_evidence_ids is null or cardinality(p_evidence_ids) not between 1 and 500
  or exists(select from unnest(p_evidence_ids) x where x is null or x='')
 then raise exception 'PUBLICATION_INGRESS_SCOPE'; end if;
 select array_agg(x order by x) into ids from(select distinct unnest(p_evidence_ids) x)s;
 if cardinality(ids)<>cardinality(p_evidence_ids) then raise exception 'PUBLICATION_EVIDENCE_DUPLICATE';end if;
 -- Same serialization boundary as Owner approval/revocation and review inserts.
 perform pg_advisory_xact_lock(hashtextextended('vnext-member-publication',0));
 select * into strict p from vnext_runtime.predictions where id=p_prediction_id;
 v:=p.payload;
 if p.lock_hash<>p_expected_lock_hash or v->>'lock_hash' is distinct from p.lock_hash
  or encode(sha256(convert_to(p.payload_text,'UTF8')),'hex')<>p.lock_hash
  or p.payload_text::jsonb is distinct from (v-'lock_hash')
 then raise exception 'PUBLICATION_PREDICTION_CHANGED';end if;
 if v->>'mode' is distinct from 'FORWARD_SHADOW'
  or v->>'provenance' is distinct from 'RETAINED_REAL_EVIDENCE'
  or v->'research'->>'state' is distinct from 'QUALIFIED'
  or v->>'symbol' is distinct from p.symbol or v->>'horizon' is distinct from p.horizon
 then raise exception 'PUBLICATION_RESEARCH_NOT_ELIGIBLE';end if;
 cutoff:=(v->>'evidence_cutoff')::timestamptz;expiry:=(v->>'next_review_at')::timestamptz;
 model_lock:=(v->>'locked_at')::timestamptz;actionable:=(v->>'actionable_at')::timestamptz;
 if cutoff is null or expiry is null or cutoff>p.locked_at or p.locked_at>now_at
  or model_lock is null or actionable is null or cutoff>model_lock
  or model_lock>p.locked_at or model_lock>=actionable or expiry<=actionable
 then raise exception 'PUBLICATION_PREDICTION_TIME';end if;
 if exists(select from unnest(ids) requested(evidence_id) where not exists(
  select from vnext_private.event_sources e where e.id=requested.evidence_id and e.symbol=p.symbol
   and e.available_at<=cutoff and e.last_verified_at<=cutoff and e.valid_until>now_at
   and e.quality='PASS' and e.relevant)) then raise exception 'PUBLICATION_EVIDENCE_UNAVAILABLE';end if;
 -- Bind every model input to the same immutable source version. An unrelated
 -- company fact, a later correction or a guessed publication time cannot fill it.
 if jsonb_typeof(v->'research'->'used') is distinct from 'array'
  or jsonb_array_length(v->'research'->'used')=0 then raise exception 'PUBLICATION_TRACE_REQUIRED';end if;
 for trace in select * from jsonb_array_elements(v->'research'->'used') loop
  if not exists(select from vnext_private.event_sources e where e.id=trace->>'id'
   and e.id=any(ids) and e.source=trace->>'source' and e.snapshot_hash=trace->>'evidence_hash'
   and e.published_at=(trace->>'published_at')::timestamptz
   and e.first_seen_at=(trace->>'first_seen_at')::timestamptz
   and e.available_at=(trace->>'available_at')::timestamptz
   and e.as_of=(trace->>'as_of')::timestamptz)
  then raise exception 'PUBLICATION_TRACE_MISMATCH';end if;
 end loop;
 required:=case p.horizon when 'SHORT' then array['PRICE_VOLUME','INSTITUTIONAL','NEWS','TECHNICAL_STRUCTURE']
  when 'MEDIUM' then array['REVENUE','ORDERS','GUIDANCE','INSTITUTIONAL','INDUSTRY_EVENT']
  when 'LONG' then array['DEMAND','MOAT','SUPPLY_CHAIN','EPS','MARGIN','CAPEX','VALUATION'] end;
 if required is null then raise exception 'PUBLICATION_HORIZON';end if;
 select array_agg(k) into missing from unnest(required) k where not exists(
  select from vnext_private.event_sources e where e.id=any(ids) and e.kind=k and e.classification='CONFIRMED_FACT');
 if cardinality(missing)>0 then return jsonb_build_object('status','BLOCKED','reason','HORIZON_EVIDENCE_MISSING','missing',missing,'member_published',0);end if;
 if exists(select from vnext_private.event_sources e join vnext_private.source_licenses l on l.id=e.license_id
  where e.id=any(ids) and (not l.storage_allowed or not l.derived_allowed or not l.commercial_allowed
   or not l.redistribution_allowed or l.reviewed_at>now_at or l.expires_at<=now_at))
 then return jsonb_build_object('status','BLOCKED','reason','SOURCE_RIGHTS_UNVERIFIED','member_published',0);end if;
 select encode(sha256(convert_to(string_agg(e.id||':'||e.snapshot_hash,',' order by e.id),'UTF8')),'hex'),
  max(e.as_of),max(e.available_at),max(e.last_verified_at)
 into evidence_hash,evidence_as_of,evidence_available,evidence_verified
 from vnext_private.event_sources e where e.id=any(ids);
 observation_hash:=encode(sha256(convert_to(jsonb_build_object('version','DAILY_PUBLICATION_INGRESS_1',
  'prediction',p.id,'lock_hash',p.lock_hash,'evidence_hash',evidence_hash)::text,'UTF8')),'hex');
 select * into o from vnext_private.stock_horizon_observations where origin_prediction_id=p.id;
 if found then
  if o.snapshot_hash<>observation_hash or vnext_private.publication_evidence_hash(o.id)<>evidence_hash then raise exception 'PUBLICATION_INGRESS_CONFLICT';end if;
  return jsonb_build_object('status','ALREADY_STAGED','observation_id',o.id,'member_published',0);
 end if;
 if expiry<=now_at then raise exception 'PUBLICATION_RESEARCH_EXPIRED';end if;
 oid:='daily-'||p.id;
 -- This is a newly staged editorial observation NOW, linked to the original
 -- prediction. Never backdate created_at or create another Forward sample.
 insert into vnext_private.stock_horizon_observations(id,origin_prediction_id,symbol,company,horizon,
  created_at,as_of,available_at,last_verified_at,next_review_at,expires_at,reason,strategy_version,mode,snapshot_hash,status,
  confirmation_conditions,invalidation_conditions)
 values(oid,p.id,p.symbol,v->>'company',p.horizon,now_at,evidence_as_of,evidence_available,evidence_verified,
  expiry,expiry,v->'research'->>'reason',v->>'strategy_version','FORWARD_SHADOW',observation_hash,'WATCHING',
  jsonb_build_array(jsonb_build_object('text',v->>'confirmation','state','UNKNOWN','evidence_ids',to_jsonb(ids))),
  jsonb_build_array(jsonb_build_object('text',v->>'invalidation','state','UNKNOWN','evidence_ids',to_jsonb(ids))));
 insert into vnext_private.observation_evidence(observation_id,evidence_id) select oid,unnest(ids);
 if not vnext_private.publication_preflight(oid,now_at) then raise exception 'PUBLICATION_PREFLIGHT_REJECTED';end if;
 return jsonb_build_object('status','STAGED_REVIEW_REQUIRED','observation_id',oid,'member_published',0);
end $$;
revoke all on function public.stage_vnext_daily_publication_v1(text,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.stage_vnext_daily_publication_v1(text,text,text[]) to service_role;

-- Existing natural checkpoints may retry this transport independently of the
-- prediction lease. Missing registries remain blocked, never invented grants.
create function public.stage_vnext_daily_publication_batch_v1(p_run uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p vnext_runtime.predictions; ids text[]; r jsonb; staged integer:=0; blocked integer:=0; already integer:=0;
begin
 if p_run is null then raise exception 'PUBLICATION_RUN_REQUIRED';end if;
 for p in select * from vnext_runtime.predictions where run_id=p_run order by id loop
  if p.payload->'research'->>'state' is distinct from 'QUALIFIED' then continue;end if;
  -- Include exact model traces and independently registered supporting facts.
  -- Never use facts first observed after the immutable prediction cutoff.
  select array_agg(e.id order by e.id) into ids from vnext_private.event_sources e
   where e.symbol=p.symbol and e.quality='PASS' and e.relevant
    and e.last_verified_at<=(p.payload->>'evidence_cutoff')::timestamptz
    and e.valid_until>transaction_timestamp();
  if ids is null or cardinality(ids)>500 then blocked:=blocked+1;continue;end if;
  begin
   r:=public.stage_vnext_daily_publication_v1(p.id,p.lock_hash,ids);
   if r->>'status'='STAGED_REVIEW_REQUIRED' then staged:=staged+1;
   elsif r->>'status'='ALREADY_STAGED' then already:=already+1;
   else blocked:=blocked+1;end if;
  exception when raise_exception or no_data_found or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
   -- One invalid candidate cannot roll back valid siblings. Its failed atomic
   -- transaction leaves no half-linked observation or review behind.
   blocked:=blocked+1;
  end;
 end loop;
 return jsonb_build_object('staged',staged,'already_staged',already,'blocked',blocked,'member_published',0);
end $$;
revoke all on function public.stage_vnext_daily_publication_batch_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.stage_vnext_daily_publication_batch_v1(uuid) to service_role;
commit;
