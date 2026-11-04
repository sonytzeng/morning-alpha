CREATE OR REPLACE FUNCTION vnext_runtime.daily_ai_financial_body_v3(p_symbol text, p_kind text, p_row jsonb, p_response jsonb, p_row_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare label jsonb:=vnext_runtime.daily_ai_financial_report_v3(p_row,(p_response->>'received_at')::timestamptz);
 values jsonb;decimal jsonb;revenue double precision;n double precision;ratio double precision;key text;field text;raw jsonb;
begin
 if label is null then return null;end if;
 if p_kind='EPS_AS_REPORTED' and p_response->>'source' in('https://openapi.twse.com.tw/v1/opendata/t187ap14_L','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O') then
  decimal:=vnext_runtime.daily_ai_financial_field_v3(p_row,array['基本每股盈餘(元)','基本每股盈餘']);n:=vnext_runtime.daily_ai_financial_number_v3(decimal);if n is null then return null;end if;
  values:=jsonb_build_object('value',n,'reported_decimal',decimal#>>'{}','unit','SOURCE_REPORTED_YUAN_PER_SHARE','measurement_basis','BASIC_AS_REPORTED',
   'reported_year_roc',label->>'roc','reported_quarter',label->>'quarter','period_scope',label->>'scope','period_basis','AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_INFERRED','no_single_quarter_or_ttm_inference','TRUE');
 elsif p_kind='FINANCIAL_AS_REPORTED' and p_response->>'source'='https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci' then
  values:=jsonb_build_object('reported_year_roc',label->>'roc','reported_quarter',label->>'quarter','period_scope',label->>'scope','period_basis','AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_INFERRED',
   'unit','PERCENT_RATIO_OF_SAME_REPORTED_MONETARY_UNIT','source_monetary_scale','NOT_EXPLICIT_IN_API_ROW_NO_SCALED_AMOUNT_CLAIMS',
   'calculation_basis','GROSS_OPERATING_NET_PROFIT_DIVIDED_BY_REPORTED_REVENUE_TIMES_100','no_single_quarter_or_ttm_inference','TRUE');
  revenue:=vnext_runtime.daily_ai_financial_number_v3(p_row->'營業收入');if revenue is null or revenue=0 then return null;end if;
  foreach key in array array['gross_margin_percent','operating_margin_percent','net_margin_percent'] loop
   raw:=case key when 'gross_margin_percent' then case when coalesce(p_row->>'營業毛利（毛損）淨額','')<>'' then p_row->'營業毛利（毛損）淨額' else p_row->'營業毛利（毛損）' end
    when 'operating_margin_percent' then p_row->'營業利益（損失）' else p_row->'本期淨利（淨損）' end;
   n:=vnext_runtime.daily_ai_financial_number_v3(raw);if n is null then continue;end if;
   ratio:=floor(((n/revenue)*100)*1000000+0.5)/1000000;
   if ratio::text not in('Infinity','-Infinity','NaN') then values:=values||jsonb_build_object(key,ratio);end if;
  end loop;
  if not(values ?| array['gross_margin_percent','operating_margin_percent','net_margin_percent']) then return null;end if;
 else return null;end if;
 return jsonb_build_object('symbol',p_symbol,'kind',p_kind,'period',label->>'period','basis','AS_REPORTED','values',values,'source',p_response->>'source','published_at',null,
  'first_seen_at',p_response->>'received_at','available_at',p_response->>'received_at','as_of',p_response->>'received_at','source_sha256',p_response->>'source_sha256',
  'source_bytes',p_response->'source_bytes','source_received_at',p_response->>'received_at','source_locator',jsonb_build_object('company_code',p_symbol,
   'reported_year_roc',vnext_runtime.daily_ai_financial_field_v3(p_row,array['年度','Year']),'reported_quarter',p_row->'季別',
   'source_export_date_not_publication',vnext_runtime.daily_ai_financial_field_v3(p_row,array['出表日期','Date']),'row_sha256',p_row_hash),
  'data_quality_status','OFFICIAL_OPEN_API_OBSERVED_AFTER_RECEIPT_PUBLICATION_UNKNOWN_AS_REPORTED_PERIOD_BASIS_NOT_INFERRED','actual_only',true,
  'historical_knowledge',false,'source_admitted',false,'member_publication_approved',false);
end $function$
