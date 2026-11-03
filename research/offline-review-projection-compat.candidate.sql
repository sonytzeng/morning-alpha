-- Candidate projection metadata only. All access/review/source/expiry logic is copied unchanged.
begin;
create or replace function public.get_daily_ai_owner_research_v1(p_edition_id text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e vnext_private.ai_research_editions;r vnext_private.ai_research_reviews;a vnext_private.ai_research_publication_events;
 rights_ready boolean:=false;integrity_ready boolean:=false;review_ready boolean:=false;fresh boolean:=false;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' or not public.is_research_owner_v1() then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if p_edition_id is not null and p_edition_id !~ '^[a-f0-9]{64}$' then raise exception 'AI_EDITION_SCOPE';end if;
 select * into e from vnext_private.ai_research_editions where p_edition_id is null or id=p_edition_id order by created_at desc,id limit 1;
 if not found then return jsonb_build_object('schema','VNEXT_AI_OWNER_EDITION_V1','edition',null,'cards','[]'::jsonb,'source_urls','[]'::jsonb,
  'review',null,'publication',null,'rights_ready',false,'integrity_ready',false,'review_ready',false,'publish_ready',false,'preview_only',true);end if;
 select * into r from vnext_private.ai_research_reviews where edition_id=e.id order by recorded_at desc,id desc limit 1;
 select * into a from vnext_private.ai_research_publication_events where edition_id=e.id order by id desc limit 1;
 rights_ready:=vnext_private.ai_edition_rights_v1(e.id,now());integrity_ready:=vnext_private.ai_edition_integrity_v1(e.id);
 fresh:=e.expires_at>now() and e.created_at<=now();
 review_ready:=coalesce(r.snapshot_hash=e.id and r.quality='PASS' and r.time_status='PASS' and r.licensing='PASS' and r.expires_at>now(),false);
 return jsonb_build_object('schema','VNEXT_AI_OWNER_EDITION_V1','preview_only',true,
  'edition',jsonb_build_object('id',e.id,'batch_id',e.batch_id,'edition_date',e.business_date,'data_through',e.through,
   'evidence_cutoff',e.cutoff,'prepared_at',e.created_at,'expires_at',e.expires_at,'mode','AS_OF_RESEARCH',
   'forecast',false,'performance_available',false,'analysis_origin',coalesce(e.payload->>'analysis_origin','MODEL_GENERATED'),'jobs',cardinality(e.job_keys),'periods',jsonb_array_length(e.payload->'cards')),
  'cards',e.payload->'cards','source_urls',e.payload->'source_urls','rights_ready',rights_ready,'integrity_ready',integrity_ready,'review_ready',review_ready,
  'publish_ready',rights_ready and integrity_ready and review_ready and fresh,
  'review',case when r.id is null then null else jsonb_build_object('id',r.id,'snapshot_hash',r.snapshot_hash,'reviewer_ref',r.reviewer_ref,
   'quality',r.quality,'time_status',r.time_status,'licensing',r.licensing,'reason',r.reason,'recorded_at',r.recorded_at,'expires_at',r.expires_at,
   'quality_document_hash',r.quality_document_hash,'time_document_hash',r.time_document_hash,'license_document_hash',r.license_document_hash)end,
  'publication',case when a.id is null then null else jsonb_build_object('id',a.id,'review_id',a.review_id,'actor',a.actor,
   'action',a.action,'audience',a.audience,'occurred_at',a.occurred_at)end);
end $$;
revoke all on function public.get_daily_ai_owner_research_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_owner_research_v1(text) to authenticated;

create or replace function public.get_daily_ai_member_research_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
end $$;
revoke all on function public.get_daily_ai_member_research_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_member_research_v1() to authenticated;
commit;
