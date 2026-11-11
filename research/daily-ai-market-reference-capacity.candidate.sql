-- LOCAL CANDIDATE. The final 33-report universe needs a 33.4 MB input pool.
-- Only the segmented transport's global bound grows to 64 MB. Each chunk
-- remains <=1 MB / 256 nodes; <=60,000 raw bindings and all source gates stay.
-- The original single-request stage_daily_ai_market_price_inputs_v2 stays 32 MB.
begin;
do $patch$
declare item record;definition text;
begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.stage_daily_ai_market_price_inputs_v2(text,text,text)'))
   is distinct from 'a8e5ee899c3231d5b70fd3e19178069b' then raise exception 'MARKET_REFERENCE_CAPACITY_LEGACY_BASELINE';end if;
 for item in select * from (values
  ('public.stage_daily_ai_market_price_input_chunk_v2(text,text,text)','e2cf76383a0de59d0a2e1f6966c68189','9ac9067664841b6ac6e699cbe718884e'),
  ('public.finalize_daily_ai_market_price_inputs_v2(text,text,text)','eb5baf5025258d30ec9f0e9040011258','f9693db28224428d0ab48f1b61a92743')
 )t(signature,before_hash,after_hash) loop
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure(item.signature)) is distinct from item.before_hash
   then raise exception 'MARKET_REFERENCE_CAPACITY_BASELINE';end if;
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if (length(definition)-length(replace(definition,'32000000','')))/8<>1 then raise exception 'MARKET_REFERENCE_CAPACITY_DEFINITION';end if;
  execute replace(definition,'32000000','64000000');
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure(item.signature)) is distinct from item.after_hash
   then raise exception 'MARKET_REFERENCE_CAPACITY_RESULT';end if;
 end loop;
end $patch$;
revoke all on function public.stage_daily_ai_market_price_input_chunk_v2(text,text,text),
 public.finalize_daily_ai_market_price_inputs_v2(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_market_price_input_chunk_v2(text,text,text),
 public.finalize_daily_ai_market_price_inputs_v2(text,text,text) to service_role;
commit;
