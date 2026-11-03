-- UNDEPLOYED CANDIDATE ONLY. FreshDB controls, NOT a Supabase migration.
-- Requires the three existing projection/runtime/original-ingress candidates.
-- Narrow adapter for ALREADY registered, independently approved Evidence only.
-- No real source/authority/approval is seeded or admitted by this candidate.
-- Administrative intake remains external: the DB owner must independently
-- verify source origin, quality and INTERNAL rights, then install exact records.
-- Neither component is a formal V1 publisher or establishes approved production
-- data. The ONLY write path is the original research-only Observation. Version
-- checks below intentionally remain BEFORE its atomic write, never after it.
-- Supported write transport: one READ COMMITTED PostgREST RPC transaction.
-- Deferred commit validation is not a general pre-commit hook for separately
-- privileged SQL callers who manually force constraints IMMEDIATE mid-transaction.
-- CREATE (not REPLACE) prevents silent re-install. Resource caps are protocol
-- limits, not strategy thresholds. No V1/publication rights are granted.
begin;
create schema original_registry_candidate;
revoke all on schema original_registry_candidate from public,anon,authenticated,service_role;
create table original_registry_candidate.authorities(
 id uuid primary key,kind text not null check(kind in('SOURCE','QUALITY','RIGHTS')),
 authority_ref text not null unique check(length(btrim(authority_ref)) between 1 and 160),
 status text not null check(status in('APPROVED','PENDING','REJECTED')),
 document_ref text not null check(length(btrim(document_ref)) between 1 and 3000),
 document_hash text not null check(document_hash ~ '^[a-f0-9]{64}$'),
 valid_from timestamptz not null,expires_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 check(isfinite(valid_from) and isfinite(expires_at) and valid_from<expires_at)
);
create table original_registry_candidate.versions(
 id uuid primary key,evidence_id text not null references vnext_private.event_sources(id),
 source_authority uuid not null references original_registry_candidate.authorities(id),
 quality_authority uuid not null references original_registry_candidate.authorities(id),
 rights_authority uuid not null references original_registry_candidate.authorities(id),
 record_hash text not null check(record_hash ~ '^[a-f0-9]{64}$'),
 evidence_record_hash text not null check(evidence_record_hash ~ '^[a-f0-9]{64}$'),
 license_record_hash text not null check(license_record_hash ~ '^[a-f0-9]{64}$'),
 record jsonb not null check(jsonb_typeof(record)='object' and octet_length(record::text)<=65536),
 status text not null check(status in('APPROVED','PENDING','REJECTED')),
 valid_from timestamptz not null,expires_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 check(isfinite(valid_from) and isfinite(expires_at) and valid_from<expires_at),
 check(source_authority<>quality_authority and source_authority<>rights_authority and quality_authority<>rights_authority)
);
create index on original_registry_candidate.versions(evidence_id);
create table original_registry_candidate.revocations(
 id uuid primary key,version_id uuid references original_registry_candidate.versions(id),
 authority_id uuid references original_registry_candidate.authorities(id),
 reason text not null check(length(btrim(reason)) between 1 and 3000),
 document_hash text not null check(document_hash ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 check(num_nonnulls(version_id,authority_id)=1)
);
create index on original_registry_candidate.revocations(version_id);
create index on original_registry_candidate.revocations(authority_id);
create table original_registry_candidate.write_guards(
 id uuid primary key default gen_random_uuid(),
 request_key uuid not null references vnext_private.original_ingress_receipts(request_key),
 version_ids uuid[] not null check(cardinality(version_ids) between 1 and 100 and array_position(version_ids,null) is null),
 recorded_at timestamptz not null default clock_timestamp()
);
-- Every administrative insert shares the writer's lock, so a committed revoke
-- cannot race through an old snapshot. Application roles have NO registry DML.
create function original_registry_candidate.seal_insert() returns trigger
language plpgsql set search_path='' as $$
declare n bigint; cap bigint;begin
 perform pg_advisory_xact_lock(hashtextextended('original-registry-approval-v1',0));
 cap:=case tg_table_name when 'authorities' then 1024 when 'versions' then 10000 when 'revocations' then 20000 else 100000 end;
 execute format('select count(*) from original_registry_candidate.%I',tg_table_name) into n;
 if n>=cap then raise exception 'ORIGINAL_REGISTRY_CAPACITY_REACHED';end if;
 new.recorded_at:=clock_timestamp();return new;
end $$;
do $$declare n text;begin
 foreach n in array array['authorities','versions','revocations','write_guards'] loop
  execute format('alter table original_registry_candidate.%I enable row level security',n);
  execute format('alter table original_registry_candidate.%I force row level security',n);
  execute format('revoke all on original_registry_candidate.%I from public,anon,authenticated,service_role',n);
  execute format('create trigger seal before insert on original_registry_candidate.%I for each row execute function original_registry_candidate.seal_insert()',n);
  execute format('create trigger immutable before update or delete on original_registry_candidate.%I for each row execute function vnext_private.immutable_record()',n);
 end loop;
end $$;
revoke all on function original_registry_candidate.seal_insert() from public,anon,authenticated,service_role;
-- Registry receipts include raw_sha256 (digits in the key), outside the old
-- Original snapshot serializer's closed key envelope. Do not alter that helper.
create function original_registry_candidate.canonical_v1(v jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare r text;begin
 case jsonb_typeof(v)
 when 'object' then
  if exists(select from jsonb_object_keys(v) k where k !~ '^[a-z_][a-z_0-9]*$') then raise exception 'REGISTRY_CANONICAL_KEY_INVALID';end if;
  select '{'||coalesce(string_agg(to_jsonb(k)::text||':'||original_registry_candidate.canonical_v1(x),',' order by k collate "C"),'')||'}'
   into r from jsonb_each(v) t(k,x);
 when 'array' then
  select '['||coalesce(string_agg(original_registry_candidate.canonical_v1(x),',' order by ord),'')||']' into r from jsonb_array_elements(v) with ordinality t(x,ord);
 when 'string','boolean','null' then r:=v::text;
 else raise exception 'REGISTRY_CANONICAL_TYPE_INVALID';end case;return r;
end $$;
revoke all on function original_registry_candidate.canonical_v1(jsonb) from public,anon,authenticated,service_role;

create function original_registry_candidate.require_version(p_id uuid) returns original_registry_candidate.versions
language plpgsql security definer set search_path='' as $$
declare v original_registry_candidate.versions;a original_registry_candidate.authorities;t timestamptz:=clock_timestamp();
 q jsonb;g jsonb;eb jsonb;lb jsonb;k text;receipt_hash text;e vnext_private.event_sources;l vnext_private.source_licenses;begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'ORIGINAL_REGISTRY_ISOLATION_UNSUPPORTED';end if;
 perform pg_advisory_xact_lock(hashtextextended('original-registry-approval-v1',0));
 t:=clock_timestamp();
 select * into v from original_registry_candidate.versions where id=p_id;
 if not found then raise exception 'ORIGINAL_REGISTRY_APPROVAL_MISSING';end if;
 if v.status<>'APPROVED' or v.valid_from>t or v.expires_at<=t or v.recorded_at>t then
  raise exception 'ORIGINAL_REGISTRY_APPROVAL_EXPIRED_OR_UNAPPROVED';
 end if;
 if exists(select from original_registry_candidate.revocations where version_id=v.id or authority_id in(v.source_authority,v.quality_authority,v.rights_authority))
 then raise exception 'ORIGINAL_REGISTRY_REVOKED';end if;
 for a in select * from original_registry_candidate.authorities where id in(v.source_authority,v.quality_authority,v.rights_authority) loop
  if a.status<>'APPROVED' or a.valid_from>t or a.expires_at<=t or a.recorded_at>t then raise exception 'ORIGINAL_REGISTRY_AUTHORITY_UNAPPROVED';end if;
 end loop;
 if (select kind from original_registry_candidate.authorities where id=v.source_authority) is distinct from 'SOURCE'
  or (select kind from original_registry_candidate.authorities where id=v.quality_authority) is distinct from 'QUALITY'
  or (select kind from original_registry_candidate.authorities where id=v.rights_authority) is distinct from 'RIGHTS'
 then raise exception 'ORIGINAL_REGISTRY_AUTHORITY_KIND_INVALID';end if;
 if v.record->>'schema' is distinct from 'ORIGINAL_APPROVED_REGISTRY_RECORD_1'
  or v.record->'evidence'->>'id' is distinct from v.evidence_id
  or encode(sha256(convert_to(original_registry_candidate.canonical_v1(v.record),'UTF8')),'hex')<>v.record_hash
 then raise exception 'ORIGINAL_REGISTRY_APPROVAL_BINDING_INVALID';end if;
 eb:=v.record->'evidence';lb:=v.record->'license';
 foreach k in array array['published_at','first_seen_at','available_at','as_of','last_verified_at','valid_until'] loop
  eb:=jsonb_set(eb,array[k],to_jsonb(vnext_private.original_iso_v1((eb->>k)::timestamptz)));
 end loop;
 lb:=jsonb_set(lb,'{reviewed_at}',to_jsonb(vnext_private.original_iso_v1((lb->>'reviewed_at')::timestamptz)));
 if lb->>'expires_at' is not null then lb:=jsonb_set(lb,'{expires_at}',to_jsonb(vnext_private.original_iso_v1((lb->>'expires_at')::timestamptz)));end if;
 if encode(sha256(convert_to(vnext_private.original_canonical_v1(eb),'UTF8')),'hex') is distinct from v.evidence_record_hash
  or encode(sha256(convert_to(vnext_private.original_canonical_v1(lb),'UTF8')),'hex') is distinct from v.license_record_hash
 then raise exception 'ORIGINAL_REGISTRY_APPROVAL_BINDING_INVALID';end if;
 select * into strict e from vnext_private.event_sources where id=v.evidence_id;
 select * into strict l from vnext_private.source_licenses where (id,source)=(e.license_id,e.source);
 if e.valid_until<=t or (l.expires_at is not null and l.expires_at<=t)
 then raise exception 'ORIGINAL_REGISTRY_SOURCE_OR_LICENSE_EXPIRED';end if;
 q:=v.record->'quality_review';g:=v.record->'rights_review';
 if q->>'purpose' is distinct from 'SOURCE_QUALITY' or g->>'purpose' is distinct from 'PRIVATE_STORAGE_DERIVATION'
  or q->>'result' is distinct from 'PASS' or g->>'result' is distinct from 'PASS'
  or q->>'expires_at' is null or g->>'expires_at' is null or q->>'reviewed_at' is null or g->>'reviewed_at' is null
 then raise exception 'ORIGINAL_REGISTRY_REVIEW_INVALID';end if;
 if not isfinite((q->>'expires_at')::timestamptz) or not isfinite((g->>'expires_at')::timestamptz)
  or (q->>'expires_at')::timestamptz<=t or (g->>'expires_at')::timestamptz<=t
 then raise exception 'ORIGINAL_REGISTRY_REVIEW_EXPIRED';end if;
 receipt_hash:=encode(sha256(convert_to(original_registry_candidate.canonical_v1((v.record->'receipt')-'id'),'UTF8')),'hex');
 if v.record->'receipt'->>'id' is distinct from receipt_hash
  or q->>'receipt_hash' is distinct from receipt_hash or g->>'receipt_hash' is distinct from receipt_hash
  or q->>'evidence_hash' is distinct from encode(sha256(convert_to(vnext_private.original_canonical_v1(v.record->'evidence'),'UTF8')),'hex')
  or g->>'evidence_hash' is distinct from q->>'evidence_hash'
  or q->>'license_hash' is distinct from encode(sha256(convert_to(vnext_private.original_canonical_v1(v.record->'license'),'UTF8')),'hex')
  or g->>'license_hash' is distinct from q->>'license_hash'
  or not isfinite((q->>'reviewed_at')::timestamptz) or not isfinite((g->>'reviewed_at')::timestamptz)
  or (q->>'reviewed_at')::timestamptz<greatest(e.available_at,l.reviewed_at)
  or (g->>'reviewed_at')::timestamptz<greatest(e.available_at,l.reviewed_at)
  or (q->>'reviewed_at')::timestamptz>e.last_verified_at or (g->>'reviewed_at')::timestamptz>e.last_verified_at
 then raise exception 'ORIGINAL_REGISTRY_REVIEW_BINDING_INVALID';end if;
 return v;
end $$;
revoke all on function original_registry_candidate.require_version(uuid) from public,anon,authenticated,service_role;
create function original_registry_candidate.check_commit() returns trigger
language plpgsql security definer set search_path='' as $$
declare v uuid;begin
 foreach v in array new.version_ids loop perform original_registry_candidate.require_version(v);end loop;
 return new;
end $$;
revoke all on function original_registry_candidate.check_commit() from public,anon,authenticated,service_role;
create constraint trigger registry_commit_guard after insert on original_registry_candidate.write_guards
 deferrable initially deferred for each row execute function original_registry_candidate.check_commit();

create function public.read_original_registry_source_candidate_v1(p_evidence_id text,p_version_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare v original_registry_candidate.versions;begin
 if p_evidence_id is null or p_evidence_id !~ '^[a-f0-9]{64}$' or p_version_id is null then raise exception 'ORIGINAL_REGISTRY_READ_ID_INVALID';end if;
 v:=original_registry_candidate.require_version(p_version_id);
 if v.evidence_id<>p_evidence_id then raise exception 'ORIGINAL_REGISTRY_READ_SCOPE_INVALID';end if;
 return v.record;
end $$;
revoke all on function public.read_original_registry_source_candidate_v1(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_original_registry_source_candidate_v1(text,uuid) to service_role;

create function public.ingest_vnext_original_registry_candidate_v1(p_request_key uuid,p_request jsonb,p_sources jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare s jsonb; e vnext_private.event_sources; l vnext_private.source_licenses;
 evidence_body jsonb; license_body jsonb; ids text[]; expected_ids text[]; version_ids uuid[]:='{}';
 approval original_registry_candidate.versions;answer jsonb;
begin
 if p_request_key is null then raise exception 'ORIGINAL_REGISTRY_EXPECTATIONS_INVALID';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'ORIGINAL_REGISTRY_ISOLATION_UNSUPPORTED';end if;
 perform pg_advisory_xact_lock(hashtextextended('original-registry-approval-v1',0));
 if jsonb_typeof(p_sources) is distinct from 'array' or octet_length(p_sources::text)>65536
  or jsonb_typeof(p_request) is distinct from 'object'
  or jsonb_typeof(p_request->'evidence_ids') is distinct from 'array'
 then raise exception 'ORIGINAL_REGISTRY_EXPECTATIONS_INVALID';end if;
 if jsonb_array_length(p_sources) not between 1 and 100
  or jsonb_array_length(p_request->'evidence_ids') not between 1 and 100
 then raise exception 'ORIGINAL_REGISTRY_EXPECTATIONS_INVALID';end if;
 for s in select * from jsonb_array_elements(p_sources) loop
  if jsonb_typeof(s) is distinct from 'object'
   or not(s ?& array['evidence_id','evidence_record_hash','license_record_hash','approval_id','registry_record_hash'])
  then raise exception 'ORIGINAL_REGISTRY_EXPECTATIONS_INVALID';end if;
  if (select count(*) from jsonb_object_keys(s))<>5
   or exists(select from jsonb_each(s) v where jsonb_typeof(v.value) is distinct from 'string'
    or (v.key<>'approval_id' and v.value#>>'{}' !~ '^[a-f0-9]{64}$'))
   or s->>'approval_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  then raise exception 'ORIGINAL_REGISTRY_EXPECTATIONS_INVALID';end if;
 end loop;
 if exists(select from jsonb_array_elements(p_request->'evidence_ids') v
  where jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~ '^[a-f0-9]{64}$')
 then raise exception 'ORIGINAL_REGISTRY_EXPECTATIONS_INVALID';end if;
 select array_agg(v->>'evidence_id' order by (v->>'evidence_id') collate "C") into ids from jsonb_array_elements(p_sources) v;
 select array_agg(v order by v collate "C") into expected_ids from jsonb_array_elements_text(p_request->'evidence_ids') v;
 if ids is distinct from expected_ids or cardinality(ids)<>(select count(distinct v) from unnest(ids) v)
 then raise exception 'ORIGINAL_REGISTRY_EVIDENCE_SET_NOT_EXACT';end if;
 -- Existing append-only triggers forbid replacement/deletion. No caller-supplied
 -- quality='PASS', raw source, timestamp or License flag is accepted by this RPC.
 for s in select * from jsonb_array_elements(p_sources) loop
  select * into e from vnext_private.event_sources where id=s->>'evidence_id';
  if not found then raise exception 'ORIGINAL_REGISTRY_REGISTERED_EVIDENCE_MISSING';end if;
  select * into strict l from vnext_private.source_licenses where (id,source)=(e.license_id,e.source);
  evidence_body:=jsonb_build_object('id',e.id,'symbol',e.symbol,'kind',e.kind,'source',e.source,'source_ref',e.source_ref,
   'license_id',e.license_id,'published_at',vnext_private.original_iso_v1(e.published_at),
   'first_seen_at',vnext_private.original_iso_v1(e.first_seen_at),'available_at',vnext_private.original_iso_v1(e.available_at),
   'as_of',vnext_private.original_iso_v1(e.as_of),'last_verified_at',vnext_private.original_iso_v1(e.last_verified_at),
   'valid_until',vnext_private.original_iso_v1(e.valid_until),'snapshot_hash',e.snapshot_hash,
   'classification',e.classification,'quality',e.quality,'relevant',e.relevant,'summary',e.summary);
  license_body:=jsonb_build_object('id',l.id,'source',l.source,'document_url',l.document_url,
   'reviewed_at',vnext_private.original_iso_v1(l.reviewed_at),
   'expires_at',case when l.expires_at is null then null else vnext_private.original_iso_v1(l.expires_at) end,
   'storage',l.storage_allowed,'derived',l.derived_allowed,'commercial',l.commercial_allowed,
   'redistribution',l.redistribution_allowed,'attribution',l.attribution);
  if encode(sha256(convert_to(vnext_private.original_canonical_v1(evidence_body),'UTF8')),'hex') is distinct from s->>'evidence_record_hash'
   or encode(sha256(convert_to(vnext_private.original_canonical_v1(license_body),'UTF8')),'hex') is distinct from s->>'license_record_hash'
  then raise exception 'ORIGINAL_REGISTRY_ROW_VERSION_MISMATCH';end if;
  approval:=original_registry_candidate.require_version((s->>'approval_id')::uuid);
  if approval.evidence_id<>e.id or approval.record_hash<>s->>'registry_record_hash'
   or approval.evidence_record_hash<>s->>'evidence_record_hash' or approval.license_record_hash<>s->>'license_record_hash'
  then raise exception 'ORIGINAL_REGISTRY_APPROVAL_BINDING_INVALID';end if;
  version_ids:=array_append(version_ids,approval.id);
 end loop;
 -- Reuses ALL original lineage/cutoff/required-kinds/rights/UNKNOWN-only rules,
 -- exact-set sealing and immutable idempotent receipt. Any error rolls back.
 answer:=public.ingest_vnext_original_observation_candidate_v1(p_request_key,p_request);
 -- Replays add only a private eligibility-attempt guard, never another Original
 -- Observation/link/receipt. Deferred expiry failure rolls ALL new writes back.
 insert into original_registry_candidate.write_guards(request_key,version_ids) values(p_request_key,version_ids);
 return answer;
end $$;
revoke all on function public.ingest_vnext_original_registry_candidate_v1(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ingest_vnext_original_registry_candidate_v1(uuid,jsonb,jsonb) to service_role;
-- The previous server-only raw entry would bypass approval/revocation checks.
-- Keep its body/data intact, but permit it only through this definer wrapper.
revoke execute on function public.ingest_vnext_original_observation_candidate_v1(uuid,jsonb) from service_role;
commit;
