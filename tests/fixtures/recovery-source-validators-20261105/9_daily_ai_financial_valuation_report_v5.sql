CREATE OR REPLACE FUNCTION vnext_runtime.daily_ai_financial_valuation_report_v5(p_row jsonb, p_received timestamp with time zone, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare is_tpex boolean:=p_source='https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis';keys text[];
 raw_date text:=p_row->>'Date';fiscal text;dividend_year text;quote_date date;report_end date;age integer;
begin
 if p_source not in('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d','https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis') then return null;end if;
 keys:=case when is_tpex then array['Date','SecuritiesCompanyCode','CompanyName','PriceEarningRatio','DividendPerShare','YieldRatio','PriceBookRatio']
  else array['Date','Code','Name','ClosePrice','DividendYield','DividendYear','PEratio','PBratio','FiscalYearQuarter'] end;
 if jsonb_typeof(p_row) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_row))<>cardinality(keys)
  or exists(select from unnest(keys)k where jsonb_typeof(p_row->k) is distinct from 'string') then return null;end if;
 if is_tpex then
  if coalesce(raw_date,'') !~ '^\d{7}$' or substring(raw_date from 1 for 3)::integer not between 80 and 300 then return null;end if;
  quote_date:=make_date(substring(raw_date from 1 for 3)::integer+1911,substring(raw_date from 4 for 2)::integer,substring(raw_date from 6 for 2)::integer);
 else
  fiscal:=p_row->>'FiscalYearQuarter';dividend_year:=p_row->>'DividendYear';
  if coalesce(raw_date,'') !~ '^\d{8}$' or coalesce(fiscal,'') !~ '^\d{4}Q[1-4]$' or coalesce(dividend_year,'') !~ '^\d{3,4}$' then return null;end if;
  quote_date:=make_date(substring(raw_date from 1 for 4)::integer,substring(raw_date from 5 for 2)::integer,substring(raw_date from 7 for 2)::integer);
  report_end:=(make_date(substring(fiscal from 1 for 4)::integer,right(fiscal,1)::integer*3,1)+interval '1 month'-interval '1 day')::date;
  if substring(fiscal from 1 for 4)::integer<1991 or report_end>quote_date then return null;end if;
 end if;
 age:=(p_received at time zone 'Asia/Taipei')::date-quote_date;if age not between 0 and 7 then return null;end if;
 return jsonb_build_object('period',to_char(quote_date,'YYYY-MM-DD'),'raw',raw_date,'fiscal',fiscal,'dividendYear',dividend_year);
exception when others then return null;
end $function$
