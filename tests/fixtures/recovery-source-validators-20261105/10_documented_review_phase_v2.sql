CREATE OR REPLACE FUNCTION vnext_runtime.documented_review_phase_v2(p_inputs jsonb, p_cutoff timestamp with time zone, p_until text, p_basis jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare s jsonb;bar_count integer;closing numeric;observed jsonb;state text;
begin
 select x into s from jsonb_array_elements(p_inputs)x where x->>'symbol'='2330';
 select count(*),min(case when jsonb_typeof(b->'close')='number' then (b->>'close')::numeric else null end) into bar_count,closing
  from jsonb_array_elements(coalesce(s->'bars','[]'))b where b->>'date'=s->>'through';
 if bar_count<>1 or closing is null or closing<=0 then closing:=null;end if;
 observed:=jsonb_build_object('session_date',s->'through','close_twd',closing);
 if p_cutoff>=(p_until::timestamptz) then state:='EXPIRED_NOT_APPLIED';
 elsif s is null or coalesce(s->>'through','') !~ '^\d{4}-\d\d-\d\d$' or closing is null then state:='PRICE_DATE_UNVERIFIED_NOT_APPLIED';
 elsif s->>'through' is distinct from p_basis->>'session_date' then state:='PRICE_DATE_CHANGED_NOT_APPLIED';
 elsif closing is distinct from (p_basis->>'close_twd')::numeric then state:='PRICE_CHANGED_NOT_APPLIED';
 elsif (select count(*) from jsonb_array_elements(s->'facts')f where f->>'id' like 'sec-quarter:2330:%')<>12 then state:='FINANCIAL_BASE_INCOMPLETE_NOT_APPLIED';
 else state:='ACTIVE';end if;
 return jsonb_build_object('state',state,'observed_price',observed);
end $function$
