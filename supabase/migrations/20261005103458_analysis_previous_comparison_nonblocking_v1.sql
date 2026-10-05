-- Candidate only; Sony must separately approve Production execution.
-- Research-only forward successor. No data backfill, Core edits, ACL/RLS or Cron changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
begin
  if (select md5(prosrc) from pg_proc where oid='public.research_analysis_input_v1(date,timestamptz,text)'::regprocedure)
       is distinct from '704d187dfeb9f4c6ced035ee117a64f1'
    or (select md5(prosrc) from pg_proc where oid='public.store_research_analysis_v1(jsonb,jsonb,text,numeric)'::regprocedure)
       is distinct from '37cbd06c91c70c2fbc3a03a467b5458c' then
    raise exception 'RESEARCH_COMPARISON_PREDECESSOR_MISMATCH';
  end if;
end $guard$;
create or replace function public.research_analysis_input_v1(p_date date,p_cutoff timestamptz,p_kind text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare b public.market_checkpoint_batches; s public.decision_snapshots; r public.research_sessions;
  v_rows jsonb; v_production jsonb; v_context jsonb; v_previous date; v_prediction uuid;
begin
  if p_kind not in ('FORWARD','HISTORICAL_REPLAY') or p_cutoff>now()
    or (p_cutoff at time zone 'Asia/Taipei')::date<>p_date
    or (p_cutoff at time zone 'Asia/Taipei')::time>=time '09:00' then
    raise exception 'RESEARCH_INPUT_CUTOFF_INVALID';
  end if;
  select * into b from public.market_checkpoint_batches where business_date=p_date and checkpoint='PREMARKET';
  select jsonb_agg(to_jsonb(t) order by t.provider_key) into v_rows from (
    select x.id,x.provider_key,x.symbol,x.value,x.change_percent,x.source,x.source_timestamp,x.captured_at,x.created_at,
      x.snapshot_version,x.trading_date,x.checkpoint,x.market_session,x.batch_id,x.correlation_id,x.idempotency_key,
      jsonb_build_object('change',x.raw->'change','market',x.raw->'market','contract',x.raw->'contract',
        'source_symbol',x.raw->'source_symbol','freshness_status',x.raw->'freshness_status',
        'freshness_age_minutes',x.raw->'freshness_age_minutes','captured_session_date',x.raw->'captured_session_date',
        'tw_cash_phase',x.raw->'tw_cash_phase','tw_cash_session_contract',x.raw->'tw_cash_session_contract',
        'tw_cash_expected_session_date',x.raw->'tw_cash_expected_session_date','tw_cash_provider_session_date',x.raw->'tw_cash_provider_session_date',
        'txf_session_type',x.raw->'txf_session_type','txf_session_contract',x.raw->'txf_session_contract',
        'txf_expected_previous_trading_date',x.raw->'txf_expected_previous_trading_date','txf_provider_session_date',x.raw->'txf_provider_session_date',
        'source_raw',jsonb_build_object('date',x.raw#>'{source_raw,date}','session',x.raw#>'{source_raw,session}',
          'response_date',x.raw#>'{source_raw,response_date}','evidence_session_date',x.raw#>'{source_raw,evidence_session_date}',
          'price_basis',x.raw#>'{source_raw,price_basis}')) raw
    from public.market_checkpoint_snapshots x where x.trading_date=p_date and x.checkpoint='PREMARKET'
  ) t;
  select * into s from public.decision_snapshots where report_date=p_date and created_at<=p_cutoff
    and generated_text ? 'market_report_gate' order by created_at desc,id limit 1;
  if s.id is not null then
    v_production:=jsonb_build_object('id',s.id,'business_date',p_date,'created_at',s.created_at,
      'revision',s.version,'fingerprint',s.snapshot_fingerprint,'market_regime',s.market_regime,
      'direction',s.generated_text->>'market_bias','action',s.action,'confidence',s.confidence_score,
      'source_methodology_version',s.generated_text->>'methodology_version');
    select id into v_prediction from public.learning_predictions where decision_snapshot_id=s.id
      and prediction_at<=p_cutoff and created_at<=p_cutoff order by prediction_at,id limit 1;
  end if;
  select * into r from public.research_sessions where trading_date=p_date and created_at<=p_cutoff and generated_at<=p_cutoff
    order by created_at desc,id limit 1;
  v_context:=case when r.id is not null then jsonb_build_object('observed_at',r.created_at,'evidence_ids',jsonb_build_array(r.id),
    'missing_evidence',case when cardinality(r.missing_sources)>0 then to_jsonb(r.missing_sources) else '[]'::jsonb end,
    'report_level',coalesce(s.generated_text#>>'{market_report_gate,operational_market,report_level}',case when cardinality(r.missing_sources)>0 then 'DEGRADED' else 'UNAVAILABLE' end))
    else jsonb_build_object('observed_at',null,'evidence_ids','[]'::jsonb,'missing_evidence','["RESEARCH_CONTEXT"]'::jsonb,'report_level','UNAVAILABLE') end;
  -- Calendar day is a candidate, not a claim of comparable evidence.
  -- Availability/as-of/current contract compatibility belong to the single Shadow resolver.
  v_previous:=public.previous_market_session_v1('TW',p_date);
  return jsonb_build_object('schema_version','ANALYSIS_INPUT_V1','observation_kind',p_kind,'analysis_cutoff_at',p_cutoff,
    'core',jsonb_build_object('business_date',p_date,'observed_at',p_cutoff,'batch',to_jsonb(b),
      'integrity',public.market_checkpoint_batch_integrity_v1(p_date,'PREMARKET'),'rows',coalesce(v_rows,'[]'::jsonb)),
    'registry',(select jsonb_agg(jsonb_build_object('feature_key',feature_key,'version',version,'normalization',normalization) order by feature_key)
      from public.research_feature_versions where version=1),
    'enhancements',v_context,'production',v_production,'existing_prediction_id',v_prediction,
    'previous_valid_business_date',v_previous,'previous_trading_day',v_previous);
end $$;


-- Narrow service-only writer. The source readset is rebuilt, not trusted from caller JSON.
-- Definer is needed only to insert locked research rows; no business writes exist here.
create or replace function public.store_research_analysis_v1(p_input jsonb,p_previous jsonb,p_analysis_text text,p_compute_ms numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_date date:=(p_input#>>'{core,business_date}')::date; v_cutoff timestamptz:=(p_input->>'analysis_cutoff_at')::timestamptz;
  v_kind text:=p_input->>'observation_kind'; v_live jsonb; v_previous jsonb; a jsonb:=p_analysis_text::jsonb;
  v_graph uuid; v_result public.research_daily_analysis; v_hash text; v_created timestamptz:=clock_timestamp();
begin
  v_live:=public.research_analysis_input_v1(v_date,v_cutoff,v_kind);
  if v_live is distinct from p_input then raise exception 'RESEARCH_SOURCE_READSET_MISMATCH'; end if;
  if p_previous is not null then
    if v_live->>'previous_trading_day' is null then raise exception 'RESEARCH_UNEXPECTED_PREVIOUS_INPUT'; end if;
    v_previous:=public.research_analysis_input_v1((v_live->>'previous_trading_day')::date,
      (((v_live->>'previous_trading_day')::date+time '08:44:59') at time zone 'Asia/Taipei'),'HISTORICAL_REPLAY');
    if v_previous is distinct from p_previous then raise exception 'RESEARCH_PREVIOUS_READSET_MISMATCH'; end if;
  end if;
  if a#>>'{previous_comparison,contract}' is distinct from 'PREVIOUS_VALID_COMPARISON_V1'
    or a#>>'{previous_comparison,previous_trading_day}' is distinct from v_live->>'previous_trading_day' then
    raise exception 'RESEARCH_COMPARISON_CONTRACT_INVALID';
  end if;
  if a#>>'{previous_comparison,status}' = 'AVAILABLE' then
    if p_previous is null
      or a#>>'{previous_comparison,previous_comparable_evidence_day}' is distinct from v_live->>'previous_trading_day'
      or a#>>'{quality,change_detection}' is distinct from 'AVAILABLE'
      then raise exception 'RESEARCH_COMPARISON_AVAILABLE_INVALID'; end if;
  elsif a#>>'{previous_comparison,status}' = 'UNAVAILABLE' then
    if a#>>'{previous_comparison,reason}' is distinct from 'PREVIOUS_COMPARISON_UNAVAILABLE'
      or a#>>'{previous_comparison,previous_comparable_evidence_day}' is not null
      or a->'what_changed' is distinct from '[]'::jsonb
      or a#>>'{quality,change_detection}' is distinct from 'UNAVAILABLE'
      or not coalesce(a#>'{quality,missing_components}' ? 'PREVIOUS_DAY_COMPARISON',false)
      or (a#>>'{quality,evidence_coverage}')::numeric is distinct from 91.6667
      or (a#>>'{decision,confidence_components,previous_comparison_penalty}')::numeric is distinct from 5
      then raise exception 'RESEARCH_COMPARISON_UNAVAILABLE_INVALID'; end if;
  else raise exception 'RESEARCH_COMPARISON_STATUS_INVALID'; end if;
  if v_live#>>'{core,integrity,status}' is distinct from 'PASS'
    or (v_live#>>'{core,batch,committed_at}')::timestamptz>v_cutoff
    or exists(select 1 from jsonb_array_elements(v_live#>'{core,rows}') e
      where (e->>'created_at')::timestamptz>v_cutoff or (e->>'captured_at')::timestamptz>v_cutoff)
    then raise exception 'RESEARCH_TRUSTED_ASOF_CORE_REQUIRED'; end if;
  if a->>'schema_version' is distinct from 'ANALYSIS_INTELLIGENCE_V1' or a->>'mode' is distinct from 'SHADOW_ONLY'
    or a->'production_eligible' is distinct from 'false'::jsonb or (a->>'business_date')::date is distinct from v_date
    or (a->>'analysis_cutoff_at')::timestamptz is distinct from v_cutoff
    or a->>'observation_kind' is distinct from v_kind or a->>'methodology_version' is distinct from '1'
    or jsonb_array_length(a->'signals') is distinct from 11 or jsonb_array_length(a->'features') is distinct from 33
    then raise exception 'RESEARCH_OUTPUT_CONTRACT_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(a->'features') f where not exists(
      select 1 from jsonb_array_elements(v_live#>'{core,rows}') e
      where e->>'id'=f->>'source_evidence_id' and e->>'provider_key'=f->>'registry_key'
        and (f->>'observed_at')::timestamptz=(e->>'created_at')::timestamptz)) then
    raise exception 'RESEARCH_FEATURE_LINEAGE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(a->'features') f where not exists(
    select 1 from public.research_feature_versions v where v.feature_key=f->>'feature_id'
      and v.version=(f->>'feature_version')::integer and v.normalization=f->>'normalization')) then
    raise exception 'RESEARCH_FEATURE_VERSION_DRIFT'; end if;
  if v_kind='FORWARD' and not research_private.analysis_forward_allowed_v1(v_date,v_cutoff,v_created,
    (select enabled_at from research_private.analysis_activation)) then
    raise exception 'RESEARCH_FORWARD_CANNOT_BE_BACKDATED'; end if;
  v_hash:=encode(sha256(convert_to(p_analysis_text,'UTF8')),'hex');
  -- A concurrent duplicate returns the same canonical artifact; conflicting reruns cannot overwrite it.
  perform pg_advisory_xact_lock(hashtextextended('research-analysis:'||v_date::text,0));
  select * into v_result from public.research_daily_analysis where business_date=v_date and methodology_id='ANALYSIS_INTELLIGENCE_V1';
  if found then
    if v_result.prediction_hash<>v_hash then raise exception 'RESEARCH_CANONICAL_ALREADY_LOCKED'; end if;
    return jsonb_build_object('status','ALREADY_RECORDED','id',v_result.id,'prediction_hash',v_result.prediction_hash);
  end if;
  if p_input->'production'<>'null'::jsonb and p_input#>>'{enhancements,report_level}' in ('FULL','DEGRADED') then
    insert into public.research_analysis_graphs(business_date,decision_snapshot_id,decision_revision,decision_fingerprint,
      source_methodology_version,methodology_id,methodology_version,report_level,evidence_as_of,observation_kind,what_changed,invalidation_conditions)
    values(v_date,(p_input#>>'{production,id}')::uuid,(p_input#>>'{production,revision}')::integer,p_input#>>'{production,fingerprint}',
      p_input#>>'{production,source_methodology_version}','ANALYSIS_INTELLIGENCE_V1',1,p_input#>>'{enhancements,report_level}',
      v_cutoff,v_kind,a->'what_changed',a->'invalidation_conditions') returning id into v_graph;
  end if;
  insert into public.research_daily_analysis(business_date,observation_kind,analysis_cutoff_at,created_at,graph_id,
    existing_prediction_id,input_snapshot,previous_input_snapshot,analysis,prediction_hash,compute_ms)
  values(v_date,v_kind,v_cutoff,v_created,v_graph,(p_input->>'existing_prediction_id')::uuid,p_input,p_previous,a,v_hash,p_compute_ms)
  returning * into v_result;
  return jsonb_build_object('status','RECORDED','id',v_result.id,'prediction_hash',v_result.prediction_hash);
end $$;

commit;
