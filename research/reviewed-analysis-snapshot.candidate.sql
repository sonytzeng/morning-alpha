-- INSTALLATION SCOPE: initial/fresh OFFLINE admission objects only.
-- DO NOT run this file as an incremental upgrade after
-- offline-snapshot-stage-only.candidate.sql. Both create the same immutable
-- snapshot table, helpers and snapshot-stage RPC; silently skipping them would
-- hide version drift. Stage-only -> full edition admission requires a separate,
-- independently reviewed upgrade that reuses the existing sealed objects.
-- This file is not that upgrade. No stage-only records may be dropped/replaced.
-- Candidate only. Separate OFFLINE_REVIEWED research provenance; no model job,
-- provider receipt or paid request is created. Existing model editions remain
-- immutable. UI parsers must accept explicit offline origin before deployment.
-- Install documented-reviews-v2 first so offline and model editions share its
-- retained-review expiry bound. Missing dependencies must fail before mutation.
begin;
do $offline_expiry_dependency$
begin
 if to_regprocedure('vnext_runtime.documented_review_edition_expiry_v2(jsonb,timestamptz)') is null
  or to_regprocedure('vnext_runtime.documented_review_packet_fact_matches_v2(jsonb,jsonb)') is null
  or to_regprocedure('vnext_runtime.documented_review_packet_original_id_v2(jsonb)') is null
  or to_regclass('vnext_private.verified_documented_reviews_v2') is null
  or to_regclass('vnext_private.verified_retained_sec_facts_v1') is null
  then raise exception 'OFFLINE_DOCUMENTED_REVIEW_EXPIRY_DEPENDENCY_REQUIRED';end if;
end $offline_expiry_dependency$;
create table vnext_private.reviewed_analysis_snapshots_v1(
 snapshot_hash text primary key check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 batch_id text not null references vnext_runtime.ai_stock_batches(id),
 author_ref text not null check(length(btrim(author_ref)) between 1 and 200),
 body_text text not null check(octet_length(body_text) between 2 and 2000000),body jsonb not null,
 validator_document_hash text not null check(validator_document_hash ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 check(body=body_text::jsonb),check(encode(sha256(convert_to(body_text,'UTF8')),'hex')=snapshot_hash)
);
alter table vnext_private.reviewed_analysis_snapshots_v1 enable row level security;
alter table vnext_private.reviewed_analysis_snapshots_v1 force row level security;
revoke all on vnext_private.reviewed_analysis_snapshots_v1 from public,anon,authenticated,service_role;
create trigger immutable before update or delete on vnext_private.reviewed_analysis_snapshots_v1
 for each row execute function vnext_private.immutable_record();
create index reviewed_analysis_snapshots_batch_v1 on vnext_private.reviewed_analysis_snapshots_v1(batch_id);

-- Do not fill the model job_keys column with invented identifiers.
alter table vnext_private.ai_research_editions add column reviewed_snapshot_hash text
 references vnext_private.reviewed_analysis_snapshots_v1(snapshot_hash);
alter table vnext_private.ai_research_editions drop constraint ai_research_editions_job_keys_check;
alter table vnext_private.ai_research_editions add constraint ai_research_editions_origin_job_keys_v1 check(
 (reviewed_snapshot_hash is null and cardinality(job_keys)=72)
 or (reviewed_snapshot_hash is not null and cardinality(job_keys)=0));

-- A claim has precisely two known keys, so this reproduces the shared JS
-- canonical claim preimage without pretending JSONB::text is a JS hash.
create function vnext_private.offline_claim_hash_v1(p_claim jsonb) returns text
language sql immutable set search_path='' as $$
 select encode(sha256(convert_to('{"evidence_ids":['||coalesce((select string_agg(to_jsonb(id)::text,',' order by ord)
  from jsonb_array_elements_text(p_claim->'evidence_ids') with ordinality x(id,ord)),'')||'],"text":'||to_jsonb(p_claim->>'text')::text||'}','UTF8')),'hex');
$$;
revoke all on function vnext_private.offline_claim_hash_v1(jsonb) from public,anon,authenticated,service_role;

-- Values are selected only from JSON objects/arrays in a cited retained source.
-- Unknown units stay unknown; they are not guessed or promoted into valuation.
create function vnext_private.offline_numeric_operand_v1(p_packet jsonb,p_claim jsonb,p_operand jsonb) returns numeric
language plpgsql immutable set search_path='' as $$
declare ev jsonb;content jsonb;v jsonb;path text[];part text;field text;
begin
 if jsonb_typeof(p_operand) is distinct from 'object' then raise exception 'OFFLINE_NUMERIC_OPERAND';end if;
 if p_operand ? 'literal' then
  if (select count(*) from jsonb_object_keys(p_operand))<>1 or jsonb_typeof(p_operand->'literal') is distinct from 'number'
   then raise exception 'OFFLINE_NUMERIC_LITERAL';end if;
  return (p_operand->>'literal')::numeric;
 end if;
 if not p_operand ?& array['evidence_id','value_path','period_path','period','unit_path','unit']
  or (select count(*) from jsonb_object_keys(p_operand))<>6
  or jsonb_typeof(p_operand->'evidence_id') is distinct from 'string'
  or not(p_claim->'evidence_ids') ? (p_operand->>'evidence_id')
  or jsonb_typeof(p_operand->'period') is distinct from 'string'
  then raise exception 'OFFLINE_NUMERIC_SOURCE';end if;
 select e into strict ev from jsonb_array_elements(p_packet->'evidence')e where e->>'id'=p_operand->>'evidence_id';
 content:=(ev->>'content')::jsonb;
 foreach field in array array['value_path','period_path','unit_path'] loop
  if field='unit_path' and p_operand->field='null'::jsonb then
   if p_operand->'unit' is distinct from 'null'::jsonb then raise exception 'OFFLINE_NUMERIC_UNIT';end if;
   continue;
  end if;
  if jsonb_typeof(p_operand->field) is distinct from 'array' or jsonb_array_length(p_operand->field) not between 1 and 12
   or exists(select from jsonb_array_elements(p_operand->field)p where jsonb_typeof(p)<>'string'
    or length(p#>>'{}') not between 1 and 100 or p#>>'{}' in('__proto__','constructor','prototype'))
   then raise exception 'OFFLINE_NUMERIC_PATH';end if;
  select array_agg(p order by ord) into path from jsonb_array_elements_text(p_operand->field) with ordinality x(p,ord);
  v:=content;
  foreach part in array path loop
   if jsonb_typeof(v)='object' then
    if not v ? part then raise exception 'OFFLINE_NUMERIC_PATH';end if;v:=v->part;
   elsif jsonb_typeof(v)='array' and part ~ '^(0|[1-9][0-9]*)$' then
    if part::numeric>=jsonb_array_length(v) then raise exception 'OFFLINE_NUMERIC_PATH';end if;v:=v->(part::integer);
   else raise exception 'OFFLINE_NUMERIC_PATH';end if;
  end loop;
  if field='period_path' and v is distinct from p_operand->'period' then raise exception 'OFFLINE_NUMERIC_PERIOD';end if;
  if field='unit_path' and (jsonb_typeof(p_operand->'unit') is distinct from 'string' or v is distinct from p_operand->'unit')
   then raise exception 'OFFLINE_NUMERIC_UNIT';end if;
 end loop;
 select array_agg(p order by ord) into path from jsonb_array_elements_text(p_operand->'value_path') with ordinality x(p,ord);
 v:=content#>path;
 if jsonb_typeof(v) is distinct from 'number' then raise exception 'OFFLINE_NUMERIC_VALUE';end if;
 return (v#>>'{}')::numeric;
end $$;
revoke all on function vnext_private.offline_numeric_operand_v1(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Full database-side binding/structure/value checks. Natural-language meaning
-- and valuation economics still require the existing independent full review.
create function public.stage_offline_reviewed_analysis_snapshot_v1(p_body_text text,p_snapshot_hash text,p_validator_document_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;b vnext_runtime.ai_stock_batches;packet jsonb;card jsonb;claim jsonb;source jsonb;ev jsonb;a jsonb;
 symbols text[]:='{}';keys text[]:='{}';required_keys text[]:=array['schema','provenance','author_ref','batch_id','cutoff','through',
 'prepared_at','expires_at','packet_hashes','cards','numeric_assertions','reference_jobs','model_generated','model_calls','member_published','publication_ready'];
 field text;requested text;horizon text;path text[];left_value numeric;right_value numeric;comparison boolean;
 prior vnext_private.reviewed_analysis_snapshots_v1;at_time timestamptz:=clock_timestamp();
 iso_pattern text:='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
begin
 if p_body_text is null or octet_length(p_body_text) not between 2 and 2000000
  or p_snapshot_hash is null or p_snapshot_hash !~ '^[a-f0-9]{64}$'
  or p_validator_document_hash is null or p_validator_document_hash !~ '^[a-f0-9]{64}$'
  or encode(sha256(convert_to(p_body_text,'UTF8')),'hex') is distinct from p_snapshot_hash then raise exception 'OFFLINE_SNAPSHOT_HASH';end if;
 v:=p_body_text::jsonb;
 if jsonb_typeof(v) is distinct from 'object' or not v ?& required_keys
  or (select count(*) from jsonb_object_keys(v))<>cardinality(required_keys)
  or v->>'schema' is distinct from 'DAILY_OFFLINE_REVIEWED_ANALYSIS_V1' or v->>'provenance' is distinct from 'OFFLINE_REVIEWED'
  or v->'model_generated' is distinct from 'false'::jsonb or v->'model_calls' is distinct from '0'::jsonb
  or v->'member_published' is distinct from 'false'::jsonb or v->'publication_ready' is distinct from 'false'::jsonb
  or jsonb_typeof(v->'author_ref') is distinct from 'string' or length(btrim(v->>'author_ref')) not between 1 and 200
  or jsonb_typeof(v->'batch_id') is distinct from 'string' or jsonb_typeof(v->'through') is distinct from 'string'
  or coalesce(v->>'batch_id','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(v->'packet_hashes') is distinct from 'object'
  or jsonb_typeof(v->'cards') is distinct from 'array' or jsonb_array_length(v->'cards')<>216
  or jsonb_typeof(v->'numeric_assertions') is distinct from 'array' or jsonb_array_length(v->'numeric_assertions')>4320
  or (select count(distinct items.item) from jsonb_array_elements(v->'numeric_assertions')items(item))<>jsonb_array_length(v->'numeric_assertions')
  or jsonb_typeof(v->'reference_jobs') is distinct from 'array' or jsonb_array_length(v->'reference_jobs')>72
  then raise exception 'OFFLINE_SNAPSHOT_SCOPE';end if;
 foreach field in array array['cutoff','prepared_at','expires_at'] loop
  if jsonb_typeof(v->field) is distinct from 'string' or coalesce(v->>field,'') !~ iso_pattern
   or not isfinite((v->>field)::timestamptz) then raise exception 'OFFLINE_SNAPSHOT_TIME';end if;
 end loop;
 select * into b from vnext_runtime.ai_stock_batches where id=v->>'batch_id';
 if b.id is null or not vnext_private.ai_batch_commitment_v1(b.id) or jsonb_array_length(b.payload->'packets')<>72
  or v->'packet_hashes' is distinct from b.payload->'packet_hashes'
  or (v->>'cutoff')::timestamptz is distinct from b.cutoff or v->>'through' is distinct from b.payload->>'through'
  or (v->>'prepared_at')::timestamptz<b.cutoff or (v->>'prepared_at')::timestamptz>at_time
  or (v->>'expires_at')::timestamptz<=at_time or (v->>'expires_at')::timestamptz<=(v->>'prepared_at')::timestamptz
  or (v->>'expires_at')::timestamptz>b.cutoff+interval '72 hours' then raise exception 'OFFLINE_SNAPSHOT_BATCH_TIME';end if;
 if exists(select from jsonb_array_elements(v->'reference_jobs')j where jsonb_typeof(j)<>'string' or j#>>'{}' !~ '^[a-f0-9]{64}$')
  or (select count(distinct j) from jsonb_array_elements_text(v->'reference_jobs')j)<>jsonb_array_length(v->'reference_jobs')
  or exists(select from jsonb_array_elements_text(v->'reference_jobs')requested(id) where not exists(
   select from vnext_runtime.ai_stock_jobs j where j.id=requested.id and j.state='COMPLETE'))
  then raise exception 'OFFLINE_REFERENCE_JOBS';end if;
 for card in select * from jsonb_array_elements(v->'cards') loop
  if jsonb_typeof(card) is distinct from 'object' or not card ?& array['symbol','company','horizon','status','reason','counter_evidence','confirmation','invalidation','gaps','sources','classification']
   or (select count(*) from jsonb_object_keys(card))<>11 or card->>'classification' is distinct from 'INFERENCE'
   or exists(select from unnest(array['symbol','company','horizon','status','classification'])k where jsonb_typeof(card->k) is distinct from 'string')
   or coalesce(card->>'symbol','') !~ '^[0-9]{4,6}$' or coalesce(card->>'horizon','') not in('SHORT','MEDIUM','LONG')
   or coalesce(card->>'status','') not in('WATCH','WAIT','AVOID','INSUFFICIENT')
   or (card->>'symbol')||':'||(card->>'horizon')=any(keys)
   then raise exception 'OFFLINE_CARD_SCOPE';end if;
  keys:=array_append(keys,(card->>'symbol')||':'||(card->>'horizon'));symbols:=array_append(symbols,card->>'symbol');
  select p into strict packet from jsonb_array_elements(b.payload->'packets')p where p->>'symbol'=card->>'symbol';
  if card->>'company' is distinct from packet->>'company'
   or jsonb_typeof(card->'sources') is distinct from 'array' or jsonb_array_length(card->'sources') not between 1 and 100
   or jsonb_typeof(card->'counter_evidence') is distinct from 'array' or jsonb_array_length(card->'counter_evidence')>20
   or jsonb_typeof(card->'gaps') is distinct from 'array' or jsonb_array_length(card->'gaps')>130
   or exists(select from jsonb_array_elements(card->'gaps')g where jsonb_typeof(g)<>'string' or length(btrim(g#>>'{}')) not between 1 and 1500)
   or exists(select from jsonb_array_elements_text(coalesce(packet->'data_gaps','[]'::jsonb))g where not(card->'gaps') ? g)
   or (card->>'status'='INSUFFICIENT' and jsonb_array_length(card->'gaps')=0)
   or (select count(distinct s->>'id') from jsonb_array_elements(card->'sources')s)<>jsonb_array_length(card->'sources')
   then raise exception 'OFFLINE_CARD_BINDING';end if;
  foreach field in array array['confirmation','invalidation'] loop
   if jsonb_typeof(card->field) is distinct from 'string' or length(btrim(card->>field)) not between 1 and 1500
    or card->>field ~ '[0-9０-９]' or card->>field ~ '[零〇一二三四五六七八九十百千萬億兩壹貳參肆伍陸柒捌玖拾佰仟點点半]+[[:space:]]*(元|圓|塊|角|分)'
    or card->>field ~ '(上看|站上|守住|跌破|突破|回測|支撐|壓力|停損|目標價|價位)[[:space:]]*[零〇一二三四五六七八九十百千萬億兩壹貳參肆伍陸柒捌玖拾佰仟點点半]+'
    then raise exception 'OFFLINE_CONDITION';end if;
  end loop;
  if concat(card->'reason'->>'text',card->>'confirmation',card->>'invalidation',card->'counter_evidence') ~ '(保證獲利|穩賺|必漲|必賺)'
   then raise exception 'OFFLINE_UNSUPPORTED_PROMISE';end if;
  for claim in select card->'reason' union all select * from jsonb_array_elements(card->'counter_evidence') loop
   if jsonb_typeof(claim) is distinct from 'object' or not claim ?& array['text','evidence_ids']
    or (select count(*) from jsonb_object_keys(claim))<>2
    or jsonb_typeof(claim->'text') is distinct from 'string' or length(btrim(claim->>'text')) not between 1 and 1500
    or jsonb_typeof(claim->'evidence_ids') is distinct from 'array' or jsonb_array_length(claim->'evidence_ids') not between 1 and 100
    or exists(select from jsonb_array_elements(claim->'evidence_ids')id where jsonb_typeof(id)<>'string')
    or (select count(distinct id) from jsonb_array_elements_text(claim->'evidence_ids')id)<>jsonb_array_length(claim->'evidence_ids')
    or exists(select from jsonb_array_elements_text(claim->'evidence_ids')asked(id) where not exists(
     select from jsonb_array_elements(packet->'evidence')e where e->>'id'=asked.id)
     or not exists(select from jsonb_array_elements(card->'sources')s where s->>'id'=asked.id))
    then raise exception 'OFFLINE_CLAIM';end if;
  end loop;
  if card->>'status'='WATCH' and not exists(select from jsonb_array_elements(packet->'evidence')e
   where e->>'symbol'=card->>'symbol' and card->'reason'->'evidence_ids' ? (e->>'id')) then raise exception 'OFFLINE_WATCH_SOURCE';end if;
  for source in select * from jsonb_array_elements(card->'sources') loop
   select e into strict ev from jsonb_array_elements(packet->'evidence')e where e->>'id'=source->>'id';
   if source is distinct from jsonb_build_object('id',ev->>'id','source',ev->>'source','kind',ev->>'kind','published_at',ev->>'published_at',
     'available_at',ev->>'available_at','time_basis',coalesce(ev->>'time_basis','PUBLISHED'),'first_seen_at',ev->>'first_seen_at','as_of',ev->>'as_of','evidence_hash',ev->>'evidence_hash')
    or (ev->>'available_at')::timestamptz>b.cutoff
    or not(card->'reason'->'evidence_ids') ? (ev->>'id') and not exists(select from jsonb_array_elements(card->'counter_evidence')ce where ce->'evidence_ids' ? (ev->>'id'))
    then raise exception 'OFFLINE_SOURCE';end if;
  end loop;
 end loop;
 if cardinality(array(select distinct unnest(symbols)))<>72 or cardinality(keys)<>216 then raise exception 'OFFLINE_UNIVERSE';end if;
 for a in select * from jsonb_array_elements(v->'numeric_assertions') loop
  if jsonb_typeof(a) is distinct from 'object' or not a ?& array['symbol','horizon','claim_path','claim_hash','text_fragment','operator','left','right','expected']
   or (select count(*) from jsonb_object_keys(a))<>9 or coalesce(a->>'operator','') not in('EQ','NE','GT','GTE','LT','LTE')
   or exists(select from unnest(array['symbol','horizon','claim_path','claim_hash','text_fragment','operator'])k where jsonb_typeof(a->k) is distinct from 'string')
   or jsonb_typeof(a->'expected') is distinct from 'boolean' or coalesce(a->>'claim_path','') !~ '^(reason|counter_evidence\.(0|[1-9][0-9]?))$'
   or length(coalesce(a->>'text_fragment','')) not between 1 and 1500 then raise exception 'OFFLINE_NUMERIC_SCOPE';end if;
  select c into strict card from jsonb_array_elements(v->'cards')c where c->>'symbol'=a->>'symbol' and c->>'horizon'=a->>'horizon';
  path:=string_to_array(a->>'claim_path','.');claim:=card#>path;
  if claim is null or a->>'claim_hash' is distinct from vnext_private.offline_claim_hash_v1(claim)
   or position(a->>'text_fragment' in claim->>'text')=0
   or position(a->>'text_fragment' in substring(claim->>'text' from position(a->>'text_fragment' in claim->>'text')+1))>0
   then raise exception 'OFFLINE_NUMERIC_CLAIM';end if;
  select p into strict packet from jsonb_array_elements(b.payload->'packets')p where p->>'symbol'=a->>'symbol';
  if (a->'left') ? 'literal' then raise exception 'OFFLINE_NUMERIC_LEFT_SOURCE';end if;
  left_value:=vnext_private.offline_numeric_operand_v1(packet,claim,a->'left');right_value:=vnext_private.offline_numeric_operand_v1(packet,claim,a->'right');
  if not(a->'right') ? 'literal' and a->'left'->'unit'<>'null'::jsonb and a->'right'->'unit'<>'null'::jsonb
   and a->'left'->'unit' is distinct from a->'right'->'unit' then raise exception 'OFFLINE_NUMERIC_UNIT_MISMATCH';end if;
  comparison:=case a->>'operator' when 'EQ' then left_value=right_value when 'NE' then left_value<>right_value
   when 'GT' then left_value>right_value when 'GTE' then left_value>=right_value when 'LT' then left_value<right_value else left_value<=right_value end;
  if to_jsonb(comparison) is distinct from a->'expected' then raise exception 'OFFLINE_NUMERIC_ASSERTION_FALSE';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('offline-reviewed-snapshot:'||p_snapshot_hash,0));
 select * into prior from vnext_private.reviewed_analysis_snapshots_v1 where snapshot_hash=p_snapshot_hash;
 if found and (prior.body_text is distinct from p_body_text or prior.validator_document_hash is distinct from p_validator_document_hash)
  then raise exception 'OFFLINE_SNAPSHOT_REPLAY_CONFLICT';end if;
 insert into vnext_private.reviewed_analysis_snapshots_v1(snapshot_hash,batch_id,author_ref,body_text,body,validator_document_hash)
 values(p_snapshot_hash,b.id,v->>'author_ref',p_body_text,v,p_validator_document_hash) on conflict do nothing;
 return jsonb_build_object('state','OFFLINE_SNAPSHOT_STAGED_FULL_REVIEW_REQUIRED','snapshot_hash',p_snapshot_hash,
  'cards',216,'model_generated',false,'model_calls',0,'independent_review_required',true,'member_published',false);
end $$;
revoke all on function public.stage_offline_reviewed_analysis_snapshot_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_offline_reviewed_analysis_snapshot_v1(text,text,text) to service_role;

create function vnext_private.offline_reviewed_payload_v1(p_snapshot_hash text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema','VNEXT_AI_RESEARCH_EDITION_V1','mode','AS_OF_RESEARCH','batch_id',s.batch_id,
  'job_set_hash',encode(sha256(convert_to('','UTF8')),'hex'),'cutoff',b.cutoff,'through',b.payload->>'through',
  'cards',s.body->'cards','source_urls',(select jsonb_agg(distinct ev->>'source' order by ev->>'source')
   from jsonb_array_elements(b.payload->'packets')p,jsonb_array_elements(p->'evidence')ev),
  'forecast',false,'performance_available',false,'analysis_origin','OFFLINE_REVIEWED','reviewed_snapshot_hash',s.snapshot_hash,
  'model_generated',false,'new_model_calls',0)
 from vnext_private.reviewed_analysis_snapshots_v1 s join vnext_runtime.ai_stock_batches b on b.id=s.batch_id where s.snapshot_hash=p_snapshot_hash;
$$;
revoke all on function vnext_private.offline_reviewed_payload_v1(text) from public,anon,authenticated,service_role;

create function vnext_private.offline_reviewed_edition_integrity_v1(p_id text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select from vnext_private.ai_research_editions e
 join vnext_private.reviewed_analysis_snapshots_v1 s on s.snapshot_hash=e.reviewed_snapshot_hash
 join vnext_runtime.ai_stock_batches b on b.id=s.batch_id
 where e.id=p_id and cardinality(e.job_keys)=0 and e.job_set_hash=encode(sha256(convert_to('','UTF8')),'hex')
  and e.batch_id=b.id and e.cutoff=b.cutoff and e.through=(b.payload->>'through')::date
  and s.body=s.body_text::jsonb and s.snapshot_hash=encode(sha256(convert_to(s.body_text,'UTF8')),'hex')
  and s.author_ref=s.body->>'author_ref' and s.body->>'provenance'='OFFLINE_REVIEWED' and s.body->'model_generated'='false'::jsonb
  and s.body->'packet_hashes'=b.payload->'packet_hashes' and (s.body->>'cutoff')::timestamptz=b.cutoff
  and (s.body->>'prepared_at')::timestamptz<=s.recorded_at and s.recorded_at<=e.created_at
  and e.expires_at<=(s.body->>'expires_at')::timestamptz and e.expires_at<=b.cutoff+interval '72 hours'
  and vnext_private.ai_batch_commitment_v1(b.id) and e.payload=vnext_private.offline_reviewed_payload_v1(s.snapshot_hash)
  and encode(sha256(convert_to(e.payload::text,'UTF8')),'hex')=e.id);
$$;
revoke all on function vnext_private.offline_reviewed_edition_integrity_v1(text) from public,anon,authenticated,service_role;

-- Preserve the existing model-integrity function's source byte-for-byte. The
-- new public-name wrapper selects offline records only by their explicit FK.
alter function vnext_private.ai_edition_integrity_v1(text) rename to ai_model_edition_integrity_legacy_v1;
create function vnext_private.ai_edition_integrity_v1(p_id text) returns boolean
language sql stable security definer set search_path='' as $$
 select case when exists(select from vnext_private.ai_research_editions e where e.id=p_id and e.reviewed_snapshot_hash is not null)
  then vnext_private.offline_reviewed_edition_integrity_v1(p_id)
  else vnext_private.ai_model_edition_integrity_legacy_v1(p_id) end;
$$;
revoke all on function vnext_private.ai_edition_integrity_v1(text) from public,anon,authenticated,service_role;

create function public.stage_offline_reviewed_analysis_edition_v1(p_snapshot_hash text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s vnext_private.reviewed_analysis_snapshots_v1;b vnext_runtime.ai_stock_batches;
 payload jsonb;eid text;at_time timestamptz:=clock_timestamp();existing vnext_private.ai_research_editions;
begin
 if p_snapshot_hash is null or p_snapshot_hash !~ '^[a-f0-9]{64}$' or p_expires_at is null or not isfinite(p_expires_at)
  then raise exception 'OFFLINE_EDITION_SCOPE';end if;
 select * into s from vnext_private.reviewed_analysis_snapshots_v1 where snapshot_hash=p_snapshot_hash;
 if s.snapshot_hash is null then raise exception 'OFFLINE_EDITION_SNAPSHOT';end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=s.batch_id;
 if s.recorded_at>at_time or p_expires_at<=at_time or p_expires_at>(s.body->>'expires_at')::timestamptz
  or p_expires_at>b.cutoff+interval '72 hours' then raise exception 'OFFLINE_EDITION_EXPIRY';end if;
 -- Reuse the current model-stage time cap; this can only shorten the requested expiry.
 p_expires_at:=vnext_runtime.documented_review_edition_expiry_v2(b.payload,p_expires_at);
 payload:=vnext_private.offline_reviewed_payload_v1(s.snapshot_hash);eid:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 insert into vnext_private.ai_research_editions(id,batch_id,business_date,cutoff,through,job_keys,job_set_hash,payload,expires_at,reviewed_snapshot_hash,created_at)
 values(eid,b.id,(b.cutoff at time zone 'Asia/Taipei')::date,b.cutoff,(b.payload->>'through')::date,'{}',
  encode(sha256(convert_to('','UTF8')),'hex'),payload,p_expires_at,s.snapshot_hash,at_time) on conflict do nothing;
 select * into strict existing from vnext_private.ai_research_editions where id=eid;
 if existing.expires_at<=at_time or not vnext_private.ai_edition_integrity_v1(eid) then raise exception 'OFFLINE_EDITION_INTEGRITY_OR_EXPIRED';end if;
 return jsonb_build_object('state','OFFLINE_EDITION_STAGED_FULL_REVIEW_REQUIRED','edition_id',eid,'snapshot_hash',s.snapshot_hash,
  'analysis_origin','OFFLINE_REVIEWED','model_jobs',0,'cards',216,'model_calls',0,'reviews_copied',false,'member_published',false);
end $$;
revoke all on function public.stage_offline_reviewed_analysis_edition_v1(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.stage_offline_reviewed_analysis_edition_v1(text,timestamptz) to service_role;

-- Existing full-review triggers still run; this adds author independence for
-- offline snapshots, which correctly have no provider model/job to compare.
create function vnext_private.offline_review_author_independence_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select from vnext_private.ai_research_editions e join vnext_private.reviewed_analysis_snapshots_v1 s
  on s.snapshot_hash=e.reviewed_snapshot_hash where e.id=new.edition_id and new.reviewer_ref=s.author_ref)
  then raise exception 'OFFLINE_AUTHOR_CANNOT_SELF_REVIEW';end if;return new;
end $$;
revoke all on function vnext_private.offline_review_author_independence_v1() from public,anon,authenticated,service_role;
create trigger offline_author_independence before insert on vnext_private.ai_research_reviews
 for each row execute function vnext_private.offline_review_author_independence_v1();
do $$begin
 if to_regclass('vnext_private.ai_research_use_reviews') is not null then
  execute 'create trigger offline_author_independence before insert on vnext_private.ai_research_use_reviews for each row execute function vnext_private.offline_review_author_independence_v1()';
 end if;
end $$;
commit;
