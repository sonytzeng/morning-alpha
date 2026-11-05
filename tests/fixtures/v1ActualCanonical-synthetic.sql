-- SYNTHETIC ONLY. No issuer values, original filings, rights, or real approvals.
-- Fixtures install separate fake authorities as local DB administrator. The
-- candidate migration itself seeds nothing and grants no registry access.
insert into v1_actual_candidate.authorities(id,authority_ref,kind,status,document_ref,document_sha256,valid_from,valid_until)
select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'SYNTHETIC-'||kind,kind,'APPROVED','https://synthetic.invalid/authority/'||n,repeat(n::text,64),
 clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day'
from (values(1,'SOURCE'),(2,'INDEPENDENT_REVIEW'),(3,'INTERNAL_RIGHTS')) as x(n,kind);

-- One directly observed quarter. First-seen/availability are fresh; the printed
-- fiscal period and fake original announcement are NOT receipt/canonical times.
insert into v1_actual_candidate.source_revisions(id,authority_id,provider,symbol,source_kind,source_format,source_ref,
 source_sha256,source_bytes,receipt_document_ref,receipt_document_sha256,source_version_ref,version_status,first_seen_at,available_at)
values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
 'SYNTHETIC_ISSUER','2330','ISSUER_FILING','SUPPORTED_INLINE_XBRL_ONLY','https://synthetic.invalid/filing',repeat('a',64),1234,
 'SYNTHETIC-SEALED-RECEIPT',repeat('b',64),'SYNTHETIC-ORIGINAL-V1','EXACT',clock_timestamp(),clock_timestamp());
insert into v1_actual_candidate.actual_rows(id,source_revision_id,symbol,fiscal_year,fiscal_quarter,period_start,period_end,
 period_basis,profile,revenue_definition,accounting_basis,consolidation,currency,revenue_unit,revenue_scale,revenue_resolution_twd,
 share_class,eps_basis,eps_unit,revenue_namespace,revenue_concept,eps_namespace,eps_concept,revenue_locator,eps_locator,revenue_actual,eps_actual)
select '20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2330',
 extract(year from start_at),extract(quarter from start_at),start_at,(start_at+interval '3 months'-interval '1 day')::date,
 'DIRECT_STANDALONE_QUARTER','NONFINANCIAL_IFRS','IFRS_REVENUE','IFRS_AS_REPORTED','CONSOLIDATED','TWD','TWD',1,1,
 'COMMON_SHARE','DILUTED','TWD_PER_COMMON_SHARE',
 'https://xbrl.ifrs.org/taxonomy/2025-03-27/ifrs-full','Revenue',
 'https://xbrl.ifrs.org/taxonomy/2025-03-27/ifrs-full','DilutedEarningsLossPerShare',
 'SYNTHETIC:exact-quarter:revenue','SYNTHETIC:exact-quarter:eps',123456789,1.25
from (select (date_trunc('quarter',clock_timestamp())-interval '3 months')::date as start_at) q;
insert into v1_actual_candidate.independent_reviews(id,source_revision_id,row_id,authority_id,source_record_sha256,row_record_sha256,
 status,document_ref,document_sha256,announced_at,announcement_precision,announcement_source_ref,announcement_document_sha256,announcement_version_ref,reviewed_at)
select '30000000-0000-0000-0000-000000000001',s.id,r.id,'00000000-0000-0000-0000-000000000002',s.record_sha256,r.record_sha256,
 'APPROVED','SYNTHETIC-INDEPENDENT-REVIEW',repeat('c',64),(r.period_end+1)::timestamp at time zone 'Asia/Taipei','SECOND',
 'https://synthetic.invalid/exact-announcement',repeat('d',64),s.source_version_ref,clock_timestamp()
from v1_actual_candidate.source_revisions s join v1_actual_candidate.actual_rows r on r.source_revision_id=s.id;
insert into v1_actual_candidate.internal_rights(id,source_revision_id,authority_id,source_record_sha256,source_ref,purpose,status,
 document_ref,document_sha256,attribution,reviewed_at,expires_at)
select '40000000-0000-0000-0000-000000000001',id,'00000000-0000-0000-0000-000000000003',record_sha256,source_ref,
 'INTERNAL_CANONICAL_ACTUAL_STORAGE','APPROVED','SYNTHETIC-INTERNAL-RIGHTS-NOT-MEMBER-LICENSE',repeat('e',64),
 'SYNTHETIC ONLY - NOT A REAL SOURCE GRANT',clock_timestamp(),clock_timestamp()+interval '1 day'
from v1_actual_candidate.source_revisions;
