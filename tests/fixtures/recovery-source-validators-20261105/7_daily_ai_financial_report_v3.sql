CREATE OR REPLACE FUNCTION vnext_runtime.daily_ai_financial_report_v3(p_row jsonb, p_received timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare roc text:=vnext_runtime.daily_ai_financial_field_v3(p_row,array['年度','Year'])#>>'{}';q text:=p_row->>'季別';
 exported text:=vnext_runtime.daily_ai_financial_field_v3(p_row,array['出表日期','Date'])#>>'{}';year integer;report_end date;export_date date;
begin
 if coalesce(roc,'') !~ '^\d{1,3}$' or roc::integer not between 80 and 300 or coalesce(q,'') !~ '^[1-4]$'
  or coalesce(exported,'') !~ '^\d{7}$' then return null;end if;
 year:=roc::integer+1911;report_end:=(make_date(year,q::integer*3,1)+interval '1 month'-interval '1 day')::date;
 export_date:=make_date(substring(exported from 1 for 3)::integer+1911,substring(exported from 4 for 2)::integer,substring(exported from 6 for 2)::integer);
 if report_end>(p_received at time zone 'Asia/Taipei')::date or export_date>(p_received at time zone 'Asia/Taipei')::date then return null;end if;
 return jsonb_build_object('roc',roc,'quarter',q,'exported',exported,'period',year::text||'-Q'||q,'rank',year*10+q::integer,
  'scope','YEAR_'||roc||'_QUARTER_'||q||'_AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_EXPLICIT');
exception when others then return null;
end $function$
