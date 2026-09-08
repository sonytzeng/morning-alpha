-- Local candidate only. Applying to Production requires separate approval.
-- Production catalog baseline: cttfzgvhiewfckydcrci, 2026-09-08T03:46:06Z.
-- pg_get_functiondef MD5:
-- enforce_decision_snapshot_premium_90_gate_v1(): ee1b071babc962a537aaf89639e9a71f
-- publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb): a7f484435e551c01a77b9c096a810c03
-- publish_member_content_revision_v1(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb): ce94f5ad2af5dfba9db1aa039a60a699
-- Exact signatures/security/search_path/owner/private ACL are retained.
-- No table/RLS/trigger replacement, business-row UPDATE, Acceptance, reconciler,
-- Cron, v2/v3 publisher or historical backfill is part of this migration.
begin;

-- Definitions below add one explicit market_only contract. Existing modes
-- retain their previous branches. Market-only is NOT an alias for no_trade.

CREATE OR REPLACE FUNCTION public.enforce_decision_snapshot_premium_90_gate_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_premium_min numeric := 90;
  v_auto_repair_min numeric := 70;
  v_ai jsonb; v_report_date date; v_gate jsonb; v_quality jsonb;
  v_screen jsonb; v_universe numeric; v_evaluated numeric; v_field text;
begin
  select policy.premium_publish_min, policy.auto_repair_min
    into v_premium_min, v_auto_repair_min
  from public.runtime_quality_policies as policy
  where policy.active = true
  limit 1;

  if new.decision_mode = 'market_only' then
    -- v2/v3 may be called directly. Invalid market-only input must abort the
    -- transaction; a PARTIAL snapshot must not yield a SUCCEEDED pipeline row.
    select report_date, ai_strategy_json into v_report_date, v_ai
    from public.reports where id = new.report_id;
    if not found then raise exception 'MARKET_ONLY_REPORT_IDENTITY_REQUIRED'; end if;
    v_gate := new.generated_text->'market_report_gate';
    v_quality := v_ai#>'{research_master_v2,quality}';
    if v_premium_min is null or v_premium_min < 90
      or v_report_date is distinct from new.report_date
      or v_gate is null or jsonb_typeof(v_gate) is distinct from 'object'
      or v_gate is distinct from v_ai->'market_report_gate'
      or v_gate->>'contract_version' is distinct from 'MARKET_REPORT_GATE_V2'
      or v_gate->>'report_date' is distinct from new.report_date::text
      or v_gate->'eligible' is distinct from 'true'::jsonb
      or v_gate->>'status' is distinct from 'READY_MARKET_ONLY'
      or v_gate->>'report_status' is distinct from 'READY'
      or v_gate->>'decision_mode' is distinct from 'market_only'
      or v_gate->'reason_codes' is distinct from '[]'::jsonb
      or not coalesce(v_gate->>'recommendation_status' in ('BLOCKED','NO_QUALIFIED_OPPORTUNITY'),false)
      or v_gate#>>'{recommendation_gate,status}' is distinct from v_gate->>'recommendation_status'
      or v_gate#>'{recommendation_gate,eligible}' is distinct from 'false'::jsonb
      or new.action is distinct from 'WAIT' or new.status is distinct from 'READY'
      or new.generated_text->'recommendations' is distinct from '[]'::jsonb
      or coalesce(new.generated_text->'opportunity_score','null'::jsonb) is distinct from 'null'::jsonb
      or coalesce(new.generated_text->'stock_opportunities','[]'::jsonb) is distinct from '[]'::jsonb
      or not coalesce(jsonb_typeof(new.source_refs)='array' and jsonb_array_length(new.source_refs)>0,false)
      or new.coverage_score is distinct from 100
      or not coalesce(new.content_score between v_premium_min and 100,false)
      or jsonb_typeof(v_gate->'content_score') is distinct from 'number'
      or (v_gate->>'content_score')::numeric is distinct from new.content_score
      or v_ai->>'decision_mode' is distinct from 'market_only'
      or v_ai->>'canonical_action' is distinct from 'WAIT'
      or v_ai->>'report_status' is distinct from 'READY'
      or v_ai->>'recommendation_status' is distinct from v_gate->>'recommendation_status'
      or v_ai->>'data_quality' is distinct from 'complete'
      or v_ai->'today_beneficiary_stocks' is distinct from '[]'::jsonb
      or v_ai->'today_beneficiary_stocks_v10' is distinct from '[]'::jsonb
      or v_ai->>'today_quote' is distinct from new.generated_text->>'daily_sentence'
      or nullif(btrim(new.generated_text->>'daily_sentence'),'') is null
      or v_ai#>>'{research_master_v2,report_date}' is distinct from new.report_date::text
      or v_ai#>>'{research_master_v2,today_date}' is distinct from new.report_date::text
      or v_quality->>'publish_status' is distinct from 'ready'
      or v_quality->'evidence_coverage' is distinct from '100'::jsonb
      or v_ai#>'{content_evidence_quality,blank_market_change_count}' is distinct from '0'::jsonb
      or not coalesce((v_ai#>>'{content_evidence_quality,verified_market_count}')::numeric>0,false)
    then raise exception 'MARKET_ONLY_PUBLICATION_GATE_BLOCKED'; end if;
    foreach v_field in array array['unsupported_claims','duplicate_claims','contradictions','missing_sections'] loop
      if v_quality->v_field is distinct from '[]'::jsonb then
        raise exception 'MARKET_ONLY_QUALITY_COUNTER_NOT_EXPLICIT_ZERO: %',v_field;
      end if;
    end loop;
    if v_gate->>'recommendation_status' = 'NO_QUALIFIED_OPPORTUNITY' then
      v_screen := v_gate#>'{recommendation_gate,screening}';
      if v_gate#>'{recommendation_gate,universe_evaluation_complete}' is distinct from 'true'::jsonb
        or v_screen->>'status' is distinct from 'COMPLETE'
        or v_screen->'rejected' is distinct from '[]'::jsonb
        or jsonb_typeof(v_screen->'universe_count') is distinct from 'number'
        or jsonb_typeof(v_screen->'evaluated_count') is distinct from 'number'
      then raise exception 'MARKET_ONLY_UNIVERSE_EVIDENCE_REQUIRED'; end if;
      v_universe := (v_screen->>'universe_count')::numeric;
      v_evaluated := (v_screen->>'evaluated_count')::numeric;
      if v_universe <= 0 or trunc(v_universe) <> v_universe
        or v_evaluated is distinct from v_universe
      then raise exception 'MARKET_ONLY_UNIVERSE_EVIDENCE_REQUIRED'; end if;
    end if;
    return new;
  end if;

  if new.session_type = 'PREMARKET'
    and (
      new.content_score is null
      or new.content_score < coalesce(v_premium_min, 90)
      or coalesce(new.decision_mode, 'blocked') not in ('recommendations', 'no_trade')
    )
  then
    new.status := case
      when coalesce(new.content_score, 0) >= coalesce(v_auto_repair_min, 70) then 'PARTIAL'
      else 'INSUFFICIENT_DATA'
    end;
  end if;
  return new;
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
  v_market_gate jsonb;
begin
  if v_date is null then raise exception 'REPORT_DATE_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('research-publication:' || v_date::text, 0));
  select * into v_run from public.pipeline_runs where id=p_run_id for update;
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
  v_quality := p_report#>'{ai_strategy_json,research_master_v2,quality}';
  if not coalesce(p_decision->>'decision_mode' in ('recommendations','no_trade','market_only'),false)
    or p_semantic->>'status' is distinct from 'PASSED' or p_semantic->'eligible' is distinct from 'true'::jsonb
    or p_semantic->'reason_codes' is distinct from '[]'::jsonb
    or v_quality->>'publish_status' is distinct from 'ready'
    or v_quality->'evidence_coverage' is distinct from '100'::jsonb
    or not coalesce((p_decision->>'content_score')::numeric between 90 and 100,false)
    or coalesce(v_quote,'') = '' then raise exception 'PUBLICATION_GATE_BLOCKED'; end if;
  foreach v_field in array array['unsupported_claims','duplicate_claims','contradictions','missing_sections'] loop
    if v_quality->v_field is distinct from '[]'::jsonb then raise exception 'QUALITY_COUNTER_NOT_EXPLICIT_ZERO: %',v_field; end if;
  end loop;
  if p_decision->>'decision_mode' = 'market_only' then
    v_market_gate := p_decision#>'{generated_text,market_report_gate}';
    if v_market_gate is null
      or v_market_gate is distinct from p_report#>'{ai_strategy_json,market_report_gate}'
      or v_market_gate is distinct from p_contract->'market_report_gate'
      or v_market_gate is distinct from p_member#>'{canonical_contract,market_report_gate}'
      or v_market_gate->>'report_date' is distinct from v_date::text
      or p_decision->>'action' is distinct from 'WAIT'
      or p_contract->>'action' is distinct from 'WAIT'
      or p_contract->>'decision_mode' is distinct from 'market_only'
      or p_contract->'primary_symbols' is distinct from '[]'::jsonb
      or p_contract->>'data_quality_status' is distinct from 'complete'
      or p_decision#>'{generated_text,recommendations}' is distinct from '[]'::jsonb
      or p_member->'beneficiary_candidates' is distinct from '[]'::jsonb
      or p_member->'representative_stocks' is distinct from '[]'::jsonb
      or coalesce(p_decision->'opportunity_score','null'::jsonb) is distinct from 'null'::jsonb
      or coalesce(p_decision->'stock_opportunities','[]'::jsonb) is distinct from '[]'::jsonb
      or p_decision->'safe_mode' = 'true'::jsonb
    then raise exception 'MARKET_ONLY_BUNDLE_CONTRACT_MISMATCH'; end if;
  end if;
  if p_report->>'summary' is distinct from v_quote or p_report->>'today_quote' is distinct from v_quote
    or p_report->>'today_summary' is distinct from v_quote
    or p_member->>'today_core_thesis' is distinct from v_quote or p_member->>'line_summary' is distinct from v_quote
    or p_report#>>'{ai_strategy_json,line_push_copy,one_sentence}' is distinct from v_quote then
    raise exception 'CANONICAL_OUTPUT_DIVERGENCE'; end if;

  -- Lock the report and retain runtime evidence captured after the app's read.
  select id,ai_strategy_json into v_report_id,v_previous_ai from public.reports where report_date=v_date for update;
  foreach v_field in array array['opening_radar','opening_radar_status','intraday_tracking','intraday_sync_status','war_room','closing_verification','closing_verification_v2','todayCloseVerification'] loop
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
  p_decision := p_decision - array['generated_at','started_at','duration_ms','correlation_id','recovery_plan'];
  v_snapshot_id := public.publish_decision_snapshot_v3(v_date,'PREMARKET',v_report_id,p_decision,p_correlation_id,
    'production-report:'||v_date::text||':PREMARKET',v_run.attempt);
  select * into strict v_snapshot from public.decision_snapshots where id=v_snapshot_id;
  if p_decision->>'decision_mode' = 'market_only'
    and (v_snapshot.status is distinct from 'READY' or v_snapshot.action is distinct from 'WAIT'
      or v_snapshot.decision_mode is distinct from 'market_only') then
    raise exception 'MARKET_ONLY_SNAPSHOT_NOT_READY';
  end if;
  p_contract := p_contract || jsonb_build_object('snapshot_id',v_snapshot_id,'snapshot_version',v_snapshot.version);
  p_member := p_member || jsonb_build_object('canonical_contract',p_contract);
  p_semantic := p_semantic || jsonb_build_object('canonical_snapshot_id',v_snapshot_id,'canonical_snapshot_version',v_snapshot.version);
  v_member_id := public.publish_member_content_revision_v1(v_date,v_report_id,v_snapshot_id,
    'member-content:'||v_snapshot_id::text, v_run.provider_status->>'input_fingerprint',p_contract,p_member,p_semantic,
    (p_decision->>'content_score')::numeric,100,clock_timestamp(),
    jsonb_build_object('actor','generate-daily-report-v7','suppress_notifications',true,'pipeline_run_id',p_run_id));
  if not exists(select 1 from public.member_content_revisions where id=v_member_id and status='PASSED') then
    raise exception 'MEMBER_PUBLICATION_NOT_PASSED'; end if;
  update public.reports set ai_strategy_json=ai_strategy_json || jsonb_build_object('revision_id',v_snapshot_id,
    'canonical_contract',p_contract,'canonical_member_revision_id',v_member_id)
  where id=v_report_id;
  v_result := jsonb_build_object('success',true,'report_id',v_report_id,'decision_snapshot_id',v_snapshot_id,
    'member_content_revision_id',v_member_id,'report_date',v_date,'semantic_status','PASSED');
  perform public.finish_research_input_v1(p_run_id,p_correlation_id,'SUCCEEDED',v_result,null);
  return v_result;
end; $function$;

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
  v_market_gate jsonb; v_report_gate jsonb; v_premium_min numeric;
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
  select id into v_existing from public.member_content_revisions where idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  select * into v_snapshot from public.decision_snapshots where id = p_decision_snapshot_id for share;
  if not found or v_snapshot.report_date <> p_report_date or v_snapshot.report_id <> p_report_id then
    raise exception 'snapshot/report/date contract mismatch';
  end if;
  if p_canonical_contract->>'snapshot_id' <> p_decision_snapshot_id::text
    or nullif(p_canonical_contract->>'snapshot_version','')::integer <> v_snapshot.version then
    raise exception 'canonical snapshot identity mismatch';
  end if;
  if v_snapshot.decision_mode = 'market_only' then
    select premium_publish_min into v_premium_min
    from public.runtime_quality_policies where active=true limit 1;
    select ai_strategy_json->'market_report_gate' into v_report_gate
    from public.reports where id=p_report_id and report_date=p_report_date;
    v_market_gate := v_snapshot.generated_text->'market_report_gate';
    if v_premium_min is null or v_premium_min<90
      or v_snapshot.status is distinct from 'READY' or v_snapshot.action is distinct from 'WAIT'
      or v_market_gate is null or v_market_gate is distinct from v_report_gate
      or v_market_gate is distinct from p_canonical_contract->'market_report_gate'
      or v_market_gate is distinct from p_member_content#>'{canonical_contract,market_report_gate}'
      or p_canonical_contract->>'decision_mode' is distinct from 'market_only'
      or p_canonical_contract->>'action' is distinct from 'WAIT'
      or p_canonical_contract->>'data_quality_status' is distinct from 'complete'
      or p_canonical_contract->>'report_date' is distinct from p_report_date::text
      or p_canonical_contract->>'snapshot_id' is distinct from p_decision_snapshot_id::text
      or nullif(p_canonical_contract->>'snapshot_version','')::integer is distinct from v_snapshot.version
      or p_canonical_contract->'primary_symbols' is distinct from '[]'::jsonb
      or p_member_content->'beneficiary_candidates' is distinct from '[]'::jsonb
      or p_member_content->'representative_stocks' is distinct from '[]'::jsonb
      or coalesce(p_member_content->'recommendations','[]'::jsonb) is distinct from '[]'::jsonb
      or coalesce(p_member_content->'stock_opportunities','[]'::jsonb) is distinct from '[]'::jsonb
      or coalesce(p_member_content->'opportunity_score','null'::jsonb) is distinct from 'null'::jsonb
      or p_member_content->>'today_core_thesis' is distinct from v_snapshot.generated_text->>'daily_sentence'
      or p_member_content->>'line_summary' is distinct from v_snapshot.generated_text->>'daily_sentence'
      or p_content_score is distinct from v_snapshot.content_score
      or not coalesce(p_content_score between v_premium_min and 100,false)
      or p_evidence_coverage is distinct from 100
      or p_generated_at is null
      or v_status is distinct from 'PASSED'
      or p_semantic_result->'eligible' is distinct from 'true'::jsonb
      or p_semantic_result->'reason_codes' is distinct from '[]'::jsonb
      or p_semantic_result->'conflicting_fields' is distinct from '[]'::jsonb
    then raise exception 'MARKET_ONLY_MEMBER_CONTRACT_BLOCKED'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('member_content:' || p_report_date::text, 0));
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

ALTER FUNCTION public.enforce_decision_snapshot_premium_90_gate_v1() OWNER TO postgres;
ALTER FUNCTION public.publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) OWNER TO postgres;
ALTER FUNCTION public.publish_member_content_revision_v1(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_decision_snapshot_premium_90_gate_v1() FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.publish_member_content_revision_v1(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_decision_snapshot_premium_90_gate_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_member_content_revision_v1(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb) TO service_role;
commit;
