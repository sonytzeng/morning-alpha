CREATE OR REPLACE FUNCTION public.get_daily_ai_member_research_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare tier text;e vnext_private.ai_research_editions;cards jsonb:='[]';edition jsonb:=null;
begin
 tier:=academy_private.access_v11();
 if auth.uid() is null or tier is null or tier not in('free','premium','owner') then raise exception 'MEMBER_REQUIRED' using errcode='42501';end if;
 select x.* into e from vnext_private.ai_research_editions x
 join lateral(select * from vnext_private.ai_research_publication_events a where a.edition_id=x.id order by a.id desc limit 1)a on true
 join lateral(select * from vnext_private.ai_research_reviews r where r.edition_id=x.id order by r.recorded_at desc,r.id desc limit 1)r on true
 where a.action='APPROVE' and a.review_id=r.id and r.quality='PASS' and r.time_status='PASS' and r.licensing='PASS'
  and r.snapshot_hash=x.id and r.expires_at>now() and x.expires_at>now() and x.created_at<=now()
  and (tier<>'free' or a.audience='free') and vnext_private.ai_edition_rights_v1(x.id,now())
 order by x.created_at desc,x.id limit 1;
 if found then
  edition:=jsonb_build_object('id',e.id,'edition_date',e.business_date,'data_through',e.through,'evidence_cutoff',e.cutoff,
   'prepared_at',e.created_at,'expires_at',e.expires_at,'mode','AS_OF_RESEARCH','forecast',false,'performance_available',false,
   'analysis_origin',coalesce(e.payload->>'analysis_origin','MODEL_GENERATED'));
  select coalesce(jsonb_agg(case when tier='free' then c-'sources'-'counter_evidence' else c end order by c->>'symbol',c->>'horizon'),'[]') into cards
   from jsonb_array_elements(e.payload->'cards')c where tier<>'free' or c->>'symbol' in(
    select distinct q->>'symbol' from jsonb_array_elements(e.payload->'cards')q order by q->>'symbol' limit 3);
 end if;
 return jsonb_build_object('schema','VNEXT_AI_MEMBER_EDITION_V1','tier',tier,'business_date',(now() at time zone 'Asia/Taipei')::date,
  'research_only',true,'edition',edition,'cards',cards);
end $function$
