-- Additive offline corrections only. Never creates a model job or receipt.
-- Existing source-use, quality/time review, Owner approval and member reader
-- remain unchanged. The new edition has no inherited review or publication.
begin;
create table vnext_private.ai_editorial_derivatives_v1(
 derivative_hash text primary key check(derivative_hash ~ '^[a-f0-9]{64}$'),
 batch_id text not null references vnext_runtime.ai_stock_batches(id),
 original_job_key text not null references vnext_runtime.ai_stock_jobs(id),
 symbol text not null check(symbol ~ '^[0-9]{4,6}$'),
 body_text text not null check(octet_length(body_text) between 2 and 50000),
 body jsonb not null,
 review_document_hash text not null check(review_document_hash ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 check(body=body_text::jsonb),
 check(encode(sha256(convert_to(body_text,'UTF8')),'hex')=derivative_hash)
);
alter table vnext_private.ai_editorial_derivatives_v1 enable row level security;
alter table vnext_private.ai_editorial_derivatives_v1 force row level security;
revoke all on vnext_private.ai_editorial_derivatives_v1 from public,anon,authenticated,service_role;
create trigger immutable before update or delete on vnext_private.ai_editorial_derivatives_v1
 for each row execute function vnext_private.immutable_record();
create index ai_editorial_derivatives_batch_v1 on vnext_private.ai_editorial_derivatives_v1(batch_id,symbol);

-- This importer records a review DOCUMENT reference, not a quality PASS.
-- Raw text is the caller's exact JS canonical preimage; no JSONB/JS hash lie.
create function public.stage_daily_ai_editorial_derivative_v1(
 p_body_text text,p_derivative_hash text,p_review_document_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb;j vnext_runtime.ai_stock_jobs;b vnext_runtime.ai_stock_batches;
 packet jsonb;raw_candidate vnext_runtime.ai_stock_model_candidates;
 before_claim jsonb;after_claim jsonb;expected_horizons jsonb;h_index integer;path text[];
 prior vnext_private.ai_editorial_derivatives_v1;at_time timestamptz:=clock_timestamp();
 expected_keys text[]:=array['schema','symbol','batch_id','cutoff','input_hash','original_job_key','original_model_revision',
  'original_response_id','original_candidate_pg_hash','original_result_hash','original_result_pg_hash','original_horizons_hash',
  'proposal_document_hash','proposal_hash','reviewed_at','review_kind','horizons','change','model_generated','paid_model_calls',
  'production_writes','member_published','publication_ready','status'];
begin
 if p_body_text is null or octet_length(p_body_text) not between 2 and 50000
  or p_derivative_hash is null or p_derivative_hash !~ '^[a-f0-9]{64}$'
  or p_review_document_hash is null or p_review_document_hash !~ '^[a-f0-9]{64}$'
  or encode(sha256(convert_to(p_body_text,'UTF8')),'hex') is distinct from p_derivative_hash
  then raise exception 'AI_EDITORIAL_HASH';end if;
 v:=p_body_text::jsonb;
 if jsonb_typeof(v) is distinct from 'object' or not v ?& expected_keys
  or (select count(*) from jsonb_object_keys(v))<>cardinality(expected_keys)
  or v->>'schema' is distinct from 'DAILY_AI_REVIEWED_DERIVATIVE_V1'
  or v->>'review_kind' is distinct from 'EDITORIAL_CORRECTION'
  or v->>'status' is distinct from 'MECHANICAL_PASS_INDEPENDENT_REVIEW_REQUIRED'
  or v->'model_generated' is distinct from 'false'::jsonb or v->'paid_model_calls' is distinct from '0'::jsonb
  or v->'production_writes' is distinct from '0'::jsonb or v->'member_published' is distinct from 'false'::jsonb
  or v->'publication_ready' is distinct from 'false'::jsonb
  or jsonb_typeof(v->'reviewed_at') is distinct from 'string'
  or jsonb_typeof(v->'cutoff') is distinct from 'string'
  or coalesce(v->>'reviewed_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(v->>'cutoff','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(v->>'symbol','') !~ '^[0-9]{4,6}$'
  or exists(select from unnest(array['batch_id','input_hash','original_job_key','original_candidate_pg_hash',
   'original_result_hash','original_result_pg_hash','original_horizons_hash','proposal_document_hash','proposal_hash'])key
   where jsonb_typeof(v->key) is distinct from 'string' or coalesce(v->>key,'') !~ '^[a-f0-9]{64}$')
  then raise exception 'AI_EDITORIAL_SCOPE';end if;
 select * into j from vnext_runtime.ai_stock_jobs where id=v->>'original_job_key';
 select * into b from vnext_runtime.ai_stock_batches where id=v->>'batch_id';
 if j.id is null or b.id is null or not vnext_private.ai_batch_commitment_v1(b.id)
  or j.state<>'COMPLETE' or j.symbol is distinct from v->>'symbol' or j.cutoff is distinct from b.cutoff
  or (v->>'cutoff')::timestamptz is distinct from b.cutoff
  or j.model_revision is distinct from v->>'original_model_revision' or j.input_hash is distinct from v->>'input_hash'
  or b.payload->'packet_hashes'->>j.symbol is distinct from j.input_hash
  or j.result->'model_generated' is distinct from 'true'::jsonb
  or j.result->'member_published' is distinct from 'false'::jsonb
  or j.result->>'schema' is distinct from 'DAILY_AI_STOCK_ANALYSIS_V1'
  or j.result->>'input_hash' is distinct from j.input_hash
  or encode(sha256(convert_to(j.result::text,'UTF8')),'hex') is distinct from v->>'original_result_pg_hash'
  or j.result->'receipt'->>'response_id' is distinct from v->>'original_response_id'
  then raise exception 'AI_EDITORIAL_ORIGIN';end if;
 select * into raw_candidate from vnext_runtime.ai_stock_model_candidates where response_id=v->>'original_response_id';
 if raw_candidate.job_id is distinct from j.id or raw_candidate.candidate_hash is distinct from v->>'original_candidate_pg_hash'
  or raw_candidate.candidate_hash is distinct from encode(sha256(convert_to(raw_candidate.candidate::text,'UTF8')),'hex')
  then raise exception 'AI_EDITORIAL_RECEIPT';end if;
 select p into strict packet from jsonb_array_elements(b.payload->'packets')p where p->>'symbol'=j.symbol;
 if (b.payload->'packet_texts'->>j.symbol)::jsonb is distinct from packet
  or encode(sha256(convert_to(b.payload->'packet_texts'->>j.symbol,'UTF8')),'hex') is distinct from j.input_hash
  or not isfinite((v->>'reviewed_at')::timestamptz)
  or (v->>'reviewed_at')::timestamptz<b.cutoff or (v->>'reviewed_at')::timestamptz>at_time
  or jsonb_typeof(v->'change') is distinct from 'object'
  or (select count(*) from jsonb_object_keys(v->'change'))<>5
  or not(v->'change') ?& array['horizon','claim_path','before','after','reason']
  or coalesce(v->'change'->>'horizon','') not in('SHORT','MEDIUM','LONG')
  or coalesce(v->'change'->>'claim_path','') !~ '^(reason|counter_evidence\.[0-9]{1,2})$'
  or length(btrim(coalesce(v->'change'->>'reason',''))) not between 1 and 3000
  or jsonb_typeof(v->'horizons') is distinct from 'array' or jsonb_array_length(v->'horizons')<>3
  then raise exception 'AI_EDITORIAL_CHANGE_SCOPE';end if;
 select ordinality::integer-1 into strict h_index from jsonb_array_elements(j.result->'horizons') with ordinality h(value,ordinality)
  where h.value->>'horizon'=v->'change'->>'horizon';
 path:=array[h_index::text]||string_to_array(v->'change'->>'claim_path','.');
 before_claim:=(j.result->'horizons')#>path;after_claim:=v->'change'->'after';
 if before_claim is null or before_claim is distinct from v->'change'->'before'
  or before_claim=after_claim or jsonb_typeof(after_claim) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(after_claim))<>2 or not after_claim ?& array['text','evidence_ids']
  or jsonb_typeof(after_claim->'text') is distinct from 'string' or length(btrim(after_claim->>'text')) not between 1 and 1500
  or after_claim->>'text' ~ '(保證獲利|穩賺|必漲|必賺)'
  or jsonb_typeof(after_claim->'evidence_ids') is distinct from 'array'
  or jsonb_array_length(after_claim->'evidence_ids') not between 1 and 100
  or exists(select from jsonb_array_elements(after_claim->'evidence_ids')id where jsonb_typeof(id)<>'string')
  or (select count(distinct id) from jsonb_array_elements_text(after_claim->'evidence_ids')id)<>jsonb_array_length(after_claim->'evidence_ids')
  or exists(select from jsonb_array_elements_text(before_claim->'evidence_ids')old(id) where not(after_claim->'evidence_ids') ? old.id)
  or exists(select from jsonb_array_elements_text(after_claim->'evidence_ids')asked(id) where not exists(
   select from jsonb_array_elements(packet->'evidence')ev where ev->>'id'=asked.id
    and isfinite((ev->>'available_at')::timestamptz) and (ev->>'available_at')::timestamptz<=b.cutoff
    and (ev->>'symbol'=j.symbol or ev->'symbol'='null'::jsonb)))
  then raise exception 'AI_EDITORIAL_CLAIM';end if;
 expected_horizons:=jsonb_set(j.result->'horizons',path,after_claim,false);
 if expected_horizons is distinct from v->'horizons' then raise exception 'AI_EDITORIAL_UNRELATED_CHANGE';end if;
 perform pg_advisory_xact_lock(hashtextextended('ai-editorial:'||p_derivative_hash,0));
 select * into prior from vnext_private.ai_editorial_derivatives_v1 where derivative_hash=p_derivative_hash;
 if found and (prior.body_text is distinct from p_body_text or prior.review_document_hash is distinct from p_review_document_hash)
  then raise exception 'AI_EDITORIAL_REPLAY_CONFLICT';end if;
 insert into vnext_private.ai_editorial_derivatives_v1(derivative_hash,batch_id,original_job_key,symbol,body_text,body,review_document_hash)
 values(p_derivative_hash,b.id,j.id,j.symbol,p_body_text,v,p_review_document_hash) on conflict do nothing;
 return jsonb_build_object('state','EDITORIAL_STAGED_REVIEW_REQUIRED','derivative_hash',p_derivative_hash,
  'review_reference_only',true,'model_calls',0,'member_published',false);
end $$;
revoke all on function public.stage_daily_ai_editorial_derivative_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_editorial_derivative_v1(text,text,text) to service_role;

-- Only a complete, current 72-stock base edition can receive these corrections.
-- Do not renew old data by setting a later expiry. Old reviews/approvals are not
-- copied; the normal independent quality/time/source-use and Owner gates apply.
create function public.stage_daily_ai_editorial_edition_v1(p_base_edition_id text,p_derivative_hashes text[],p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare base vnext_private.ai_research_editions;d vnext_private.ai_editorial_derivatives_v1;
 keys text[];symbols text[]:='{}';payload jsonb;cards jsonb;card jsonb;packet jsonb;refs jsonb;manifest jsonb:='[]';
 path text[];c_index integer;eid text;at_time timestamptz:=transaction_timestamp();
begin
 if p_base_edition_id is null or p_base_edition_id !~ '^[a-f0-9]{64}$' or p_derivative_hashes is null
  or cardinality(p_derivative_hashes) not between 1 and 72
  or exists(select from unnest(p_derivative_hashes)h where h is null or h !~ '^[a-f0-9]{64}$')
  then raise exception 'AI_EDITORIAL_EDITION_SCOPE';end if;
 select array_agg(distinct h order by h) into keys from unnest(p_derivative_hashes)h;
 if cardinality(keys)<>cardinality(p_derivative_hashes) then raise exception 'AI_EDITORIAL_EDITION_DUPLICATE';end if;
 select * into base from vnext_private.ai_research_editions where id=p_base_edition_id;
 if base.id is null or base.created_at>at_time or base.expires_at<=at_time or base.payload ? 'editorial_provenance'
  or not vnext_private.ai_edition_integrity_v1(base.id) or cardinality(base.job_keys)<>72
  or jsonb_array_length(base.payload->'cards')<>216
  or (select count(distinct c->>'symbol') from jsonb_array_elements(base.payload->'cards')c)<>72
  or p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=at_time
  or p_expires_at>base.expires_at or p_expires_at>at_time+interval '72 hours'
  then raise exception 'AI_EDITORIAL_EDITION_BASE';end if;
 cards:=base.payload->'cards';
 for d in select * from vnext_private.ai_editorial_derivatives_v1 where derivative_hash=any(keys) order by derivative_hash loop
  if d.batch_id is distinct from base.batch_id or not d.original_job_key=any(base.job_keys) or d.symbol=any(symbols)
   then raise exception 'AI_EDITORIAL_EDITION_BINDING';end if;
  symbols:=array_append(symbols,d.symbol);
  select ordinality::integer-1,c.value into strict c_index,card from jsonb_array_elements(cards) with ordinality c(value,ordinality)
   where c.value->>'symbol'=d.symbol and c.value->>'horizon'=d.body->'change'->>'horizon';
  path:=string_to_array(d.body->'change'->>'claim_path','.');
  if card#>path is distinct from d.body->'change'->'before' then raise exception 'AI_EDITORIAL_EDITION_ORIGINAL_CLAIM';end if;
  card:=jsonb_set(card,path,d.body->'change'->'after',false);
  select p into strict packet from vnext_runtime.ai_stock_batches b cross join lateral jsonb_array_elements(b.payload->'packets')p
   where b.id=base.batch_id and p->>'symbol'=d.symbol;
  select coalesce(jsonb_agg(jsonb_build_object('id',ev->>'id','source',ev->>'source','kind',ev->>'kind',
    'published_at',ev->>'published_at','available_at',ev->>'available_at','time_basis',coalesce(ev->>'time_basis','PUBLISHED'),
    'first_seen_at',ev->>'first_seen_at','as_of',ev->>'as_of','evidence_hash',ev->>'evidence_hash') order by ev->>'id'),'[]'::jsonb)
   into refs from jsonb_array_elements(packet->'evidence')ev where card->'reason'->'evidence_ids' ? (ev->>'id')
    or exists(select from jsonb_array_elements(card->'counter_evidence')ce where ce->'evidence_ids' ? (ev->>'id'));
  card:=jsonb_set(card,'{sources}',refs,false);cards:=jsonb_set(cards,array[c_index::text],card,false);
  manifest:=manifest||jsonb_build_array(jsonb_build_object('symbol',d.symbol,'derivative_hash',d.derivative_hash,
   'original_job_key',d.original_job_key,'review_document_hash',d.review_document_hash));
 end loop;
 if cardinality(symbols)<>cardinality(keys) then raise exception 'AI_EDITORIAL_EDITION_MISSING';end if;
 payload:=jsonb_set(base.payload,'{cards}',cards,false)||jsonb_build_object('editorial_provenance',
  jsonb_build_object('schema','DAILY_AI_EDITORIAL_EDITION_V1','base_edition_id',base.id,'derivatives',manifest,
   'new_model_calls',0,'original_model_outputs_changed',false));
 eid:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 insert into vnext_private.ai_research_editions(id,batch_id,business_date,cutoff,through,job_keys,job_set_hash,payload,expires_at)
 values(eid,base.batch_id,base.business_date,base.cutoff,base.through,base.job_keys,base.job_set_hash,payload,p_expires_at) on conflict do nothing;
 return jsonb_build_object('state','EDITORIAL_EDITION_STAGED_REVIEW_REQUIRED','edition_id',eid,'base_edition_id',base.id,
  'periods',216,'model_calls',0,'reviews_copied',false,'member_published',false);
end $$;
revoke all on function public.stage_daily_ai_editorial_edition_v1(text,text[],timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_editorial_edition_v1(text,text[],timestamptz) to service_role;
commit;
