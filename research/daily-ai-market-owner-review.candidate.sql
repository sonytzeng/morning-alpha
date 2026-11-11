-- Local candidate only. Requires market-v2 (and references for its detail UI).
-- Human review submission and publication are separate transactions. This file
-- never creates source_licenses, defaults a verdict, or publishes an edition.
begin;
do $$begin
 if to_regprocedure('public.get_daily_ai_owner_market_page_v2(text,integer,integer)') is null
  or to_regclass('vnext_market.owner_review_requests') is not null then raise exception 'MARKET_OWNER_REVIEW_PREREQUISITES';end if;
end $$;

create table vnext_market.owner_review_requests(
 request_key uuid primary key,actor uuid not null references auth.users(id),
 edition_id text not null references vnext_market.editions(id),
 submission_hash text not null check(submission_hash~'^[a-f0-9]{64}$'),submission jsonb not null,
 review_id uuid not null references vnext_market.reviews(id),result jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),
 check(submission_hash=vnext_market.hash(submission))
);
alter table vnext_market.owner_review_requests enable row level security;
alter table vnext_market.owner_review_requests force row level security;
revoke all on vnext_market.owner_review_requests from public,anon,authenticated,service_role;
create trigger immutable before update or delete on vnext_market.owner_review_requests
 for each row execute function vnext_market.immutable();

create function public.get_daily_ai_owner_market_catalog_v2(p_before jsonb default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;last_row jsonb;more boolean;before_at timestamptz;before_id text;begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' or not coalesce(public.is_research_owner_v1(),false)
  then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 20 then raise exception 'MARKET_OWNER_CATALOG_SCOPE';end if;
 if p_before is not null and p_before<>'null'::jsonb then
  if not coalesce(vnext_market.exact(p_before,array['prepared_at','id']),false)
   or jsonb_typeof(p_before->'prepared_at') is distinct from 'string'
   or coalesce(p_before->>'id','')!~'^[a-f0-9]{64}$' then raise exception 'MARKET_OWNER_CATALOG_SCOPE';end if;
  before_at:=(p_before->>'prepared_at')::timestamptz;before_id:=p_before->>'id';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'plan_hash',x.plan_id,'edition_date',x.business_date,
  'evidence_cutoff',vnext_market.iso(x.cutoff),'prepared_at',vnext_market.iso(x.prepared_at),'expires_at',vnext_market.iso(x.expires_at),
  'analysis_origin',x.analysis_origin,'method_version',x.method_version,'mode','AS_OF_RESEARCH','forecast',false,'performance_available',false)
  order by x.prepared_at desc,x.id desc),'[]') into rows
 from(select * from vnext_market.editions e where before_at is null or(e.prepared_at,e.id)<(before_at,before_id)
  order by e.prepared_at desc,e.id desc limit p_limit)x;
 last_row:=rows->(jsonb_array_length(rows)-1);
 select last_row is not null and exists(select from vnext_market.editions e
  where(e.prepared_at,e.id)<((last_row->>'prepared_at')::timestamptz,last_row->>'id')) into more;
 return jsonb_build_object('schema','VNEXT_AI_OWNER_MARKET_CATALOG_V2','subject_user_id',auth.uid(),
  'preview_only',true,'research_only',true,'checked_at',vnext_market.iso(now()),'editions',rows,
  'next_cursor',case when more then jsonb_build_object('prepared_at',last_row->>'prepared_at','id',last_row->>'id')else null end);
end $$;

-- Preserve the existing bounded page and its independent Owner gates. Add
-- actual coverage and retained review documents; never load all packet bodies.
alter function public.get_daily_ai_owner_market_page_v2(text,integer,integer) set schema vnext_market;
alter function vnext_market.get_daily_ai_owner_market_page_v2(text,integer,integer) rename to owner_page_before_manual_review_v2;
revoke all on function vnext_market.owner_page_before_manual_review_v2(text,integer,integer) from public,anon,authenticated,service_role;
create function public.get_daily_ai_owner_market_page_v2(p_edition_id text,p_offset integer default 0,p_limit integer default 60)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;e vnext_market.editions;r vnext_market.reviews;coverage jsonb;source_use jsonb;begin
 answer:=vnext_market.owner_page_before_manual_review_v2(p_edition_id,p_offset,p_limit);
 select * into strict e from vnext_market.editions where id=p_edition_id;
 select * into r from vnext_market.reviews where edition_id=e.id order by sequence desc limit 1;
 select jsonb_agg(jsonb_build_object('market',m.market,'universe_count',u.total,'analysed_count',c.stocks,'card_count',c.cards,
  'roster_as_of',u.roster_as_of,'price_date',c.price_date,
  'financial_available_at',case when c.financial_at is null then null else vnext_market.iso(c.financial_at)end,
  'news_available_at',case when c.news_at is null then null else vnext_market.iso(c.news_at)end) order by m.rank) into coverage
 from(values('TWSE',0),('TPEX',1),('EMERGING',2))m(market,rank)
 cross join lateral(select count(*) total,max(roster_as_of) roster_as_of from vnext_market.companies
  where universe_id=e.universe_id and market=m.market)u
 cross join lateral(select count(distinct security_id) stocks,count(*) cards,max(price_date) price_date,
  max(financial_available_at) financial_at,max(news_available_at) news_at from vnext_market.cards
  where plan_id=e.plan_id and market=m.market)c;
 with checked as(select s.source_url,exists(select from vnext_private.source_licenses l where l.source=s.source_url
  and l.storage_allowed and l.derived_allowed and l.commercial_allowed and l.reviewed_at<=now()
  and(l.expires_at is null or l.expires_at>now())and l.document_url like 'https://%'and length(btrim(l.attribution))>0)ready
  from vnext_market.edition_sources s where s.edition_id=e.id)
 select jsonb_build_object('total',count(*),'approved',count(*)filter(where ready),
  'blocked_sources',(select coalesce(jsonb_agg(source_url order by source_url),'[]')from(select source_url from checked where not ready order by source_url limit 20)b)) into source_use from checked;
 if r.id is not null then answer:=jsonb_set(answer,'{review}',(answer->'review')||jsonb_build_object('review_text',r.review_text));end if;
 return answer||jsonb_build_object('checked_at',vnext_market.iso(now()),'coverage',coverage,'source_use',source_use,
  'review_documents',case when r.id is null then '[]'::jsonb else r.documents end);
end $$;

create function public.submit_daily_ai_owner_market_review_v2(p_edition_id text,p_request_key uuid,p_submission jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();e vnext_market.editions;prior vnext_market.owner_review_requests;
 d jsonb;document_text text;documents jsonb:='[]';hashes jsonb:='{}';statuses jsonb:='{}';seen text[]:='{}';
 review jsonb;review_text text;result jsonb;submission_hash text;begin
 if actor is null or academy_private.access_v11() is distinct from 'owner' or not coalesce(public.is_research_owner_v1(),false)
  then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if p_request_key is null or coalesce(p_edition_id,'')!~'^[a-f0-9]{64}$'
  or not coalesce(vnext_market.exact(p_submission,array['schema','edition_id','reason','documents']),false)
  or p_submission->>'schema' is distinct from 'DAILY_AI_MARKET_OWNER_REVIEW_REQUEST_V1'
  or p_submission->>'edition_id' is distinct from p_edition_id
  or jsonb_typeof(p_submission->'reason') is distinct from 'string' or length(btrim(p_submission->>'reason')) not between 10 and 3000
  or jsonb_typeof(p_submission->'documents') is distinct from 'array' or jsonb_array_length(p_submission->'documents')<>4
  or octet_length(p_submission::text)>50000 then raise exception 'MARKET_OWNER_REVIEW_CONTRACT';end if;
 submission_hash:=vnext_market.hash(p_submission);
 perform pg_advisory_xact_lock(hashtextextended('market-owner-request:'||p_request_key::text,0));
 select * into prior from vnext_market.owner_review_requests where request_key=p_request_key;
 if found then
  if prior.actor is distinct from actor or prior.edition_id is distinct from p_edition_id
   or prior.submission_hash is distinct from submission_hash or prior.submission is distinct from p_submission
   then raise exception 'MARKET_OWNER_REVIEW_REPLAY_CONFLICT';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if exists(select from vnext_market.publication_events where request_key=p_request_key) then raise exception 'MARKET_OWNER_REQUEST_CONFLICT';end if;
 select * into strict e from vnext_market.editions where id=p_edition_id;
 if e.expires_at<=clock_timestamp() then raise exception 'MARKET_REVIEW_EXPIRED';end if;
 for d in select * from jsonb_array_elements(p_submission->'documents')loop
  if not coalesce(vnext_market.exact(d,array['kind','status','document_url','notes']),false)
   or coalesce(d->>'kind','')not in('QUALITY','TIME','SOURCE_USE','METHODOLOGY')or d->>'kind'=any(seen)
   or coalesce(d->>'status','')not in('PASS','FAIL','PENDING')
   or jsonb_typeof(d->'document_url')is distinct from 'string'
   or length(d->>'document_url')not between 10 and 2000 or (d->>'document_url')!~'^https://[^[:space:]@#]+$'
   or (d->>'document_url')~*'[?&](token|secret|key|auth|email)[^=]*='
   or jsonb_typeof(d->'notes')is distinct from 'string' or length(btrim(d->>'notes'))not between 10 and 8000
   then raise exception 'MARKET_OWNER_REVIEW_DOCUMENT';end if;
  seen:=array_append(seen,d->>'kind');
  document_text:=vnext_market.canonical(jsonb_build_object('schema','DAILY_AI_MARKET_OWNER_REVIEW_DOCUMENT_V1',
   'edition_id',e.id,'request_key',p_request_key,'reviewer_user_id',actor,'kind',d->>'kind','status',d->>'status',
   'document_url',d->>'document_url','notes',d->>'notes','submitted_at',vnext_market.iso(clock_timestamp())));
  hashes:=hashes||jsonb_build_object(d->>'kind',vnext_market.digest(document_text));
  statuses:=statuses||jsonb_build_object(d->>'kind',d->>'status');
  documents:=documents||jsonb_build_array(jsonb_build_object('kind',d->>'kind','text',document_text,'hash',vnext_market.digest(document_text)));
 end loop;
 review:=jsonb_build_object('schema','DAILY_AI_MARKET_REVIEW_V2','edition_id',e.id,'snapshot_hash',e.id,
  'reviewer_ref','OWNER:'||actor::text,'quality',statuses->>'QUALITY','time_status',statuses->>'TIME','licensing',statuses->>'SOURCE_USE',
  'methodology',statuses->>'METHODOLOGY','document_hashes',hashes,'reason',p_submission->>'reason','expires_at',vnext_market.iso(e.expires_at));
 review_text:=vnext_market.canonical(review);
 result:=public.stage_daily_ai_market_review_v2(review_text,vnext_market.digest(review_text),documents);
 result:=result||jsonb_build_object('schema','DAILY_AI_OWNER_MARKET_REVIEW_RECEIPT_V2','subject_user_id',actor,'request_key',p_request_key,
  'submission_hash',submission_hash,'review_hash',vnext_market.digest(review_text));
 insert into vnext_market.owner_review_requests(request_key,actor,edition_id,submission_hash,submission,review_id,result)
 values(p_request_key,actor,e.id,submission_hash,p_submission,(result->>'review_id')::uuid,result);
 return result;
end $$;

-- Read-only reconciliation. NOT_RECORDED is deliberately not a failure verdict:
-- a still-running transaction may commit later. It never issues a mutation.
create function public.get_daily_ai_owner_market_command_v2(p_request_key uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();r vnext_market.owner_review_requests;a vnext_market.publication_events;begin
 if actor is null or academy_private.access_v11() is distinct from 'owner' or not coalesce(public.is_research_owner_v1(),false)
  then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if p_request_key is null then raise exception 'MARKET_OWNER_REQUEST_SCOPE';end if;
 select rr.* into r from vnext_market.owner_review_requests rr where rr.request_key=p_request_key and rr.actor=auth.uid();
 if found then return jsonb_build_object('schema','DAILY_AI_OWNER_MARKET_COMMAND_V2','subject_user_id',actor,'request_key',p_request_key,
  'state','RECORDED','kind','REVIEW','edition_id',r.edition_id,'request_hash',r.submission_hash,'recorded_at',vnext_market.iso(r.recorded_at),'result',r.result);end if;
 select pa.* into a from vnext_market.publication_events pa where pa.request_key=p_request_key and pa.actor=auth.uid();
 if found then return jsonb_build_object('schema','DAILY_AI_OWNER_MARKET_COMMAND_V2','subject_user_id',actor,'request_key',p_request_key,
  'state','RECORDED','kind',a.action,'edition_id',a.edition_id,
  'request_hash',vnext_market.hash(jsonb_build_object('edition_id',a.edition_id,'review_id',a.review_id,'action',a.action,'audience',a.audience)),
  'recorded_at',vnext_market.iso(a.occurred_at),
  'result',jsonb_build_object('schema','DAILY_AI_MARKET_PUBLICATION_V2','edition_id',a.edition_id,'event_id',a.id,'action',a.action,'replayed',true));end if;
 return jsonb_build_object('schema','DAILY_AI_OWNER_MARKET_COMMAND_V2','subject_user_id',actor,'request_key',p_request_key,
  'state','NOT_RECORDED','kind',null,'edition_id',null,'request_hash',null,'recorded_at',null,'result',null);
end $$;

revoke all on function public.get_daily_ai_owner_market_catalog_v2(jsonb,integer),public.get_daily_ai_owner_market_page_v2(text,integer,integer),
 public.submit_daily_ai_owner_market_review_v2(text,uuid,jsonb),public.get_daily_ai_owner_market_command_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_owner_market_catalog_v2(jsonb,integer),public.get_daily_ai_owner_market_page_v2(text,integer,integer),
 public.submit_daily_ai_owner_market_review_v2(text,uuid,jsonb),public.get_daily_ai_owner_market_command_v2(uuid) to authenticated;
commit;
