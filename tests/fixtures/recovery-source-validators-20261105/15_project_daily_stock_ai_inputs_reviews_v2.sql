CREATE OR REPLACE FUNCTION vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(p_inputs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r vnext_private.verified_documented_reviews_v2;reviews jsonb;registered jsonb;projected jsonb;phase jsonb;result jsonb;
begin
 projected:=vnext_runtime.project_daily_stock_ai_inputs_v1(p_inputs);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into reviews from jsonb_array_elements(p_inputs)i,
  lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_documented_review_v2(f);
 if reviews='[]'::jsonb then return projected;end if;
 select * into strict r from vnext_private.verified_documented_reviews_v2;
 select jsonb_agg(f order by (f->>'id') collate "C") into registered from jsonb_array_elements(r.facts_text::jsonb)f;
 if reviews is distinct from registered then raise exception 'DOCUMENTED_REVIEW_V2_PROJECT_SCOPE';end if;
 phase:=vnext_runtime.documented_review_phase_v2(p_inputs,(p_inputs->0->>'cutoff')::timestamptz,r.review_valid_until,r.review_price_basis_text::jsonb);
 select jsonb_agg(i.value||jsonb_build_object('facts',case when i.value->>'symbol'<>'2330' then i.value->'facts' else (
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]'::jsonb) from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where case when phase->>'state'<>'ACTIVE' then not vnext_runtime.is_documented_review_v2(f.value)
   when f.value->>'kind' not in('EPS_AS_REPORTED','FINANCIAL_AS_REPORTED','VALUATION_AS_REPORTED') then true
   else f.value=(select x from jsonb_array_elements(i.value->'facts')x where x->>'kind'=f.value->>'kind'
    order by coalesce(x->>'period','') desc,(x->>'available_at')::timestamptz desc,(x->>'id') collate "C" desc limit 1) end)end) order by i.ordinality)
 into result from jsonb_array_elements(projected) with ordinality i(value,ordinality);
 return result;
end $function$
