-- UNDEPLOYED CANDIDATE ONLY. FreshDB controls, NOT a Supabase migration.
-- Requires the three existing projection/runtime/original-ingress candidates.
-- Narrow adapter for ALREADY registered, independently approved Evidence only.
-- Does NOT register a source, License, quality approval or publication right.
-- SOURCE ONBOARDING AUTHORITY IS NOT IMPLEMENTED. The private registeredSource
-- adapter checks bytes against externally supplied pins/review trust inputs;
-- this SQL row hash proves existing row identity, NOT origin/truth/approval.
-- Neither component is a formal V1 publisher or establishes approved production
-- data. The ONLY write path is the original research-only Observation. Version
-- checks below intentionally remain BEFORE its atomic write, never after it.
-- No new tables/schema/policies. CREATE (not REPLACE) prevents silent re-install.
begin;
create function public.ingest_vnext_original_registry_candidate_v1(p_request_key uuid,p_request jsonb,p_sources jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare s jsonb; e vnext_private.event_sources; l vnext_private.source_licenses;
 evidence_body jsonb; license_body jsonb; ids text[]; expected_ids text[];
begin
 if jsonb_typeof(p_sources) is distinct from 'array' or octet_length(p_sources::text)>65536
  or jsonb_typeof(p_request) is distinct from 'object'
  or jsonb_typeof(p_request->'evidence_ids') is distinct from 'array'
 then raise exception 'ORIGINAL_REGISTRY_EXPECTATIONS_INVALID';end if;
 if jsonb_array_length(p_sources) not between 1 and 100
  or jsonb_array_length(p_request->'evidence_ids') not between 1 and 100
 then raise exception 'ORIGINAL_REGISTRY_EXPECTATIONS_INVALID';end if;
 for s in select * from jsonb_array_elements(p_sources) loop
  if jsonb_typeof(s) is distinct from 'object'
   or not(s ?& array['evidence_id','evidence_record_hash','license_record_hash'])
  then raise exception 'ORIGINAL_REGISTRY_EXPECTATIONS_INVALID';end if;
  if (select count(*) from jsonb_object_keys(s))<>3
   or exists(select from jsonb_each(s) v where jsonb_typeof(v.value) is distinct from 'string' or v.value#>>'{}' !~ '^[a-f0-9]{64}$')
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
 end loop;
 -- Reuses ALL original lineage/cutoff/required-kinds/rights/UNKNOWN-only rules,
 -- exact-set sealing and immutable idempotent receipt. Any error rolls back.
 return public.ingest_vnext_original_observation_candidate_v1(p_request_key,p_request);
end $$;
revoke all on function public.ingest_vnext_original_registry_candidate_v1(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ingest_vnext_original_registry_candidate_v1(uuid,jsonb,jsonb) to service_role;
commit;
