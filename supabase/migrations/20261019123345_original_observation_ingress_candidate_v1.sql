-- CANDIDATE ONLY. No Production application or caller activation is authorized.
-- An existing C lock is lineage, never evidence that the original method passed.
-- Source registration and independent member publication review remain separate.
begin;

create table vnext_private.original_ingress_receipts(
 request_key uuid primary key,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 request jsonb not null,
 c_prediction_id text not null unique references vnext_runtime.predictions(id),
 c_lock_hash text not null check(c_lock_hash ~ '^[a-f0-9]{64}$'),
 c_source_revision text not null check(c_source_revision ~ '^[a-f0-9]{64}$'),
 observation_id text not null unique references vnext_private.stock_horizon_observations(id),
 original_snapshot jsonb not null,
 recorded_at timestamptz not null default transaction_timestamp()
);
alter table vnext_private.original_ingress_receipts enable row level security;
alter table vnext_private.original_ingress_receipts force row level security;
revoke all on vnext_private.original_ingress_receipts from public,anon,authenticated,service_role;
create trigger immutable before update or delete on vnext_private.original_ingress_receipts
 for each row execute function vnext_private.immutable_record();

-- Existing same-transaction membership is not sufficient on its own: a server
-- must not append an extra link later in that transaction after this RPC returns.
create function vnext_private.original_ingress_seal_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare oid text; receipt vnext_private.original_ingress_receipts; actual jsonb;begin
 oid:=new.observation_id;
 select * into receipt from vnext_private.original_ingress_receipts where observation_id=oid;
 if not found then return new;end if;
 select coalesce(jsonb_agg(evidence_id order by evidence_id collate "C"),'[]') into actual
  from vnext_private.observation_evidence where observation_id=oid;
 if actual is distinct from receipt.original_snapshot->'observation'->'evidence_ids'
 then raise exception 'ORIGINAL_EVIDENCE_SET_NOT_EXACT';end if;
 return new;
end $$;
revoke all on function vnext_private.original_ingress_seal_v1() from public,anon,authenticated,service_role;
create constraint trigger original_ingress_exact_set after insert on vnext_private.observation_evidence
 deferrable initially deferred for each row execute function vnext_private.original_ingress_seal_v1();
create constraint trigger original_ingress_receipt_seal after insert on vnext_private.original_ingress_receipts
 deferrable initially deferred for each row execute function vnext_private.original_ingress_seal_v1();

-- Exact original snapshotHash serialization, restricted to this closed envelope:
-- ASCII object keys, string/boolean/null/array/object values, no numeric coercion.
create function vnext_private.original_canonical_v1(v jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare result text;begin
 case jsonb_typeof(v)
 when 'object' then
  if exists(select from jsonb_object_keys(v) k where k !~ '^[a-z_]+$') then raise exception 'CANONICAL_KEY_INVALID';end if;
  select '{'||coalesce(string_agg(to_jsonb(k)::text||':'||vnext_private.original_canonical_v1(x),',' order by k collate "C"),'')||'}'
   into result from jsonb_each(v) t(k,x);
 when 'array' then
  select '['||coalesce(string_agg(vnext_private.original_canonical_v1(x),',' order by ord),'')||']'
   into result from jsonb_array_elements(v) with ordinality t(x,ord);
 when 'string','boolean','null' then result:=v::text;
 else raise exception 'CANONICAL_TYPE_INVALID';
 end case;
 return result;
end $$;
create function vnext_private.original_iso_v1(v timestamptz) returns text
language sql immutable set search_path='' as $$select to_char(v at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')$$;
create function vnext_private.original_text_units_v1(v text) returns integer
language sql immutable set search_path='' as $$
 select coalesce(sum(case when ascii(substr(v,n,1))>65535 then 2 else 1 end),0)::integer from generate_series(1,length(v)) n
$$;
revoke all on function vnext_private.original_canonical_v1(jsonb),vnext_private.original_iso_v1(timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function vnext_private.original_text_units_v1(text) from public,anon,authenticated,service_role;

create function public.ingest_vnext_original_observation_candidate_v1(p_request_key uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare
 at_time timestamptz:=transaction_timestamp();
 req_hash text; old vnext_private.original_ingress_receipts;
 cp vnext_runtime.predictions; cr vnext_runtime.runs;
 ids text[]; required text[]; c jsonb; selected jsonb; body jsonb; result jsonb;
 source_time timestamptz; cutoff timestamptz; review_at timestamptz; expiry timestamptz;
 asof_at timestamptz; available_at timestamptz; verified_at timestamptz;
 state text:='WATCHING'; oid text; h text;
begin
 -- The grant is server-only; no browser Owner/Free/Premium may select a tier or
 -- supply new source rows, source rights, quality flags, timestamps or a status.
 if p_request_key is null or jsonb_typeof(p_request) is distinct from 'object'
  or octet_length(p_request::text)>65536
  or not(p_request ?& array['schema','c_prediction_id','c_lock_hash','symbol','company','horizon','reason',
   'evidence_ids','confirmation_conditions','invalidation_conditions','next_review_at','expires_at'])
  or (select count(*) from jsonb_object_keys(p_request))<>12
  or p_request->>'schema' is distinct from 'ORIGINAL_OBSERVATION_INGRESS_1'
 then raise exception 'ORIGINAL_REQUEST_INVALID';end if;
 if exists(select from jsonb_each(p_request) t(k,v) where k not in('evidence_ids','confirmation_conditions','invalidation_conditions')
   and jsonb_typeof(v) is distinct from 'string')
  or length(p_request->>'c_prediction_id') not between 1 and 256 or p_request->>'c_prediction_id' !~ '^[a-zA-Z0-9:_-]+$'
  or p_request->>'c_lock_hash' !~ '^[a-f0-9]{64}$'
  or p_request->>'symbol' !~ '^[0-9]{4,6}$'
  or length(btrim(p_request->>'company'))=0 or vnext_private.original_text_units_v1(p_request->>'company')>200
  or length(btrim(p_request->>'reason'))=0 or vnext_private.original_text_units_v1(p_request->>'reason')>3000
  or p_request->>'horizon' not in('SHORT','MEDIUM','LONG')
  or jsonb_typeof(p_request->'evidence_ids') is distinct from 'array'
  or jsonb_typeof(p_request->'confirmation_conditions') is distinct from 'array'
  or jsonb_typeof(p_request->'invalidation_conditions') is distinct from 'array'
  or p_request->>'next_review_at' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$'
  or p_request->>'expires_at' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$'
 then raise exception 'ORIGINAL_REQUEST_INVALID';end if;
 if jsonb_array_length(p_request->'evidence_ids') not between 1 and 100
  or jsonb_array_length(p_request->'confirmation_conditions') not between 1 and 20
  or jsonb_array_length(p_request->'invalidation_conditions') not between 1 and 20
 then raise exception 'ORIGINAL_REQUEST_BOUNDS';end if;
 -- Hex source identities give identical localeCompare and bytewise ordering.
 -- Noncanonical legacy IDs are rejected, never silently aliased or rewritten.
 if exists(select from jsonb_array_elements(p_request->'evidence_ids') v
  where jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~ '^[a-f0-9]{64}$')
 then raise exception 'ORIGINAL_CANONICAL_SOURCE_ID_UNSUPPORTED';end if;
 select array_agg(v order by v collate "C") into ids from jsonb_array_elements_text(p_request->'evidence_ids') v;
 if cardinality(ids)<>(select count(distinct v) from unnest(ids)v) then raise exception 'ORIGINAL_EVIDENCE_DUPLICATE';end if;
 for c in select * from jsonb_array_elements((p_request->'confirmation_conditions')||(p_request->'invalidation_conditions')) loop
  if jsonb_typeof(c) is distinct from 'object' or not(c ?& array['text','state','evidence_ids'])
   or (select count(*) from jsonb_object_keys(c))<>3
   or jsonb_typeof(c->'text') is distinct from 'string' or length(btrim(c->>'text'))=0 or vnext_private.original_text_units_v1(c->>'text')>3000
   -- A reproducible original condition-state producer is not installed. Never
   -- accept caller-declared truth, even from C or an authorized server identity.
   or jsonb_typeof(c->'state') is distinct from 'string' or c->>'state'<>'UNKNOWN'
   or jsonb_typeof(c->'evidence_ids') is distinct from 'array'
  then raise exception 'ORIGINAL_CONDITION_INVALID';end if;
  if jsonb_array_length(c->'evidence_ids') not between 1 and 100
   or exists(select from jsonb_array_elements(c->'evidence_ids') v where jsonb_typeof(v) is distinct from 'string')
   or exists(select from jsonb_array_elements_text(c->'evidence_ids') v where not(v=any(ids)))
   or jsonb_array_length(c->'evidence_ids')<>(select count(distinct v) from jsonb_array_elements_text(c->'evidence_ids') v)
  then raise exception 'ORIGINAL_CONDITION_UNTRACEABLE';end if;
 end loop;
 req_hash:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('original-request:'||p_request_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended('original-prediction:'||(p_request->>'c_prediction_id'),0));
 select * into old from vnext_private.original_ingress_receipts where request_key=p_request_key;
 if found then
  if old.request_hash<>req_hash or old.request<>p_request then raise exception 'ORIGINAL_IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('schema','ORIGINAL_OBSERVATION_RECEIPT_1','replayed',true,'snapshot',old.original_snapshot);
 end if;
 if exists(select from vnext_private.original_ingress_receipts where c_prediction_id=p_request->>'c_prediction_id')
 then raise exception 'ORIGINAL_PREDICTION_ALREADY_LINKED';end if;
 select * into strict cp from vnext_runtime.predictions where id=p_request->>'c_prediction_id';
 select * into strict cr from vnext_runtime.runs where id=cp.run_id;
 -- Do not inspect or promote research.status / research.score / C confirmation.
 if cp.lock_hash is distinct from p_request->>'c_lock_hash'
  or cp.symbol is distinct from p_request->>'symbol' or cp.horizon is distinct from p_request->>'horizon'
  or cp.payload->>'id' is distinct from cp.id or cp.payload->>'symbol' is distinct from cp.symbol
  or cp.payload->>'horizon' is distinct from cp.horizon or (cp.payload->>'business_date')::date is distinct from cr.business_date
  or cp.payload->>'mode' is distinct from 'FORWARD_SHADOW'
  or cp.payload->>'provenance' is distinct from 'RETAINED_REAL_EVIDENCE'
  or cp.payload->>'strategy_version' is distinct from 'VNEXT_OBSERVATION_HYPOTHESIS_2.0.0'
  or cp.payload->>'lock_hash' is distinct from cp.lock_hash
  or cp.payload->>'company' is distinct from p_request->>'company'
  or encode(sha256(convert_to(cp.payload_text,'UTF8')),'hex') is distinct from cp.lock_hash
  or cp.payload_text::jsonb is distinct from cp.payload-'lock_hash'
  or (cr.checkpoint->'locks' @> jsonb_build_array(cp.payload)) is distinct from true
  or cr.checkpoint->'acquired'->>'snapshot_hash' is distinct from cr.source_revision
  or cr.source_revision is null or cr.source_revision !~ '^[a-f0-9]{64}$'
 then raise exception 'ORIGINAL_C_LINEAGE_INVALID';end if;
 cutoff:=(cp.payload->>'evidence_cutoff')::timestamptz;
 source_time:=(cp.payload->>'generated_at')::timestamptz;
 if cutoff is null or source_time is null or not isfinite(cutoff) or not isfinite(source_time)
  or cutoff<cr.created_at or cutoff>source_time or source_time>cp.locked_at
  or cp.locked_at>at_time or at_time>=cr.actionable_at or clock_timestamp()>=cr.actionable_at
  or (cp.payload->>'actionable_at')::timestamptz is distinct from cr.actionable_at
  or cr.business_date<>(at_time at time zone 'Asia/Taipei')::date
  or cp.payload->>'evidence_cutoff' is distinct from cr.checkpoint->'acquired'->>'evidence_cutoff'
  or cp.payload->>'next_review_at' is null or not isfinite((cp.payload->>'next_review_at')::timestamptz)
  or clock_timestamp()>=(cp.payload->>'next_review_at')::timestamptz
 then raise exception 'ORIGINAL_FORWARD_WINDOW_INVALID';end if;
 review_at:=(p_request->>'next_review_at')::timestamptz;
 expiry:=(p_request->>'expires_at')::timestamptz;
 if review_at is null or expiry is null or not isfinite(review_at) or not isfinite(expiry)
  or review_at<=at_time or expiry<=at_time or review_at>expiry or expiry>='10000-01-01 00:00:00+00'::timestamptz
 then raise exception 'ORIGINAL_REVIEW_TIME_INVALID';end if;
 if cardinality(ids)<>(select count(*) from vnext_private.event_sources where id=any(ids))
 then raise exception 'ORIGINAL_REGISTERED_EVIDENCE_MISSING';end if;
 if exists(select from vnext_private.event_sources e join vnext_private.source_licenses l on (l.id,l.source)=(e.license_id,e.source)
  where e.id=any(ids) and (e.symbol<>cp.symbol or e.quality<>'PASS' or not e.relevant
   or e.available_at>cutoff or e.last_verified_at>cutoff or e.last_verified_at>at_time or e.valid_until<=at_time
   or not isfinite(e.published_at) or not isfinite(e.first_seen_at) or not isfinite(e.available_at)
   or not isfinite(e.as_of) or not isfinite(e.last_verified_at) or not isfinite(e.valid_until)
   -- SQL allows finite years outside the original four-digit ISO contract.
   -- Reject before persistence; never commit an unreconstructable JS snapshot.
   or e.as_of<'0001-01-01 00:00:00+00'::timestamptz or e.first_seen_at<'0001-01-01 00:00:00+00'::timestamptz
   or e.valid_until>='10000-01-01 00:00:00+00'::timestamptz
   or not l.storage_allowed or not l.derived_allowed or l.reviewed_at>cutoff
   or not isfinite(l.reviewed_at) or (l.expires_at is not null and not isfinite(l.expires_at))
   or (l.expires_at is not null and l.expires_at<=at_time)
   or length(btrim(e.summary))=0 or vnext_private.original_text_units_v1(e.summary)>3000
   -- This initial serialization envelope supports public DNS HTTPS references,
   -- not credential URLs/ports or percent-encoded query keys. No source is aliased.
   or e.source_ref !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?([/?]|$)'
   or exists(select from regexp_split_to_table(split_part(e.source_ref,'?',2),'&') q
     where split_part(q,'=',1) ~* '(token|secret|key|auth|email|%)')))
 then raise exception 'ORIGINAL_EVIDENCE_TIME_QUALITY_OR_STORAGE_RIGHTS';end if;
 required:=case cp.horizon when 'SHORT' then array['PRICE_VOLUME','INSTITUTIONAL','NEWS','TECHNICAL_STRUCTURE']
  when 'MEDIUM' then array['REVENUE','ORDERS','GUIDANCE','INSTITUTIONAL','INDUSTRY_EVENT']
  else array['DEMAND','MOAT','SUPPLY_CHAIN','EPS','MARGIN','CAPEX','VALUATION'] end;
 if exists(select from unnest(required) k where not exists(select from vnext_private.event_sources e
  where e.id=any(ids) and e.kind=k and e.classification='CONFIRMED_FACT'))
 then raise exception 'ORIGINAL_HORIZON_EVIDENCE_INCOMPLETE';end if;
 select max(e.as_of),max(e.available_at),max(e.last_verified_at) into asof_at,available_at,verified_at
  from vnext_private.event_sources e where e.id=any(ids);
 -- Evidence is reconstructed from immutable registered rows, not caller copies.
 select jsonb_agg(jsonb_build_object('id',e.id,'source',e.source,'source_ref',e.source_ref,'symbol',e.symbol,'kind',e.kind,
  'published_at',vnext_private.original_iso_v1(e.published_at),'first_seen_at',vnext_private.original_iso_v1(e.first_seen_at),
  'available_at',vnext_private.original_iso_v1(e.available_at),'as_of',vnext_private.original_iso_v1(e.as_of),
  'last_verified_at',vnext_private.original_iso_v1(e.last_verified_at),'valid_until',vnext_private.original_iso_v1(e.valid_until),
  'snapshot_hash',e.snapshot_hash,'license_id',e.license_id,'quality',e.quality,'relevant',e.relevant,
  'classification',e.classification,'summary',e.summary) order by e.id collate "C") into selected
  from vnext_private.event_sources e where e.id=any(ids);
 -- The original engine also resolves these UNKNOWN conditions to WATCHING.
 oid:='original-'||encode(sha256(convert_to(cp.id,'UTF8')),'hex');
 body:=jsonb_build_object('id',oid,'symbol',cp.symbol,'company',p_request->>'company','horizon',cp.horizon,
  'created_at',vnext_private.original_iso_v1(at_time),'as_of',vnext_private.original_iso_v1(asof_at),
  'available_at',vnext_private.original_iso_v1(available_at),'last_verified_at',vnext_private.original_iso_v1(verified_at),
  'next_review_at',vnext_private.original_iso_v1(review_at),'expires_at',vnext_private.original_iso_v1(expiry),
  'reason',p_request->>'reason','evidence_ids',to_jsonb(ids),'confirmation_conditions',p_request->'confirmation_conditions',
  'invalidation_conditions',p_request->'invalidation_conditions','strategy_version','VNEXT_RESEARCH_1.0.0',
  'mode','FORWARD_SHADOW','publication_status','RESEARCH_ONLY');
 h:=encode(sha256(convert_to(vnext_private.original_canonical_v1(jsonb_build_object('observation',body,'evidence',selected)),'UTF8')),'hex');
 body:=body||jsonb_build_object('snapshot_hash',h);
 insert into vnext_private.stock_horizon_observations(id,symbol,company,horizon,created_at,as_of,available_at,last_verified_at,
  next_review_at,expires_at,reason,strategy_version,mode,snapshot_hash,status,confirmation_conditions,invalidation_conditions)
 values(oid,cp.symbol,p_request->>'company',cp.horizon,at_time,asof_at,available_at,verified_at,review_at,expiry,
  p_request->>'reason','VNEXT_RESEARCH_1.0.0','FORWARD_SHADOW',h,state,p_request->'confirmation_conditions',p_request->'invalidation_conditions');
 insert into vnext_private.observation_evidence select oid,eid from unnest(ids) eid;
 result:=jsonb_build_object('observation',body,'evidence',selected,'state',state,'lineage',jsonb_build_object(
  'c_prediction_id',cp.id,'c_lock_hash',cp.lock_hash,'c_source_revision',cr.source_revision,
  'c_generated_at',vnext_private.original_iso_v1(source_time),'c_cutoff',vnext_private.original_iso_v1(cutoff)));
 insert into vnext_private.original_ingress_receipts(request_key,request_hash,request,c_prediction_id,c_lock_hash,c_source_revision,observation_id,original_snapshot)
 values(p_request_key,req_hash,p_request,cp.id,cp.lock_hash,cr.source_revision,oid,result);
 if clock_timestamp()>=cr.actionable_at or clock_timestamp()>=(cp.payload->>'next_review_at')::timestamptz
 then raise exception 'ORIGINAL_FORWARD_WINDOW_INVALID';end if;
 -- No publication audit/review/copy/edition, Outcome, entitlement or C mutation.
 return jsonb_build_object('schema','ORIGINAL_OBSERVATION_RECEIPT_1','replayed',false,'snapshot',result);
end $$;
revoke all on function public.ingest_vnext_original_observation_candidate_v1(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ingest_vnext_original_observation_candidate_v1(uuid,jsonb) to service_role;
commit;
