-- Branch-local candidate. Named authoring/isolated-test approval: 2026-09-09.
-- No Production execution is authorized. No table/trigger attachment, RLS,
-- Cron, member profile, provider history or delivery row changes. Additional
-- named approval covers the existing private terminal reconciler definition;
-- this migration never invokes it or changes any business outcome.
begin;

-- Preserve the catalog contract of every existing function, including defaults.
create temporary table ma_consolidation_function_before on commit drop as
select oid, proname, proowner, proacl, prosecdef, proconfig,
 pg_get_function_identity_arguments(oid) signature, pg_get_function_arguments(oid) arguments,
 pg_get_function_result(oid) result
from pg_proc where oid in (
 'public.enforce_decision_snapshot_premium_90_gate_v1()'::regprocedure,
 'public.publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
 'public.publish_member_content_revision_v1(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb)'::regprocedure,
 'public.publish_decision_snapshot_v3(date,text,uuid,jsonb,uuid,text,integer)'::regprocedure,
 'public.capture_morning_alpha_acceptance_v1(date,text)'::regprocedure,
 'public.reconcile_runtime_terminal_failures_v1(date,uuid)'::regprocedure
);
create temporary table ma_consolidation_trigger_before on commit drop as
select oid, pg_get_triggerdef(oid) definition from pg_trigger
where tgname='decision_snapshots_premium_90_gate';

-- One market validator. Trigger, atomic writer, member writer and Acceptance
-- call this same contract. NULL optional documents are only the BEFORE-trigger
-- phase; the atomic publisher supplies all five documents before any write.
CREATE OR REPLACE FUNCTION public.validate_core_market_publication_v1(
 p_report_date date, p_ai jsonb, p_decision jsonb, p_contract jsonb, p_member jsonb, p_semantic jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO '' AS $function$
declare
 v_state jsonb:=p_decision#>'{generated_text,canonical_market_state}';
 v_document jsonb; v_quality jsonb; v_audit jsonb; v_claim jsonb; v_source jsonb;
 v_gate jsonb:=p_decision#>'{generated_text,market_report_gate}';
 v_recommendation jsonb; v_refs jsonb; v_expected jsonb; v_ids jsonb; v_state_ids jsonb;
 v_errors text[]:='{}'; v_field text; v_count integer; v_generated timestamptz;
 v_min numeric; v_sentence text:=p_decision#>>'{generated_text,daily_sentence}';
begin
 v_document:=v_state->'document'; v_quality:=v_document->'quality'; v_audit:=v_quality->'coverage_audit';
 select premium_publish_min into v_min from public.runtime_quality_policies where active=true limit 1;
 if v_min is null or v_min<90 or v_min>100 then v_errors:=array_append(v_errors,'PUBLICATION_POLICY_INVALID'); end if;
 if p_report_date is null or v_state->>'schema_version' is distinct from 'CANONICAL_MARKET_STATE_V1'
  or v_state->>'status' is distinct from 'READY' or v_state->'reason_codes' is distinct from '[]'::jsonb
  or v_state is distinct from p_ai->'canonical_market_state'
  or v_state->>'report_date' is distinct from p_report_date::text
  or v_state->>'today_date' is distinct from p_report_date::text
  or v_document->>'report_date' is distinct from p_report_date::text
  or v_document->>'today_date' is distinct from p_report_date::text
  or v_document->>'timezone' is distinct from 'Asia/Taipei'
  or v_state->>'generated_at' is distinct from v_document#>>'{provenance,generated_at}'
  or v_state->'data_as_of' is distinct from v_document->'data_as_of'
  or v_document#>'{sections,representative_stocks}' is distinct from '[]'::jsonb
 then v_errors:=array_append(v_errors,'CANONICAL_MARKET_IDENTITY_INVALID'); end if;
 begin
  v_generated:=(v_state->>'generated_at')::timestamptz;
  if v_generated is null or not isfinite(v_generated) or v_generated>clock_timestamp()
   or (v_generated at time zone 'Asia/Taipei')::date is distinct from p_report_date
   or nullif(v_state->>'data_as_of','')::timestamptz is null
   or not isfinite((v_state->>'data_as_of')::timestamptz)
   or (v_state->>'data_as_of')::timestamptz>v_generated
  then v_errors:=array_append(v_errors,'MARKET_GENERATION_TIME_INVALID'); end if;
 exception when invalid_datetime_format or datetime_field_overflow then
  v_errors:=array_append(v_errors,'MARKET_GENERATION_TIME_INVALID');
 end;
 if not coalesce(lower(v_quality->>'publish_status') in ('ready','approved','published','publishable'),false)
  or v_quality->'evidence_coverage' is distinct from '100'::jsonb
 then v_errors:=array_append(v_errors,'MARKET_QUALITY_NOT_READY'); end if;
 foreach v_field in array array['unsupported_claims','duplicate_claims','contradictions','missing_sections'] loop
  if v_quality->v_field is distinct from '[]'::jsonb then
   v_errors:=array_append(v_errors,'MARKET_QUALITY_'||upper(v_field));
  end if;
 end loop;
 if v_audit->>'contract_version' is distinct from 'CLAIM_EVIDENCE_LEDGER_V1'
  or jsonb_typeof(v_audit->'claims') is distinct from 'array'
 then v_errors:=array_append(v_errors,'MARKET_CLAIM_LEDGER_MISSING');
 else
  v_count:=jsonb_array_length(v_audit->'claims');
  if v_count=0 or v_audit->'numerator' is distinct from to_jsonb(v_count)
   or v_audit->'denominator' is distinct from to_jsonb(v_count)
  then v_errors:=array_append(v_errors,'MARKET_CLAIM_COVERAGE_INCOMPLETE'); end if;
  for v_claim in select value from jsonb_array_elements(v_audit->'claims') loop
   if v_claim->>'scope' is distinct from 'market' or v_claim->'supported' is distinct from 'true'::jsonb
    or v_claim->'reason_codes' is distinct from '[]'::jsonb
    or nullif(btrim(v_claim->>'statement'),'') is null
    or nullif(btrim(v_claim->>'claim_id'),'') is null
    or jsonb_typeof(v_claim->'evidence_ids') is distinct from 'array'
    or jsonb_typeof(v_claim->'sources') is distinct from 'array'
   then v_errors:=array_append(v_errors,'MARKET_CLAIM_UNSUPPORTED'); continue; end if;
   if jsonb_array_length(v_claim->'evidence_ids')=0 or jsonb_array_length(v_claim->'sources')=0
    or exists(select 1 from jsonb_array_elements(v_claim->'evidence_ids') x
     where jsonb_typeof(x) is distinct from 'string' or nullif(btrim(x#>>'{}'),'') is null)
   then v_errors:=array_append(v_errors,'MARKET_CLAIM_EVIDENCE_MISSING'); end if;
   select coalesce(jsonb_agg(x order by x),'[]') into v_ids from (select distinct value x from jsonb_array_elements(v_claim->'evidence_ids')) t;
   select coalesce(jsonb_agg(x order by x),'[]') into v_refs from (select distinct value->'evidence_id' x from jsonb_array_elements(v_claim->'sources')) t;
   if v_ids is distinct from v_refs then v_errors:=array_append(v_errors,'MARKET_CLAIM_SOURCE_ID_MISMATCH'); end if;
   for v_source in select value from jsonb_array_elements(v_claim->'sources') loop
    if nullif(btrim(v_source->>'source'),'') is null
     or nullif(btrim(v_source->>'evidence_id'),'') is null
     or not coalesce(case v_source->>'source'
       when 'sector_rotation_scores' then lower(btrim(v_source->>'freshness'))='previous_trading_day'
         and v_source->>'source_date' ~ '^\d{4}-\d{2}-\d{2}$' and v_source->>'source_date'<p_report_date::text
       when 'reports' then lower(btrim(v_source->>'freshness'))='previous_report'
         and v_source->>'source_date' ~ '^\d{4}-\d{2}-\d{2}$' and v_source->>'source_date'<p_report_date::text
       else lower(btrim(v_source->>'freshness')) in ('fresh','recent') end,false)
    then v_errors:=array_append(v_errors,'MARKET_SOURCE_PROVENANCE_INVALID'); end if;
    begin
     if nullif(v_source->>'source_date','')::timestamptz is null
      or not isfinite((v_source->>'source_date')::timestamptz)
      or (v_source->>'source_date')::timestamptz>v_generated
     then v_errors:=array_append(v_errors,'MARKET_SOURCE_TIME_INVALID'); end if;
    exception when invalid_datetime_format or datetime_field_overflow then
     v_errors:=array_append(v_errors,'MARKET_SOURCE_TIME_INVALID');
    end;
   end loop;
  end loop;
  select coalesce(jsonb_agg(x order by x),'[]') into v_ids from (
   select distinct e.value x from jsonb_array_elements(v_audit->'claims') c
   cross join lateral jsonb_array_elements(case when jsonb_typeof(c.value->'evidence_ids')='array'
     then c.value->'evidence_ids' else '[]' end) e
  ) t;
  if jsonb_typeof(v_state->'evidence_ids') is distinct from 'array' then
   v_errors:=array_append(v_errors,'MARKET_STATE_EVIDENCE_IDS_MISMATCH');
  else
   select coalesce(jsonb_agg(value order by value),'[]') into v_state_ids from jsonb_array_elements(v_state->'evidence_ids');
   if v_ids='[]'::jsonb or v_state_ids is distinct from v_ids
    then v_errors:=array_append(v_errors,'MARKET_STATE_EVIDENCE_IDS_MISMATCH'); end if;
  end if;
  select coalesce(jsonb_agg(x order by x),'[]') into v_expected from (
   select distinct jsonb_build_object('evidence_id',s.value->'evidence_id','source',s.value->'source',
    'source_date',s.value->'source_date','freshness',s.value->'freshness') x
   from jsonb_array_elements(v_audit->'claims') c
   cross join lateral jsonb_array_elements(case when jsonb_typeof(c.value->'sources')='array' then c.value->'sources' else '[]' end) s
  ) t;
  if jsonb_typeof(p_decision->'source_refs') is distinct from 'array' then
   v_errors:=array_append(v_errors,'MARKET_SOURCE_REFS_MISSING');
  else
   select coalesce(jsonb_agg(x order by x),'[]') into v_refs from (
    select distinct jsonb_build_object('evidence_id',value->'evidence_id','source',value->'source',
     'source_date',value->'source_date','freshness',value->'freshness') x from jsonb_array_elements(p_decision->'source_refs')) t;
   if v_refs is distinct from v_expected or v_refs='[]'
    or jsonb_array_length(p_decision->'source_refs')<>jsonb_array_length(v_refs)
   then v_errors:=array_append(v_errors,'MARKET_SOURCE_REFS_MISMATCH'); end if;
  end if;
 end if;
 if p_ai->>'data_quality' is distinct from 'complete' or p_decision->'coverage_score' is distinct from '100'::jsonb
  or p_decision#>>'{generated_text,data_quality}' is distinct from 'complete'
  or p_decision#>'{generated_text,missing_sources}' is distinct from '[]'::jsonb
  or jsonb_typeof(p_decision->'content_score') is distinct from 'number'
  or not coalesce((p_decision->>'content_score')::numeric between v_min and 100,false)
  or v_gate->'content_score' is distinct from p_decision->'content_score'
  or v_gate->>'contract_version' is distinct from 'MARKET_REPORT_GATE_V2'
  or v_gate->'eligible' is distinct from 'true'::jsonb
  or v_gate->>'report_status' is distinct from 'READY' or v_gate->'reason_codes' is distinct from '[]'::jsonb
  or v_gate->>'report_date' is distinct from p_report_date::text
  or v_gate is distinct from p_ai->'market_report_gate'
  or v_gate->>'decision_mode' is distinct from p_decision->>'decision_mode'
  or not coalesce(p_decision->>'decision_mode' in ('market_only','recommendations','no_trade'),false)
  or coalesce(nullif(btrim(p_decision#>>'{generated_text,market_bias}'),''),nullif(btrim(p_decision->>'market_regime'),'')) is null
  or nullif(btrim(v_sentence),'') is null or v_sentence is distinct from v_document#>>'{sections,executive_summary,text}'
 then v_errors:=array_append(v_errors,'MARKET_PUBLICATION_CONTRACT_INVALID'); end if;
 v_recommendation:=v_gate->'recommendation_gate';
 if p_decision->>'decision_mode'='recommendations' then
  -- A qualified stock branch still needs its independent 100% / zero-unsupported
  -- ledger. None of these counters is consulted by market_only publication.
  if p_ai#>>'{stock_research,document,report_date}' is distinct from p_report_date::text
   or p_ai#>'{stock_research,document,quality,evidence_coverage}' is distinct from '100'::jsonb
   or not coalesce(p_ai#>>'{stock_research,document,quality,publish_status}' in ('ready','approved','published','publishable'),false)
  then v_errors:=array_append(v_errors,'STOCK_RESEARCH_EVIDENCE_BLOCKED'); end if;
  foreach v_field in array array['unsupported_claims','duplicate_claims','contradictions','missing_sections'] loop
   if p_ai#>array['stock_research','document','quality',v_field] is distinct from '[]'::jsonb then
    v_errors:=array_append(v_errors,'STOCK_RESEARCH_'||upper(v_field));
   end if;
  end loop;
  if v_recommendation->'eligible' is distinct from 'true'::jsonb or v_recommendation->>'status' is distinct from 'QUALIFIED'
   or jsonb_typeof(p_decision#>'{generated_text,recommendations}') is distinct from 'array'
   or p_decision#>'{generated_text,recommendations}'='[]'::jsonb
  then v_errors:=array_append(v_errors,'RECOMMENDATION_EVIDENCE_BLOCKED'); end if;
 else
  if p_decision#>'{generated_text,recommendations}' is distinct from '[]'::jsonb
   or p_ai->'today_beneficiary_stocks' is distinct from '[]'::jsonb
   or p_ai->'today_beneficiary_stocks_v10' is distinct from '[]'::jsonb
   or coalesce(p_decision->'opportunity_score','null') is distinct from 'null'::jsonb
   or coalesce(p_decision#>'{generated_text,opportunity_score}','null') is distinct from 'null'::jsonb
   or coalesce(p_decision->'stock_opportunities','[]') is distinct from '[]'::jsonb
  then v_errors:=array_append(v_errors,'UNQUALIFIED_STOCK_PROJECTION_FORBIDDEN'); end if;
  if p_decision->>'decision_mode'='market_only' and (
   p_decision->>'action' is distinct from 'WAIT' or v_gate->>'status' is distinct from 'READY_MARKET_ONLY'
   or v_recommendation->'eligible' is distinct from 'false'::jsonb
   or not coalesce(v_recommendation->>'status' in ('BLOCKED','NO_QUALIFIED_OPPORTUNITY'),false))
  then v_errors:=array_append(v_errors,'MARKET_ONLY_CONTRACT_INVALID'); end if;
 end if;
 if v_recommendation->>'status'='NO_QUALIFIED_OPPORTUNITY' and (
  v_recommendation->'universe_evaluation_complete' is distinct from 'true'::jsonb
  or v_recommendation#>>'{screening,status}' is distinct from 'COMPLETE'
  or v_recommendation#>'{screening,rejected}' is distinct from '[]'::jsonb
  or jsonb_typeof(v_recommendation#>'{screening,universe_count}') is distinct from 'number'
  or not coalesce((v_recommendation#>>'{screening,universe_count}')::numeric>0,false)
  or trunc((v_recommendation#>>'{screening,universe_count}')::numeric) is distinct from (v_recommendation#>>'{screening,universe_count}')::numeric
  or v_recommendation#>'{screening,universe_count}' is distinct from v_recommendation#>'{screening,evaluated_count}')
 then v_errors:=array_append(v_errors,'UNIVERSE_EVALUATION_UNVERIFIED'); end if;
 if p_contract is not null then
  if p_contract->>'report_date' is distinct from p_report_date::text
   or p_contract->>'decision_mode' is distinct from p_decision->>'decision_mode'
   or p_contract->>'action' is distinct from p_decision->>'action'
   or p_contract->>'data_quality_status' is distinct from 'complete'
   or p_contract->'market_report_gate' is distinct from v_gate
   or (p_decision->>'decision_mode'<>'recommendations' and p_contract->'primary_symbols' is distinct from '[]'::jsonb)
  then v_errors:=array_append(v_errors,'MEMBER_CANONICAL_CONTRACT_MISMATCH'); end if;
 end if;
 if p_member is not null then
  if p_contract is null or p_member->'canonical_contract' is distinct from p_contract
   or p_member->>'today_core_thesis' is distinct from v_sentence or p_member->>'line_summary' is distinct from v_sentence
  then v_errors:=array_append(v_errors,'MEMBER_MARKET_TEXT_DIVERGENCE'); end if;
  if p_decision->>'decision_mode'<>'recommendations' and (
   p_member->'beneficiary_candidates' is distinct from '[]'::jsonb or p_member->'representative_stocks' is distinct from '[]'::jsonb
   or coalesce(p_member->'recommendations','[]') is distinct from '[]'::jsonb
   or coalesce(p_member->'stock_opportunities','[]') is distinct from '[]'::jsonb
   or coalesce(p_member->'opportunity_score','null') is distinct from 'null'::jsonb)
  then v_errors:=array_append(v_errors,'MEMBER_UNQUALIFIED_STOCKS_FORBIDDEN'); end if;
 end if;
 if p_semantic is not null and (p_semantic->>'status' is distinct from 'PASSED'
  or p_semantic->'eligible' is distinct from 'true'::jsonb
  or p_semantic->'reason_codes' is distinct from '[]'::jsonb
  or p_semantic->'conflicting_fields' is distinct from '[]'::jsonb)
 then v_errors:=array_append(v_errors,'SEMANTIC_MARKET_CONTRACT_BLOCKED'); end if;
 return jsonb_build_object('schema_version','CORE_MARKET_VALIDATION_V1','report_date',p_report_date,
  'eligible',cardinality(v_errors)=0,'reason_codes',(select coalesce(jsonb_agg(x order by x),'[]') from (select distinct unnest(v_errors) x)t));
end;
$function$;
ALTER FUNCTION public.validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_decision_snapshot_premium_90_gate_v1()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
declare v_ai jsonb; v_date date; v_result jsonb;
begin
 -- Preserve this trigger's timing/events/attachment. Non-published QA and other
 -- sessions are not market publication. No text keyword promotes state.
 if new.session_type='PREMARKET' and new.status='READY' then
  select report_date,ai_strategy_json into v_date,v_ai from public.reports where id=new.report_id;
  if v_date is distinct from new.report_date then raise exception 'MARKET_REPORT_IDENTITY_REQUIRED'; end if;
  -- A closed-day digest is not a trading-day publication or stability day.
  if v_ai->'is_trading_day'='false'::jsonb then return new; end if;
  v_result:=public.validate_core_market_publication_v1(new.report_date,v_ai,to_jsonb(new),null,null,null);
  if v_result->'eligible' is distinct from 'true'::jsonb then
   raise exception 'CORE_MARKET_PUBLICATION_GATE_BLOCKED: %',v_result->'reason_codes';
  end if;
 end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_decision_snapshot_v3(p_report_date date, p_session_type text, p_report_id uuid, p_payload jsonb, p_correlation_id uuid, p_idempotency_key text, p_attempt integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_snapshot_id uuid;
  v_research_session_id uuid;
  v_policy public.runtime_quality_policies%rowtype;
  v_score numeric;
  v_pipeline_status text;
  v_snapshot public.decision_snapshots;
begin
  if p_correlation_id is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'correlation_id and idempotency_key are required';
  end if;

  select * into v_policy
  from public.runtime_quality_policies
  where active = true
  limit 1;
  if not found then
    raise exception 'active runtime quality policy missing';
  end if;

  v_snapshot_id := public.publish_decision_snapshot_v2(
    p_report_date,
    p_session_type,
    p_report_id,
    p_payload
  );

  select * into strict v_snapshot from public.decision_snapshots where id=v_snapshot_id;
  v_research_session_id:=v_snapshot.research_session_id;

  v_score := nullif(p_payload ->> 'content_score', '')::numeric;
  v_pipeline_status := case
    when coalesce((p_payload ->> 'safe_mode')::boolean, false) then 'DEGRADED'
    when p_payload ->> 'decision_mode' = 'blocked' then 'DEGRADED'
    -- Pipeline success follows the actual trigger-validated stored snapshot.
    when v_snapshot.status in ('READY','FINAL') and v_score >= v_policy.premium_publish_min then 'SUCCEEDED'
    when v_score >= v_policy.auto_repair_min then 'DEGRADED'
    else 'FAILED'
  end;

  insert into public.pipeline_runs (
    research_session_id,
    decision_snapshot_id,
    trading_date,
    checkpoint,
    idempotency_key,
    status,
    attempt,
    started_at,
    completed_at,
    reason_codes,
    correlation_id,
    engine_version,
    safe_mode,
    duration_ms,
    delivery_status,
    recovery_plan,
    updated_at
  ) values (
    v_research_session_id,
    v_snapshot_id,
    p_report_date,
    p_session_type,
    p_idempotency_key,
    v_pipeline_status,
    greatest(1, coalesce(p_attempt, 1)),
    coalesce(nullif(p_payload ->> 'started_at', '')::timestamptz, now()),
    now(),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[]),
    p_correlation_id,
    nullif(p_payload ->> 'engine_version', ''),
    coalesce((p_payload ->> 'safe_mode')::boolean, false),
    nullif(p_payload ->> 'duration_ms', '')::integer,
    case when v_pipeline_status = 'SUCCEEDED' then 'PENDING' else 'FAILED' end,
    coalesce(p_payload -> 'recovery_plan', '{}'::jsonb),
    now()
  )
  on conflict (idempotency_key) do update
    set research_session_id = excluded.research_session_id,
        decision_snapshot_id = excluded.decision_snapshot_id,
        status = excluded.status,
        completed_at = excluded.completed_at,
        reason_codes = excluded.reason_codes,
        correlation_id = excluded.correlation_id,
        engine_version = excluded.engine_version,
        safe_mode = excluded.safe_mode,
        duration_ms = excluded.duration_ms,
        delivery_status = excluded.delivery_status,
        recovery_plan = excluded.recovery_plan,
        updated_at = now();

  return v_snapshot_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_member_content_revision_v1(p_report_date date, p_report_id uuid, p_decision_snapshot_id uuid, p_idempotency_key text, p_source_revision text, p_canonical_contract jsonb, p_member_content jsonb, p_semantic_result jsonb, p_content_score numeric, p_evidence_coverage numeric, p_generated_at timestamp with time zone, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing uuid;
  v_snapshot public.decision_snapshots;
  v_revision integer;
  v_revision_id uuid;
  v_status text := upper(coalesce(p_semantic_result->>'status','BLOCKED'));
  v_ai jsonb; v_validation jsonb; v_existing_row public.member_content_revisions;
  v_gate_version text := coalesce(p_semantic_result->>'gate_version','SEMANTIC_COHERENCE_V2');
begin
  if p_report_date is null or p_report_id is null or p_decision_snapshot_id is null then
    raise exception 'member revision identity is required';
  end if;
  if coalesce(trim(p_idempotency_key),'') = '' or coalesce(trim(p_source_revision),'') = '' then
    raise exception 'member revision idempotency and source revision are required';
  end if;
  if v_status not in ('PASSED','BLOCKED','DEGRADED') then
    raise exception 'invalid semantic status: %', v_status;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('member_content:' || p_report_date::text, 0));
  select * into v_existing_row from public.member_content_revisions where idempotency_key=p_idempotency_key;
  if found then
   if v_existing_row.report_date is distinct from p_report_date or v_existing_row.report_id is distinct from p_report_id
    or v_existing_row.decision_snapshot_id is distinct from p_decision_snapshot_id
    or v_existing_row.source_revision is distinct from p_source_revision
    or v_existing_row.canonical_contract is distinct from p_canonical_contract
    or v_existing_row.member_content is distinct from p_member_content
    or v_existing_row.content_score is distinct from p_content_score
    or v_existing_row.evidence_coverage is distinct from p_evidence_coverage
    or v_existing_row.status is distinct from v_status then raise exception 'MEMBER_IDEMPOTENCY_CONFLICT'; end if;
   return v_existing_row.id;
  end if;
  select * into v_snapshot from public.decision_snapshots where id = p_decision_snapshot_id for share;
  if not found or v_snapshot.report_date <> p_report_date or v_snapshot.report_id <> p_report_id then
    raise exception 'snapshot/report/date contract mismatch';
  end if;
  if p_canonical_contract->>'snapshot_id' is distinct from p_decision_snapshot_id::text
    or nullif(p_canonical_contract->>'snapshot_version','')::integer is distinct from v_snapshot.version then
    raise exception 'canonical snapshot identity mismatch';
  end if;
  select ai_strategy_json into v_ai from public.reports where id=p_report_id and report_date=p_report_date;
  if v_snapshot.session_type='PREMARKET' and v_status='PASSED' and v_ai->'is_trading_day' is distinct from 'false'::jsonb then
   v_validation:=public.validate_core_market_publication_v1(p_report_date,v_ai,to_jsonb(v_snapshot),p_canonical_contract,p_member_content,p_semantic_result);
   if v_validation->'eligible' is distinct from 'true'::jsonb
    or v_snapshot.status is distinct from 'READY'
    or p_content_score is distinct from v_snapshot.content_score
    or p_evidence_coverage is distinct from 100
    or p_generated_at is null or p_generated_at>clock_timestamp()
   then raise exception 'CORE_MARKET_MEMBER_CONTRACT_BLOCKED: %',v_validation->'reason_codes'; end if;
  end if;
  select coalesce(max(revision),0)+1 into v_revision
  from public.member_content_revisions where report_date = p_report_date;
  insert into public.member_content_revisions(
    report_date,report_id,decision_snapshot_id,decision_snapshot_version,revision,
    idempotency_key,status,canonical_contract,member_content,data_quality_status,
    content_score,evidence_coverage,source_revision,generated_at,metadata
  ) values (
    p_report_date,p_report_id,p_decision_snapshot_id,v_snapshot.version,v_revision,
    p_idempotency_key,v_status,p_canonical_contract,p_member_content,
    coalesce(p_canonical_contract->>'data_quality_status','insufficient'),
    p_content_score,p_evidence_coverage,p_source_revision,p_generated_at,coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_revision_id;
  insert into public.semantic_coherence_reviews(
    report_date,decision_snapshot_id,member_content_revision_id,gate_version,status,
    reason_codes,conflicting_fields,canonical_snapshot_id,canonical_snapshot_version,
    checked_at,idempotency_key,result
  ) values (
    p_report_date,p_decision_snapshot_id,v_revision_id,v_gate_version,v_status,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_semantic_result->'reason_codes','[]'::jsonb))),'{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_semantic_result->'conflicting_fields','[]'::jsonb))),'{}'::text[]),
    p_decision_snapshot_id,v_snapshot.version,
    coalesce(nullif(p_semantic_result->>'checked_at','')::timestamptz,now()),
    p_idempotency_key || ':semantic:' || v_gate_version,p_semantic_result
  );
  return v_revision_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_research_bundle_v1(p_run_id uuid, p_correlation_id uuid, p_report jsonb, p_decision jsonb, p_contract jsonb, p_member jsonb, p_semantic jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_date date := (p_report->>'report_date')::date;
  v_run public.pipeline_runs;
  v_snapshot public.decision_snapshots;
  v_report_id uuid; v_snapshot_id uuid; v_member_id uuid;
  v_columns text; v_updates text; v_field text; v_quality jsonb;
  v_quote text := p_decision#>>'{generated_text,daily_sentence}';
  v_previous_ai jsonb;
  v_result jsonb;
  v_validation jsonb; v_publication jsonb; v_opening_revision uuid; v_existing_result jsonb;
begin
  if v_date is null then raise exception 'REPORT_DATE_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('research-publication:' || v_date::text, 0));
  select * into v_run from public.pipeline_runs where id=p_run_id for update;
  if found and v_run.status='SUCCEEDED' and v_run.correlation_id=p_correlation_id
    and v_run.trading_date=v_date and p_decision->>'input_fingerprint'=v_run.provider_status->>'input_fingerprint' then
   v_existing_result:=v_run.provider_status->'result';
   if v_existing_result->'success'='true'::jsonb
    and exists(select 1 from public.decision_snapshots d where d.id::text=v_existing_result->>'decision_snapshot_id'
      and d.report_date=v_date and d.report_id::text=v_existing_result->>'report_id')
   then return v_existing_result; end if;
   raise exception 'PUBLICATION_REUSE_RECEIPT_INVALID';
  end if;
  if not found or p_correlation_id is null or v_run.trading_date is distinct from v_date
    or v_run.correlation_id is distinct from p_correlation_id or v_run.status is distinct from 'RUNNING'
    or not coalesce((v_run.provider_status->>'lease_expires_at')::timestamptz > clock_timestamp(),false) then
    raise exception 'RESEARCH_LEASE_LOST'; end if;
  if p_decision->>'input_fingerprint' is distinct from v_run.provider_status->>'input_fingerprint'
    or p_contract->>'report_date' is distinct from v_date::text then raise exception 'INPUT_REVISION_MISMATCH'; end if;
  if v_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb
    or not coalesce((v_run.provider_status#>>'{manifest,market_count}')::numeric>0,false)
    or not coalesce((v_run.provider_status#>>'{manifest,news_count}')::numeric>0,false)
    or not coalesce((v_run.provider_status#>>'{manifest,sector_count}')::numeric>0,false)
    or p_report#>>'{ai_strategy_json,data_quality}' is distinct from 'complete'
    or nullif(p_decision->>'data_as_of','') is null then raise exception 'SOURCE_COMPLETENESS_UNVERIFIED'; end if;
  if p_contract is null or p_member is null or p_semantic is null then raise exception 'PUBLICATION_DOCUMENTS_REQUIRED'; end if;
  v_validation:=public.validate_core_market_publication_v1(v_date,p_report->'ai_strategy_json',p_decision,p_contract,p_member,p_semantic);
  if v_validation->'eligible' is distinct from 'true'::jsonb then
   raise exception 'CORE_MARKET_PUBLICATION_GATE_BLOCKED: %',v_validation->'reason_codes';
  end if;
  if p_report->>'summary' is distinct from v_quote or p_report->>'today_quote' is distinct from v_quote
    or p_report->>'today_summary' is distinct from v_quote
    or p_member->>'today_core_thesis' is distinct from v_quote or p_member->>'line_summary' is distinct from v_quote
    or p_report#>>'{ai_strategy_json,line_push_copy,one_sentence}' is distinct from v_quote then
    raise exception 'CANONICAL_OUTPUT_DIVERGENCE'; end if;

  -- Lock the report and retain runtime evidence captured after the app's read.
  select id,ai_strategy_json into v_report_id,v_previous_ai from public.reports where report_date=v_date for update;
  foreach v_field in array array['opening_radar','opening_radar_status','intraday_tracking','intraday_sync_status','war_room','closing_contract','closing_verification','closing_verification_v2','todayCloseVerification'] loop
    if v_previous_ai ? v_field then p_report := jsonb_set(p_report,array['ai_strategy_json',v_field],v_previous_ai->v_field); end if;
  end loop;
  p_report := p_report || jsonb_build_object('updated_at',clock_timestamp());
  if exists(select 1 from jsonb_object_keys(p_report) k where k in ('id','created_at') or not exists(
    select 1 from pg_catalog.pg_attribute a where a.attrelid='public.reports'::regclass and a.attname=k and a.attnum>0 and not a.attisdropped)) then
    raise exception 'REPORT_COLUMNS_INVALID'; end if;
  select string_agg(format('%I',k),',' order by k),
    string_agg(format('%I=excluded.%I',k,k),',' order by k) filter(where k<>'report_date')
  into v_columns,v_updates from jsonb_object_keys(p_report) k;
  execute format('insert into public.reports(%s) select %s from jsonb_populate_record(null::public.reports,$1) on conflict(report_date) do update set %s returning id',v_columns,v_columns,v_updates)
    into v_report_id using p_report;

  -- Execution time is not decision identity. data_as_of and the effective input
  -- fingerprint remain in the hashed payload, as do source and policy versions.
  -- Freeze the independent recommendation proof at this exact publication,
  -- without allowing its rejection counters to block the market document.
  p_decision:=jsonb_set(p_decision,'{source_freshness}',
   coalesce(p_decision->'source_freshness','{}')||jsonb_build_object('status',p_report#>>'{ai_strategy_json,data_quality}'));
  p_decision:=jsonb_set(p_decision,'{generated_text}',
   coalesce(p_decision->'generated_text','{}')||jsonb_build_object('stock_research',p_report#>'{ai_strategy_json,stock_research}'));
  p_decision := p_decision - array['generated_at','started_at','duration_ms','correlation_id','recovery_plan'];
  v_snapshot_id := public.publish_decision_snapshot_v3(v_date,'PREMARKET',v_report_id,p_decision,p_correlation_id,
    'production-report:'||v_date::text||':PREMARKET',v_run.attempt);
  select * into strict v_snapshot from public.decision_snapshots where id=v_snapshot_id;
  if v_snapshot.status is distinct from 'READY' then raise exception 'STORED_MARKET_SNAPSHOT_NOT_READY'; end if;
  p_contract := p_contract || jsonb_build_object('snapshot_id',v_snapshot_id,'snapshot_version',v_snapshot.version);
  p_member := p_member || jsonb_build_object('canonical_contract',p_contract);
  p_semantic := p_semantic || jsonb_build_object('canonical_snapshot_id',v_snapshot_id,'canonical_snapshot_version',v_snapshot.version);
  v_member_id := public.publish_member_content_revision_v1(v_date,v_report_id,v_snapshot_id,
    'member-content:'||v_snapshot_id::text, v_run.provider_status->>'input_fingerprint',p_contract,p_member,p_semantic,
    (p_decision->>'content_score')::numeric,100,clock_timestamp(),
    jsonb_build_object('actor','generate-daily-report-v7','suppress_notifications',true,'pipeline_run_id',p_run_id));
  if not exists(select 1 from public.member_content_revisions where id=v_member_id and status='PASSED') then
    raise exception 'MEMBER_PUBLICATION_NOT_PASSED'; end if;
  -- The first published opening never follows later current QA/revisions.
  if v_previous_ai ? 'market_publication_contract' then
   if v_previous_ai#>>'{market_publication_contract,schema_version}' is distinct from 'CORE_MARKET_PUBLICATION_V1'
    or v_previous_ai#>>'{market_publication_contract,status}' is distinct from 'PUBLISHED'
    or v_previous_ai#>>'{market_publication_contract,report_date}' is distinct from v_date::text
    or v_previous_ai#>>'{market_publication_contract,revision_id}' is distinct from v_previous_ai->>'revision_id'
   then raise exception 'EXISTING_PUBLICATION_POINTER_INVALID'; end if;
   v_opening_revision:=(v_previous_ai#>>'{market_publication_contract,opening_publication_revision_id}')::uuid;
  elsif nullif(v_previous_ai->>'revision_id','') is not null then
   -- Compatibility accepts only an exact existing atomic receipt, never an
   -- is_current QA selector or a same-date guess.
   select d.id into v_opening_revision from public.decision_snapshots d
    where d.id::text=v_previous_ai->>'revision_id' and d.report_id=v_report_id
     and d.report_date=v_date and d.session_type='PREMARKET' and d.status='READY'
     and exists(select 1 from public.pipeline_runs r where r.trading_date=v_date and r.status='SUCCEEDED'
      and r.idempotency_key like 'research-input:%' and r.provider_status#>>'{result,decision_snapshot_id}'=d.id::text
      and r.provider_status#>>'{result,report_id}'=v_report_id::text
      and r.provider_status#>'{result,success}'='true'::jsonb);
   if v_opening_revision is null then raise exception 'EXISTING_PUBLICATION_RECEIPT_INVALID'; end if;
  else v_opening_revision:=v_snapshot_id;
  end if;
  if v_opening_revision is null or not exists(select 1 from public.decision_snapshots
   where id=v_opening_revision and report_id=v_report_id and report_date=v_date and session_type='PREMARKET' and status='READY')
  then raise exception 'OPENING_PUBLICATION_IDENTITY_INVALID'; end if;
  v_publication:=jsonb_build_object('schema_version','CORE_MARKET_PUBLICATION_V1','status','PUBLISHED',
   'report_date',v_date,'revision_id',v_snapshot_id,'opening_publication_revision_id',v_opening_revision,
   'publication_run_id',p_run_id,'published_at',clock_timestamp());
  update public.reports set ai_strategy_json=ai_strategy_json || jsonb_build_object('revision_id',v_snapshot_id,
    'canonical_contract',p_contract,'canonical_member_revision_id',v_member_id,'market_publication_contract',v_publication)
  where id=v_report_id;
  v_result := jsonb_build_object('success',true,'report_id',v_report_id,'decision_snapshot_id',v_snapshot_id,
    'member_content_revision_id',v_member_id,'report_date',v_date,'semantic_status','PASSED');
  perform public.finish_research_input_v1(p_run_id,p_correlation_id,'SUCCEEDED',v_result,null);
  return v_result;
end; $function$;

-- Named local-authoring fragment only. Root assembles the single approved
-- migration; this file is never a Production execution path.
-- The terminal consumer uses the same committed market authority as Payload
-- and Acceptance. A later private QA revision is not a new publication, and
-- blocked stock research is not grounds to reject a proven market_only report.
-- Original same-job replacement, failure evidence and private ACL are retained.
create or replace function public.reconcile_runtime_terminal_failures_v1(
  p_business_date date, p_correlation_id uuid
) returns integer language plpgsql security definer set search_path='' as $$
declare
  v_count integer; v_r public.reports; v_d public.decision_snapshots;
  v_m public.member_content_revisions; v_sem public.semantic_coherence_reviews;
  v_run public.pipeline_runs; v_pointer jsonb; v_ai jsonb; v_validation jsonb;
begin
  if p_business_date is null or p_correlation_id is null then raise exception 'RECONCILIATION_IDENTITY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-publication:'||p_business_date::text,0));
  select * into v_r from public.reports where report_date=p_business_date;
  v_pointer:=v_r.ai_strategy_json->'market_publication_contract';
  select * into v_d from public.decision_snapshots
    where id::text=v_r.ai_strategy_json->>'revision_id' and report_id=v_r.id
      and report_date=p_business_date and session_type='PREMARKET' and status='READY';
  select * into v_m from public.member_content_revisions
    where id::text=v_r.ai_strategy_json->>'canonical_member_revision_id'
      and decision_snapshot_id=v_d.id and decision_snapshot_version=v_d.version
      and report_id=v_r.id and report_date=p_business_date;
  select * into v_run from public.pipeline_runs
    where id::text=v_pointer->>'publication_run_id' and trading_date=p_business_date
      and idempotency_key like 'research-input:%' and status='SUCCEEDED'
      and provider_status#>'{result,success}'='true'::jsonb
      and provider_status#>>'{result,report_id}'=v_r.id::text
      and provider_status#>>'{result,report_date}'=p_business_date::text
      and provider_status#>>'{result,decision_snapshot_id}'=v_d.id::text
      and provider_status#>>'{result,member_content_revision_id}'=v_m.id::text
      and provider_status#>>'{result,semantic_status}'='PASSED'
      and completed_at>=v_d.valid_from and completed_at<=clock_timestamp()
      and (completed_at at time zone 'Asia/Taipei')::date=p_business_date;
  select * into v_sem from public.semantic_coherence_reviews
    where member_content_revision_id=v_m.id and decision_snapshot_id=v_d.id
      and report_date=p_business_date and canonical_snapshot_id=v_d.id
      and canonical_snapshot_version=v_d.version and status='PASSED'
      and cardinality(reason_codes)=0 and cardinality(conflicting_fields)=0
      and checked_at<=v_run.completed_at and result->>'status'='PASSED'
      and result->'eligible'='true'::jsonb and result->'reason_codes'='[]'::jsonb
      and result->'conflicting_fields'='[]'::jsonb
    order by checked_at limit 1;
  if v_r.id is null or v_d.id is null or v_m.id is null or v_run.id is null or v_sem.id is null
    or v_pointer->>'schema_version' is distinct from 'CORE_MARKET_PUBLICATION_V1'
    or v_pointer->>'status' is distinct from 'PUBLISHED'
    or v_pointer->>'report_date' is distinct from p_business_date::text
    or v_pointer->>'revision_id' is distinct from v_d.id::text
    or v_r.ai_strategy_json->'canonical_contract' is distinct from v_m.canonical_contract
    or v_m.canonical_contract->>'snapshot_id' is distinct from v_d.id::text
    or v_m.canonical_contract->'snapshot_version' is distinct from to_jsonb(v_d.version)
    or (v_d.valid_from at time zone 'Asia/Taipei')::date is distinct from p_business_date
    or v_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb
    or not exists(select 1 from public.research_sessions where id=v_d.research_session_id
      and trading_date=p_business_date and data_as_of is not null)
    or not exists(select 1 from public.editorial_reviews where decision_snapshot_id=v_d.id
      and review_status='APPROVED' and content_score>=90 and cardinality(reason_codes)=0)
  then raise exception 'TERMINAL_RECONCILIATION_BLOCKED:CURRENT_QUALITY_NOT_APPROVED'; end if;
  -- Reconstruct from the frozen publication, never from mutable research QA.
  -- No second quality threshold or mode translator is introduced here.
  v_ai:=jsonb_build_object('canonical_market_state',v_d.generated_text->'canonical_market_state',
    'research_master_v2',v_d.generated_text#>'{canonical_market_state,document}',
    'stock_research',v_d.generated_text->'stock_research',
    'market_report_gate',v_d.generated_text->'market_report_gate',
    'report_date',p_business_date,'today_date',p_business_date,'decision_mode',v_d.decision_mode,
    'canonical_action',v_d.action,'report_status',v_d.status,'data_quality',v_d.generated_text->'data_quality',
    'today_quote',v_d.generated_text->>'daily_sentence',
    'today_beneficiary_stocks',v_d.generated_text->'recommendations',
    'today_beneficiary_stocks_v10',v_d.generated_text->'recommendations');
  v_validation:=public.validate_core_market_publication_v1(p_business_date,v_ai,to_jsonb(v_d),
    v_m.canonical_contract,v_m.member_content,v_sem.result);
  if v_validation->'eligible' is distinct from 'true'::jsonb then
    raise exception 'TERMINAL_RECONCILIATION_BLOCKED:CURRENT_QUALITY_NOT_APPROVED';
  end if;
  with replacements as (
    select f.id, s.id success_id, v_d.id revision_id
    from public.runtime_http_dispatches f
    join lateral (
      select x.id from public.runtime_http_dispatches x
      where x.trading_date=f.trading_date and x.job_name=f.job_name
        and x.checkpoint is not distinct from f.checkpoint and x.endpoint=f.endpoint
        and x.id<>f.id and x.dispatch_status='SUCCEEDED' and x.response_success=true
        and x.http_status between 200 and 299 and x.completed_at>f.completed_at
        and x.response_body->>'report_date'=f.trading_date::text
        and x.response_body->>'decision_snapshot_id'=v_d.id::text
      order by x.completed_at desc limit 1
    ) s on true
    where f.trading_date=p_business_date and f.dispatch_status in ('FAILED','TIMED_OUT','DEAD_LETTERED')
  )
  update public.runtime_http_dispatches f set dispatch_status='SKIPPED',next_retry_at=null,updated_at=clock_timestamp(),
    response_body=coalesce(f.response_body,'{}')||jsonb_build_object('terminal_reconciliation',
      jsonb_build_object('reason','SAME_JOB_DURABLE_SUCCESS','success_dispatch_id',r.success_id,
        'decision_snapshot_id',r.revision_id,'correlation_id',p_correlation_id,'reconciled_at',clock_timestamp(),
        'original_http_status',f.http_status,'original_error_code',f.response_error_code,'original_completed_at',f.completed_at))
  from replacements r where f.id=r.id;
  get diagnostics v_count=row_count;
  update public.runtime_dead_letters dl set status='resolved',resolved_at=clock_timestamp(),
    context=dl.context||jsonb_build_object('terminal_reconciliation',f.response_body->'terminal_reconciliation')
  from public.runtime_http_dispatches f
  where dl.status='open' and dl.context->>'dispatch_id'=f.id::text and f.trading_date=p_business_date
    and f.dispatch_status='SKIPPED' and f.response_body#>>'{terminal_reconciliation,reason}'='SAME_JOB_DURABLE_SUCCESS';
  return v_count;
end; $$;
revoke all on function public.reconcile_runtime_terminal_failures_v1(date,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_runtime_terminal_failures_v1(date,uuid) to service_role;

create or replace function public.capture_morning_alpha_acceptance_v1(
  p_business_date date, p_evaluator_version text default 'PRODUCTION_ACCEPTANCE_V1'
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_d public.decision_snapshots; v_current public.decision_snapshots; v_c public.decision_snapshots;
  v_r public.reports; v_m public.member_content_revisions; v_sem public.semantic_coherence_reviews;
  v_day public.trading_day_state; v_learning public.learning_runs; v_prediction public.learning_predictions;
  v_source_run public.pipeline_runs; v_current_run public.pipeline_runs;
  v_now timestamptz:=clock_timestamp(); v_today date:=(clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_phase text; v_verdict text; v_block text[]:='{}'; v_auto_block text[]:='{}';
  v_revision text; v_pointer jsonb; v_validation jsonb; v_ai jsonb; v_close jsonb; v_closing_contract jsonb;
  v_learning_contract jsonb; v_field text; v_symbol text; v_quote jsonb; v_key text;
  v_evidence jsonb; v_id uuid; v_version text; v_line_count bigint; v_failed bigint; v_dead bigint;
  v_manual boolean; v_due_at timestamptz; v_incidents bigint; v_line_time timestamptz;
  v_close_ok boolean:=false; v_learning_ok boolean:=false; v_market_predictions bigint;
begin
  if p_business_date is null then raise exception 'BUSINESS_DATE_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-publication:'||p_business_date::text,0));
  select * into v_r from public.reports where report_date=p_business_date;
  select * into v_day from public.trading_day_state where trading_date=p_business_date;
  v_pointer:=v_r.ai_strategy_json->'market_publication_contract';
  v_revision:=v_pointer->>'opening_publication_revision_id';
  v_phase:=case when v_now < (p_business_date::text||'T08:00:00+08:00')::timestamptz then 'NOT_DUE'
    when v_now < (p_business_date::text||'T15:25:00+08:00')::timestamptz then 'MORNING' else 'FULL_DAY' end;
  if extract(isodow from p_business_date) in (6,7) or v_r.ai_strategy_json->'is_trading_day'='false'::jsonb then
    v_phase:='NON_TRADING'; v_verdict:='NOT_DUE';
  elsif v_phase='NOT_DUE' then v_verdict:='NOT_DUE';
  else
    -- A report JSON pointer alone cannot publish: both the current commitment
    -- and the frozen opening must have actual exact atomic success receipts.
    select * into v_current from public.decision_snapshots where id::text=v_r.ai_strategy_json->>'revision_id'
      and report_id=v_r.id and report_date=p_business_date and status='READY';
    if v_pointer->>'schema_version' is distinct from 'CORE_MARKET_PUBLICATION_V1'
      or v_pointer->>'status' is distinct from 'PUBLISHED'
      or v_pointer->>'report_date' is distinct from p_business_date::text
      or v_pointer->>'revision_id' is distinct from v_r.ai_strategy_json->>'revision_id'
      or nullif(v_revision,'') is null or v_current.id is null then
      v_block:=array_append(v_block,'REPORT_REVISION_MISMATCH');
    end if;
    select * into v_current_run from public.pipeline_runs where trading_date=p_business_date
      and idempotency_key like 'research-input:%' and status='SUCCEEDED'
      and provider_status#>'{result,success}'='true'::jsonb
      and provider_status#>>'{result,report_id}'=v_r.id::text
      and provider_status#>>'{result,report_date}'=p_business_date::text
      and provider_status#>>'{result,decision_snapshot_id}'=v_current.id::text
      and provider_status#>>'{result,member_content_revision_id}'=v_r.ai_strategy_json->>'canonical_member_revision_id'
      and provider_status#>>'{result,semantic_status}'='PASSED'
      and (v_pointer->>'publication_run_id' is null or id::text=v_pointer->>'publication_run_id')
      and completed_at>=v_current.valid_from and completed_at<=v_now
      and (completed_at at time zone 'Asia/Taipei')::date=p_business_date
      order by completed_at limit 1;
    if v_current_run.id is null then v_block:=array_append(v_block,'CURRENT_PUBLICATION_RECEIPT_UNVERIFIED'); end if;
    select * into v_d from public.decision_snapshots where id::text=v_revision and report_id=v_r.id
      and report_date=p_business_date and session_type='PREMARKET' and status='READY'
      and (valid_from at time zone 'Asia/Taipei')::date=p_business_date
      and valid_from < (p_business_date::text||'T09:00:00+08:00')::timestamptz and valid_from<=v_now;
    if v_d.id is null then v_block:=array_append(v_block,'CANONICAL_NOT_READY'); end if;
    select * into v_source_run from public.pipeline_runs where trading_date=p_business_date
      and idempotency_key like 'research-input:%' and status='SUCCEEDED'
      and provider_status#>'{result,success}'='true'::jsonb
      and provider_status#>>'{result,report_id}'=v_r.id::text
      and provider_status#>>'{result,report_date}'=p_business_date::text
      and provider_status#>>'{result,decision_snapshot_id}'=v_revision
      and provider_status#>>'{result,semantic_status}'='PASSED'
      and completed_at>=v_d.valid_from and completed_at<=v_now
      and (completed_at at time zone 'Asia/Taipei')::date=p_business_date
      and completed_at < (p_business_date::text||'T09:00:00+08:00')::timestamptz
      order by completed_at limit 1;
    if v_source_run.id is null then v_block:=array_append(v_block,'INPUT_LINEAGE_UNVERIFIED'); end if;
    select * into v_m from public.member_content_revisions
      where id::text=v_source_run.provider_status#>>'{result,member_content_revision_id}'
      and decision_snapshot_id=v_d.id and decision_snapshot_version=v_d.version
      and report_id=v_r.id and report_date=p_business_date;
    select * into v_sem from public.semantic_coherence_reviews where member_content_revision_id=v_m.id
      and decision_snapshot_id=v_d.id and report_date=p_business_date
      and canonical_snapshot_id=v_d.id and canonical_snapshot_version=v_d.version
      and status='PASSED' and cardinality(reason_codes)=0 and checked_at<=v_source_run.completed_at
      and cardinality(conflicting_fields)=0 and result->>'status'='PASSED'
      and result->'eligible'='true'::jsonb and result->'reason_codes'='[]'::jsonb
      and result->'conflicting_fields'='[]'::jsonb
      order by checked_at limit 1;
    if v_m.id is null or v_sem.id is null
      or v_m.canonical_contract->>'snapshot_id' is distinct from v_d.id::text
      or v_m.canonical_contract->'snapshot_version' is distinct from to_jsonb(v_d.version)
    then v_block:=array_append(v_block,'PREMIUM_SEMANTIC_NOT_PASSED'); end if;
    -- Re-audit only the actual frozen market document. Current private stock QA
    -- and member scores are diagnostics, not alternative market authorities.
    v_ai:=jsonb_build_object('canonical_market_state',v_d.generated_text->'canonical_market_state',
      'research_master_v2',v_d.generated_text#>'{canonical_market_state,document}',
      'stock_research',v_d.generated_text->'stock_research',
      'market_report_gate',v_d.generated_text->'market_report_gate',
      'report_date',p_business_date,'today_date',p_business_date,'decision_mode',v_d.decision_mode,
      'canonical_action',v_d.action,'report_status',v_d.status,'data_quality',v_d.generated_text->'data_quality',
      'today_quote',v_d.generated_text->>'daily_sentence',
      'today_beneficiary_stocks',v_d.generated_text->'recommendations',
      'today_beneficiary_stocks_v10',v_d.generated_text->'recommendations');
    if v_m.id is not null and v_sem.id is not null then
      v_validation:=public.validate_core_market_publication_v1(p_business_date,v_ai,to_jsonb(v_d),
        v_m.canonical_contract,v_m.member_content,v_sem.result);
    else
      v_validation:=jsonb_build_object('schema_version','CORE_MARKET_VALIDATION_V1','eligible',false,
        'report_date',p_business_date,'reason_codes',jsonb_build_array('PERSISTED_MEMBER_SEMANTIC_RECEIPT_MISSING'));
    end if;
    if v_validation->'eligible' is distinct from 'true'::jsonb then v_block:=array_append(v_block,'CORE_MARKET_PUBLICATION_UNVERIFIED'); end if;
    if v_source_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb
      or not coalesce((v_source_run.provider_status#>>'{manifest,market_count}')::numeric>0,false)
      or not coalesce((v_source_run.provider_status#>>'{manifest,news_count}')::numeric>0,false)
      or not coalesce((v_source_run.provider_status#>>'{manifest,sector_count}')::numeric>0,false)
      or not exists(select 1 from public.research_sessions where id=v_d.research_session_id
        and trading_date=p_business_date and data_as_of is not null)
      then v_block:=array_append(v_block,'SOURCE_COMPLETENESS_UNVERIFIED'); end if;
    if not exists(select 1 from public.editorial_reviews where decision_snapshot_id=v_d.id
      and review_status='APPROVED' and content_score>=90 and cardinality(reason_codes)=0)
      then v_block:=array_append(v_block,'EDITORIAL_NOT_APPROVED'); end if;
    select count(*),max(sent_at) into v_line_count,v_line_time from public.line_delivery_outbox
      where report_date=p_business_date and push_type='daily_report' and status='SENT' and decision_snapshot_id=v_d.id;
    if v_line_count=0 or exists(select 1 from public.line_delivery_outbox where report_date=p_business_date and push_type='daily_report'
      and (status<>'SENT' or decision_snapshot_id is distinct from v_d.id or sent_at is null)) then
      v_block:=array_append(v_block,'NORMAL_REPORT_LINE_NOT_COMPLETE'); end if;
    if exists(select 1 from public.line_delivery_outbox where report_date=p_business_date and push_type='daily_report'
      group by line_subscriber_id having count(*)>1) then v_block:=array_append(v_block,'DUPLICATE_REPORT_DELIVERY'); end if;
    if v_line_time is null or v_line_time >= (p_business_date::text||'T08:00:00+08:00')::timestamptz
      or (v_line_time at time zone 'Asia/Taipei')::date<>p_business_date then v_auto_block:=array_append(v_auto_block,'REPORT_DELIVERY_NOT_ON_TIME'); end if;
    if not exists(select 1 from public.ma_ops_runs where check_type='report' and status='passed'
      and details_json->>'target_date'=p_business_date::text and completed_at>=v_d.created_at)
      then v_block:=array_append(v_block,'PREMARKET_HEALTH_UNVERIFIED'); end if;
    if exists(select 1 from public.content_os_sync_incidents where business_date=p_business_date and status='OPEN')
      then v_block:=array_append(v_block,'CONTENT_HANDOFF_INCIDENT'); end if;
    foreach v_symbol in array array['TAIEX','2330','TXF','NVDA','TSM','SPX'] loop
      if not exists(select 1 from public.market_checkpoint_snapshots e
        where trading_date=p_business_date and checkpoint='PREMARKET' and market_session='premarket'
          and symbol=v_symbol and value is not null and change_percent is not null
          and value::text not in ('NaN','Infinity','-Infinity') and change_percent::text not in ('NaN','Infinity','-Infinity')
          and (captured_at at time zone 'Asia/Taipei')::date=p_business_date
          and captured_at < (p_business_date::text||'T08:00:00+08:00')::timestamptz
          and source_timestamp<=captured_at+interval '60 seconds' and source_timestamp<=created_at and captured_at<=created_at and coalesce(source,'')<>''
          and correlation_id::text=v_day.checkpoint_status#>>'{premarket,correlation_id}'
          and raw->>'contract'='FETCH_CHECKPOINT_EVIDENCE_V1' and exists(select 1 from public.market_data_snapshots m
           where m.trading_date=e.trading_date
            and m.checkpoint=case when e.checkpoint='PREMARKET' then 'premarket' else e.checkpoint end and m.symbol=e.symbol
            and m.phase=e.market_session and m.source=e.source and m.value=e.value
            and m.change_percent=e.change_percent and m.captured_at=e.source_timestamp
            and m.raw->>'correlation_id'=e.correlation_id::text
            and m.raw->>'immutable_snapshot_version'=e.snapshot_version::text
            and m.raw->>'immutable_checkpoint'=e.checkpoint))
        then v_block:=array_append(v_block,'PREMARKET_'||v_symbol||'_PRODUCER_EVIDENCE_MISSING'); end if;
    end loop;
    foreach v_field in array array['0900','0930','1030','1300','1410','1430'] loop
      v_due_at:=(p_business_date::text||'T'||substr(v_field,1,2)||':'||substr(v_field,3,2)||':00+08:00')::timestamptz+interval '5 minutes';
      if v_now<v_due_at then continue; end if;
      if v_day.checkpoint_status#>>array[v_field,'status'] is distinct from 'SUCCEEDED'
        or v_day.checkpoint_status#>>array[v_field,'updated_at'] is null
        or v_day.checkpoint_status#>array[v_field,'metadata','core_batch_complete'] is distinct from 'true'::jsonb
        then v_block:=array_append(v_block,'CHECKPOINT_'||v_field||'_UNVERIFIED'); end if;
      foreach v_symbol in array array['TAIEX','2330','TXF'] loop
        if not exists(select 1 from public.market_checkpoint_snapshots e where trading_date=p_business_date and checkpoint=v_field
          and market_session=case when v_field in ('1410','1430') then 'close' else 'intraday' end
          and captured_at<=v_now and (captured_at at time zone 'Asia/Taipei')::date=p_business_date
          and symbol=v_symbol and value is not null and change_percent is not null
          and value::text not in ('NaN','Infinity','-Infinity') and change_percent::text not in ('NaN','Infinity','-Infinity')
          and source_timestamp is not null and source_timestamp<=captured_at+interval '60 seconds' and source_timestamp<=created_at and captured_at<=created_at and coalesce(source,'')<>''
          and correlation_id::text=v_day.checkpoint_status#>>array[v_field,'correlation_id'] and exists(select 1 from public.market_data_snapshots m
           where m.trading_date=e.trading_date
            and m.checkpoint=case when e.checkpoint='PREMARKET' then 'premarket' else e.checkpoint end and m.symbol=e.symbol
            and m.phase=e.market_session and m.source=e.source and m.value=e.value
            and m.change_percent=e.change_percent and m.captured_at=e.source_timestamp
            and m.raw->>'correlation_id'=e.correlation_id::text
            and m.raw->>'immutable_snapshot_version'=e.snapshot_version::text
            and m.raw->>'immutable_checkpoint'=e.checkpoint))
          then v_block:=array_append(v_block,'CHECKPOINT_'||v_field||'_'||v_symbol||'_EVIDENCE_MISSING'); end if;
      end loop;
    end loop;
    if v_phase='FULL_DAY' then
      if v_day.current_state is distinct from 'DAY_COMPLETED' then v_block:=array_append(v_block,'DAY_NOT_COMPLETED'); end if;
      v_closing_contract:=v_r.ai_strategy_json->'closing_contract';
      select * into v_c from public.decision_snapshots where id::text=v_closing_contract->>'closing_snapshot_id'
        and report_id=v_r.id and report_date=p_business_date and session_type='CLOSING' and status='FINAL';
      v_close:=v_c.generated_text->'closing_verification_v2';
      begin
        v_close_ok:=v_closing_contract->>'schema_version'='CORE_CLOSING_V1'
          and v_closing_contract->>'status'='COMPLETE' and v_closing_contract->>'market_evaluation'='COMPLETE'
          and v_closing_contract->>'report_date'=p_business_date::text
          and v_closing_contract->>'opening_publication_revision_id'=v_revision
          and v_closing_contract->'reason_codes'='[]'::jsonb and v_closing_contract->'market_reason_codes'='[]'::jsonb
          and v_c.id is not null and v_c.coverage_score=100 and v_c.source_freshness->>'status'='complete'
          and v_close->>'status'='completed' and v_close->>'data_status'='complete'
          and v_close->>'report_date'=p_business_date::text
          and v_close->>'opening_decision_snapshot_id'=v_revision
          and v_close->'opening_decision_snapshot_version'=to_jsonb(v_d.version)
          and v_c.generated_text->>'opening_decision_snapshot_id'=v_revision
          and v_c.generated_text->'opening_decision_snapshot_version'=to_jsonb(v_d.version)
          and nullif(v_close->>'evidence_fingerprint','') is not null
          and v_c.generated_text->>'evidence_fingerprint'=v_close->>'evidence_fingerprint'
          and v_closing_contract->>'evidence_fingerprint'=v_close->>'evidence_fingerprint'
          and v_close->>'actual_direction' in ('up','down','flat') and v_close->>'hit_or_miss' in ('hit','miss','partial')
          and (v_close->>'verified_at')::timestamptz >= (p_business_date::text||'T14:10:00+08:00')::timestamptz
          and ((v_close->>'verified_at')::timestamptz at time zone 'Asia/Taipei')::date=p_business_date
          and v_c.valid_from>=(v_close->>'verified_at')::timestamptz and v_c.valid_from<=v_now
          and (v_c.valid_from at time zone 'Asia/Taipei')::date=p_business_date;
        if v_d.decision_mode in ('market_only','no_trade') then
          v_close_ok:=v_close_ok and v_closing_contract->>'stock_evaluation'='NOT_APPLICABLE'
            and v_close->'predicted_beneficiary_stocks'='[]'::jsonb
            and v_close#>'{beneficiary_list_validation,items}'='[]'::jsonb;
        end if;
        foreach v_field in array array['actual_taiex_close','actual_2330_close','actual_txf_close'] loop
          v_quote:=v_close->v_field;
          v_symbol:=v_quote->>'symbol';
          if not coalesce(v_symbol=any(case v_field
            when 'actual_taiex_close' then array['TAIEX','^TWII','TWII']
            when 'actual_2330_close' then array['2330','2330.TW','TSMC_TW']
            else array['TXF','TX','TXF1','MTX'] end),false)
            or jsonb_typeof(v_quote->'value') is distinct from 'number'
            or jsonb_typeof(v_quote->'change_percent') is distinct from 'number'
            or not coalesce((v_quote->>'phase'='close' and v_quote->>'trading_date'=p_business_date::text)
              or (v_close->>'version'='S2_P2_CLOSE_VERIFICATION_V2'
                and v_close#>>'{data_source,table}'='market_data_snapshots'
                and v_close#>'{data_source,no_fake_data}'='true'::jsonb),false)
            or not exists(select 1 from public.market_data_snapshots s where s.trading_date=p_business_date and s.phase='close'
              and s.symbol=v_symbol and s.source=v_quote->>'source' and s.value=(v_quote->>'value')::numeric
              and s.change_percent=(v_quote->>'change_percent')::numeric and s.value>0
              and s.value::text not in ('NaN','Infinity','-Infinity') and s.change_percent::text not in ('NaN','Infinity','-Infinity')
              and s.captured_at=(v_quote->>'captured_at')::timestamptz
              and s.captured_at between (p_business_date::text||'T13:30:00+08:00')::timestamptz and (p_business_date::text||'T18:00:00+08:00')::timestamptz
              and (v_field<>'actual_txf_close' or s.captured_at>=(p_business_date::text||'T13:40:00+08:00')::timestamptz)
              and (not(v_quote?'phase') or v_quote->>'phase'='close')
              and (not(v_quote?'trading_date') or v_quote->>'trading_date'=p_business_date::text)
              and (not(v_quote?'source_at') or ((v_quote->>'source_at')::timestamptz<=s.captured_at
                and ((v_quote->>'source_at')::timestamptz at time zone 'Asia/Taipei')::date=p_business_date
                and (v_quote->>'source_at')::timestamptz>=(p_business_date::text||case when v_field='actual_txf_close' then 'T13:40:00+08:00' else 'T13:25:00+08:00' end)::timestamptz))
              and (s.raw->>'returned_date' is null or ((s.raw->>'returned_date')::timestamptz<=s.captured_at
                and ((s.raw->>'returned_date')::timestamptz at time zone 'Asia/Taipei')::date=p_business_date
                and (s.raw->>'returned_date')::timestamptz>=(p_business_date::text||case when v_field='actual_txf_close' then 'T13:40:00+08:00' else 'T13:25:00+08:00' end)::timestamptz))
              and s.captured_at<=(v_close->>'verified_at')::timestamptz and coalesce(s.source,'')<>'') then
            v_close_ok:=false; v_block:=array_append(v_block,'CLOSING_'||upper(v_field)||'_EVIDENCE_MISSING');
          end if;
        end loop;
      exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
        v_close_ok:=false;
      end;
      if v_close_ok is distinct from true then v_block:=array_append(v_block,'CLOSING_REVISION_UNVERIFIED'); end if;
      -- Actual CLE producer stores its contract on the durable run and the
      -- lifecycle checkpoint, not in reports.ai_strategy_json.
      v_learning_contract:=v_day.checkpoint_status#>'{continuous_learning,metadata,learning_contract}';
      select * into v_learning from public.learning_runs where run_date=p_business_date and status='succeeded'
        and completed_at is not null and completed_at<=v_now
        and id::text=v_day.checkpoint_status#>>'{continuous_learning,metadata,run_id}'
        and v_day.checkpoint_status#>>'{continuous_learning,status}'='SUCCEEDED'
        and metadata#>>'{learning_contract,opening_publication_revision_id}'=v_revision
        and metadata->'learning_contract'=v_learning_contract order by completed_at limit 1;
      -- Same one-sample selection as selectLearningPredictionSamples: preserve
      -- historical rows, choose the highest valid revision, do not count both.
      select * into v_prediction from public.learning_predictions p where p.report_date=p_business_date
        and p.report_id=v_r.id and p.decision_snapshot_id=v_d.id and p.prediction_scope='market' and p.symbol='TAIEX'
        and p.analysis_window='PREMARKET' and p.record_status='valid' and p.data_quality_status in ('complete','degraded')
        order by p.revision desc,p.id desc limit 1;
      v_market_predictions:=case when v_prediction.id is null then 0 else 1 end;
      begin
      v_learning_ok:=v_close_ok and v_learning_contract->>'schema_version'='CORE_LEARNING_V1'
        and v_learning_contract->>'status'='COMPLETE' and v_learning_contract->>'report_date'=p_business_date::text
        and v_learning_contract->>'opening_publication_revision_id'=v_revision
        and v_learning_contract->'reason_codes'='[]'::jsonb and v_learning_contract->'market_reason_codes'='[]'::jsonb
        and v_market_predictions=1 and v_learning.id is not null
        and exists(select 1 from public.learning_predictions p join public.prediction_outcomes o on o.prediction_id=p.id
          join public.market_data_snapshots s on s.trading_date=p_business_date and s.phase='close' and s.symbol='TAIEX'
          where p.id=v_prediction.id and p.report_date=p_business_date and p.report_id=v_r.id and p.decision_snapshot_id=v_d.id
            and p.prediction_scope='market' and p.symbol='TAIEX' and p.analysis_window='PREMARKET'
            and p.record_status='valid' and p.data_quality_status='complete'
            and p.prediction_at=v_d.valid_from and o.horizon='close' and o.target_date=p_business_date
            and o.status='completed' and o.data_quality_status='complete' and o.direction_correct is not null
            and o.return_percent is not null and o.return_percent::text not in ('NaN','Infinity','-Infinity')
            and o.return_percent=s.change_percent and s.value>0 and s.value::text not in ('NaN','Infinity','-Infinity')
            and o.evaluated_at>=s.captured_at and o.evaluated_at>=p.prediction_at and o.evaluated_at<=v_learning.completed_at
            and s.captured_at between (p_business_date::text||'T13:30:00+08:00')::timestamptz and (p_business_date::text||'T18:00:00+08:00')::timestamptz
            and s.symbol=v_close#>>'{actual_taiex_close,symbol}' and s.source=v_close#>>'{actual_taiex_close,source}'
            and s.captured_at=(v_close#>>'{actual_taiex_close,captured_at}')::timestamptz
            and exists(select 1 from jsonb_array_elements(o.source_refs) ref where ref->>'table'='market_data_snapshots'
              and ref->>'symbol'=s.symbol and ref->>'phase'='close' and ref->>'trading_date'=p_business_date::text
              and ref->>'source'=s.source and (ref->>'captured_at')::timestamptz=s.captured_at
              and (not(ref?'value') or ref->'value'=to_jsonb(s.value))
              and (not(ref?'change_percent') or ref->'change_percent'=to_jsonb(s.change_percent))));
      if v_d.decision_mode in ('market_only','no_trade') then
        v_learning_ok:=v_learning_ok and v_learning_contract->>'stock_evaluation'='NOT_APPLICABLE'
          and not exists(select 1 from public.learning_predictions p where p.report_date=p_business_date
            and p.decision_snapshot_id=v_d.id and p.prediction_scope='symbol' and p.record_status='valid');
      end if;
      exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
        v_learning_ok:=false;
      end;
      if v_learning_ok is distinct from true then v_block:=array_append(v_block,'LEARNING_REVISION_UNVERIFIED'); end if;
      if not exists(select 1 from public.ma_ops_runs where check_type='closing' and status='passed'
        and details_json->>'target_date'=p_business_date::text and completed_at>=v_c.valid_from)
        then v_block:=array_append(v_block,'CLOSING_HEALTH_UNVERIFIED'); end if;
    end if;
    v_manual:=coalesce(v_source_run.provider_status->>'trigger','') !~ '^(scheduled|daily_generate|daily_retry|daily_watchdog)$'
      or coalesce(v_current_run.provider_status->>'trigger','') !~ '^(scheduled|daily_generate|daily_retry|daily_watchdog)$'
      or exists(select 1 from public.pipeline_runs p where p.trading_date=p_business_date
        and p.idempotency_key like 'research-input:%' and p.status='SUCCEEDED'
        and p.provider_status#>'{result,success}'='true'::jsonb
        and p.provider_status#>>'{result,report_id}'=v_r.id::text
        and p.provider_status#>>'{result,report_date}'=p_business_date::text
        and coalesce(p.provider_status->>'trigger','') !~ '^(scheduled|daily_generate|daily_retry|daily_watchdog)$')
      or exists(select 1 from public.ma_ops_recovery_actions a left join public.ma_ops_runs r on r.id=a.run_id
        where a.status in ('running','succeeded') and (r.details_json->>'target_date'=p_business_date::text
          or a.before_json->>'report_date'=p_business_date::text or a.after_json->>'report_date'=p_business_date::text
          or a.before_json#>>'{request_payload,report_date}'=p_business_date::text
          or a.before_json#>>'{request_payload,target_date}'=p_business_date::text
          or a.after_json#>>'{response,report_date}'=p_business_date::text));
    if v_manual then v_auto_block:=array_append(v_auto_block,'MANUAL_RECOVERY_OR_UNVERIFIED_TRIGGER'); end if;
    if not exists(select 1 from public.runtime_http_dispatches h join public.pipeline_runs p
      on h.response_body->>'pipeline_run_id'=p.id::text and p.trading_date=h.trading_date
      where h.trading_date=p_business_date and h.job_name='daily_delivery'
        and h.checkpoint in ('daily_generate','daily_deliver','daily_repair','daily_watchdog')
        and h.dispatch_status='SUCCEEDED' and h.response_success=true and h.http_status between 200 and 299
        and h.response_body->>'report_date'=p_business_date::text and h.response_body->>'decision_snapshot_id'=v_revision
        and p.status='SUCCEEDED' and p.provider_status->>'decision_snapshot_id'=v_revision
        and h.completed_at < (p_business_date::text||'T08:00:00+08:00')::timestamptz)
      then v_auto_block:=array_append(v_auto_block,'AUTOMATION_PROVENANCE_UNVERIFIED'); end if;
    if p_business_date<>v_today then v_auto_block:=array_append(v_auto_block,'HISTORICAL_REPLAY'); end if;
    select count(*) into v_failed from public.runtime_http_dispatches where trading_date=p_business_date and dispatch_status in ('FAILED','TIMED_OUT','DEAD_LETTERED');
    select count(*) into v_dead from public.runtime_dead_letters where status='open'
      and (context->>'trading_date'=p_business_date::text or context->>'dispatch_id' in (select id::text from public.runtime_http_dispatches where trading_date=p_business_date));
    if v_failed<>0 or v_dead<>0 then v_block:=array_append(v_block,'RUNTIME_FAILURE_PRESENT'); end if;
    select count(*) into v_incidents from public.runtime_http_dispatches
      where trading_date=p_business_date and (dispatch_status in ('FAILED','TIMED_OUT','DEAD_LETTERED')
        or (dispatch_status='SKIPPED' and (response_success=false or response_error_code is not null)));
    if v_incidents>0 or exists(select 1 from public.line_delivery_outbox where report_date=p_business_date and push_type='data_incident' and status='SENT')
      then v_auto_block:=array_append(v_auto_block,'PRODUCTION_INCIDENT_RECORDED'); end if;
    v_verdict:=case when cardinality(v_block)=0 then 'PASS' else 'FAIL' end;
  end if;
  v_evidence:=jsonb_build_object('phase',v_phase,'canonical_revision_id',v_revision,'current_revision_id',v_current.id,
    'input_run_id',v_source_run.id,'current_publication_run_id',v_current_run.id,
    'input_fingerprint',v_source_run.provider_status->>'input_fingerprint','engine_version',v_source_run.engine_version,
    'member_revision_id',v_m.id,'learning_run_id',v_learning.id,'closing_snapshot_id',v_c.id,
    'normal_report_line_count',v_line_count,'normal_report_last_sent_at',v_line_time,
    'failed_dispatches',v_failed,'open_dead_letters',v_dead,'automatic_blocking_checks',v_auto_block,
    'manual_intervention',v_manual,'automatic_stable_day',v_verdict='PASS' and v_phase='FULL_DAY' and cardinality(v_auto_block)=0,
    'content_handoff_evidence_scope','PROJECTION_CONTRACT_ONLY_NOT_DOWNSTREAM_DELIVERY',
    'trial_started',false,'trading_date',p_business_date,'premium_gate_independent',true,
    'market_validation',v_validation,'member_quality_diagnostic',jsonb_build_object('status',v_m.status,'content_score',v_m.content_score,'evidence_coverage',v_m.evidence_coverage),
    'market_data_pass',not exists(select 1 from unnest(v_block) b where b like 'SOURCE_%' or b like 'PREMARKET_%_PRODUCER_%'),
    'report_pass',not('CANONICAL_NOT_READY'=any(v_block) or 'REPORT_REVISION_MISMATCH'=any(v_block)),
    'research_pass',not('CORE_MARKET_PUBLICATION_UNVERIFIED'=any(v_block)),
    'editorial_pass',not('EDITORIAL_NOT_APPROVED'=any(v_block)),
    'semantic_pass',not('PREMIUM_SEMANTIC_NOT_PASSED'=any(v_block)),
    'publication_pass',not('REPORT_REVISION_MISMATCH'=any(v_block) or 'CURRENT_PUBLICATION_RECEIPT_UNVERIFIED'=any(v_block) or 'INPUT_LINEAGE_UNVERIFIED'=any(v_block) or 'CORE_MARKET_PUBLICATION_UNVERIFIED'=any(v_block)),
    'delivery_pass',not('NORMAL_REPORT_LINE_NOT_COMPLETE'=any(v_block) or 'DUPLICATE_REPORT_DELIVERY'=any(v_block)),
    'checkpoint_pass',not exists(select 1 from unnest(v_block) b where b like 'CHECKPOINT_%'),
    'closing_status',case when v_phase<>'FULL_DAY' then 'WAITING' when exists(select 1 from unnest(v_block) b where b like 'CLOSING_%') then 'FAIL' else 'PASS' end,
    'learning_status',case when v_phase<>'FULL_DAY' then 'WAITING' when 'LEARNING_REVISION_UNVERIFIED'=any(v_block) then 'FAIL' else 'PASS' end,
    'frontend_status','EXTERNAL_SMOKE_REQUIRED','incident_count',coalesce(v_incidents,0)+coalesce(v_dead,0));
  if v_verdict='NOT_DUE' then
    v_evidence:=v_evidence||'{"market_data_pass":null,"report_pass":null,"research_pass":null,"editorial_pass":null,"semantic_pass":null,"publication_pass":null,"delivery_pass":null,"checkpoint_pass":null}'::jsonb;
  end if;
  v_version:=p_evaluator_version||':CORE_CONSOLIDATION_V1:'||v_phase||':'||coalesce(v_revision,'none')||':'||md5((v_evidence||jsonb_build_object('blocking',v_block))::text);
  v_key:=p_business_date::text||':'||v_version;
  insert into public.production_acceptance_results(business_date,evaluator_version,idempotency_key,verdict,blocking_checks,evidence)
    values(p_business_date,v_version,v_key,v_verdict,v_block,v_evidence)
    on conflict(idempotency_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.production_acceptance_results where idempotency_key=v_key; end if;
  return v_id;
end; $$;
revoke all on function public.capture_morning_alpha_acceptance_v1(date,text) from public,anon,authenticated;
grant execute on function public.capture_morning_alpha_acceptance_v1(date,text) to service_role;


-- Fail the transaction if CREATE OR REPLACE changed any existing privilege,
-- parameter default, return type, security mode or attached trigger contract.
do $audit$
begin
 if (select count(*) from ma_consolidation_function_before)<>6 then raise exception 'ORIGINAL_FUNCTION_SCOPE_INCOMPLETE'; end if;
 if exists(select 1 from ma_consolidation_function_before b left join pg_proc p on p.oid=b.oid
  where p.oid is null or p.proowner is distinct from b.proowner or p.proacl is distinct from b.proacl
   or p.prosecdef is distinct from b.prosecdef or p.proconfig is distinct from b.proconfig
   or pg_get_function_identity_arguments(p.oid) is distinct from b.signature
   or pg_get_function_arguments(p.oid) is distinct from b.arguments
   or pg_get_function_result(p.oid) is distinct from b.result)
 then raise exception 'EXISTING_FUNCTION_AUTHORITY_DRIFT'; end if;
 if (select count(*) from ma_consolidation_trigger_before)<>1 or exists(
  select 1 from ma_consolidation_trigger_before b left join pg_trigger t on t.oid=b.oid
  where t.oid is null or pg_get_triggerdef(t.oid) is distinct from b.definition)
 then raise exception 'EXISTING_TRIGGER_ATTACHMENT_DRIFT'; end if;
 if has_function_privilege('anon','public.validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
  or not has_function_privilege('service_role','public.validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
 then raise exception 'PRIVATE_VALIDATOR_ACL_INVALID'; end if;
end;
$audit$;
commit;
