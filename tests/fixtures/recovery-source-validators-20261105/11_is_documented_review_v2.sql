CREATE OR REPLACE FUNCTION vnext_runtime.is_documented_review_v2(p_fact jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(p_fact->>'id' like 'own-documented-review:%',false);
$function$
