-- LOCAL CANDIDATE. Install after BVPS and reference performance extensions.
-- Complete TWSE official STOCK_DAY history and complete TPEx all-trade history
-- carry different normalized scope labels. Only this market/scope pairing is
-- changed. All source, packet, date, price, summary and BVPS checks remain.
-- This admits an observed historical range, not a BUY or validated strategy.
begin;
do $patch$
declare definition text;
 old_expression text:=$old$bar->>'session_scope' is distinct from 'INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES'$old$;
 new_expression text:=$new$not coalesce((bar->>'market'='TPEX' and bar->>'session_scope'='INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES')
     or (bar->>'market'='TWSE' and bar->>'session_scope'='OFFICIAL_STOCK_DAY'),false)$new$;
begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.reference_projection(text,text,text,text,text,text)'))
   is distinct from '886c09fa20182876261b9b28f6d1dd97'
  then raise exception 'MARKET_SHORT_SCOPE_BASELINE';end if;
 definition:=pg_get_functiondef('vnext_market.reference_projection(text,text,text,text,text,text)'::regprocedure);
 if (length(definition)-length(replace(definition,old_expression,'')))/length(old_expression)<>1
  then raise exception 'MARKET_SHORT_SCOPE_DEFINITION';end if;
 execute replace(definition,old_expression,new_expression);
 if (select md5(prosrc) from pg_proc where oid='vnext_market.reference_projection(text,text,text,text,text,text)'::regprocedure)
   is distinct from '52130f03d9b1318f54d96bfa93d15852'
  then raise exception 'MARKET_SHORT_SCOPE_RESULT';end if;
end $patch$;
-- No new callable surface or data mutation; keep the projection private.
revoke all on function vnext_market.reference_projection(text,text,text,text,text,text) from public,anon,authenticated,service_role;
commit;
