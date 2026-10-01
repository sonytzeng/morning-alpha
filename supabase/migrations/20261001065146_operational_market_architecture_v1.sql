-- CANDIDATE ONLY. No Production execution is authorized.
-- Forward-only, exact predecessor guarded. Existing owner/ACL/security and
-- search_path are retained. No business DML, Cron, Auth, RLS or secret changes.
begin;
do $migration$
declare
 target regprocedure; definition text; before_catalog jsonb; after_catalog jsonb;
 old_fragment text; new_fragment text;
begin
 target:='public.validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
 definition:=pg_get_functiondef(target);
 if md5(definition)<>'21a20b8c6d5d0095ed2aae489fbd3057' then raise exception 'OPERATIONAL_PUBLICATION_PREDECESSOR_MISMATCH'; end if;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into before_catalog from pg_proc where oid=target;
 definition:=replace(definition,'declare'||chr(10),'declare'||chr(10)||$vars$
 v_operational boolean:=false; v_input jsonb; v_core jsonb; v_proof jsonb; v_enhancements jsonb;
 v_batch public.market_checkpoint_batches; v_actual_proof jsonb; v_core_rows integer;
$vars$);
 old_fragment:=$old$ v_document:=v_state->'document'; v_quality:=v_document->'quality'; v_audit:=v_quality->'coverage_audit';$old$;
 new_fragment:=old_fragment||$new$
 if v_document ? 'operational_market' then
  v_input:=v_document#>'{operational_market,input}'; v_core:=v_input->'core';
  v_proof:=v_core->'integrity'; v_enhancements:=v_input->'enhancements';
  v_actual_proof:=public.market_checkpoint_batch_integrity_v1(p_report_date,'PREMARKET');
  select * into v_batch from public.market_checkpoint_batches
   where business_date=p_report_date and checkpoint='PREMARKET' and status='COMMITTED';
  select count(*) into v_core_rows from jsonb_array_elements(case when jsonb_typeof(v_core->'rows')='array' then v_core->'rows' else '[]' end) e
   join public.market_checkpoint_snapshots s on s.provider_key=e.value->>'provider_key'
    and s.batch_id=v_batch.batch_id and s.trading_date=p_report_date
   where to_jsonb(s) @> e.value;
  v_operational:=v_document#>>'{operational_market,contract_version}'='OPERATIONAL_MARKET_V1'
   and v_actual_proof->>'status'='PASS' and v_proof=v_actual_proof
   and v_core->>'business_date'=p_report_date::text
   and v_core->>'observed_at'=v_document#>>'{provenance,generated_at}'
   and v_batch.committed_at<=(v_core->>'observed_at')::timestamptz
   and v_core#>>'{batch,batch_id}'=v_batch.batch_id::text
   and v_core#>>'{batch,payload_hash}'=v_batch.payload_hash
   and v_core_rows=11 and jsonb_array_length(v_core->'rows')=11
   and (select count(distinct e->>'provider_key') from jsonb_array_elements(v_core->'rows') e)=11
   and v_gate#>>'{operational_market,market_decision}'='READY'
   and v_gate#>>'{operational_market,core_market,core_evidence_revision}'=v_batch.batch_id::text
   and v_gate#>>'{operational_market,report_level}'=case
    when (v_enhancements->>'news_count')::int>0 and (v_enhancements->>'sector_count')::int>0
      and v_enhancements->'missing_sources'='[]'::jsonb then 'FULL' else 'DEGRADED' end;
  if v_operational is distinct from true then v_errors:=array_append(v_errors,'OPERATIONAL_CORE_PROOF_INVALID'); end if;
 end if;
$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_VALIDATOR_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$ if not coalesce(lower(v_quality->>'publish_status') in ('ready','approved','published','publishable'),false)$old$;
 new_fragment:=$new$ if not coalesce(lower(v_quality->>'publish_status') in ('ready','approved','published','publishable')
  or (v_operational and lower(v_quality->>'publish_status')='degraded'),false)$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_QUALITY_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$ if p_ai->>'data_quality' is distinct from 'complete' or p_decision->'coverage_score' is distinct from '100'::jsonb
  or p_decision#>>'{generated_text,data_quality}' is distinct from 'complete'
  or p_decision#>'{generated_text,missing_sources}' is distinct from '[]'::jsonb$old$;
 new_fragment:=$new$ if (not v_operational and (p_ai->>'data_quality' is distinct from 'complete'
   or p_decision#>>'{generated_text,data_quality}' is distinct from 'complete'
   or p_decision#>'{generated_text,missing_sources}' is distinct from '[]'::jsonb))
  or p_decision->'coverage_score' is distinct from '100'::jsonb$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_COMPLETENESS_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into after_catalog from pg_proc where oid=target;
 if after_catalog is distinct from before_catalog then raise exception 'OPERATIONAL_VALIDATOR_CATALOG_DRIFT'; end if;

 target:='public.publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
 definition:=pg_get_functiondef(target);
 if md5(definition)<>'312adf45afe52c1a31921554dc6f7239' then raise exception 'OPERATIONAL_BUNDLE_PREDECESSOR_MISMATCH'; end if;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into before_catalog from pg_proc where oid=target;
 definition:=replace(definition,'declare'||chr(10),'declare'||chr(10)||'  v_operational boolean; v_enhancements jsonb;'||chr(10));
 old_fragment:=$old$  if v_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb$old$;
 new_fragment:=$new$  v_operational:=p_decision#>>'{generated_text,canonical_market_state,document,operational_market,contract_version}'='OPERATIONAL_MARKET_V1';
  v_enhancements:=p_decision#>'{generated_text,canonical_market_state,document,operational_market,input,enhancements}';
  if v_operational then
   if v_enhancements->'missing_sources' is distinct from v_run.provider_status#>'{manifest,missing_sources}'
    or v_enhancements->'news_count' is distinct from v_run.provider_status#>'{manifest,news_count}'
    or v_enhancements->'sector_count' is distinct from v_run.provider_status#>'{manifest,sector_count}'
   then raise exception 'OPERATIONAL_ENHANCEMENT_MANIFEST_MISMATCH'; end if;
  end if;
  if (not coalesce(v_operational,false) and (v_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_BUNDLE_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$    or p_report#>>'{ai_strategy_json,data_quality}' is distinct from 'complete'
    or nullif(p_decision->>'data_as_of','') is null then raise exception 'SOURCE_COMPLETENESS_UNVERIFIED'; end if;$old$;
 new_fragment:=$new$    or p_report#>>'{ai_strategy_json,data_quality}' is distinct from 'complete'))
    or nullif(p_decision->>'data_as_of','') is null then raise exception 'SOURCE_COMPLETENESS_UNVERIFIED'; end if;$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_BUNDLE_SOURCE_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 definition:=replace(definition,$old$jsonb_build_object('status',p_report#>>'{ai_strategy_json,data_quality}')$old$,
  $new$jsonb_build_object('status',case when v_operational then 'complete' else p_report#>>'{ai_strategy_json,data_quality}' end,
   'enhancement_quality',p_report#>>'{ai_strategy_json,data_quality}')$new$);
 execute definition;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into after_catalog from pg_proc where oid=target;
 if after_catalog is distinct from before_catalog then raise exception 'OPERATIONAL_BUNDLE_CATALOG_DRIFT'; end if;

 target:='public.capture_morning_alpha_acceptance_v1(date,text)'::regprocedure;
 definition:=pg_get_functiondef(target);
 if md5(definition)<>'f4e74a11d125187d0ecb92c09085120a' then raise exception 'OPERATIONAL_ACCEPTANCE_PREDECESSOR_MISMATCH'; end if;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into before_catalog from pg_proc where oid=target;
 definition:=replace(definition,'declare'||chr(10),'declare'||chr(10)||'  v_operational boolean:=false; v_service boolean:=false;'||chr(10));
 old_fragment:=$old$    if v_source_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb$old$;
 new_fragment:=$new$    v_operational:=v_d.generated_text#>>'{canonical_market_state,document,operational_market,contract_version}'='OPERATIONAL_MARKET_V1'
      and v_validation->'eligible'='true'::jsonb;
    if (not coalesce(v_operational,false) and (v_source_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_ACCEPTANCE_SOURCE_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$      or not coalesce((v_source_run.provider_status#>>'{manifest,sector_count}')::numeric>0,false)
      or not exists(select 1 from public.research_sessions$old$;
 new_fragment:=$new$      or not coalesce((v_source_run.provider_status#>>'{manifest,sector_count}')::numeric>0,false)))
      or not exists(select 1 from public.research_sessions$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_ACCEPTANCE_SOURCE_END_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$  if v_verdict='NOT_DUE' then$old$;
 new_fragment:=$new$  if v_operational then
    v_service:=public.market_checkpoint_batch_integrity_v1(p_business_date,'PREMARKET')->>'status'='PASS'
      and v_validation->'eligible'='true'::jsonb and v_evidence->'publication_pass'='true'::jsonb
      and v_evidence->'report_pass'='true'::jsonb and v_evidence->'delivery_pass'='true'::jsonb
      and v_line_count>0 and v_line_time<(p_business_date::text||'T08:45:00+08:00')::timestamptz;
    v_evidence:=v_evidence||jsonb_build_object('operational_contract','OPERATIONAL_MARKET_V1',
      'service_available',coalesce(v_service,false),'acceptance_dimensions',jsonb_build_object(
        'CORE_MARKET',case when public.market_checkpoint_batch_integrity_v1(p_business_date,'PREMARKET')->>'status'='PASS' then 'PASS' else 'FAIL' end,
        'REPORT_PUBLICATION',case when v_validation->'eligible'='true'::jsonb and v_evidence->'publication_pass'='true'::jsonb
          then (v_d.generated_text#>>'{market_report_gate,operational_market,report_level}')||'_PUBLISHED' else 'BLOCKED' end,
        'RECOMMENDATION',case v_d.generated_text#>>'{market_report_gate,recommendation_status}' when 'QUALIFIED' then 'READY' when 'NO_QUALIFIED_OPPORTUNITY' then 'NONE' else 'BLOCKED' end,
        'LINE',case when v_evidence->'delivery_pass'='true'::jsonb then 'PASS' else 'FAIL' end,
        'CLOSING',case when v_phase<>'FULL_DAY' then 'PENDING' when v_close_ok then 'PASS' else 'FAIL' end,
        'LEARNING',case when v_learning_ok then 'PASS' else 'LEARNING_DEGRADED' end,
        'DATA_SLA',v_evidence->'delivery_sla_status'));
  end if;
  if v_verdict='NOT_DUE' then$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_ACCEPTANCE_DIMENSIONS_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 -- Persist the new dimensions in the observer's expected result too. Older
 -- capsules remain unchanged and continue using their original verdict shape.
 old_fragment:=$old$'verdict',verdict,'blocking_checks',blocking_checks)$old$;
 new_fragment:=$new$'verdict',verdict,'blocking_checks',blocking_checks,
          'service_available',evidence->'service_available',
          'acceptance_dimensions',evidence->'acceptance_dimensions')$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_ACCEPTANCE_RECORDER_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into after_catalog from pg_proc where oid=target;
 if after_catalog is distinct from before_catalog then raise exception 'OPERATIONAL_ACCEPTANCE_CATALOG_DRIFT'; end if;

 target:='public.project_critical_sql_input_v1(jsonb,integer)'::regprocedure;
 definition:=pg_get_functiondef(target);
 if md5(definition)<>'b2022e42da4e53cfe0c915d147991c65' then raise exception 'OPERATIONAL_RECORDER_PREDECESSOR_MISMATCH'; end if;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into before_catalog from pg_proc where oid=target;
 old_fragment:=$old$elsif v_key=any(v_keys) or v_key=any(array[$old$;
 new_fragment:=$new$elsif v_key=any(string_to_array('operational_market input core enhancements integrity batch rows observed_at canonical_row_count unbatched_row_count committed_batch_count distinct_batch_id_count distinct_provider_count duplicate_authoritative_provider_count compatibility_row_count compatibility_provider_count compatibility_mismatch_count mixed_batch_revision_count production_2026_09_11_evidence_preserved core_market market_decision report_level publication_status confidence_impact missing_evidence unavailable_sections news_context sector_rotation learning_evidence unknown_missing_sources core_evidence_revision source_correlation_id classification learning_available recommendation_status is_current supersedes_id service_available acceptance_dimensions CORE_MARKET REPORT_PUBLICATION RECOMMENDATION LINE CLOSING LEARNING DATA_SLA',' ')) or v_key=any(v_keys) or v_key=any(array[$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_RECORDER_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into after_catalog from pg_proc where oid=target;
 if after_catalog is distinct from before_catalog then raise exception 'OPERATIONAL_RECORDER_CATALOG_DRIFT'; end if;

 -- Enrichment legitimately creates N+1 research sessions. Replay must retain
 -- their version identity, not let every restored row default to version 1.
 target:='public.critical_sql_replay_inputs_v1(date)'::regprocedure;
 definition:=pg_get_functiondef(target);
 if md5(definition)<>'b47b63e41760e63f40bc170dca940cd9' then raise exception 'OPERATIONAL_READSET_PREDECESSOR_MISMATCH'; end if;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into before_catalog from pg_proc where oid=target;
 old_fragment:=$old$('research_sessions','id,idempotency_key,session_type,trading_date,data_as_of','trading_date=$1')$old$;
 new_fragment:=$new$('research_sessions','id,idempotency_key,session_type,trading_date,data_as_of,version','trading_date=$1')$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_SESSION_VERSION_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$('decision_snapshots','id,idempotency_key,report_id,report_date,session_type,status,version,valid_from$old$;
 new_fragment:=$new$('decision_snapshots','id,idempotency_key,report_id,report_date,session_type,status,version,is_current,supersedes_id,valid_from$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_REVISION_IDENTITY_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into after_catalog from pg_proc where oid=target;
 if after_catalog is distinct from before_catalog then raise exception 'OPERATIONAL_READSET_CATALOG_DRIFT'; end if;

 -- Publication validation now consumes the immutable Atomic proof. Its
 -- Recorder must retain that same bounded read-set, not only policy settings.
 target:='public.record_publication_contract_evidence_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
 definition:=pg_get_functiondef(target);
 if md5(definition)<>'7d8ce4069782690e577ad2f7c0acd552' then raise exception 'OPERATIONAL_PUBLICATION_RECORDER_PREDECESSOR_MISMATCH'; end if;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into before_catalog from pg_proc where oid=target;
 definition:=replace(definition,'declare v_args jsonb;','declare v_inputs jsonb;v_args jsonb;');
 old_fragment:=$old$ return public.record_critical_contract_evidence_v1(p_report_date,'PUBLICATION',jsonb_build_object($old$;
 new_fragment:=$new$ v_inputs:=public.critical_sql_replay_inputs_v1(p_report_date);
 return public.record_critical_contract_evidence_v1(p_report_date,'PUBLICATION',jsonb_build_object($new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_PUBLICATION_RECORDER_INPUT_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$'tables',jsonb_build_object('runtime_quality_policies',v_policy))$old$;
 new_fragment:=$new$'tables',jsonb_build_object('runtime_quality_policies',v_policy,
    'market_checkpoint_batches',v_inputs#>'{tables,market_checkpoint_batches}',
    'market_checkpoint_snapshots',v_inputs#>'{tables,market_checkpoint_snapshots}',
    'market_data_snapshots',v_inputs#>'{tables,market_data_snapshots}'))$new$;
 if position(old_fragment in definition)=0 then raise exception 'OPERATIONAL_PUBLICATION_RECORDER_TABLES_ANCHOR_MISSING'; end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid))
 into after_catalog from pg_proc where oid=target;
 if after_catalog is distinct from before_catalog then raise exception 'OPERATIONAL_PUBLICATION_RECORDER_CATALOG_DRIFT'; end if;
end;
$migration$;
commit;
