-- LOCAL ROLLBACK CANDIDATE. Closes aggregate admission and restores the exact
-- predecessor validator. Immutable source/evidence records remain available.
begin;
do $$declare definition text;begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.validate_packet(jsonb,text,text)'))
   is distinct from 'd4de884bc23b70a448f284db1cc790a4'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.validate_packet_rows_v2(jsonb,text,text)'))
   is distinct from 'e2c9c3472685027640a271e8a070552d'
  then raise exception 'MARKET_ACTION_AGGREGATE_ROLLBACK_BASELINE';end if;
 definition:=pg_get_functiondef('vnext_market.validate_packet_rows_v2(jsonb,text,text)'::regprocedure);
 if strpos(definition,'FUNCTION vnext_market.validate_packet_rows_v2(')=0 then raise exception 'MARKET_ACTION_AGGREGATE_ROLLBACK_DEFINITION';end if;
 execute replace(definition,'FUNCTION vnext_market.validate_packet_rows_v2(','FUNCTION vnext_market.validate_packet(');
end $$;
drop function vnext_market.validate_action_evidence(jsonb,text,text);
drop function vnext_market.validate_packet_rows_v2(jsonb,text,text);
revoke all on function vnext_market.validate_packet(jsonb,text,text) from public,anon,authenticated,service_role;
commit;
