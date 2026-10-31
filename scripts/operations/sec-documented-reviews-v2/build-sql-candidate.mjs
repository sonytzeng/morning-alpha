/** Generate a fingerprint-bound V2 candidate only; never executes SQL. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir=new URL('./',import.meta.url),registry=JSON.parse(await readFile(new URL('sealed-registry.json',dir),'utf8'));
const live=JSON.parse(await readFile(new URL('live16-baseline/functions.json',dir),'utf8'));
const stage=JSON.parse(await readFile(new URL('live16-baseline/stage-functions.json',dir),'utf8'))[0];
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const canonical=v=>JSON.stringify(stable(v));
const sha=s=>createHash('sha256').update(s).digest('hex'),facts=canonical(registry.facts),basis=canonical(registry.review_price_basis);
if(sha(facts)!==registry.facts_sha256||facts.includes('$review_facts$')||basis.includes('$review_basis$'))throw Error('V2_SQL_SOURCE_DRIFT');
const source=live.find(f=>f.schema_name==='public'),v1=live.find(f=>f.proname==='validate_daily_ai_financial_refresh_sec_v1'),projection=live.find(f=>f.proname==='project_daily_stock_ai_inputs_v1');
for(const f of [source,v1,projection,stage])if(sha(f.definition)!==f.definition_sha256)throw Error('V2_SQL_LIVE_FINGERPRINT');
const oldValidator='vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(',newValidator='vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2(';
const oldProjection='vnext_runtime.project_daily_stock_ai_inputs_v1(final_inputs)',newProjection='vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(final_inputs)';
if(source.definition.split(oldValidator).length!==2||source.definition.split(oldProjection).length!==2)throw Error('V2_SQL_CALLSITE_SCOPE');
const patched=source.definition.replace(oldValidator,newValidator).replace(oldProjection,newProjection),postHash=sha(patched);
const stageNeedle=" payload:=jsonb_build_object('schema','VNEXT_AI_RESEARCH_EDITION_V1'";
if(stage.definition.split(stageNeedle).length!==2)throw Error('V2_SQL_STAGE_CALLSITE');
const stageLine=' p_expires_at := vnext_runtime.documented_review_edition_expiry_v2(b.payload,p_expires_at);\n';
const patchedStage=stage.definition.replace(stageNeedle,stageLine+stageNeedle),stageHash=sha(patchedStage);
const sql=`-- CANDIDATE ONLY. New immutable three-review registry; V1 and old intakes unchanged.
-- No source admission, publication, Cron, model/provider, secret or RLS relaxation.
-- ACTIVE reviews bind exactly to the retained quote/date and exclusive expiry.
-- Inactive reviews are omitted from new working inputs; original registry/history remains.
begin;
do $guard$
begin
 if to_regclass('vnext_private.verified_documented_reviews_v2') is not null
  or to_regprocedure('vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2(jsonb,jsonb,jsonb,timestamptz,date)') is not null
  or to_regprocedure('public.load_daily_stock_ai_documented_reviews_v2(text,timestamptz)') is not null
  then raise exception 'DOCUMENTED_REVIEW_V2_ALREADY_PRESENT';end if;
 if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)')),'UTF8')),'hex') is distinct from '${source.definition_sha256}'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(jsonb,jsonb,jsonb,timestamptz,date)')),'UTF8')),'hex') is distinct from '${v1.definition_sha256}'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('vnext_runtime.project_daily_stock_ai_inputs_v1(jsonb)')),'UTF8')),'hex') is distinct from '${projection.definition_sha256}'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.stage_daily_ai_research_edition_v1(text,text[],timestamptz)')),'UTF8')),'hex') is distinct from '${stage.definition_sha256}'
  then raise exception 'DOCUMENTED_REVIEW_V2_LIVE_DRIFT';end if;
end $guard$;

create table vnext_private.verified_documented_reviews_v2(
 source_seal_sha256 text primary key check(source_seal_sha256='${registry.source_seal_sha256}'),
 facts_sha256 text not null check(facts_sha256='${registry.facts_sha256}'),
 facts_text text not null check(encode(sha256(convert_to(facts_text,'UTF8')),'hex')=facts_sha256
  and jsonb_typeof(facts_text::jsonb)='array' and jsonb_array_length(facts_text::jsonb)=3),
 source_review_sha256 text not null check(source_review_sha256='${registry.source_review_sha256}'),
 review_receipt_sha256 text not null check(review_receipt_sha256='${registry.review_receipt_sha256}'),
 review_valid_until text not null check(review_valid_until='${registry.review_valid_until}' and isfinite(review_valid_until::timestamptz)),
 review_price_basis_text text not null check(encode(sha256(convert_to(review_price_basis_text,'UTF8')),'hex')='${sha(basis)}'),
 source_admitted boolean not null default false check(source_admitted=false),
 member_publication_approved boolean not null default false check(member_publication_approved=false)
);
alter table vnext_private.verified_documented_reviews_v2 enable row level security;
revoke all on table vnext_private.verified_documented_reviews_v2 from public,anon,authenticated,service_role;
create function vnext_private.seal_documented_reviews_v2() returns trigger language plpgsql set search_path='' as $fn$
begin raise exception 'DOCUMENTED_REVIEW_V2_REGISTRY_IMMUTABLE';end $fn$;
revoke all on function vnext_private.seal_documented_reviews_v2() from public,anon,authenticated,service_role;
create trigger seal_documented_reviews_v2 before update or delete or truncate on vnext_private.verified_documented_reviews_v2
 for each statement execute function vnext_private.seal_documented_reviews_v2();
insert into vnext_private.verified_documented_reviews_v2(source_seal_sha256,facts_sha256,facts_text,source_review_sha256,review_receipt_sha256,review_valid_until,review_price_basis_text)
 values('${registry.source_seal_sha256}','${registry.facts_sha256}',$review_facts$${facts}$review_facts$,
 '${registry.source_review_sha256}','${registry.review_receipt_sha256}','${registry.review_valid_until}',$review_basis$${basis}$review_basis$);

create function public.load_daily_stock_ai_documented_reviews_v2(p_source_seal text,p_cutoff timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare r vnext_private.verified_documented_reviews_v2;
begin
 if p_source_seal is distinct from '${registry.source_seal_sha256}' or p_cutoff is null or not isfinite(p_cutoff) then raise exception 'DOCUMENTED_REVIEW_V2_SCOPE';end if;
 select * into strict r from vnext_private.verified_documented_reviews_v2 where source_seal_sha256=p_source_seal;
 if exists(select from jsonb_array_elements(r.facts_text::jsonb)f where (f->>'available_at')::timestamptz>p_cutoff) then raise exception 'DOCUMENTED_REVIEW_V2_FUTURE_RECEIPT';end if;
 return jsonb_build_object('schema','DOCUMENTED_REVIEW_REGISTRY_V2','source_seal_sha256',r.source_seal_sha256,
  'facts_sha256',r.facts_sha256,'facts',r.facts_text::jsonb,'source_review_sha256',r.source_review_sha256,
  'review_receipt_sha256',r.review_receipt_sha256,'review_valid_until',r.review_valid_until,
  'review_price_basis',r.review_price_basis_text::jsonb,'source_admitted',false,'member_publication_approved',false);
end $fn$;
revoke all on function public.load_daily_stock_ai_documented_reviews_v2(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_documented_reviews_v2(text,timestamptz) to service_role;

create function vnext_runtime.is_documented_review_v2(p_fact jsonb) returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(p_fact->>'id' like 'own-documented-review:%',false);
$fn$;
revoke all on function vnext_runtime.is_documented_review_v2(jsonb) from public,anon,authenticated,service_role;

-- Only raw quote identity is read; no market forecasting or negative inference.
create function vnext_runtime.documented_review_phase_v2(p_inputs jsonb,p_cutoff timestamptz,p_until text,p_basis jsonb) returns jsonb
language plpgsql immutable set search_path='' as $fn$
declare s jsonb;bar_count integer;closing numeric;observed jsonb;state text;
begin
 select x into s from jsonb_array_elements(p_inputs)x where x->>'symbol'='2330';
 select count(*),min(case when jsonb_typeof(b->'close')='number' then (b->>'close')::numeric else null end) into bar_count,closing
  from jsonb_array_elements(coalesce(s->'bars','[]'))b where b->>'date'=s->>'through';
 if bar_count<>1 or closing is null or closing<=0 then closing:=null;end if;
 observed:=jsonb_build_object('session_date',s->'through','close_twd',closing);
 if p_cutoff>=(p_until::timestamptz) then state:='EXPIRED_NOT_APPLIED';
 elsif s is null or coalesce(s->>'through','') !~ '^\\d{4}-\\d\\d-\\d\\d$' or closing is null then state:='PRICE_DATE_UNVERIFIED_NOT_APPLIED';
 elsif s->>'through' is distinct from p_basis->>'session_date' then state:='PRICE_DATE_CHANGED_NOT_APPLIED';
 elsif closing is distinct from (p_basis->>'close_twd')::numeric then state:='PRICE_CHANGED_NOT_APPLIED';
 elsif (select count(*) from jsonb_array_elements(s->'facts')f where f->>'id' like 'sec-quarter:2330:%')<>12 then state:='FINANCIAL_BASE_INCOMPLETE_NOT_APPLIED';
 else state:='ACTIVE';end if;
 return jsonb_build_object('state',state,'observed_price',observed);
end $fn$;
revoke all on function vnext_runtime.documented_review_phase_v2(jsonb,timestamptz,text,jsonb) from public,anon,authenticated,service_role;

-- Preserve V1's projection and all 71 other issuers. Only ACTIVE review inputs
-- reserve the 84-company-observation budget by retaining one latest as-reported
-- observation per financial kind. Omitted old observations remain in history.
create function vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(p_inputs jsonb) returns jsonb
language plpgsql stable set search_path='' as $fn$
declare r vnext_private.verified_documented_reviews_v2;reviews jsonb;registered jsonb;projected jsonb;phase jsonb;result jsonb;
begin
 projected:=vnext_runtime.project_daily_stock_ai_inputs_v1(p_inputs);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into reviews from jsonb_array_elements(p_inputs)i,
  lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_documented_review_v2(f);
 if reviews='[]'::jsonb then return projected;end if;
 select * into strict r from vnext_private.verified_documented_reviews_v2;
 select jsonb_agg(f order by (f->>'id') collate "C") into registered from jsonb_array_elements(r.facts_text::jsonb)f;
 if reviews is distinct from registered then raise exception 'DOCUMENTED_REVIEW_V2_PROJECT_SCOPE';end if;
 phase:=vnext_runtime.documented_review_phase_v2(p_inputs,(p_inputs->0->>'cutoff')::timestamptz,r.review_valid_until,r.review_price_basis_text::jsonb);
 select jsonb_agg(i.value||jsonb_build_object('facts',case when i.value->>'symbol'<>'2330' then i.value->'facts' else (
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]'::jsonb) from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where case when phase->>'state'<>'ACTIVE' then not vnext_runtime.is_documented_review_v2(f.value)
   when f.value->>'kind' not in('EPS_AS_REPORTED','FINANCIAL_AS_REPORTED','VALUATION_AS_REPORTED') then true
   else f.value=(select x from jsonb_array_elements(i.value->'facts')x where x->>'kind'=f.value->>'kind'
    order by coalesce(x->>'period','') desc,(x->>'available_at')::timestamptz desc,(x->>'id') collate "C" desc limit 1) end)end) order by i.ordinality)
 into result from jsonb_array_elements(projected) with ordinality i(value,ordinality);
 return result;
end $fn$;
revoke all on function vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(jsonb) from public,anon,authenticated,service_role;

create function vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2(p_base_inputs jsonb,p_inputs jsonb,p_refresh jsonb,p_cutoff timestamptz,p_business_date date) returns jsonb
language plpgsql stable set search_path='' as $fn$
declare r vnext_private.verified_documented_reviews_v2;registered jsonb;base_reviews jsonb;incoming_reviews jsonb;provided boolean;
 phase jsonb;state text;expected jsonb;base_stripped jsonb;input_stripped jsonb;prior_proof jsonb;projected jsonb;required_ids jsonb;selected_ids jsonb;price_count integer;
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72
  or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i where jsonb_typeof(i->'facts') is distinct from 'array')
  then raise exception 'DOCUMENTED_REVIEW_V2_INPUT_SCOPE';end if;
 provided:=coalesce(p_refresh?'documented_review_replay',false);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into base_reviews from jsonb_array_elements(p_base_inputs)i,
  lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_documented_review_v2(f);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into incoming_reviews from jsonb_array_elements(p_inputs)i,
  lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_documented_review_v2(f);
 if not provided and base_reviews='[]'::jsonb and incoming_reviews='[]'::jsonb then
  return vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(p_base_inputs,p_inputs,p_refresh,p_cutoff,p_business_date);end if;
 if p_cutoff is null or not isfinite(p_cutoff) then raise exception 'DOCUMENTED_REVIEW_V2_CLOCK';end if;
 select * into strict r from vnext_private.verified_documented_reviews_v2;
 select jsonb_agg(f order by (f->>'id') collate "C") into registered from jsonb_array_elements(r.facts_text::jsonb)f;
 if (base_reviews<>'[]'::jsonb and base_reviews is distinct from registered)
  or (incoming_reviews<>'[]'::jsonb and incoming_reviews is distinct from registered)
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i,lateral jsonb_array_elements(i->'facts')f
   where vnext_runtime.is_documented_review_v2(f) and i->>'symbol' is distinct from '2330')
  or exists(select from jsonb_array_elements(registered)f where (f->>'available_at')::timestamptz>p_cutoff)
  then raise exception 'DOCUMENTED_REVIEW_V2_FACT_DRIFT';end if;
 phase:=vnext_runtime.documented_review_phase_v2(p_inputs,p_cutoff,r.review_valid_until,r.review_price_basis_text::jsonb);state:=phase->>'state';
 if provided and p_refresh->'documented_review_replay'->>'state'='REGISTRY_UNAVAILABLE_NOT_APPLIED' then state:='REGISTRY_UNAVAILABLE_NOT_APPLIED';end if;
 if not provided and incoming_reviews='[]'::jsonb and state='ACTIVE' then state:='REGISTRY_UNAVAILABLE_NOT_APPLIED';end if;
 if not provided and base_reviews='[]'::jsonb and incoming_reviews<>'[]'::jsonb then raise exception 'DOCUMENTED_REVIEW_V2_PROOF_REQUIRED';end if;
 if state='ACTIVE' and incoming_reviews is distinct from registered
  or provided and state<>'ACTIVE' and incoming_reviews<>'[]'::jsonb then raise exception 'DOCUMENTED_REVIEW_V2_ACTIVATION';end if;
 expected:=jsonb_build_object('schema','DOCUMENTED_REVIEW_REPLAY_V2','source_seal_sha256',r.source_seal_sha256,'facts_sha256',r.facts_sha256,
  'review_valid_until',r.review_valid_until,'review_price_basis',r.review_price_basis_text::jsonb,
  'review_fact_ids',(select jsonb_agg(f->>'id' order by (f->>'id') collate "C") from jsonb_array_elements(registered)f),
  'applied_fact_ids',case when state='ACTIVE' then (select jsonb_agg(f->>'id' order by (f->>'id') collate "C") from jsonb_array_elements(registered)f)else '[]'::jsonb end,
  'state',state,'observed_price',phase->'observed_price','source_refetched',false,'source_admitted',false,'member_publication_approved',false);
 if provided and p_refresh->'documented_review_replay' is distinct from expected then raise exception 'DOCUMENTED_REVIEW_V2_PROOF_DRIFT';end if;
 select jsonb_agg(i.value||jsonb_build_object('facts',(select coalesce(jsonb_agg(f.value order by f.ordinality),'[]')
  from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality) where not vnext_runtime.is_documented_review_v2(f.value))) order by i.ordinality)
 into base_stripped from jsonb_array_elements(p_base_inputs) with ordinality i(value,ordinality);
 select jsonb_agg(i.value||jsonb_build_object('facts',(select coalesce(jsonb_agg(f.value order by f.ordinality),'[]')
  from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality) where not vnext_runtime.is_documented_review_v2(f.value))) order by i.ordinality)
 into input_stripped from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality);
 prior_proof:=vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(base_stripped,input_stripped,
  case when p_refresh is null then null else p_refresh-'documented_review_replay' end,p_cutoff,p_business_date);
 if state='ACTIVE' then
  select vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(jsonb_agg(i||jsonb_build_object('cutoff',p_cutoff))) into projected from jsonb_array_elements(p_inputs)i;
  select coalesce(jsonb_agg(f->>'id' order by (f->>'id') collate "C"),'[]') into required_ids from jsonb_array_elements(p_inputs)i,
   lateral jsonb_array_elements(i->'facts')f where i->>'symbol'='2330' and (vnext_runtime.is_documented_review_v2(f) or f->>'id' like 'sec-quarter:2330:%');
  select count(*) into price_count from jsonb_array_elements(projected)i,
   lateral jsonb_array_elements_text(i->'expected_sessions') with ordinality s(day,n),lateral jsonb_array_elements(i->'bars')b
   where i->>'symbol'='2330' and s.n>greatest(jsonb_array_length(i->'expected_sessions')-20,0) and b->>'date'=s.day;
  select coalesce(jsonb_agg(f.value->>'id' order by (f.value->>'id') collate "C"),'[]') into selected_ids from jsonb_array_elements(projected)i,
   lateral jsonb_array_elements(i->'facts') with ordinality f(value,n)
   where i->>'symbol'='2330' and f.n<=84-price_count and (vnext_runtime.is_documented_review_v2(f.value) or f.value->>'id' like 'sec-quarter:2330:%');
  if jsonb_array_length(required_ids)<>15 or selected_ids is distinct from required_ids then raise exception 'DOCUMENTED_REVIEW_V2_15_EVIDENCE_BUDGET';end if;
 end if;
 return prior_proof||jsonb_build_object('documented_review_replay',expected);
end $fn$;
revoke all on function vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2(jsonb,jsonb,jsonb,timestamptz,date) from public,anon,authenticated,service_role;

-- Match the exact model-visible projection of a registered fact. Raw source
-- hashes/permissions remain bound through the unchanged per-fact evidence hash.
create function vnext_runtime.documented_review_packet_fact_matches_v2(p_e jsonb,p_f jsonb) returns boolean
language sql immutable set search_path='' as $fn$
 select coalesce(p_e-'content'=jsonb_build_object('id','2330:FINANCIAL:'||(p_f->>'id'),'symbol','2330','kind','FINANCIAL',
  'source',p_f->>'source','published_at',p_f->'published_at','available_at',p_f->>'available_at',
  'first_seen_at',p_f->>'first_seen_at','as_of',p_f->>'as_of','evidence_hash',p_f->>'evidence_hash',
  'time_basis',case when p_f->'published_at'='null'::jsonb then 'OBSERVED_AFTER_RECEIPT' else 'PUBLISHED' end)
  and (p_e->>'content')::jsonb=jsonb_build_object('kind',p_f->>'kind','period',p_f->'period','basis',p_f->'basis',
   'values',p_f->'values','original_id',p_f->>'id'),false);
$fn$;
revoke all on function vnext_runtime.documented_review_packet_fact_matches_v2(jsonb,jsonb) from public,anon,authenticated,service_role;

-- Deadline is chosen before edition hashing/insertion, never by an AFTER hash
-- mutation. Legacy batches without this review namespace are exactly unchanged.
create function vnext_runtime.documented_review_packet_original_id_v2(p_e jsonb) returns text
language plpgsql immutable set search_path='' as $fn$
declare c jsonb;
begin
 if p_e->>'kind' is distinct from 'FINANCIAL' or jsonb_typeof(p_e->'content') is distinct from 'string' then return null;end if;
 begin c:=(p_e->>'content')::jsonb;exception when invalid_text_representation then return null;end;
 return c->>'original_id';
end $fn$;
revoke all on function vnext_runtime.documented_review_packet_original_id_v2(jsonb) from public,anon,authenticated,service_role;

create function vnext_runtime.documented_review_edition_expiry_v2(p_payload jsonb,p_requested timestamptz) returns timestamptz
language plpgsql volatile set search_path='' as $fn$
declare r vnext_private.verified_documented_reviews_v2;review_rows jsonb;stock jsonb;f jsonb;e jsonb;actual_ids jsonb;expected_ids jsonb;
 until_value timestamptz;basis_value jsonb;price_count integer;closing numeric;expected_count integer:=0;
begin
 select coalesce(jsonb_agg(jsonb_build_object('packet_symbol',p->'symbol','evidence',x)),'[]') into review_rows
  from jsonb_array_elements(coalesce(p_payload->'packets','[]'))p,lateral jsonb_array_elements(coalesce(p->'evidence','[]'))x
  where coalesce(x->>'id','') like '%own-documented-review:%'
   or exists(select from vnext_private.verified_documented_reviews_v2 known,lateral jsonb_array_elements(known.facts_text::jsonb)known_fact where known_fact->>'evidence_hash'=x->>'evidence_hash')
   or coalesce(vnext_runtime.documented_review_packet_original_id_v2(x),'') like 'own-documented-review:%';
 if review_rows='[]'::jsonb then return p_requested;end if;
 select * into strict r from vnext_private.verified_documented_reviews_v2;
 until_value:=r.review_valid_until::timestamptz;basis_value:=r.review_price_basis_text::jsonb;
 if jsonb_array_length(review_rows)<>3 or exists(select from jsonb_array_elements(review_rows)x where x->>'packet_symbol'<>'2330')
  or p_requested is null or not isfinite(p_requested) or p_requested<=clock_timestamp()
  or clock_timestamp()>=until_value or p_payload->>'cutoff' is null or not isfinite((p_payload->>'cutoff')::timestamptz)
  or (p_payload->>'cutoff')::timestamptz>=until_value then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_EXPIRED_OR_SCOPE';end if;
 select p into strict stock from jsonb_array_elements(p_payload->'packets')p where p->>'symbol'='2330';
 select coalesce(jsonb_agg(x->>'id' order by (x->>'id') collate "C"),'[]') into actual_ids
  from jsonb_array_elements(p_payload->'packets')p,lateral jsonb_array_elements(p->'evidence')x
  where coalesce(x->>'id','') like '%own-documented-review:%' or coalesce(x->>'id','') like '%:FINANCIAL:sec-quarter:%'
   or coalesce(vnext_runtime.documented_review_packet_original_id_v2(x),'') like 'sec-quarter:%'
   or coalesce(vnext_runtime.documented_review_packet_original_id_v2(x),'') like 'own-documented-review:%'
   or x->>'kind'='FINANCIAL' and coalesce(x->>'source','') ~* '^https?://[^/]*sec[.]gov[^/]*/Archives/edgar/data/0*1046179(/|$)';
 select jsonb_agg('2330:FINANCIAL:'||(candidate_fact->>'id') order by (candidate_fact->>'id') collate "C") into expected_ids
  from (select x candidate_fact from jsonb_array_elements(r.facts_text::jsonb)x union all
   select x from vnext_private.verified_retained_sec_facts_v1 n,lateral jsonb_array_elements(n.facts_text::jsonb)x)sealed;
 if actual_ids is distinct from expected_ids then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_RESERVED_SCOPE';end if;
 if stock->>'data_through' is distinct from basis_value->>'session_date' then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_QUOTE_DATE';end if;
 select count(*),min(((x->>'content')::jsonb->>'close')::numeric) into price_count,closing
  from jsonb_array_elements(stock->'evidence')x where x->>'kind'='PRICE'
   and (x->>'content')::jsonb->>'date'=basis_value->>'session_date';
 if price_count<>1 or closing is distinct from (basis_value->>'close_twd')::numeric
  or exists(select from jsonb_array_elements(stock->'evidence')x where x->>'kind'='PRICE' and (x->>'content')::jsonb->>'date'>basis_value->>'session_date')
  then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_QUOTE_DRIFT';end if;
 for f in select x from jsonb_array_elements(r.facts_text::jsonb)x union all
  select x from vnext_private.verified_retained_sec_facts_v1 n,lateral jsonb_array_elements(n.facts_text::jsonb)x loop
  select x into strict e from jsonb_array_elements(stock->'evidence')x where x->>'id'='2330:FINANCIAL:'||(f->>'id');
  if not vnext_runtime.documented_review_packet_fact_matches_v2(e,f) then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_FACT_DRIFT';end if;
  expected_count:=expected_count+1;
 end loop;
 if expected_count<>15 then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_FINANCIAL_SCOPE';end if;
 return least(p_requested,until_value);
end $fn$;
revoke all on function vnext_runtime.documented_review_edition_expiry_v2(jsonb,timestamptz) from public,anon,authenticated,service_role;

-- SOURCE keeps all other live V16 code, including CLAIM's two original V1
-- projections and the existing V4 packet-equality validator.
do $patch$
declare d text;p text;
begin
 d:=pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)'));
 if encode(sha256(convert_to(d,'UTF8')),'hex') is distinct from '${source.definition_sha256}'
  or (length(d)-length(replace(d,'${oldValidator}','')))/length('${oldValidator}')<>1
  or (length(d)-length(replace(d,'${oldProjection}','')))/length('${oldProjection}')<>1 then raise exception 'DOCUMENTED_REVIEW_V2_SOURCE_DRIFT';end if;
 p:=replace(replace(d,'${oldValidator}','${newValidator}'),'${oldProjection}','${newProjection}');execute p;
 if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)')),'UTF8')),'hex') is distinct from '${postHash}' then raise exception 'DOCUMENTED_REVIEW_V2_PATCH_UNCONFIRMED';end if;
end $patch$;
do $stage_patch$
declare d text;p text;needle constant text:=$stage_needle$${stageNeedle}$stage_needle$;
begin
 d:=pg_get_functiondef(to_regprocedure('public.stage_daily_ai_research_edition_v1(text,text[],timestamptz)'));
 if encode(sha256(convert_to(d,'UTF8')),'hex') is distinct from '${stage.definition_sha256}'
  or (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_CALLSITE_DRIFT';end if;
 p:=replace(d,needle,$stage_line$${stageLine}$stage_line$||needle);execute p;
 if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.stage_daily_ai_research_edition_v1(text,text[],timestamptz)')),'UTF8')),'hex') is distinct from '${stageHash}'
  then raise exception 'DOCUMENTED_REVIEW_V2_STAGE_PATCH_UNCONFIRMED';end if;
end $stage_patch$;
commit;
`;
await writeFile(new URL('documented-reviews-v2.candidate.sql',dir),sql,{flag:process.argv[2]==='--refresh'?'w':'wx'});
console.log(JSON.stringify({sql_sha256:sha(sql),source_before:source.definition_sha256,source_after:postHash,stage_before:stage.definition_sha256,stage_after:stageHash,source_seal_sha256:registry.source_seal_sha256,production_writes:0}));
