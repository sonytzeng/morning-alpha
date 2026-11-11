-- Stop only the new bounded transport. Keep every immutable chunk, binding,
-- node and completed pool for audit. The existing pool/reference APIs remain.
begin;
do $$declare sig text;begin
 foreach sig in array array[
  'public.stage_daily_ai_market_price_input_chunk_v2(text,text,text)',
  'public.finalize_daily_ai_market_price_inputs_v2(text,text,text)',
  'vnext_market.price_validate_raw_binding_v2(text,timestamptz,text,jsonb)'
 ] loop
  if to_regprocedure(sig) is not null then execute 'revoke all on function '||sig||' from public,anon,authenticated,service_role';end if;
 end loop;
end $$;
commit;
