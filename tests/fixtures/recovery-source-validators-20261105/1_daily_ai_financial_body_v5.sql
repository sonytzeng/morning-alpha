CREATE OR REPLACE FUNCTION vnext_runtime.daily_ai_financial_body_v5(p_symbol text, p_kind text, p_row jsonb, p_response jsonb, p_row_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare source text:=p_response->>'source';is_tpex boolean:=source='https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis';label jsonb;values jsonb;
 close_value double precision;pe double precision;pb double precision;yield_value double precision;dividend double precision;raw jsonb;key text;
begin
 if p_kind<>'VALUATION_AS_REPORTED' then return vnext_runtime.daily_ai_financial_body_v3(p_symbol,p_kind,p_row,p_response,p_row_hash);end if;
 label:=vnext_runtime.daily_ai_financial_valuation_report_v5(p_row,(p_response->>'received_at')::timestamptz,source);if label is null then return null;end if;
 if (case when is_tpex then p_row->>'SecuritiesCompanyCode' else p_row->>'Code' end) is distinct from p_symbol then return null;end if;
 foreach key in array case when is_tpex then array['PriceEarningRatio','PriceBookRatio','YieldRatio','DividendPerShare'] else array['PEratio','PBratio','DividendYield'] end loop
  raw:=p_row->key;
  if vnext_runtime.daily_ai_financial_number_v3(raw) is null and btrim(raw#>>'{}') not in('','-','--','N/A') then return null;end if;
 end loop;
 pe:=vnext_runtime.daily_ai_financial_number_v3(p_row->case when is_tpex then 'PriceEarningRatio' else 'PEratio' end);
 pb:=vnext_runtime.daily_ai_financial_number_v3(p_row->case when is_tpex then 'PriceBookRatio' else 'PBratio' end);
 yield_value:=vnext_runtime.daily_ai_financial_number_v3(p_row->case when is_tpex then 'YieldRatio' else 'DividendYield' end);
 if is_tpex then dividend:=vnext_runtime.daily_ai_financial_number_v3(p_row->'DividendPerShare');
 else close_value:=vnext_runtime.daily_ai_financial_number_v3(p_row->'ClosePrice');if close_value is null or close_value<=0 then return null;end if;end if;
 if pe<=0 or yield_value<0 or dividend<0 then return null;end if;
 values:=jsonb_build_object('quote_date',label->>'period','close_price',close_value,'pe_ratio',pe,'pb_ratio',pb,'dividend_yield_percent',yield_value,
  'dividend_year_as_reported',label->'dividendYear','financial_year_quarter_as_reported',label->'fiscal','price_unit','SOURCE_REPORTED_PRICE_PER_SHARE','ratio_unit','TIMES','yield_unit','PERCENT',
  'calculation_basis',case when is_tpex then 'OFFICIAL_TPEX_PUBLISHED_RATIOS_NOT_RECONSTRUCTED' else 'OFFICIAL_TWSE_PUBLISHED_RATIOS_NOT_RECONSTRUCTED' end,
  'earnings_reference_basis',case when is_tpex then 'TPEX_REPORTED_FOUR_QUARTER_EARNINGS' else 'TWSE_PREVIOUSLY_FILED_NEAR_FOUR_FULL_QUARTERS' end,
  'yield_basis',case when is_tpex then 'TPEX_OFFICIAL_REPORTED_YIELD_COMPONENTS_NOT_FORWARD_OR_CASH_ONLY' else 'TWSE_DECLARED_DISTRIBUTION_COMPONENTS_NOT_FORWARD_OR_CASH_ONLY' end,'no_eps_or_forward_yield_inference','TRUE');
 if is_tpex then values:=values||jsonb_build_object('dividend_per_share_as_reported',dividend,'unpublished_fields','CLOSE_PRICE_FINANCIAL_YEAR_QUARTER_DIVIDEND_YEAR_NOT_PUBLISHED_BY_THIS_API');end if;
 return jsonb_build_object('symbol',p_symbol,'kind',p_kind,'period',label->>'period','basis','AS_REPORTED','values',values,'source',source,'published_at',null,
  'first_seen_at',p_response->>'received_at','available_at',p_response->>'received_at','as_of',p_response->>'received_at','source_sha256',p_response->>'source_sha256',
  'source_bytes',p_response->'source_bytes','source_received_at',p_response->>'received_at','source_locator',jsonb_build_object('company_code',p_symbol,
   'quote_date_as_reported',p_row->'Date','financial_year_quarter_as_reported',coalesce(p_row->'FiscalYearQuarter','null'::jsonb),'dividend_year_as_reported',coalesce(p_row->'DividendYear','null'::jsonb),'row_sha256',p_row_hash),
  'data_quality_status','OFFICIAL_OPEN_API_OBSERVED_AFTER_RECEIPT_PUBLICATION_UNKNOWN_AS_REPORTED_VALUATION','actual_only',true,'historical_knowledge',false,'source_admitted',false,'member_publication_approved',false);
exception when others then return null;
end $function$
