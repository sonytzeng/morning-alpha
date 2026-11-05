CREATE OR REPLACE FUNCTION vnext_runtime.daily_ai_financial_number_v3(p_value jsonb)
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare value text:=btrim(p_value#>>'{}');result double precision;
begin
 if jsonb_typeof(p_value)='number' or jsonb_typeof(p_value)='string' and value ~ '^[-+]?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$' then
  result:=replace(value,',','')::double precision;
  if result::text not in('Infinity','-Infinity','NaN') then return result;end if;
 end if;return null;
exception when others then return null;
end $function$
