CREATE FUNCTION public.get_daily_ai_member_research_delta_v1(p_known_edition_id text, p_known_tier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare current_payload jsonb; current_edition jsonb; current_tier text; caller_id uuid; envelope jsonb;
begin
 -- Always execute the original reader first. Known values never grant access
 -- or bypass current membership, source-use, review, publication or expiry gates.
 current_payload:=public.get_daily_ai_member_research_v1();
 caller_id:=auth.uid();current_edition:=current_payload->'edition';current_tier:=current_payload->>'tier';
 if caller_id is null or current_payload->>'schema' is distinct from 'VNEXT_AI_MEMBER_EDITION_V1'
  or current_payload->'research_only' is distinct from 'true'::jsonb
  or current_tier is null or current_tier not in('free','premium','owner')
  then raise exception 'AI_MEMBER_DELTA_READER_CONTRACT' using errcode='42501';end if;
 envelope:=jsonb_build_object('schema','VNEXT_AI_MEMBER_DELTA_V1','user_id',caller_id,'tier',current_tier,
  'business_date',current_payload->'business_date','research_only',true,'edition',current_edition);
 if jsonb_typeof(current_edition)='object' and p_known_edition_id ~ '^[a-f0-9]{64}$'
  and current_edition->>'id'=p_known_edition_id and current_tier=p_known_tier then
  return envelope||jsonb_build_object('mode','UNCHANGED');
 end if;
 return envelope||jsonb_build_object('mode','FULL','payload',current_payload);
end
$function$;
