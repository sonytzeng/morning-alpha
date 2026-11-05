CREATE OR REPLACE FUNCTION vnext_runtime.is_umc_ir_direct_fact_v1(p_fact jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(p_fact->>'id' like 'umc-ir-direct:%',false);
$function$
