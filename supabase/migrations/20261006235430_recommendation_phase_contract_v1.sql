-- CANDIDATE ONLY. Exact predecessor, forward-only, no business DML/backfill.
-- Phase-aware WATCH is NOT a recommendation. Existing Core/Atomic/quality
-- predicates, identities, owner, ACL, security and search_path remain unchanged.
begin;
do $migration$
declare target regprocedure; definition text; before_catalog jsonb; after_catalog jsonb; old_fragment text; new_fragment text;
begin
 target:='public.validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
 definition:=pg_get_functiondef(target);
 if md5(definition)<>'ebfc39a36947b061d6810e7772e86ba8' then raise exception 'RECOMMENDATION_PHASE_PREDECESSOR_MISMATCH'; end if;
 select jsonb_build_array(proowner,proacl,prosecdef,proconfig,pg_get_function_arguments(oid)) into before_catalog from pg_proc where oid=target;
 old_fragment:=$old$v_recommendation->>'status' in ('BLOCKED','NO_QUALIFIED_OPPORTUNITY')$old$;
 if position(old_fragment in definition)=0 then raise exception 'RECOMMENDATION_PHASE_STATUS_ANCHOR'; end if;
 definition:=replace(definition,old_fragment,$new$v_recommendation->>'status' in ('BLOCKED','NO_QUALIFIED_OPPORTUNITY','PREMARKET_WATCH')$new$);
 old_fragment:=$old$ if v_recommendation->>'status'='NO_QUALIFIED_OPPORTUNITY' and ($old$;
 if position(old_fragment in definition)=0 then raise exception 'RECOMMENDATION_PHASE_PROOF_ANCHOR'; end if;
 new_fragment:=$new$ if v_recommendation->>'status'='PREMARKET_WATCH' then
  -- New research-only state requires a complete same-cutoff phase proof.
  -- Never accept an LLM label, empty screen, arbitrary future timestamp, or
  -- a WATCH list in generated recommendations.
  if p_ai#>>'{decision_v1,schema_version}' is distinct from 'decision-evidence-v1'
   or p_ai#>>'{decision_v1,report_date}' is distinct from p_report_date::text
   or p_ai#>>'{decision_v1,today_date}' is distinct from p_report_date::text
   or p_ai#>>'{decision_v1,generated_at}' is distinct from v_state->>'generated_at'
   or nullif(p_ai#>>'{decision_v1,revision_id}','') is null
   or p_ai#>>'{decision_v1,evidence_quality}' is distinct from 'complete'
   or p_ai#>>'{decision_v1,data_freshness}' is distinct from 'valid_at_assessment'
   or p_ai#>>'{decision_v1,phase_evaluation,evaluation_phase}' is distinct from 'PREMARKET'
   or p_ai#>>'{decision_v1,phase_evaluation,status}' is distinct from 'PREMARKET_WATCH'
   or p_ai#>'{decision_v1,phase_evaluation,universe_count}' is distinct from '72'::jsonb
   or p_ai#>'{decision_v1,phase_evaluation,evaluated_count}' is distinct from '72'::jsonb
   or p_ai#>'{decision_v1,phase_evaluation,blocked_count}' is distinct from '0'::jsonb
   or p_ai#>'{decision_v1,phase_evaluation,ready_count}' is distinct from '0'::jsonb
   or (v_generated at time zone 'Asia/Taipei')::time >= time '09:00'
   or p_ai#>>'{decision_v1,screening,status}' is distinct from 'COMPLETE'
   or p_ai#>'{decision_v1,screening,rejected}' is distinct from '[]'::jsonb
   or jsonb_typeof(p_ai#>'{decision_v1,phase_evaluation,candidates}') is distinct from 'array'
   or jsonb_typeof(p_ai#>'{decision_v1,evidence}') is distinct from 'array'
  then v_errors:=array_append(v_errors,'PREMARKET_WATCH_PROOF_INVALID');
  else
   if (select array_agg(e->>'symbol' order by e->>'symbol') from jsonb_array_elements(p_ai#>'{decision_v1,phase_evaluation,candidates}') e)
     is distinct from string_to_array('1504 1513 1514 1519 1590 1605 1760 2049 2208 2303 2308 2317 2330 2337 2344 2356 2357 2368 2376 2377 2379 2382 2383 2408 2421 2454 2520 2539 2542 2548 2603 2609 2610 2615 2618 2634 2881 2882 2884 2885 2886 2891 2892 3006 3017 3034 3037 3081 3189 3231 3324 3363 3443 3450 3529 3653 3661 3711 4566 4743 4908 4979 6213 6230 6274 6446 6488 6547 6669 8033 8046 8299',' ')
    or not coalesce((p_ai#>>'{decision_v1,phase_evaluation,watch_count}')::integer>0,false)
    or (select count(*) from jsonb_array_elements(p_ai#>'{decision_v1,phase_evaluation,candidates}') e where e->>'status'='WATCH') is distinct from (p_ai#>>'{decision_v1,phase_evaluation,watch_count}')::integer
    or exists(select 1 from jsonb_array_elements(p_ai#>'{decision_v1,phase_evaluation,candidates}') e
      where not coalesce(e->>'status' in ('WATCH','NONE'),false)
       or (e->>'status'='WATCH' and (e->>'post_event_price' is distinct from 'NOT_YET_OBSERVABLE'
        or e->>'post_event_volume' is distinct from 'NOT_YET_OBSERVABLE'
        or jsonb_typeof(e->'evidence_ids') is distinct from 'array' or e->'evidence_ids'='[]'::jsonb)))
   then v_errors:=array_append(v_errors,'PREMARKET_WATCH_UNIVERSE_INVALID'); end if;
  end if;
 end if;
 if v_recommendation->>'status' in ('NO_QUALIFIED_OPPORTUNITY','PREMARKET_WATCH') and ($new$;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 select jsonb_build_array(proowner,proacl,prosecdef,proconfig,pg_get_function_arguments(oid)) into after_catalog from pg_proc where oid=target;
 if after_catalog is distinct from before_catalog then raise exception 'RECOMMENDATION_PHASE_SECURITY_DRIFT'; end if;

 target:='public.capture_morning_alpha_acceptance_v1(date,text)'::regprocedure;
 definition:=pg_get_functiondef(target);
 if md5(definition)<>'d818e7b3949cd6efdb8856341646a211' then raise exception 'RECOMMENDATION_PHASE_ACCEPTANCE_PREDECESSOR'; end if;
 -- Only recommendation dimension label. Verdict, SLA, deadlines untouched.
 old_fragment:=$old$when 'NO_QUALIFIED_OPPORTUNITY' then 'NONE' else 'BLOCKED' end$old$;
 if position(old_fragment in definition)=0 then raise exception 'RECOMMENDATION_PHASE_ACCEPTANCE_ANCHOR'; end if;
 definition:=replace(definition,old_fragment,$new$when 'NO_QUALIFIED_OPPORTUNITY' then 'NONE' when 'PREMARKET_WATCH' then 'WATCH' else 'BLOCKED' end$new$);
 execute definition;

 target:='public.project_critical_sql_input_v1(jsonb,integer)'::regprocedure;
 definition:=pg_get_functiondef(target);
 if md5(definition)<>'6278f9b0b7eb5141a0caeba316b412f6' then raise exception 'RECOMMENDATION_PHASE_RECORDER_PREDECESSOR'; end if;
 -- A complete 72-stock proof references more than 1000 unique price/fundamental
 -- rows. Scope the larger bound ONLY to this named proof's evidence array;
 -- the generic array bound, sanitization, depth and capsule byte limits stay.
 old_fragment:=$old$if v_key='raw' then$old$;
 if position(old_fragment in definition)=0 then raise exception 'RECOMMENDATION_PHASE_RECORDER_EVIDENCE_ANCHOR'; end if;
 definition:=replace(definition,old_fragment,$new$if v_key='evidence' and p_value->>'schema_version'='decision-evidence-v1' then
       if jsonb_typeof(v_value) is distinct from 'array' or jsonb_array_length(v_value)>4096 then raise exception 'RECOMMENDATION_PROOF_EVIDENCE_BOUND'; end if;
       v_out:=v_out||jsonb_build_object(v_key,(select coalesce(jsonb_agg(public.project_critical_sql_input_v1(e,p_depth+1)),'[]') from jsonb_array_elements(v_value) e));
     elsif v_key='raw' then$new$);
 old_fragment:=$old$elsif v_key=any(string_to_array('$old$;
 if position(old_fragment in definition)=0 then raise exception 'RECOMMENDATION_PHASE_RECORDER_ANCHOR'; end if;
 definition:=replace(definition,old_fragment,$new$elsif v_key=any(string_to_array('decision_v1 phase_evaluation evaluation_phase universe_count evaluated_count watch_count ready_count none_count blocked_count not_yet_observable_count reason_distribution candidates post_event_price post_event_volume relative_strength risk_pass reasons evidence observed_at available_at evidence_ids screening rejected evidence_quality data_freshness ENTRY_PENDING_MARKET_OPEN FUNDAMENTAL_DAMAGE INSTITUTIONAL_CONFIRMATION_FAILED PRE_EVENT_EXTENSION_REJECTED MARKET_RISK_REJECTED ENTRY_NOT_CONFIRMED QUALITY_THRESHOLD_NOT_MET RISK_OR_EXTENSION_REJECTED FRESH_QUOTE_MISSING CONFLICTING_QUOTES 20_DAILY_VOLUMES_MISSING 20_DAILY_CLOSES_MISSING THREE_INSTITUTIONS_MISSING FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING SOURCED_COMPANY_CATALYST_MAPPING_MISSING SECTOR_REACTION_MISSING EVENT_ALIGNED_PRICE_VOLUME_REACTION_MISSING MARKET_REQUIRED_MARKET_REGIME MARKET_REQUIRED_RISK MARKET_REQUIRED_PRICE_POSITION MARKET_REQUIRED_BREADTH MARKET_REQUIRED_INSTITUTIONAL MARKET_REQUIRED_CATALYST MARKET_REQUIRED_EVIDENCE_QUALITY $new$);
 execute definition;
end;
$migration$;
commit;
