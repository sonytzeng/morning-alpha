-- AS_OF member research. No prediction, trade, performance or forward approval.
-- Requires ai_stock_batches, ai_stock_jobs, existing entitlements/source licenses.
begin;
create table vnext_private.ai_research_editions(
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 batch_id text not null references vnext_runtime.ai_stock_batches(id),
 business_date date not null,cutoff timestamptz not null,through date not null,
 job_keys text[] not null check(cardinality(job_keys)=72),
 job_set_hash text not null check(job_set_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb not null,created_at timestamptz not null default transaction_timestamp(),
 expires_at timestamptz not null,
 check(business_date=(cutoff at time zone 'Asia/Taipei')::date),
 check(through<=business_date and cutoff<=created_at and expires_at>created_at
  and expires_at<=created_at+interval '72 hours')
);
create table vnext_private.ai_research_reviews(
 id uuid primary key default gen_random_uuid(),edition_id text not null references vnext_private.ai_research_editions(id),
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 reviewer_ref text not null check(length(btrim(reviewer_ref)) between 1 and 200),
 quality text not null check(quality in('PASS','FAIL','PENDING')),
 time_status text not null check(time_status in('PASS','FAIL','PENDING')),
 licensing text not null check(licensing in('PASS','FAIL','PENDING')),
 quality_document_hash text not null check(quality_document_hash ~ '^[a-f0-9]{64}$'),
 time_document_hash text not null check(time_document_hash ~ '^[a-f0-9]{64}$'),
 license_document_hash text not null check(license_document_hash ~ '^[a-f0-9]{64}$'),
 reason text not null check(length(btrim(reason)) between 1 and 3000),
 recorded_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 check(expires_at>recorded_at)
);
create table vnext_private.ai_research_publication_events(
 id bigint generated always as identity primary key,request_key uuid not null unique,
 edition_id text not null references vnext_private.ai_research_editions(id),
 review_id uuid not null references vnext_private.ai_research_reviews(id),actor uuid not null references auth.users(id),
 action text not null check(action in('APPROVE','REVOKE')),audience text not null check(audience in('free','premium')),
 occurred_at timestamptz not null default clock_timestamp()
);
create index ai_research_edition_latest on vnext_private.ai_research_editions(created_at desc,id);
create index ai_research_review_latest on vnext_private.ai_research_reviews(edition_id,recorded_at desc,id);
create index ai_research_publication_latest on vnext_private.ai_research_publication_events(edition_id,id desc);
create index if not exists ai_member_source_rights_v1 on vnext_private.source_licenses(source)
 where storage_allowed and derived_allowed and commercial_allowed;
do $$declare n text;begin
 foreach n in array array['ai_research_editions','ai_research_reviews','ai_research_publication_events'] loop
  execute format('alter table vnext_private.%I enable row level security',n);
  execute format('alter table vnext_private.%I force row level security',n);
  execute format('revoke all on vnext_private.%I from public,anon,authenticated,service_role',n);
  execute format('create trigger immutable before update or delete on vnext_private.%I for each row execute function vnext_private.immutable_record()',n);
 end loop;
end $$;
-- Independent reviewer importer only. Selectors and browsers cannot self-approve.
grant usage on schema vnext_private to service_role;
grant select,insert on vnext_private.ai_research_reviews to service_role;

-- A member projection trusts the snapshot already verified during staging,
-- review and approval. Seal completed results so member reads need no repeated
-- multi-megabyte input/job hashing. Incomplete jobs retain their retry flow.
create function vnext_runtime.seal_completed_ai_stock_job_v1() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.state='COMPLETE' then raise exception 'AI_JOB_COMPLETED_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function vnext_runtime.seal_completed_ai_stock_job_v1() from public,anon,authenticated,service_role;
create trigger ai_stock_jobs_completed_seal before update or delete on vnext_runtime.ai_stock_jobs
 for each row execute function vnext_runtime.seal_completed_ai_stock_job_v1();

-- Original text commits to each packet text/hash. The stored read bundle adds
-- packets reconstructed in the same symbol order; it cannot add new evidence.
create function vnext_private.ai_batch_commitment_v1(p_id text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select from vnext_runtime.ai_stock_batches b where b.id=p_id
  and encode(sha256(convert_to(b.payload_text,'UTF8')),'hex')=b.id
  and b.payload=(b.payload_text::jsonb)||jsonb_build_object('packets',(
   select jsonb_agg(pt.value::jsonb order by pt.key) from jsonb_each_text(b.payload_text::jsonb->'packet_texts')pt)));
$$;
revoke all on function vnext_private.ai_batch_commitment_v1(text) from public,anon,authenticated,service_role;

create function vnext_private.ai_edition_integrity_v1(p_id text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select from vnext_private.ai_research_editions e join vnext_runtime.ai_stock_batches b on b.id=e.batch_id
 where e.id=p_id and encode(sha256(convert_to(e.payload::text,'UTF8')),'hex')=e.id and vnext_private.ai_batch_commitment_v1(b.id)
  and e.job_set_hash=(select encode(sha256(convert_to(string_agg(j.id||':'||j.input_hash||':'||
   encode(sha256(convert_to(j.result::text,'UTF8')),'hex'),',' order by j.id),'UTF8')),'hex')
   from vnext_runtime.ai_stock_jobs j where j.id=any(e.job_keys) and j.state='COMPLETE')
  and (select count(*) from vnext_runtime.ai_stock_jobs j where j.id=any(e.job_keys) and j.state='COMPLETE')=72);
$$;
revoke all on function vnext_private.ai_edition_integrity_v1(text) from public,anon,authenticated,service_role;

-- Use-specific rights: reviewed summaries/own analysis require storage, derived
-- and commercial permission. This projection never redistributes raw articles,
-- provider bodies, prompts or original financial datasets.
create function vnext_private.ai_edition_rights_v1(p_id text,p_now timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select from vnext_private.ai_research_editions e where e.id=p_id
 and not exists(select from jsonb_array_elements_text(e.payload->'source_urls')requested(source) where not exists(
   select from vnext_private.source_licenses l where l.source=requested.source
    and l.storage_allowed and l.derived_allowed and l.commercial_allowed
    and l.reviewed_at<=p_now and (l.expires_at is null or l.expires_at>p_now)
    and l.document_url like 'https://%' and length(btrim(l.attribution))>0)));
$$;
revoke all on function vnext_private.ai_edition_rights_v1(text,timestamptz) from public,anon,authenticated,service_role;

create function vnext_private.validate_ai_research_review_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare e vnext_private.ai_research_editions;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai-member-research',0));
 select * into strict e from vnext_private.ai_research_editions where id=new.edition_id;
 if new.snapshot_hash<>e.id or new.expires_at>e.expires_at
  or exists(select from vnext_runtime.ai_stock_jobs j where j.id=any(e.job_keys)
   and new.reviewer_ref in(j.model_revision,j.result->'receipt'->>'model'))
  or not vnext_private.ai_edition_integrity_v1(e.id) then raise exception 'AI_RESEARCH_REVIEW_INVALID';end if;
 new.recorded_at:=clock_timestamp();
 if new.expires_at<=new.recorded_at then raise exception 'AI_RESEARCH_REVIEW_EXPIRED';end if;
 return new;
end $$;
revoke all on function vnext_private.validate_ai_research_review_v1() from public,anon,authenticated,service_role;
create trigger validate_review before insert on vnext_private.ai_research_reviews
 for each row execute function vnext_private.validate_ai_research_review_v1();

create function public.stage_daily_ai_research_edition_v1(p_batch_id text,p_job_keys text[],p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b vnext_runtime.ai_stock_batches;j vnext_runtime.ai_stock_jobs;packet jsonb;h jsonb;s jsonb;c jsonb;
 keys text[];symbols text[]:='{}';cards jsonb:='[]';refs jsonb;counters jsonb;gaps jsonb;source_urls jsonb;payload jsonb;job_hash text;eid text;at_time timestamptz:=transaction_timestamp();
begin
 if p_batch_id is null or p_batch_id !~ '^[a-f0-9]{64}$' or p_job_keys is null or cardinality(p_job_keys)<>72
  or p_expires_at is null or p_expires_at<=at_time or p_expires_at>at_time+interval '72 hours'
  then raise exception 'AI_EDITION_SCOPE';end if;
 select array_agg(k order by k) into keys from(select distinct unnest(p_job_keys)k)x;
 if cardinality(keys)<>72 then raise exception 'AI_EDITION_DUPLICATE_JOB';end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=p_batch_id;
 if b.cutoff>at_time or b.payload->>'schema' is distinct from 'DAILY_AI_BATCH_INPUT_V1'
  or not vnext_private.ai_batch_commitment_v1(b.id)
  or jsonb_array_length(b.payload->'packets')<>72 then raise exception 'AI_EDITION_BATCH';end if;
 if (select count(*) from vnext_runtime.ai_stock_jobs where id=any(keys) and state='COMPLETE')<>72 then raise exception 'AI_EDITION_INCOMPLETE';end if;
 for j in select * from vnext_runtime.ai_stock_jobs where id=any(keys) order by symbol loop
  select p into strict packet from jsonb_array_elements(b.payload->'packets')p where p->>'symbol'=j.symbol;
  if j.symbol=any(symbols) or j.cutoff<>b.cutoff
   or j.input_hash is distinct from b.payload->'packet_hashes'->>j.symbol
   or encode(sha256(convert_to(b.payload->'packet_texts'->>j.symbol,'UTF8')),'hex') is distinct from j.input_hash
   or (b.payload->'packet_texts'->>j.symbol)::jsonb is distinct from packet
   or j.result->>'input_hash' is distinct from j.input_hash or j.result->>'symbol' is distinct from j.symbol
   or j.result->>'schema' is distinct from 'DAILY_AI_STOCK_ANALYSIS_V1'
   or (j.result->>'cutoff')::timestamptz is distinct from b.cutoff
   or j.result->'model_generated' is distinct from 'true'::jsonb
   or j.result->'member_published' is distinct from 'false'::jsonb
   or coalesce(j.result->'receipt'->>'response_id','')=''
   or coalesce(j.result->'receipt'->>'model','')=''
   or jsonb_array_length(j.result->'horizons')<>3
   or (select count(distinct x->>'horizon') from jsonb_array_elements(j.result->'horizons')x where x->>'horizon' in('SHORT','MEDIUM','LONG'))<>3
   then raise exception 'AI_EDITION_PROVENANCE';end if;
  symbols:=array_append(symbols,j.symbol);
  if packet->'data_gaps' is not null and (jsonb_typeof(packet->'data_gaps') is distinct from 'array'
   or jsonb_array_length(packet->'data_gaps')>100 or exists(select from jsonb_array_elements(packet->'data_gaps')g
    where jsonb_typeof(g)<>'string' or length(btrim(g#>>'{}')) not between 1 and 1500)) then raise exception 'AI_EDITION_GAPS';end if;
  if jsonb_array_length(j.result->'sources') is distinct from jsonb_array_length(packet->'evidence')
   or (select count(distinct sr->>'id') from jsonb_array_elements(j.result->'sources')sr)<>jsonb_array_length(packet->'evidence')
   then raise exception 'AI_EDITION_SOURCE_SET';end if;
  for s in select * from jsonb_array_elements(j.result->'sources') loop
   if not exists(select from jsonb_array_elements(packet->'evidence')e where s=e-'content'
    and length(e->>'id') between 1 and 200 and length(e->>'source') between 1 and 3000
    and e->>'kind' in('NEWS','MARKET','FINANCIAL','PRICE')
    and e->>'source' ~ '^https://[^/?#@[:space:]]+([/?]|$)' and e->>'source' !~ '[#[:space:]]'
    and e->>'source' !~* '[?&][^=]*(token|secret|key|auth|email)[^=]*='
    and isfinite((e->>'available_at')::timestamptz) and (e->>'available_at')::timestamptz<=b.cutoff
    and ((e->>'published_at' is not null and isfinite((e->>'published_at')::timestamptz)
      and (e->>'published_at')::timestamptz<=(e->>'available_at')::timestamptz and coalesce(e->>'time_basis','PUBLISHED')='PUBLISHED')
     or (e->'published_at'='null'::jsonb and e->>'time_basis'='OBSERVED_AFTER_RECEIPT'
      and isfinite((e->>'first_seen_at')::timestamptz) and isfinite((e->>'as_of')::timestamptz)
      and (e->>'first_seen_at')::timestamptz<=(e->>'available_at')::timestamptz
      and (e->>'as_of')::timestamptz<=(e->>'available_at')::timestamptz and e->>'evidence_hash' ~ '^[a-f0-9]{64}$'))
    and (e->>'symbol'=j.symbol or e->'symbol'='null'::jsonb)) then raise exception 'AI_EDITION_SOURCE';end if;
  end loop;
  for h in select * from jsonb_array_elements(j.result->'horizons') loop
   if coalesce(h->>'status','') not in('WATCH','WAIT','AVOID','INSUFFICIENT')
    or length(btrim(coalesce(h->'reason'->>'text',''))) not between 1 and 1500
    or length(btrim(coalesce(h->>'confirmation',''))) not between 1 and 1500
    or length(btrim(coalesce(h->>'invalidation',''))) not between 1 and 1500
    or jsonb_typeof(h->'reason'->'evidence_ids') is distinct from 'array' or jsonb_array_length(h->'reason'->'evidence_ids')=0
    or jsonb_typeof(h->'counter_evidence') is distinct from 'array' or jsonb_typeof(h->'gaps') is distinct from 'array'
    or jsonb_array_length(h->'counter_evidence')>20 or jsonb_array_length(h->'gaps')>30
    or exists(select from jsonb_array_elements(h->'gaps')g where jsonb_typeof(g)<>'string' or length(btrim(g#>>'{}')) not between 1 and 1500)
    or (h->>'status'='INSUFFICIENT' and jsonb_array_length(h->'gaps')=0)
    or (h->>'status'='WATCH' and not exists(select from jsonb_array_elements(packet->'evidence')e
     where e->>'symbol'=j.symbol and h->'reason'->'evidence_ids' ? (e->>'id')))
    or concat(h->'reason'->>'text',h->>'confirmation',h->>'invalidation',h->'counter_evidence') ~ '(保證獲利|穩賺|必漲|必賺)'
    then raise exception 'AI_EDITION_ANALYSIS';end if;
   for c in select h->'reason' union all select * from jsonb_array_elements(h->'counter_evidence') loop
    if length(btrim(coalesce(c->>'text',''))) not between 1 and 1500
     or jsonb_typeof(c->'evidence_ids') is distinct from 'array' or jsonb_array_length(c->'evidence_ids') not between 1 and 100
     or (select count(distinct requested.cid) from jsonb_array_elements_text(c->'evidence_ids')requested(cid))<>jsonb_array_length(c->'evidence_ids')
     or exists(select from jsonb_array_elements(c->'evidence_ids')ci where jsonb_typeof(ci)<>'string')
     or exists(select from jsonb_array_elements_text(c->'evidence_ids')requested(cid) where not exists(
      select from jsonb_array_elements(packet->'evidence')e where e->>'id'=requested.cid)) then raise exception 'AI_EDITION_CITATION';end if;
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('id',e->>'id','source',e->>'source','kind',e->>'kind',
    'published_at',e->>'published_at','available_at',e->>'available_at','time_basis',coalesce(e->>'time_basis','PUBLISHED'),
    'first_seen_at',e->>'first_seen_at','as_of',e->>'as_of','evidence_hash',e->>'evidence_hash') order by e->>'id'),'[]') into refs
    from jsonb_array_elements(packet->'evidence')e where h->'reason'->'evidence_ids' ? (e->>'id')
     or exists(select from jsonb_array_elements(h->'counter_evidence')ce where ce->'evidence_ids' ? (e->>'id'));
   select coalesce(jsonb_agg(jsonb_build_object('text',ce->>'text','evidence_ids',ce->'evidence_ids')),'[]') into counters
    from jsonb_array_elements(h->'counter_evidence')ce;
   select coalesce(jsonb_agg(to_jsonb(gap) order by gap),'[]') into gaps from (
    select distinct value#>>'{}' gap from jsonb_array_elements(h->'gaps'||coalesce(packet->'data_gaps','[]'::jsonb)))combined;
   cards:=cards||jsonb_build_array(jsonb_build_object('symbol',j.symbol,'company',packet->>'company','horizon',h->>'horizon',
    'status',h->>'status','reason',jsonb_build_object('text',h->'reason'->>'text','evidence_ids',h->'reason'->'evidence_ids'),
    'counter_evidence',counters,'confirmation',h->>'confirmation',
    'invalidation',h->>'invalidation','gaps',gaps,'sources',refs,'classification','INFERENCE'));
  end loop;
 end loop;
 if cardinality(symbols)<>72 or jsonb_array_length(cards)<>216 then raise exception 'AI_EDITION_UNIVERSE';end if;
 select encode(sha256(convert_to(string_agg(aj.id||':'||aj.input_hash||':'||encode(sha256(convert_to(aj.result::text,'UTF8')),'hex'),',' order by aj.id),'UTF8')),'hex') into job_hash
 from vnext_runtime.ai_stock_jobs aj where aj.id=any(keys);
 select jsonb_agg(distinct ev->>'source' order by ev->>'source') into source_urls
  from jsonb_array_elements(b.payload->'packets')pkt,jsonb_array_elements(pkt->'evidence')ev;
 payload:=jsonb_build_object('schema','VNEXT_AI_RESEARCH_EDITION_V1','mode','AS_OF_RESEARCH','batch_id',b.id,'job_set_hash',job_hash,
  'cutoff',b.cutoff,'through',b.payload->>'through','cards',cards,'source_urls',source_urls,'forecast',false,'performance_available',false);
 eid:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 insert into vnext_private.ai_research_editions(id,batch_id,business_date,cutoff,through,job_keys,job_set_hash,payload,expires_at)
 values(eid,b.id,(b.cutoff at time zone 'Asia/Taipei')::date,b.cutoff,(b.payload->>'through')::date,keys,job_hash,payload,p_expires_at)
 on conflict do nothing;
 return jsonb_build_object('status','STAGED_REVIEW_REQUIRED','edition_id',eid,'rights_ready',vnext_private.ai_edition_rights_v1(eid,at_time),'member_published',false);
end $$;
revoke all on function public.stage_daily_ai_research_edition_v1(text,text[],timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_research_edition_v1(text,text[],timestamptz) to service_role;

create function public.review_daily_ai_research_edition_v1(p_edition_id text,p_review_id uuid,p_action text,p_audience text,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e vnext_private.ai_research_editions;r vnext_private.ai_research_reviews;prior vnext_private.ai_research_publication_events;event_id bigint;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' or not public.is_research_owner_v1() then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if p_edition_id is null or p_edition_id !~ '^[a-f0-9]{64}$' or p_review_id is null
  or p_request_key is null or p_action is null or p_action not in('APPROVE','REVOKE') or p_audience is null or p_audience not in('free','premium') then raise exception 'AI_EDITION_REVIEW_SCOPE';end if;
 perform pg_advisory_xact_lock(hashtextextended('ai-member-research',0));
 select * into prior from vnext_private.ai_research_publication_events where request_key=p_request_key;
 if found then
  if prior.actor is distinct from auth.uid() or prior.edition_id is distinct from p_edition_id or prior.review_id is distinct from p_review_id
   or prior.action is distinct from p_action or prior.audience is distinct from p_audience then raise exception 'AI_EDITION_REPLAY_CONFLICT';end if;
  return jsonb_build_object('event_id',prior.id,'action',prior.action,'replayed',true);
 end if;
 select * into strict e from vnext_private.ai_research_editions where id=p_edition_id;
 select * into strict r from vnext_private.ai_research_reviews where edition_id=e.id order by recorded_at desc,id desc limit 1;
 if r.id is distinct from p_review_id then raise exception 'AI_EDITION_REVIEW_CHANGED';end if;
 if p_action='APPROVE' and (r.quality<>'PASS' or r.time_status<>'PASS' or r.licensing<>'PASS' or r.snapshot_hash<>e.id
  or r.expires_at<=clock_timestamp() or e.expires_at<=clock_timestamp() or not vnext_private.ai_edition_integrity_v1(e.id)
  or not vnext_private.ai_edition_rights_v1(e.id,clock_timestamp())) then raise exception 'AI_EDITION_PREREQUISITES';end if;
 insert into vnext_private.ai_research_publication_events(request_key,edition_id,review_id,actor,action,audience)
 values(p_request_key,e.id,r.id,auth.uid(),p_action,p_audience) returning id into event_id;
 return jsonb_build_object('event_id',event_id,'action',p_action,'replayed',false);
end $$;
revoke all on function public.review_daily_ai_research_edition_v1(text,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.review_daily_ai_research_edition_v1(text,uuid,text,text,uuid) to authenticated;

-- Owner can inspect a staged edition before approving. This view never creates
-- a license, an independent review or an approval on the Owner's behalf.
create function public.get_daily_ai_owner_research_v1(p_edition_id text default null) returns jsonb
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
   'forecast',false,'performance_available',false,'jobs',cardinality(e.job_keys),'periods',jsonb_array_length(e.payload->'cards')),
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

create function public.get_daily_ai_member_research_v1() returns jsonb
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
   'prepared_at',e.created_at,'expires_at',e.expires_at,'mode','AS_OF_RESEARCH','forecast',false,'performance_available',false);
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
