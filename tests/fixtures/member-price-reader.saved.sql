-- Exact read-only production pg_get_functiondef captured 2026-11-10.
-- definition_md5: a7027fc316e31f154fbdfea46cab72cc
-- Public ACL at capture: authenticated execute only (plus function owner).
CREATE OR REPLACE FUNCTION public.get_daily_ai_member_price_plans_v1(p_edition_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare member jsonb;current_id text;tier text;plans jsonb:='[]';source_sets jsonb:='[]';card jsonb;batch_packets jsonb;
 p vnext_private.ai_price_plans_v1;r vnext_private.ai_price_plan_reviews_v1;
 a vnext_private.ai_price_plan_publication_events_v1;
begin
 -- This remains the single authority for the currently readable edition,
 -- latest rights/publication/review state and the real server entitlement.
 member:=public.get_daily_ai_member_research_v1();
 tier:=member->>'tier';current_id:=member->'edition'->>'id';
 if p_edition_id is null or p_edition_id !~ '^[a-f0-9]{64}$' then raise exception 'AI_PRICE_PLAN_SCOPE';end if;
 if current_id is distinct from p_edition_id then current_id:=null;
 elsif tier in('premium','owner') then
  for card in select * from jsonb_array_elements(member->'cards')c where c->>'status' in('WATCH','WAIT') loop
   -- The newest registered version suppresses old versions even while its
   -- review/Owner approval is pending. FAIL/REVOKE/expiry never revive prices.
   select q.* into p from vnext_private.ai_price_plans_v1 q
    where q.edition_id=current_id and q.symbol=card->>'symbol' and q.horizon=card->>'horizon'
    order by q.registration_id desc limit 1;
   if not found then continue;end if;
   select * into a from vnext_private.ai_price_plan_publication_events_v1
    where plan_hash=p.plan_hash order by id desc limit 1;
   if not found then continue;end if;
   select * into r from vnext_private.ai_price_plan_reviews_v1 where plan_hash=p.plan_hash order by review_sequence desc limit 1;
   if a.action='APPROVE' and a.review_id=r.id and r.quality='PASS' and r.time_status='PASS'
    and r.source_use='PASS' and r.methodology='PASS' and r.expires_at>now() and r.reviewed_at<=now()
    and r.recorded_at<=now() and p.expires_at>now() and p.created_at<=now() then
    plans:=plans||jsonb_build_array(p.body||jsonb_build_object('plan_hash',p.plan_hash,'review',jsonb_build_object(
     'status','PASS','plan_hash',p.plan_hash,'reviewed_at',to_char(r.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'document_hash',r.document_hash)));
   end if;
  end loop;
  -- Emit only metadata for the actual plan references, including legitimate
  -- original packet refs not used by the prose claim (e.g. twenty daily bars).
  -- Merge horizons by symbol/id; never return packet content, prompts or jobs.
  if jsonb_array_length(plans)>0 then
  select b.payload->'packets' into batch_packets from vnext_private.ai_research_editions e
   join vnext_runtime.ai_stock_batches b on b.id=e.batch_id where e.id=current_id;
  select coalesce(jsonb_agg(jsonb_build_object('symbol',sets.symbol,'sources',sets.sources) order by sets.symbol),'[]') into source_sets
   from(select refs.symbol,jsonb_agg(refs.source order by refs.source->>'id') sources from(
    select distinct pl->>'symbol' symbol,jsonb_build_object('id',ev->>'id','source',ev->>'source','kind',ev->>'kind',
     'published_at',ev->>'published_at','available_at',ev->>'available_at','time_basis',coalesce(ev->>'time_basis','PUBLISHED'),
     'first_seen_at',ev->>'first_seen_at','as_of',ev->>'as_of','evidence_hash',ev->>'evidence_hash') source
    from jsonb_array_elements(plans)pl join jsonb_array_elements(batch_packets)pkt on pkt->>'symbol'=pl->>'symbol',
     jsonb_array_elements(pkt->'evidence')ev where pl->'evidence_ids' ? (ev->>'id')
   )refs group by refs.symbol)sets;
  end if;
 end if;
 return jsonb_build_object('schema','VNEXT_AI_MEMBER_PRICE_PLANS_V1','edition_id',current_id,'tier',tier,
  'subject_user_id',auth.uid(),'research_only',true,'plans',plans,'source_sets',source_sets);
end $function$
;
