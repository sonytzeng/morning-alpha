CREATE OR REPLACE FUNCTION vnext_runtime.daily_ai_financial_latest_v3(p_rows jsonb, p_symbol text, p_received timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare row jsonb;label jsonb;winner jsonb;best_rank integer:=-1;best_export text:='';ties integer:=0;rank_value integer;
begin
 for row in select r from jsonb_array_elements(p_rows)r where vnext_runtime.daily_ai_financial_field_v3(r,array['公司代號','SecuritiesCompanyCode'])#>>'{}'=p_symbol loop
  label:=vnext_runtime.daily_ai_financial_report_v3(row,p_received);if label is null then return null;end if;rank_value:=(label->>'rank')::integer;
  if rank_value>best_rank or rank_value=best_rank and label->>'exported'>best_export then
   winner:=row;best_rank:=rank_value;best_export:=label->>'exported';ties:=1;
  elsif rank_value=best_rank and label->>'exported'=best_export then ties:=ties+1;end if;
 end loop;
 if ties<>1 then return null;end if;return winner;
end $function$
