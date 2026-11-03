-- CANDIDATE ONLY. NO PRODUCTION APPLICATION / SOURCE ADMISSION AUTHORIZED.
-- Separate from OriginalObservation / VNext registries. No seeds, Auth changes,
-- old-row edits, member RPC grants, schedule, or existing service_role ACL changes.
-- One public-schema, SERVICE-ONLY wrapper uses the existing server Supabase RPC
-- transport. The private schema stays unexposed; no new DB credential is needed.
-- Install only as the trusted DB owner after independent approval. Registry
-- intake/review is an offline administrative trust boundary, NOT this RPC.
-- Creating this schema twice deliberately fails atomically (duplicate guard).
begin;
create schema v1_actual_candidate;
revoke all on schema v1_actual_candidate from public,anon,authenticated,service_role;

create table v1_actual_candidate.authorities (
 id uuid primary key default gen_random_uuid(),
 authority_ref text not null unique check(length(authority_ref) between 1 and 160),
 kind text not null check(kind in ('SOURCE','INDEPENDENT_REVIEW','INTERNAL_RIGHTS')),
 status text not null default 'PENDING' check(status in ('APPROVED','PENDING','REJECTED')),
 document_ref text not null check(document_ref like 'https://%'),
 document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
 valid_from timestamptz not null, valid_until timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 record_sha256 text not null default repeat('0',64),
 check(valid_from<valid_until)
);
create table v1_actual_candidate.source_revisions (
 id uuid primary key default gen_random_uuid(),
 authority_id uuid not null references v1_actual_candidate.authorities(id),
 provider text not null check(provider ~ '^[A-Z0-9_:-]{1,80}$'),
 symbol text not null check(symbol ~ '^[0-9]{4,6}$'),
 source_kind text not null check(source_kind in ('ISSUER_FILING','EXCHANGE_FILING')),
 source_format text not null default 'UNKNOWN'
  check(source_format in ('SUPPORTED_INLINE_XBRL_ONLY','ISSUER_PDF_DIRECT_QUARTER_V1','PDF_UNSUPPORTED','UNKNOWN')),
 source_ref text not null check(source_ref ~ '^https://[^/?#@[:space:]]+([/?#]|$)'
  and source_ref !~* '[?&][^=]*(token|secret|key|auth|email)[^=]*='),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_bytes bigint not null check(source_bytes between 1 and 8000000),
 receipt_document_ref text not null check(length(receipt_document_ref)>0),
 receipt_document_sha256 text not null check(receipt_document_sha256 ~ '^[a-f0-9]{64}$'),
 source_version_ref text, version_status text not null default 'UNKNOWN'
  check(version_status in ('EXACT','UNKNOWN')),
 first_seen_at timestamptz not null, available_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 record_sha256 text not null default repeat('0',64),
 check(first_seen_at<=available_at)
);
create table v1_actual_candidate.actual_rows (
 id uuid primary key default gen_random_uuid(),
 source_revision_id uuid not null references v1_actual_candidate.source_revisions(id),
 symbol text not null check(symbol ~ '^[0-9]{4,6}$'),
 fiscal_year integer not null check(fiscal_year between 1900 and 2200),
 fiscal_quarter integer not null check(fiscal_quarter between 1 and 4),
 period_start date, period_end date, period_basis text,
 profile text, revenue_definition text, accounting_basis text, consolidation text,
 currency text, revenue_unit text, revenue_scale integer, revenue_resolution_twd numeric,
 share_class text, eps_basis text, eps_unit text,
 revenue_namespace text, revenue_concept text, eps_namespace text, eps_concept text,
 revenue_locator text, eps_locator text,
 -- A separate native PDF measurement dialect. No invented XBRL QName/context.
 -- Row-hash-bound independent review is still mandatory; the parser is NOT
 -- an approval authority and this JSON cannot grant source or member rights.
 pdf_measurement jsonb,
 revenue_actual numeric, eps_actual numeric,
 recorded_at timestamptz not null default clock_timestamp(),
 record_sha256 text not null default repeat('0',64),
 unique(source_revision_id,id)
);
-- Missing / UNKNOWN observations may be retained privately. They NEVER qualify
-- for canonical append. A hash is integrity, not proof of the document's origin.
create table v1_actual_candidate.independent_reviews (
 id uuid primary key default gen_random_uuid(),
 source_revision_id uuid not null,
 row_id uuid not null unique,
 foreign key(source_revision_id,row_id) references v1_actual_candidate.actual_rows(source_revision_id,id),
 authority_id uuid not null references v1_actual_candidate.authorities(id),
 source_record_sha256 text not null check(source_record_sha256 ~ '^[a-f0-9]{64}$'),
 row_record_sha256 text not null check(row_record_sha256 ~ '^[a-f0-9]{64}$'),
 status text not null default 'PENDING' check(status in ('APPROVED','PENDING','REJECTED')),
 document_ref text not null check(length(document_ref)>0),
 document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
 announced_at timestamptz, announcement_precision text,
 announcement_source_ref text, announcement_document_sha256 text,
 announcement_version_ref text,
 reviewed_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 record_sha256 text not null default repeat('0',64)
);
create table v1_actual_candidate.internal_rights (
 id uuid primary key default gen_random_uuid(),
 source_revision_id uuid not null unique references v1_actual_candidate.source_revisions(id),
 authority_id uuid not null references v1_actual_candidate.authorities(id),
 source_record_sha256 text not null check(source_record_sha256 ~ '^[a-f0-9]{64}$'),
 source_ref text not null,
 purpose text not null check(purpose='INTERNAL_CANONICAL_ACTUAL_STORAGE'),
 status text not null default 'PENDING' check(status in ('APPROVED','PENDING','REJECTED')),
 document_ref text not null check(length(document_ref)>0),
 document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
 attribution text not null check(length(attribution)>0),
 reviewed_at timestamptz not null, expires_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 record_sha256 text not null default repeat('0',64)
);
create table v1_actual_candidate.revocations (
 id uuid primary key default gen_random_uuid(),
 source_revision_id uuid references v1_actual_candidate.source_revisions(id),
 row_id uuid references v1_actual_candidate.actual_rows(id),
 review_id uuid references v1_actual_candidate.independent_reviews(id),
 rights_id uuid references v1_actual_candidate.internal_rights(id),
 authority_id uuid references v1_actual_candidate.authorities(id),
 reason text not null check(length(reason)>0),
 document_ref text not null check(length(document_ref)>0),
 document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 record_sha256 text not null default repeat('0',64),
 check(num_nonnulls(source_revision_id,row_id,review_id,rights_id,authority_id)=1)
);
create index on v1_actual_candidate.revocations(source_revision_id);
create index on v1_actual_candidate.revocations(row_id);
create index on v1_actual_candidate.revocations(review_id);
create index on v1_actual_candidate.revocations(rights_id);
create index on v1_actual_candidate.revocations(authority_id);
create table v1_actual_candidate.canonical_audit (
 id uuid primary key default gen_random_uuid(),
 source_revision_id uuid not null,
 row_id uuid not null unique,
 foreign key(source_revision_id,row_id) references v1_actual_candidate.actual_rows(source_revision_id,id),
 review_id uuid not null references v1_actual_candidate.independent_reviews(id),
 rights_id uuid not null references v1_actual_candidate.internal_rights(id),
 earnings_event_id uuid not null unique references public.earnings_events(id),
 canonical_sha256 text not null check(canonical_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 record_sha256 text not null default repeat('0',64)
);

create function v1_actual_candidate.seal_insert() returns trigger
language plpgsql set search_path='' as $$
begin
 -- Same lock as writer: revocation and approval inserts cannot race a write.
 perform pg_advisory_xact_lock(hashtextextended('v1-actual-canonical-candidate',0));
 new.recorded_at:=clock_timestamp();
 new.record_sha256:=encode(sha256(convert_to((to_jsonb(new)-'record_sha256')::text,'UTF8')),'hex');
 return new;
end $$;
create function v1_actual_candidate.immutable_record() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'V1_ACTUAL_APPEND_ONLY'; end $$;
do $$ declare n text; begin
 foreach n in array array['authorities','source_revisions','actual_rows','independent_reviews','internal_rights','revocations','canonical_audit'] loop
  execute format('alter table v1_actual_candidate.%I enable row level security',n);
  execute format('alter table v1_actual_candidate.%I force row level security',n);
  execute format('revoke all on v1_actual_candidate.%I from public,anon,authenticated,service_role',n);
  execute format('create trigger seal_insert before insert on v1_actual_candidate.%I for each row execute function v1_actual_candidate.seal_insert()',n);
  execute format('create trigger immutable before update or delete on v1_actual_candidate.%I for each row execute function v1_actual_candidate.immutable_record()',n);
 end loop;
end $$;
revoke all on function v1_actual_candidate.seal_insert() from public,anon,authenticated,service_role;
revoke all on function v1_actual_candidate.immutable_record() from public,anon,authenticated,service_role;

-- Internal ID-only core, not an exposed Data API schema. SECURITY DEFINER
-- is deliberately confined to this unexposed schema. The DB owner loads sealed
-- administrative approvals; the service caller has NO registry DML privileges.
-- No end-user auth.uid/JWT/metadata claim grants this internal capability.
create function v1_actual_candidate.append_actual_v1(p_source_revision_id uuid,p_row_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 s v1_actual_candidate.source_revisions; r v1_actual_candidate.actual_rows;
 v v1_actual_candidate.independent_reviews; g v1_actual_candidate.internal_rights;
 a v1_actual_candidate.authorities; audit v1_actual_candidate.canonical_audit;
 e public.earnings_events; body jsonb; digest text; event_id uuid; audit_id uuid;
 at_time timestamptz; expected_start date; expected_end date; ns text; p jsonb; m jsonb; metric text;
begin
 if p_source_revision_id is null or p_row_id is null then raise exception 'ACTUAL_ID_REQUIRED'; end if;
 -- Under a stale repeatable-read snapshot a just-committed revocation could be
 -- invisible. This deliberately small RPC requires fresh statement snapshots.
 if current_setting('transaction_isolation') is distinct from 'read committed' then raise exception 'ACTUAL_ISOLATION_UNSUPPORTED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('v1-actual-canonical-candidate',0));
 at_time:=clock_timestamp();
 select * into s from v1_actual_candidate.source_revisions where id=p_source_revision_id;
 if not found then raise exception 'ACTUAL_SOURCE_MISSING'; end if;
 select * into r from v1_actual_candidate.actual_rows where id=p_row_id and source_revision_id=s.id;
 if not found then raise exception 'ACTUAL_ROW_MISSING'; end if;
 if (s.source_format in ('SUPPORTED_INLINE_XBRL_ONLY','ISSUER_PDF_DIRECT_QUARTER_V1')) is distinct from true
 then raise exception 'ACTUAL_SOURCE_FORMAT_UNSUPPORTED'; end if;
 select * into v from v1_actual_candidate.independent_reviews where row_id=r.id and source_revision_id=s.id;
 if not found then raise exception 'ACTUAL_REVIEW_MISSING'; end if;
 select * into g from v1_actual_candidate.internal_rights where source_revision_id=s.id;
 if not found then raise exception 'ACTUAL_INTERNAL_RIGHTS_MISSING'; end if;
 -- Registry authority is independently installed by DB administration, never
 -- accepted from RPC arguments or shared with OriginalObservation authority.
 for a in select * from v1_actual_candidate.authorities where id in(s.authority_id,v.authority_id,g.authority_id) loop
  if a.status is distinct from 'APPROVED' or a.valid_from>at_time or a.valid_until<=at_time
   or a.recorded_at>at_time then raise exception 'ACTUAL_AUTHORITY_UNAPPROVED'; end if;
 end loop;
 if (select kind from v1_actual_candidate.authorities where id=s.authority_id) is distinct from 'SOURCE'
  or (select kind from v1_actual_candidate.authorities where id=v.authority_id) is distinct from 'INDEPENDENT_REVIEW'
  or (select kind from v1_actual_candidate.authorities where id=g.authority_id) is distinct from 'INTERNAL_RIGHTS'
  or s.authority_id=v.authority_id or s.authority_id=g.authority_id or v.authority_id=g.authority_id
 then raise exception 'ACTUAL_INDEPENDENT_AUTHORITY_REQUIRED'; end if;
 if exists(select from v1_actual_candidate.revocations x where x.source_revision_id=s.id or x.row_id=r.id
  or x.review_id=v.id or x.rights_id=g.id or x.authority_id in(s.authority_id,v.authority_id,g.authority_id))
 then raise exception 'ACTUAL_REVOKED'; end if;
 if v.status is distinct from 'APPROVED' or g.status is distinct from 'APPROVED'
  or v.source_record_sha256 is distinct from s.record_sha256 or v.row_record_sha256 is distinct from r.record_sha256
  or g.source_record_sha256 is distinct from s.record_sha256 or g.source_ref is distinct from s.source_ref
  or g.purpose is distinct from 'INTERNAL_CANONICAL_ACTUAL_STORAGE'
  or v.reviewed_at<greatest(s.recorded_at,r.recorded_at) or v.reviewed_at>v.recorded_at
  or g.reviewed_at<s.recorded_at or g.reviewed_at>g.recorded_at or g.expires_at<=at_time
 then raise exception 'ACTUAL_APPROVAL_OR_RIGHTS_INVALID'; end if;
 if s.version_status is distinct from 'EXACT' or s.source_version_ref is null
  or upper(btrim(s.source_version_ref)) in ('','UNKNOWN','UNVERIFIED')
  or s.available_at>s.recorded_at or r.recorded_at<s.recorded_at
  or s.recorded_at>at_time or r.recorded_at>at_time or v.recorded_at>at_time or g.recorded_at>at_time
  or r.symbol is distinct from s.symbol then raise exception 'ACTUAL_SOURCE_VERSION_OR_RECEIPT_INVALID'; end if;
 expected_start:=make_date(r.fiscal_year,(r.fiscal_quarter-1)*3+1,1);
 expected_end:=(expected_start+interval '3 months'-interval '1 day')::date;
 if r.period_start is distinct from expected_start or r.period_end is distinct from expected_end
  or r.period_basis is distinct from 'DIRECT_STANDALONE_QUARTER'
  or r.accounting_basis is distinct from 'IFRS_AS_REPORTED'
  or (r.consolidation in ('CONSOLIDATED','INDIVIDUAL')) is distinct from true
  or r.currency is distinct from 'TWD' or r.revenue_unit is distinct from 'TWD'
  or r.revenue_scale is distinct from 1 or r.revenue_resolution_twd is null
  or r.revenue_resolution_twd::text in ('NaN','Infinity','-Infinity') or r.revenue_resolution_twd<=0
  or r.share_class is distinct from 'COMMON_SHARE' or (r.eps_basis in ('BASIC','DILUTED')) is distinct from true
  or r.eps_unit is distinct from 'TWD_PER_COMMON_SHARE'
  or r.revenue_locator is null or btrim(r.revenue_locator)='' or r.eps_locator is null or btrim(r.eps_locator)=''
 then raise exception 'ACTUAL_MEASUREMENT_BASIS_UNPROVEN'; end if;
 if s.source_format='ISSUER_PDF_DIRECT_QUARTER_V1' then
  -- Only the exact direct-quarter parser projection is understood. Unknown
  -- announcements/versions/rights still fail the SAME shared checks below.
  p:=r.pdf_measurement;
  if p is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16000
   or (select array_agg(k order by k) from jsonb_object_keys(p) k) is distinct from
    array['contract','descriptor_sha256','eps','parser_result_sha256','period_end','period_start','receipt_sha256','revenue','source_sha256','symbol']::text[]
   or p->>'contract' is distinct from 'ISSUER_PDF_DIRECT_QUARTER_MEASUREMENT_V1'
   or p->>'symbol' is distinct from s.symbol or p->>'source_sha256' is distinct from s.source_sha256
   or p->>'period_start' is distinct from r.period_start::text or p->>'period_end' is distinct from r.period_end::text
   or (p->>'parser_result_sha256' ~ '^[a-f0-9]{64}$') is distinct from true
   or (p->>'descriptor_sha256' ~ '^[a-f0-9]{64}$') is distinct from true
   or p->>'receipt_sha256' is distinct from s.receipt_document_sha256
   or r.revenue_namespace is not null or r.eps_namespace is not null
   or r.revenue_concept is not null or r.eps_concept is not null
   or r.profile is distinct from 'NONFINANCIAL_IFRS' or r.revenue_definition is distinct from 'IFRS_REVENUE'
   or r.consolidation is distinct from 'CONSOLIDATED' or r.eps_basis is distinct from 'BASIC'
   or r.symbol in ('2881','2882','2884','2885','2886','2891','2892')
  then raise exception 'ACTUAL_PDF_MEASUREMENT_UNPROVEN'; end if;
  foreach metric in array array['revenue','eps'] loop
   m:=p->metric;
   if jsonb_typeof(m) is distinct from 'object' then raise exception 'ACTUAL_PDF_MEASUREMENT_UNPROVEN'; end if;
   if (select array_agg(k order by k) from jsonb_object_keys(m) k) is distinct from
     array['bbox','page','period_basis','resolution_decimal','unit','value_decimal']::text[]
    or (m->>'period_basis' in ('DIRECT_THREE_MONTHS','DIRECT_SINGLE_QUARTER_AS_REPORTED')) is distinct from true
    or m->>'unit' is distinct from (case metric when 'revenue' then 'TWD' else 'TWD/ordinary_share' end)
    or jsonb_typeof(m->'value_decimal') is distinct from 'string'
    or jsonb_typeof(m->'resolution_decimal') is distinct from 'string'
    or length(m->>'value_decimal')>64 or length(m->>'resolution_decimal')>64
    or (m->>'value_decimal' ~ '^-?[0-9]{1,40}(\.[0-9]{1,12})?(E[+-]?[0-9]{1,2})?$') is distinct from true
    or (m->>'resolution_decimal' ~ '^[0-9]{1,40}(\.[0-9]{1,12})?(E[+-]?[0-9]{1,2})?$') is distinct from true
    or (m->>'page' ~ '^[0-9]{1,3}$') is distinct from true
    or jsonb_typeof(m->'page') is distinct from 'number'
    or jsonb_typeof(m->'bbox') is distinct from 'array'
   then raise exception 'ACTUAL_PDF_MEASUREMENT_UNPROVEN'; end if;
   if (m->>'value_decimal')::numeric is distinct from (case metric when 'revenue' then r.revenue_actual else r.eps_actual end)
    or (m->>'resolution_decimal')::numeric<=0 or (m->>'resolution_decimal')::numeric<0.000000000001
    or (m->>'page')::integer not between 1 and 160 or jsonb_array_length(m->'bbox')<>4
    or (case metric when 'revenue' then r.revenue_locator else r.eps_locator end) is distinct from 'PDF_PAGE:'||(m->>'page')
   then raise exception 'ACTUAL_PDF_MEASUREMENT_UNPROVEN'; end if;
   if exists(select from jsonb_array_elements(m->'bbox') b where jsonb_typeof(b) is distinct from 'number'
     or length(b::text)>32 or b::text !~ '^[0-9]+(\.[0-9]+)?$')
   then raise exception 'ACTUAL_PDF_MEASUREMENT_UNPROVEN'; end if;
   if (m->'bbox'->>0)::numeric>=(m->'bbox'->>2)::numeric
    or (m->'bbox'->>1)::numeric>=(m->'bbox'->>3)::numeric
   then raise exception 'ACTUAL_PDF_MEASUREMENT_UNPROVEN'; end if;
  end loop;
  if (p->'revenue'->>'resolution_decimal')::numeric is distinct from r.revenue_resolution_twd
  then raise exception 'ACTUAL_PDF_MEASUREMENT_UNPROVEN'; end if;
 else
 if r.pdf_measurement is not null then raise exception 'ACTUAL_SOURCE_FORMAT_UNSUPPORTED'; end if;
 ns:=r.eps_namespace;
 if (ns in ('http://xbrl.ifrs.org/taxonomy/2017-03-09/ifrs-full','https://xbrl.ifrs.org/taxonomy/2025-03-27/ifrs-full')) is distinct from true
  or r.eps_concept is distinct from (case r.eps_basis when 'BASIC' then 'BasicEarningsLossPerShare' else 'DilutedEarningsLossPerShare' end)
 then raise exception 'ACTUAL_EPS_CONCEPT_MISMATCH'; end if;
 if r.profile='NONFINANCIAL_IFRS' then
  if r.revenue_definition is distinct from 'IFRS_REVENUE' or r.revenue_concept is distinct from 'Revenue'
   or r.symbol in ('2881','2882','2884','2885','2886','2891','2892')
   or (r.revenue_namespace in ('http://xbrl.ifrs.org/taxonomy/2017-03-09/ifrs-full','https://xbrl.ifrs.org/taxonomy/2025-03-27/ifrs-full')) is distinct from true
  then raise exception 'ACTUAL_REVENUE_DEFINITION_MISMATCH'; end if;
 elsif r.profile='FINANCIAL_TIFRS_FH' then
  if r.revenue_definition is distinct from 'FINANCIAL_NET_REVENUE' or r.revenue_concept is distinct from 'NetIncomeLoss'
   or r.consolidation is distinct from 'CONSOLIDATED'
   or (r.revenue_namespace in ('http://www.xbrl.org/tifrs/bsci/fh/2020-06-30','http://www.xbrl.org/tifrs/bsci/fh/2025-06-30','http://www.xbrl.org/tifrs/bsci/fh/2026-03-31')) is distinct from true
   or (r.symbol in ('2881','2882','2884','2885','2886','2891','2892')) is distinct from true
  then raise exception 'ACTUAL_FINANCIAL_REVENUE_NOT_GENERIC'; end if;
  -- The existing loader ignores raw_payload. A typed flag cannot prevent it
  -- treating revenue_actual as generic revenue after a future consensus join.
  -- Keep the financial fact PRIVATE until a separately reviewed metric and
  -- comparable financial-consensus policy exists. No caller can override this.
  raise exception 'ACTUAL_FINANCIAL_CANONICAL_METHOD_REVIEW_REQUIRED';
 else raise exception 'ACTUAL_PROFILE_UNPROVEN'; end if;
 end if;
 if r.revenue_actual is null or r.eps_actual is null
  or r.revenue_actual::text in ('NaN','Infinity','-Infinity') or r.eps_actual::text in ('NaN','Infinity','-Infinity')
  or abs(r.revenue_actual)>9007199254740991 or abs(r.eps_actual)>9007199254740991
  or abs(r.eps_actual)>=1000000000000 -- canonical NUMERIC(18,6): 12 integer digits
  or round(r.revenue_actual,4) is distinct from r.revenue_actual or round(r.eps_actual,6) is distinct from r.eps_actual
 then raise exception 'ACTUAL_VALUES_UNREPRESENTABLE'; end if;
 -- The existing loader reads JSON numbers, not decimal strings. Validate that
 -- its Number serialization preserves the reported decimal, not just that the
 -- SQL numeric column can store it. This is a representation contract, NOT an
 -- EPS/revenue investment threshold. Cast only after finite/range checks above.
 if r.revenue_actual is distinct from (r.revenue_actual::double precision)::text::numeric
  or r.eps_actual is distinct from (r.eps_actual::double precision)::text::numeric
 then raise exception 'ACTUAL_VALUES_UNREPRESENTABLE'; end if;
 if v.announced_at is null or v.announcement_precision is distinct from 'SECOND'
  or date_trunc('second',v.announced_at) is distinct from v.announced_at
  or v.announcement_source_ref is null or v.announcement_source_ref !~ '^https://[^/?#@[:space:]]+([/?#]|$)'
  or v.announcement_document_sha256 is null or v.announcement_document_sha256 !~ '^[a-f0-9]{64}$'
  or v.announcement_version_ref is distinct from s.source_version_ref
  or v.announced_at<((r.period_end+1)::timestamp at time zone 'Asia/Taipei')
  or v.announced_at>s.first_seen_at or v.announced_at>at_time
 then raise exception 'ACTUAL_EXACT_ANNOUNCEMENT_REQUIRED'; end if;
 body:=jsonb_build_object('contract','V1_ACTUAL_CANONICAL_CANDIDATE_V1','actual_only',true,
  'v1_ready',false,'member_publication_approved',false,
  'source_revision_id',s.id,'row_id',r.id,'source_sha256',s.source_sha256,'source_record_sha256',s.record_sha256,
  'row_record_sha256',r.record_sha256,'source_version_ref',s.source_version_ref,'source_format',s.source_format,
  'first_seen_at',s.first_seen_at,'source_available_at',s.available_at,'registry_recorded_at',s.recorded_at,
  'review_id',v.id,'review_record_sha256',v.record_sha256,'rights_id',g.id,'rights_record_sha256',g.record_sha256,
  'rights_scope','INTERNAL_CANONICAL_ACTUAL_STORAGE_ONLY','attribution',g.attribution,
  'announcement_proof',jsonb_build_object('source_ref',v.announcement_source_ref,'document_sha256',v.announcement_document_sha256,'precision',v.announcement_precision),
  'measurement',to_jsonb(r)-'id'-'source_revision_id'-'recorded_at'-'record_sha256');
 select * into audit from v1_actual_candidate.canonical_audit where row_id=r.id;
 if found then
  select * into e from public.earnings_events where id=audit.earnings_event_id;
  if not found or e.raw_payload is distinct from body
   or audit.canonical_sha256 is distinct from encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex')
  then raise exception 'ACTUAL_CANONICAL_CONFLICT'; end if;
  event_id:=e.id; audit_id:=audit.id;
 else
  -- Never join/overwrite an existing same-quarter expectation row. The original
  -- canonical unique key remains authoritative, including concurrent writers.
  if exists(select from public.earnings_events where provider=s.provider and symbol=s.symbol
   and fiscal_period=r.fiscal_year::text||'-Q'||r.fiscal_quarter::text and announced_at=v.announced_at)
  then raise exception 'ACTUAL_CANONICAL_CONFLICT'; end if;
  insert into public.earnings_events(provider,symbol,fiscal_period,announced_at,revenue_actual,eps_actual,
   revenue_consensus,eps_consensus,guidance_direction,surprise_score,source_ref,raw_payload,created_at)
  values(s.provider,s.symbol,r.fiscal_year::text||'-Q'||r.fiscal_quarter::text,v.announced_at,r.revenue_actual,r.eps_actual,
   null,null,null,null,s.source_ref,body,clock_timestamp()) returning * into e;
  digest:=encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex'); event_id:=e.id;
  insert into v1_actual_candidate.canonical_audit(source_revision_id,row_id,review_id,rights_id,earnings_event_id,canonical_sha256)
  values(s.id,r.id,v.id,g.id,e.id,digest) returning id into audit_id;
 end if;
 return jsonb_build_object('contract','V1_ACTUAL_CANONICAL_CANDIDATE_V1','status',case when audit.id is null then 'INSERTED' else 'REPLAY' end,
  'source_revision_id',s.id,'row_id',r.id,'earnings_event_id',event_id,'audit_id',audit_id,
  'actual_only',true,'v1_ready',false,'member_publication_approved',false);
end $$;
revoke all on function v1_actual_candidate.append_actual_v1(uuid,uuid) from public,anon,authenticated,service_role;
-- Public SCHEMA is not PUBLIC EXECUTE. The fixed service-only wrapper is usable
-- by an existing Edge Supabase SDK without exposing the private registry/schema.
create function public.append_v1_canonical_actual_candidate_v1(p_source_revision_id uuid,p_row_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 return v1_actual_candidate.append_actual_v1(p_source_revision_id,p_row_id);
end $$;
revoke all on function public.append_v1_canonical_actual_candidate_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.append_v1_canonical_actual_candidate_v1(uuid,uuid) to service_role;
-- Existing service-role table privileges remain unchanged: this candidate does
-- not globally prohibit separately privileged direct SQL. No private DML grant.
comment on schema v1_actual_candidate is 'UNAPPROVED isolated Actual-only canonical writer candidate; no sources/approvals seeded; not OriginalObservation authority';
comment on function v1_actual_candidate.append_actual_v1(uuid,uuid) is 'ID-only internal candidate. Registry approval is not member publication; revoked retries deny; existing canonical rows never updated or deleted.';
comment on function public.append_v1_canonical_actual_candidate_v1(uuid,uuid) is 'UNAPPROVED service_role-only candidate wrapper. Two IDs only; no raw values, quality or rights arguments; no member EXECUTE.';
commit;
