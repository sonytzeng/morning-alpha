-- Candidate only: exact-batch financial model-use reviews. No review is seeded.
-- Does not change ingestion flags, source licenses, paid calls or publications.
begin;
do $$declare r record;p record;begin
 if to_regclass('vnext_private.ai_model_source_use_reviews_v1') is not null
  or to_regprocedure('public.load_daily_stock_ai_model_source_use_v1(text)') is not null
  or to_regprocedure('public.record_daily_stock_ai_model_source_use_v1(text,text)') is not null
 then raise exception 'AI_MODEL_USE_ALREADY_PRESENT';end if;
 if to_regprocedure('vnext_private.ai_batch_commitment_v1(text)') is null
  or to_regprocedure('vnext_private.ai_use_primary_documents_v1(text,text[],text[])') is null
  or to_regprocedure('vnext_private.immutable_record()') is null
 then raise exception 'AI_MODEL_USE_PREREQUISITES';end if;
 for r in select * from (values
  ('vnext_private.ai_batch_commitment_v1(text)','1598813b358ecb1d914b6081b86d41caa33be9c431b6d0f9bc000f657ba5d261'),
  ('vnext_private.ai_use_primary_documents_v1(text,text[],text[])','93f4623a2f17ad952f049804c2e2b1ca640d712ea7f92a0842aed9292a92737a'),
  ('vnext_private.immutable_record()','8ff0daf62ba85225db0e37df4e74284ca523ff5fd0f72852e13ec9ff3a793d91')
 )expected(signature,hash) loop
  select encode(sha256(convert_to(pg_get_functiondef(f.oid),'UTF8')),'hex') hash,
   pg_get_userbyid(f.proowner) owner,f.proacl::text acl into p from pg_proc f where f.oid=r.signature::regprocedure;
  if p.hash is distinct from r.hash or p.owner is distinct from 'postgres' or p.acl is distinct from '{postgres=X/postgres}'
  then raise exception 'AI_MODEL_USE_PREREQUISITE_DRIFT';end if;
 end loop;
end $$;

create table vnext_private.ai_model_source_use_reviews_v1(
 sequence_id bigint generated always as identity primary key,
 document_hash text not null unique check(document_hash ~ '^[a-f0-9]{64}$'),
 batch_id text not null references vnext_runtime.ai_stock_batches(id),
 document_text text not null check(octet_length(document_text) between 2 and 1000000),
 document jsonb not null check(document=document_text::jsonb),
 quality text not null check(quality in('PASS','PENDING','FAIL','REVOKED')),
 packets_commitment text not null check(packets_commitment ~ '^[a-f0-9]{64}$'),
 documents_ready boolean not null,
 reviewed_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 check(encode(sha256(convert_to(document_text,'UTF8')),'hex')=document_hash),
 check(isfinite(reviewed_at) and isfinite(recorded_at) and isfinite(expires_at)
  and reviewed_at<=recorded_at and recorded_at<expires_at and expires_at<=reviewed_at+interval '72 hours')
);
alter table vnext_private.ai_model_source_use_reviews_v1 enable row level security;
alter table vnext_private.ai_model_source_use_reviews_v1 force row level security;
revoke all on vnext_private.ai_model_source_use_reviews_v1 from public,anon,authenticated,service_role;
grant select on vnext_private.ai_model_source_use_reviews_v1 to service_role;
create index ai_model_source_use_latest_v1 on vnext_private.ai_model_source_use_reviews_v1(batch_id,sequence_id desc);
create trigger immutable before update or delete on vnext_private.ai_model_source_use_reviews_v1
 for each row execute function vnext_private.immutable_record();
create trigger immutable_truncate before truncate on vnext_private.ai_model_source_use_reviews_v1
 for each statement execute function vnext_private.immutable_record();

create function vnext_private.model_source_packets_commitment_v1(p_id text) returns text
language sql stable security definer set search_path='' as $$
 select case when vnext_private.ai_batch_commitment_v1(b.id)
  and (select count(*) from jsonb_each_text(b.payload->'packet_texts'))=72
  and (select count(*) from jsonb_each_text(b.payload->'packet_hashes'))=72
  and not exists(select from jsonb_each_text(b.payload->'packet_texts')p
   where p.key !~ '^[0-9]{4,6}$' or p.value::jsonb->>'symbol' is distinct from p.key
    or p.value::jsonb->>'cutoff' is distinct from b.payload->>'cutoff'
    or encode(sha256(convert_to(p.value,'UTF8')),'hex') is distinct from b.payload->'packet_hashes'->>p.key)
 then encode(sha256(convert_to((select string_agg(p.key||':'||p.value,E'\n' order by p.key collate "C")
  from jsonb_each_text(b.payload->'packet_hashes')p),'UTF8')),'hex') end
 from vnext_runtime.ai_stock_batches b where b.id=p_id;
$$;
revoke all on function vnext_private.model_source_packets_commitment_v1(text) from public,anon,authenticated,service_role;

create function public.record_daily_stock_ai_model_source_use_v1(p_document_text text,p_document_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb;b vnext_runtime.ai_stock_batches;commitment text;urls text[];docs text[];actual text[];
 ready boolean;t timestamptz;prior vnext_private.ai_model_source_use_reviews_v1;
 keys text[]:=array['schema','batch_id','batch_cutoff','packets_commitment','quality','basis','use_scope','reviewer_ref',
  'reviewed_at','expires_at','review_document_hash','source_mapping_document_hash','terms_document_hash','source_urls',
  'official_document_urls','documents_status','mapping_status','contractual_scope_status','raw_redistribution','member_publication_approved'];
 k text;
begin
 if p_document_text is null or octet_length(p_document_text) not between 2 and 1000000
  or p_document_hash is null or p_document_hash !~ '^[a-f0-9]{64}$'
  or encode(sha256(convert_to(p_document_text,'UTF8')),'hex') is distinct from p_document_hash
 then raise exception 'AI_MODEL_USE_DOCUMENT_HASH';end if;
 d:=p_document_text::jsonb;
 if jsonb_typeof(d) is distinct from 'object' or not d ?& keys
  or (select count(*) from jsonb_object_keys(d))<>cardinality(keys)
  or d->>'schema' is distinct from 'DAILY_AI_MODEL_SOURCE_USE_REVIEW_V1'
  or d->>'basis' is distinct from 'FACT_ONLY_OWN_ANALYSIS'
  or d->>'use_scope' is distinct from 'FINANCIAL_FACT_MODEL_INPUT_ONLY'
  or coalesce(d->>'quality','') not in('PASS','PENDING','FAIL','REVOKED')
  or d->'raw_redistribution' is distinct from 'false'::jsonb
  or d->'member_publication_approved' is distinct from 'false'::jsonb
  or coalesce(d->>'documents_status','') not in('VERIFIED','UNVERIFIED')
  or coalesce(d->>'mapping_status','') not in('ALL_INPUTS_REVIEWED','INCOMPLETE')
  or coalesce(d->>'contractual_scope_status','') not in('VERIFIED_FOR_THIS_MODEL_USE','UNKNOWN','RESTRICTED')
 then raise exception 'AI_MODEL_USE_SCOPE';end if;
 foreach k in array array['batch_id','packets_commitment','review_document_hash','source_mapping_document_hash','terms_document_hash'] loop
  if jsonb_typeof(d->k) is distinct from 'string' or d->>k !~ '^[a-f0-9]{64}$' then raise exception 'AI_MODEL_USE_COMMITMENT';end if;
 end loop;
 foreach k in array array['batch_cutoff','reviewer_ref','reviewed_at','expires_at'] loop
  if jsonb_typeof(d->k) is distinct from 'string' then raise exception 'AI_MODEL_USE_FIELDS';end if;
 end loop;
 if length(btrim(d->>'reviewer_ref')) not between 1 and 200
  or jsonb_typeof(d->'source_urls') is distinct from 'array' or jsonb_array_length(d->'source_urls') not between 1 and 4096
  or jsonb_typeof(d->'official_document_urls') is distinct from 'array' or jsonb_array_length(d->'official_document_urls') not between 1 and 20
  or exists(select from jsonb_array_elements(d->'source_urls')u where jsonb_typeof(u)<>'string')
  or exists(select from jsonb_array_elements(d->'official_document_urls')u where jsonb_typeof(u)<>'string')
 then raise exception 'AI_MODEL_USE_SOURCES';end if;
 select array_agg(u order by u collate "C") into urls from jsonb_array_elements_text(d->'source_urls')u;
 select array_agg(u order by u collate "C") into docs from jsonb_array_elements_text(d->'official_document_urls')u;
 if cardinality(urls)<>(select count(distinct u) from unnest(urls)u)
  or cardinality(docs)<>(select count(distinct u) from unnest(docs)u)
  or exists(select from unnest(urls||docs)u where length(u) not between 12 and 3000
   or u !~ '^https://[^/?#@[:space:]]+([/?]|$)' or u ~ '[#[:space:]]'
   or u ~* '[?&][^=]*(token|secret|key|auth|email)[^=]*=')
 then raise exception 'AI_MODEL_USE_SOURCES';end if;
 perform pg_advisory_xact_lock(hashtextextended('daily-stock-ai-model-use:'||(d->>'batch_id'),0));
 t:=clock_timestamp();
 select * into strict b from vnext_runtime.ai_stock_batches where id=d->>'batch_id';
 commitment:=vnext_private.model_source_packets_commitment_v1(b.id);
 if commitment is null or commitment is distinct from d->>'packets_commitment'
  or d->>'batch_cutoff' is distinct from b.payload->>'cutoff'
  or not isfinite((d->>'reviewed_at')::timestamptz) or not isfinite((d->>'expires_at')::timestamptz)
  or (d->>'reviewed_at')::timestamptz<b.cutoff or (d->>'reviewed_at')::timestamptz>t
  or (d->>'expires_at')::timestamptz<=t
  or (d->>'expires_at')::timestamptz>(d->>'reviewed_at')::timestamptz+interval '72 hours'
 then raise exception 'AI_MODEL_USE_BINDING_OR_TIME';end if;
 select array_agg(s order by s collate "C") into actual from (
  select distinct e->>'source' s from jsonb_array_elements(b.payload->'packets')p,
   lateral jsonb_array_elements(p->'evidence')e)q;
 if urls is distinct from actual then raise exception 'AI_MODEL_USE_SOURCE_COVERAGE';end if;
 ready:=d->>'documents_status'='VERIFIED' and d->>'mapping_status'='ALL_INPUTS_REVIEWED'
  and d->>'contractual_scope_status'='VERIFIED_FOR_THIS_MODEL_USE'
  and vnext_private.ai_use_primary_documents_v1('FACT_ONLY_OWN_ANALYSIS',docs,urls) is true;
 if d->>'quality'='PASS' and not ready then raise exception 'AI_MODEL_USE_REVIEW_DOCUMENTS';end if;
 select * into prior from vnext_private.ai_model_source_use_reviews_v1 where document_hash=p_document_hash;
 if found then
  if prior.document_text is distinct from p_document_text then raise exception 'AI_MODEL_USE_REPLAY_CONFLICT';end if;
  return jsonb_build_object('state','ALREADY_RECORDED','review_id',p_document_hash,'member_published',false);
 end if;
 insert into vnext_private.ai_model_source_use_reviews_v1(document_hash,batch_id,document_text,document,quality,
  packets_commitment,documents_ready,reviewed_at,recorded_at,expires_at)
 values(p_document_hash,b.id,p_document_text,d,d->>'quality',commitment,ready,(d->>'reviewed_at')::timestamptz,t,(d->>'expires_at')::timestamptz);
 return jsonb_build_object('state','RECORDED','review_id',p_document_hash,'quality',d->>'quality','member_published',false);
end $$;
revoke all on function public.record_daily_stock_ai_model_source_use_v1(text,text) from public,anon,authenticated;
grant execute on function public.record_daily_stock_ai_model_source_use_v1(text,text) to service_role;

-- Private clock parameter permits deterministic isolated expiry checks. The
-- public loader always obtains its own server clock; callers cannot backdate.
create function vnext_private.model_source_use_receipt_at_v1(p_id text,p_now timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when r.quality='PASS' and r.documents_ready and isfinite(p_now)
  and r.reviewed_at<=r.recorded_at and r.recorded_at<=p_now and r.expires_at>p_now+interval '60 seconds'
  and encode(sha256(convert_to(r.document_text,'UTF8')),'hex')=r.document_hash
  and r.document=r.document_text::jsonb
  and r.document->>'batch_id'=r.batch_id and r.document->>'quality'=r.quality
  and r.document->>'packets_commitment'=r.packets_commitment
  and r.document->>'basis'='FACT_ONLY_OWN_ANALYSIS'
  and r.document->>'use_scope'='FINANCIAL_FACT_MODEL_INPUT_ONLY'
  and r.document->>'documents_status'='VERIFIED' and r.document->>'mapping_status'='ALL_INPUTS_REVIEWED'
  and r.document->>'contractual_scope_status'='VERIFIED_FOR_THIS_MODEL_USE'
  and r.document->'raw_redistribution'='false'::jsonb and r.document->'member_publication_approved'='false'::jsonb
  and (r.document->>'reviewed_at')::timestamptz=r.reviewed_at and (r.document->>'expires_at')::timestamptz=r.expires_at
  and vnext_private.ai_use_primary_documents_v1('FACT_ONLY_OWN_ANALYSIS',
   array(select jsonb_array_elements_text(r.document->'official_document_urls')),
   array(select jsonb_array_elements_text(r.document->'source_urls'))) is true
  and r.packets_commitment=vnext_private.model_source_packets_commitment_v1(r.batch_id)
 then jsonb_build_object('schema','DAILY_AI_MODEL_SOURCE_USE_RECEIPT_V1','review_id',r.document_hash,
  'batch_id',r.batch_id,'cutoff',r.document->>'batch_cutoff','packets_commitment',r.packets_commitment,
  'quality','PASS','basis','FACT_ONLY_OWN_ANALYSIS','use_scope','FINANCIAL_FACT_MODEL_INPUT_ONLY','documents_ready',true,
  'review_document_hash',r.document->>'review_document_hash','source_mapping_document_hash',r.document->>'source_mapping_document_hash',
  'terms_document_hash',r.document->>'terms_document_hash','reviewed_at',r.document->>'reviewed_at',
  'recorded_at',to_char(r.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'checked_at',to_char(p_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'expires_at',r.document->>'expires_at','member_publication_approved',false) end
 from vnext_private.ai_model_source_use_reviews_v1 r where r.batch_id=p_id order by r.sequence_id desc limit 1;
$$;
revoke all on function vnext_private.model_source_use_receipt_at_v1(text,timestamptz) from public,anon,authenticated,service_role;

create function public.load_daily_stock_ai_model_source_use_v1(p_batch_id text) returns jsonb
language sql volatile security definer set search_path='' as $$
 select vnext_private.model_source_use_receipt_at_v1(p_batch_id,clock_timestamp());
$$;
revoke all on function public.load_daily_stock_ai_model_source_use_v1(text) from public,anon,authenticated;
grant execute on function public.load_daily_stock_ai_model_source_use_v1(text) to service_role;
commit;
