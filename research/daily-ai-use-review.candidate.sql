-- Additive AS_OF-only assessment of the actual retained facts and own analysis.
-- No source license is manufactured. No record is inserted by this migration.
-- Requires daily-ai-member.candidate.sql; legacy forward rights are untouched.
begin;
create table vnext_private.ai_research_use_reviews(
 id uuid primary key default gen_random_uuid(),
 edition_id text not null references vnext_private.ai_research_editions(id),
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 use_scope text not null check(use_scope='OWN_ANALYSIS_ONLY'),
 raw_redistribution boolean not null check(raw_redistribution=false),
 basis text not null check(basis in('OPEN_LICENSE','FACT_ONLY_OWN_ANALYSIS','EXPLICIT_PERMISSION')),
 quality text not null check(quality in('PASS','FAIL','PENDING')),
 reviewer_ref text not null check(length(btrim(reviewer_ref)) between 1 and 200),
 review_document_hash text not null check(review_document_hash ~ '^[a-f0-9]{64}$'),
 source_mapping_document_hash text not null check(source_mapping_document_hash ~ '^[a-f0-9]{64}$'),
 terms_document_hash text not null check(terms_document_hash ~ '^[a-f0-9]{64}$'),
 official_document_urls text[] not null check(cardinality(official_document_urls) between 1 and 20),
 documents_status text not null check(documents_status in('VERIFIED','UNVERIFIED')),
 mapping_status text not null check(mapping_status in('ALL_INPUTS_REVIEWED','INCOMPLETE')),
 documents_ready boolean not null default false,
 reason text not null check(length(btrim(reason)) between 30 and 5000),
 reviewed_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 check(isfinite(reviewed_at) and isfinite(recorded_at) and isfinite(expires_at)
  and reviewed_at<=recorded_at and expires_at>recorded_at)
);
alter table vnext_private.ai_research_use_reviews enable row level security;
alter table vnext_private.ai_research_use_reviews force row level security;
revoke all on vnext_private.ai_research_use_reviews from public,anon,authenticated,service_role;
grant select,insert on vnext_private.ai_research_use_reviews to service_role;
create index ai_research_use_review_latest on vnext_private.ai_research_use_reviews(edition_id,recorded_at desc,id);
create trigger immutable before update or delete on vnext_private.ai_research_use_reviews
 for each row execute function vnext_private.immutable_record();

-- A recognized primary document is a necessary review input, never evidence
-- that a particular extraction is lawful. The trusted importer must retain the
-- actual review and source mapping documents committed by their hashes.
create function vnext_private.ai_use_primary_documents_v1(p_basis text,p_urls text[],p_sources text[]) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(cardinality(p_urls) between 1 and 20
  and (select count(distinct u) from unnest(p_urls)u)=cardinality(p_urls)
  and not exists(select from unnest(p_urls)u where u is null or length(u) not between 12 and 3000
   or u !~ '^https://([a-z0-9-]+\.)*(twse\.com\.tw|tpex\.org\.tw|taifex\.com\.tw|yahoo\.com|data\.gov\.tw|tipo\.gov\.tw|tsmc\.com|honhai\.com|mediatek\.com|realtek\.com|wistron\.com|esmt\.com\.tw|udngroup\.com|udn\.com|cna\.com\.tw|ltn\.com\.tw)/[^#[:space:]]*$'
   or u ~* '[?&][^=]*(token|secret|key|auth|email)[^=]*=')
  and case p_basis
   when 'FACT_ONLY_OWN_ANALYSIS' then exists(select from unnest(p_urls)u where u in(
    'https://www.tipo.gov.tw/tw/copyright/692-16653.html',
    'https://www.tipo.gov.tw/tw/copyright/774-5043.html',
    'https://www.tipo.gov.tw/tw/copyright/692-13930.html',
    'https://www.tipo.gov.tw/tw/copyright/694-17733.html'))
   when 'OPEN_LICENSE' then 'https://data.gov.tw/license'=any(p_urls)
    and exists(select from unnest(p_urls)u where u ~ '^https://data\.gov\.tw/dataset/[0-9]+$')
   when 'EXPLICIT_PERMISSION' then cardinality(p_sources)>0 and not exists(
    select from unnest(p_sources)src where not exists(select from unnest(p_urls)doc where exists(
     select from unnest(array['twse.com.tw','tpex.org.tw','taifex.com.tw','yahoo.com','tsmc.com','honhai.com','mediatek.com','realtek.com',
      'wistron.com','esmt.com.tw','udngroup.com','udn.com','cna.com.tw','ltn.com.tw'])publisher(root)
      where src ~ ('^https://([a-z0-9-]+\.)*'||replace(publisher.root,'.','[.]')||'/')
       and doc ~ ('^https://([a-z0-9-]+\.)*'||replace(publisher.root,'.','[.]')||'/'))))
   else false end,false);
$$;
revoke all on function vnext_private.ai_use_primary_documents_v1(text,text[],text[]) from public,anon,authenticated,service_role;

create function vnext_private.validate_ai_research_use_review_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare e vnext_private.ai_research_editions;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai-member-research',0));
 select * into strict e from vnext_private.ai_research_editions where id=new.edition_id;
 new.recorded_at:=clock_timestamp();
 if new.snapshot_hash is distinct from e.id or new.expires_at>e.expires_at
  or new.expires_at<=new.recorded_at or new.reviewed_at>new.recorded_at
  or new.use_scope is distinct from 'OWN_ANALYSIS_ONLY' or new.raw_redistribution is distinct from false
  or exists(select from vnext_runtime.ai_stock_jobs j where j.id=any(e.job_keys)
   and new.reviewer_ref in(j.model_revision,j.result->'receipt'->>'model'))
  or not vnext_private.ai_edition_integrity_v1(e.id)
  then raise exception 'AI_USE_REVIEW_INVALID';end if;
 new.documents_ready:=new.documents_status='VERIFIED' and new.mapping_status='ALL_INPUTS_REVIEWED'
  and vnext_private.ai_use_primary_documents_v1(new.basis,new.official_document_urls,
   array(select jsonb_array_elements_text(e.payload->'source_urls')));
 if new.quality='PASS' and not new.documents_ready
  then raise exception 'AI_USE_REVIEW_DOCUMENTS';end if;
 -- Even PENDING/FAIL evidence must be safe to retain; it does not authorize use.
 if exists(select from unnest(new.official_document_urls)u where u is null
  or length(u) not between 12 and 3000 or u !~ '^https://[^/?#@[:space:]]+([/?]|$)'
  or u ~ '[#[:space:]]' or u ~* '[?&][^=]*(token|secret|key|auth|email)[^=]*=')
  then raise exception 'AI_USE_REVIEW_DOCUMENTS';end if;
 return new;
end $$;
revoke all on function vnext_private.validate_ai_research_use_review_v1() from public,anon,authenticated,service_role;
create trigger validate_use_review before insert on vnext_private.ai_research_use_reviews
 for each row execute function vnext_private.validate_ai_research_use_review_v1();

-- A later FAIL, PENDING or expired assessment cannot revive an older permission.
-- With no use assessment, the original all-source license route still applies.
-- This function is used only by the new immutable AS_OF edition publication.
create or replace function vnext_private.ai_edition_rights_v1(p_id text,p_now timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select case when latest.id is not null then
   latest.snapshot_hash=e.id and latest.use_scope='OWN_ANALYSIS_ONLY' and not latest.raw_redistribution
   and latest.quality='PASS' and latest.reviewed_at<=p_now and latest.recorded_at<=p_now and latest.expires_at>p_now
   and latest.documents_ready
  else not exists(select from jsonb_array_elements_text(e.payload->'source_urls')requested(source) where not exists(
   select from vnext_private.source_licenses l where l.source=requested.source
    and l.storage_allowed and l.derived_allowed and l.commercial_allowed
    and l.reviewed_at<=p_now and (l.expires_at is null or l.expires_at>p_now)
    and l.document_url like 'https://%' and length(btrim(l.attribution))>0)) end
  from vnext_private.ai_research_editions e left join lateral(
   select r.* from vnext_private.ai_research_use_reviews r where r.edition_id=e.id
   order by r.recorded_at desc,r.id desc limit 1)latest on true
  where e.id=p_id and isfinite(p_now) and e.created_at<=p_now and e.expires_at>p_now),false);
$$;
revoke all on function vnext_private.ai_edition_rights_v1(text,timestamptz) from public,anon,authenticated,service_role;
commit;
