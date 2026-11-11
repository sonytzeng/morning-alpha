-- LOCAL CANDIDATE. Whole-market packets use market-<content SHA prefix>;
-- action replay packets retain tpex-actions-<coverage SHA prefix>. Both IDs are
-- derived from independently verified content. Receipt-time checks are unchanged.
begin;
do $patch$
declare definition text;
 old_expression text:=$old$p_evidence->>'id' is distinct from 'tpex-actions-'||left(expected->>'coverage_hash',40)$old$;
 new_expression text:=$new$(p_evidence->>'id' is distinct from 'tpex-actions-'||left(expected->>'coverage_hash',40)
  and p_evidence->>'id' is distinct from 'market-'||left(p_evidence->>'evidence_hash',40))$new$;
begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.validate_action_evidence(jsonb,text,text)'))
   is distinct from '60671ada610684b17493294deb8f01b7'
  then raise exception 'MARKET_ACTION_ID_BASELINE';end if;
 definition:=pg_get_functiondef('vnext_market.validate_action_evidence(jsonb,text,text)'::regprocedure);
 if (length(definition)-length(replace(definition,old_expression,'')))/length(old_expression)<>1
  then raise exception 'MARKET_ACTION_ID_DEFINITION';end if;
 execute replace(definition,old_expression,new_expression);
 if (select md5(prosrc) from pg_proc where oid='vnext_market.validate_action_evidence(jsonb,text,text)'::regprocedure)
   is distinct from 'ca53ecd8cd502a4255b7c46602460fd0'
  then raise exception 'MARKET_ACTION_ID_RESULT';end if;
end $patch$;
revoke all on function vnext_market.validate_action_evidence(jsonb,text,text) from public,anon,authenticated,service_role;
commit;
