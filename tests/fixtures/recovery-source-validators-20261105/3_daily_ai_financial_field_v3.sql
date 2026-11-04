CREATE OR REPLACE FUNCTION vnext_runtime.daily_ai_financial_field_v3(p_row jsonb, p_keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select p_row->k from unnest(p_keys) with ordinality keys(k,n)
 where p_row->k is not null and p_row->k<>'null'::jsonb order by n limit 1;
$function$
