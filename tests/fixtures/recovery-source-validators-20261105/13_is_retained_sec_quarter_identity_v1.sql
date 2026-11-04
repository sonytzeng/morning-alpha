CREATE OR REPLACE FUNCTION vnext_runtime.is_retained_sec_quarter_identity_v1(p_fact jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(p_fact->>'id' like 'sec-quarter:%',false)
  or coalesce(p_fact->>'source' ~* '^https?://[^/]*sec[.]gov[^/]*/Archives/edgar/data/0*1046179(/|$)',false);
$function$
