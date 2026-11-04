CREATE OR REPLACE FUNCTION vnext_runtime.daily_ai_financial_restricted_v3(p_source text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(p_source ~* '^https?://([a-z0-9-]+\.)*(tsmc[.]com|mediatek[.]com|honhai[.]com)(:[0-9]+)?(/|$)',false);
$function$
