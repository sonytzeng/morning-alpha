-- Restore the exact prior post-BVPS projection body. Keep every immutable
-- capture, reference, staged stock and edition. Roll back before BVPS.
begin;
do $patch$
declare definition text;
 old_expression text:=$old$bar->>'session_scope' is distinct from 'INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES'$old$;
 new_expression text:=$new$not coalesce((bar->>'market'='TPEX' and bar->>'session_scope'='INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES')
     or (bar->>'market'='TWSE' and bar->>'session_scope'='OFFICIAL_STOCK_DAY'),false)$new$;
begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.reference_projection(text,text,text,text,text,text)'))
   is distinct from '52130f03d9b1318f54d96bfa93d15852'
  then raise exception 'MARKET_SHORT_SCOPE_ROLLBACK_BASELINE';end if;
 definition:=pg_get_functiondef('vnext_market.reference_projection(text,text,text,text,text,text)'::regprocedure);
 if (length(definition)-length(replace(definition,new_expression,'')))/length(new_expression)<>1
  then raise exception 'MARKET_SHORT_SCOPE_ROLLBACK_DEFINITION';end if;
 execute replace(definition,new_expression,old_expression);
 if (select md5(prosrc) from pg_proc where oid='vnext_market.reference_projection(text,text,text,text,text,text)'::regprocedure)
   is distinct from '886c09fa20182876261b9b28f6d1dd97'
  then raise exception 'MARKET_SHORT_SCOPE_ROLLBACK_RESULT';end if;
end $patch$;
revoke all on function vnext_market.reference_projection(text,text,text,text,text,text) from public,anon,authenticated,service_role;
commit;
