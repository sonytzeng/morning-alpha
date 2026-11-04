CREATE OR REPLACE FUNCTION vnext_runtime.project_daily_stock_ai_inputs_v1(p_inputs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare projected jsonb;
begin
 if jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72 then raise exception 'AI_HANDOFF_PROJECTION_SCOPE';end if;
 select jsonb_agg(i.value||jsonb_build_object('expected_sessions',sessions.dates,'bars',bars.rows,'facts',facts.rows) order by i.ordinality)
 into projected from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality)
 cross join lateral(select coalesce(jsonb_agg(s.value order by s.ordinality),'[]'::jsonb) dates
  from jsonb_array_elements(i.value->'expected_sessions') with ordinality s(value,ordinality)
  where s.ordinality>greatest(jsonb_array_length(i.value->'expected_sessions')-25,0)) sessions
 cross join lateral(select coalesce(jsonb_agg(b.value order by b.ordinality),'[]'::jsonb) rows
  from jsonb_array_elements(i.value->'bars') with ordinality b(value,ordinality)
  where sessions.dates @> jsonb_build_array(b.value->>'date')) bars
 cross join lateral(select coalesce(jsonb_agg(f.value order by f.kind_rank,f.kind,f.period,f.id),'[]'::jsonb) rows from(
  select value,value->>'kind' kind,coalesce(value->>'period','') period,value->>'id' id,
   case value->>'kind' when 'REVENUE' then 0 when 'INSTITUTIONAL' then 1 when 'EPS_AS_REPORTED' then 2
    when 'FINANCIAL_AS_REPORTED' then 3 when 'VALUATION_AS_REPORTED' then 4 when 'EPS' then 5 when 'MARGIN' then 6
    when 'CAPEX' then 7 when 'DEMAND' then 8 when 'MOAT' then 9 when 'VALUATION' then 10 else 11 end kind_rank,
   row_number() over(partition by value->>'kind' order by coalesce(value->>'period','') desc,value->>'id' desc) rn
  from jsonb_array_elements(i.value->'facts')) f
  where f.rn<=case f.kind when 'REVENUE' then 36 when 'INSTITUTIONAL' then 10 when 'EPS' then 4 when 'MARGIN' then 4
   when 'CAPEX' then 4 when 'DEMAND' then 1 when 'MOAT' then 1 when 'VALUATION' then 1 else 2 end) facts;
 if octet_length(projected::text)>8000000 then raise exception 'AI_HANDOFF_PROJECTION_SIZE';end if;
 return projected;
end $function$
