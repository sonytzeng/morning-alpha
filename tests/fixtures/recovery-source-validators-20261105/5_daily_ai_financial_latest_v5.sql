CREATE OR REPLACE FUNCTION vnext_runtime.daily_ai_financial_latest_v5(p_rows jsonb, p_symbol text, p_received timestamp with time zone, p_source text, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare row jsonb;label jsonb;winner jsonb;best_date text:='';ties integer:=0;code_key text;
begin
 if p_kind<>'VALUATION_AS_REPORTED' then return vnext_runtime.daily_ai_financial_latest_v3(p_rows,p_symbol,p_received);end if;
 if p_source='https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d' then code_key:='Code';
 elsif p_source='https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis' then code_key:='SecuritiesCompanyCode';else return null;end if;
 for row in select r from jsonb_array_elements(p_rows)r where r->>code_key=p_symbol loop
  label:=vnext_runtime.daily_ai_financial_valuation_report_v5(row,p_received,p_source);if label is null then return null;end if;
  if label->>'period'>best_date then winner:=row;best_date:=label->>'period';ties:=1;
  elsif label->>'period'=best_date then ties:=ties+1;end if;
 end loop;
 if ties<>1 then return null;end if;return winner;
exception when others then return null;
end $function$
