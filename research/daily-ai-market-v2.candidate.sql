-- LOCAL DEPLOYMENT CANDIDATE ONLY. No existing V1 object is replaced.
-- Shared official captures -> immutable universe -> bounded resumable shards
-- -> independent review -> Owner publication -> entitlement-scoped page.
begin;
do $$begin
 if to_regnamespace('vnext_market') is not null then raise exception 'MARKET_V2_ALREADY_INSTALLED';end if;
 if to_regprocedure('academy_private.access_v11()') is null or to_regprocedure('public.is_research_owner_v1()') is null
  or to_regclass('vnext_private.source_licenses') is null then raise exception 'MARKET_V2_PREREQUISITES';end if;
end $$;
create schema vnext_market;
revoke all on schema vnext_market from public,anon,authenticated,service_role;

create function vnext_market.digest(p_text text) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(p_text,'UTF8')),'hex')
$$;
-- Used for closed query/cursor/universe envelopes and original dataset rows.
-- Unsupported numeric representations fail closed instead of accepting a
-- different source-row hash. Input/analysis text itself is hashed verbatim.
create function vnext_market.canonical(v jsonb) returns text language plpgsql immutable set search_path='' as $$
declare answer text;n numeric;begin
 case jsonb_typeof(v)
 when 'object' then
  select '{'||coalesce(string_agg(to_jsonb(k)::text||':'||vnext_market.canonical(x),',' order by k collate "C"),'')||'}'
   into answer from jsonb_each(v)t(k,x);
 when 'array' then
  select '['||coalesce(string_agg(vnext_market.canonical(x),',' order by ord),'')||']'
   into answer from jsonb_array_elements(v) with ordinality t(x,ord);
 when 'number' then
  n:=(v#>>'{}')::numeric;
  if abs(n)>9007199254740991 or (n<>0 and abs(n)<0.000001) then raise exception 'MARKET_CANONICAL_NUMBER';end if;
  answer:=trim_scale(n)::text;
 when 'string','boolean','null' then answer:=v::text;
 else raise exception 'MARKET_CANONICAL_TYPE';
 end case;return answer;
end $$;
create function vnext_market.hash(v jsonb) returns text language sql immutable set search_path='' as $$
 select vnext_market.digest(vnext_market.canonical(v))
$$;
create function vnext_market.iso(v timestamptz) returns text language sql immutable set search_path='' as $$
 select to_char(v at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
create function vnext_market.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'MARKET_IMMUTABLE';end $$;
create function vnext_market.exact(v jsonb,keys text[]) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(v)='object' and (select array_agg(k order by k) from jsonb_object_keys(v)k)
  =(select array_agg(k order by k) from unnest(keys)k)
$$;

create table vnext_market.captures(
 id text primary key check(id~'^[a-f0-9]{64}$'),source_id text not null,source_url text not null,
 receipt_text text not null,receipt_hash text not null check(receipt_hash=vnext_market.digest(receipt_text)),
 receipt jsonb not null check(receipt=receipt_text::jsonb),body_text text not null,
 body_sha256 text not null check(body_sha256=vnext_market.digest(body_text)),
 body_bytes integer not null check(body_bytes=octet_length(body_text) and body_bytes between 1 and 16000000),
 parsed jsonb not null,received_at timestamptz not null,stored_at timestamptz not null default clock_timestamp(),
 check(received_at<=stored_at)
);
create table vnext_market.capture_rows(
 capture_id text not null references vnext_market.captures(id),row_index integer not null check(row_index between 0 and 19999),
 row_path text[] not null check(cardinality(row_path) between 1 and 8),
 row_hash text not null check(row_hash~'^[a-f0-9]{64}$'),row_body jsonb not null,primary key(capture_id,row_path)
);
create index market_capture_row_hash on vnext_market.capture_rows(capture_id,row_hash);
create table vnext_market.universes(
 id text primary key check(id~'^[a-f0-9]{64}$'),body_text text not null,body jsonb not null check(body=body_text::jsonb),
 formed_at timestamptz not null,snapshot_date date not null,total integer not null check(total between 1 and 10000),
 created_at timestamptz not null default clock_timestamp(),check(formed_at<=created_at)
);
create table vnext_market.companies(
 universe_id text not null references vnext_market.universes(id),security_id text not null,
 market text not null check(market in('TWSE','TPEX','EMERGING')),symbol text not null check(symbol~'^[0-9]{4,6}$'),
 company text not null check(length(company) between 1 and 100),ordinal integer not null,
 roster_as_of date not null,roster_capture_id text not null references vnext_market.captures(id),body jsonb not null,
 primary key(universe_id,security_id),unique(universe_id,symbol),unique(universe_id,ordinal),
 check(security_id=market||':'||symbol)
);
create table vnext_market.work_plans(
 id text primary key check(id~'^[a-f0-9]{64}$'),universe_id text not null references vnext_market.universes(id),
 business_date date not null,cutoff timestamptz not null,body_text text not null,body jsonb not null check(body=body_text::jsonb),
 expected_cards integer not null,shard_count integer not null check(shard_count between 1 and 160),
 registered_at timestamptz not null default clock_timestamp(),check(cutoff<=registered_at),
 check(business_date=(cutoff at time zone 'Asia/Taipei')::date)
);
create table vnext_market.shards(
 id text primary key check(id~'^[a-f0-9]{64}$'),plan_id text not null references vnext_market.work_plans(id),
 ordinal integer not null,security_ids text[] not null check(cardinality(security_ids) between 1 and 64),
 body jsonb not null,state text not null default 'PENDING' check(state in('PENDING','LEASED','COMPLETE')),
 attempts integer not null default 0 check(attempts between 0 and 3),lease_id uuid,lease_until timestamptz,
 worker_ref text,result_hash text,unique(plan_id,ordinal)
);
create index market_shard_claim on vnext_market.shards(plan_id,state,ordinal);
create table vnext_market.claims(
 request_key uuid primary key,plan_id text not null references vnext_market.work_plans(id),
 shard_id text not null references vnext_market.shards(id),lease_id uuid not null unique,worker_ref text not null,
 leased_at timestamptz not null,lease_until timestamptz not null
);
create table vnext_market.shard_results(
 shard_id text primary key references vnext_market.shards(id),plan_id text not null references vnext_market.work_plans(id),
 lease_id uuid not null references vnext_market.claims(lease_id),result_hash text not null check(result_hash~'^[a-f0-9]{64}$'),
 result_text text not null check(result_hash=vnext_market.digest(result_text)),recorded_at timestamptz not null default clock_timestamp()
);
create table vnext_market.stock_results(
 plan_id text not null references vnext_market.work_plans(id),shard_id text not null references vnext_market.shards(id),security_id text not null,
 packet_text text not null,packet_hash text not null check(packet_hash=vnext_market.digest(packet_text)),
 analysis_text text not null,analysis_hash text not null check(analysis_hash=vnext_market.digest(analysis_text)),
 primary key(plan_id,security_id)
);
create table vnext_market.evidence(
 evidence_hash text primary key check(evidence_hash~'^[a-f0-9]{64}$'),content_text text not null check(evidence_hash=vnext_market.digest(content_text)),
 source_capture_id text not null references vnext_market.captures(id),source_row_hash text not null,
 first_seen_at timestamptz not null,body jsonb not null,recorded_at timestamptz not null default clock_timestamp()
);
create table vnext_market.cards(
 plan_id text not null references vnext_market.work_plans(id),security_id text not null,horizon text not null check(horizon in('SHORT','MEDIUM','LONG')),
 market text not null check(market in('TWSE','TPEX','EMERGING')),symbol text not null,company text not null,
 status text not null check(status in('WATCH','WAIT','AVOID','INSUFFICIENT')),
 status_rank smallint not null check(status_rank between 0 and 3),market_rank smallint not null check(market_rank between 0 and 2),
 card jsonb not null,price_date date,financial_available_at timestamptz,news_available_at timestamptz,
 primary key(plan_id,security_id,horizon)
);
create index market_cards_page on vnext_market.cards(plan_id,horizon,status_rank,market_rank,symbol collate "C");
create table vnext_market.editions(
 id text primary key check(id~'^[a-f0-9]{64}$'),plan_id text not null unique references vnext_market.work_plans(id),
 universe_id text not null references vnext_market.universes(id),business_date date not null,cutoff timestamptz not null,
 prepared_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,results_hash text not null,
 analysis_origin text not null check(analysis_origin='DETERMINISTIC_SCREENING'),method_version text not null,
 check(cutoff<=prepared_at and expires_at>prepared_at and expires_at<=prepared_at+interval '72 hours')
);
create index market_editions_latest on vnext_market.editions(prepared_at desc,id);
create table vnext_market.edition_sources(
 edition_id text not null references vnext_market.editions(id),source_url text not null,primary key(edition_id,source_url)
);
create table vnext_market.plan_sources(
 plan_id text not null references vnext_market.work_plans(id),source_url text not null,primary key(plan_id,source_url)
);
create table vnext_market.reviews(
 sequence bigint generated always as identity primary key,id uuid not null unique default gen_random_uuid(),
 edition_id text not null references vnext_market.editions(id),review_hash text not null unique check(review_hash~'^[a-f0-9]{64}$'),
 review_text text not null check(review_hash=vnext_market.digest(review_text)),reviewer_ref text not null,
 quality text not null check(quality in('PASS','FAIL','PENDING')),time_status text not null check(time_status in('PASS','FAIL','PENDING')),
 licensing text not null check(licensing in('PASS','FAIL','PENDING')),methodology text not null check(methodology in('PASS','FAIL','PENDING')),
 documents jsonb not null,expires_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),
 check(expires_at>recorded_at)
);
create index market_reviews_latest on vnext_market.reviews(edition_id,sequence desc);
create table vnext_market.publication_events(
 id bigint generated always as identity primary key,request_key uuid not null unique,edition_id text not null references vnext_market.editions(id),
 review_id uuid not null references vnext_market.reviews(id),actor uuid not null references auth.users(id),
 action text not null check(action in('APPROVE','REVOKE')),audience text not null check(audience in('free','premium')),
 occurred_at timestamptz not null default clock_timestamp()
);
create index market_publication_latest on vnext_market.publication_events(edition_id,id desc);

-- A strict server parser makes CSV rows independently checkable against the
-- original retained response. It does not accept a client-supplied row array.
create function vnext_market.csv_rows(p_text text) returns setof jsonb language plpgsql immutable set search_path='' as $$
declare input bytea:=convert_to(ltrim(p_text,chr(65279)),'UTF8');i integer:=0;n integer:=octet_length(input);c integer;
 field_start integer:=0;closing_at integer;field text;fields text[]:='{}';headers text[];
 quoted boolean:=false;was_quoted boolean:=false;closed boolean:=false;ended boolean;
 row_count integer:=0;row_body jsonb;begin
 if n>8000000 then raise exception 'MARKET_CSV_SIZE';end if;
 -- Byte offsets avoid repeatedly scanning the preceding Unicode text. Each
 -- field is decoded once; RETURN NEXT avoids copying a growing JSON array.
 while i<=n loop
  c:=case when i<n then get_byte(input,i) else 10 end;ended:=false;
  if i-field_start>65536 then raise exception 'MARKET_CSV_FIELD_SIZE';end if;
  if quoted then
   if i=n then raise exception 'MARKET_CSV_QUOTE';end if;
   if c=34 then
    if i+1<n and get_byte(input,i+1)=34 then i:=i+1;
    else quoted:=false;closed:=true;closing_at:=i;end if;
   end if;
  elsif c=34 then
   if i<>field_start or closed then raise exception 'MARKET_CSV_QUOTE';end if;
   quoted:=true;was_quoted:=true;field_start:=i+1;
  elsif c in(44,13,10) then
   field:=convert_from(substring(input from field_start+1 for (case when was_quoted then closing_at else i end)-field_start),'UTF8');
   if was_quoted then field:=replace(field,'""','"');end if;
   fields:=array_append(fields,field);closed:=false;was_quoted:=false;closing_at:=null;
   if cardinality(fields)>128 then raise exception 'MARKET_CSV_COLUMNS';end if;
   if c<>44 then
    if c=13 and i+1<n and get_byte(input,i+1)=10 then i:=i+1;end if;ended:=true;
   end if;
   field_start:=i+1;
  elsif closed then raise exception 'MARKET_CSV_TRAILING_DATA';
  end if;
  if ended then
   if exists(select from unnest(fields)v where v<>'') then
    if headers is null then
     headers:=fields;
     if cardinality(headers)<>(select count(distinct x) from unnest(headers)x)
      or exists(select from unnest(headers)x where btrim(x)='') then raise exception 'MARKET_CSV_HEADER';end if;
    else
     if cardinality(fields)<>cardinality(headers) then raise exception 'MARKET_CSV_ROW_WIDTH';end if;
     row_count:=row_count+1;if row_count>10000 then raise exception 'MARKET_CSV_ROWS';end if;
     select jsonb_object_agg(headers[k],fields[k]) into row_body from generate_subscripts(headers,1)k;
     return next row_body;
    end if;
   end if;fields:='{}';
  end if;i:=i+1;
 end loop;
 if headers is null then raise exception 'MARKET_CSV_HEADER';end if;return;
end $$;

create function public.stage_daily_ai_market_capture_v2(p_receipt_text text,p_receipt_hash text,p_body_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;parsed jsonb;cid text;prior vnext_market.captures;at_time timestamptz:=clock_timestamp();
begin
 if p_receipt_text is null or octet_length(p_receipt_text) not between 2 and 20000
  or p_receipt_hash is null or p_receipt_hash<>vnext_market.digest(p_receipt_text)
  or p_body_text is null or octet_length(p_body_text) not between 1 and 16000000 then raise exception 'MARKET_CAPTURE_SCOPE';end if;
 r:=p_receipt_text::jsonb;
 if r->>'schema' is distinct from 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1' or r->>'state' is distinct from 'CAPTURED'
  or not(r ?& array['source_id','url','format','started_at','received_at','bytes','sha256','status'])
  or jsonb_typeof(r->'started_at') is distinct from 'string' or jsonb_typeof(r->'received_at') is distinct from 'string'
  or r->'status' is distinct from '200'::jsonb or coalesce(r->>'source_id','') !~ '^[A-Za-z][A-Za-z0-9_]{1,99}$'
  or r->>'format' not in('json','csv') or r->>'sha256' is distinct from vnext_market.digest(p_body_text)
  or (r->>'bytes')::integer is distinct from octet_length(p_body_text)
  or not isfinite((r->>'received_at')::timestamptz) or not isfinite((r->>'started_at')::timestamptz)
  or (r->>'started_at')::timestamptz>(r->>'received_at')::timestamptz or (r->>'received_at')::timestamptz>at_time
  or not vnext_market.source_allowed(r->>'source_id',r->>'url',r->>'format') then raise exception 'MARKET_CAPTURE_RECEIPT';end if;
 cid:=vnext_market.hash(jsonb_build_object('source_id',r->>'source_id','url',r->>'url','source_sha256',r->>'sha256','received_at',r->>'received_at'));
 select * into prior from vnext_market.captures where id=cid;
 if found then
  if prior.body_text is distinct from p_body_text or prior.receipt_hash is distinct from p_receipt_hash then raise exception 'MARKET_CAPTURE_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_CAPTURE_STAGED_V2','capture_id',cid,'receipt_hash',prior.receipt_hash,'replayed',true);
 end if;
 if r->>'format'='csv' then
  select coalesce(jsonb_agg(row_body order by ord),'[]'::jsonb) into parsed
   from vnext_market.csv_rows(p_body_text) with ordinality t(row_body,ord);
 else parsed:=ltrim(p_body_text,chr(65279))::jsonb;end if;
 if jsonb_typeof(parsed) not in('array','object') or (jsonb_typeof(parsed)='array' and
  (jsonb_array_length(parsed)>20000 or (r->>'row_count')::integer is distinct from jsonb_array_length(parsed)))
  then raise exception 'MARKET_CAPTURE_ROWS';end if;
 if jsonb_typeof(parsed)='object' and (r->>'source_id'!~'^(TWSE|TPEX)_DAILY_[0-9]{8}$'
  or jsonb_typeof(parsed->'tables') is distinct from 'array' or jsonb_array_length(parsed->'tables')>32)
  then raise exception 'MARKET_CAPTURE_TABLES';end if;
 insert into vnext_market.captures(id,source_id,source_url,receipt_text,receipt_hash,receipt,body_text,body_sha256,body_bytes,parsed,received_at)
 values(cid,r->>'source_id',r->>'url',p_receipt_text,p_receipt_hash,r,p_body_text,r->>'sha256',octet_length(p_body_text),parsed,(r->>'received_at')::timestamptz);
 if jsonb_typeof(parsed)='array' then
  insert into vnext_market.capture_rows(capture_id,row_index,row_path,row_hash,row_body)
   select cid,(ord-1)::integer,array[(ord-1)::text],vnext_market.hash(x),x from jsonb_array_elements(parsed) with ordinality t(x,ord);
 else
  -- Preserve the actual table/row path once. Later stock validation reads the
  -- indexed immutable row instead of repeatedly detoasting the whole response.
  insert into vnext_market.capture_rows(capture_id,row_index,row_path,row_hash,row_body)
   select cid,(row_ord-1)::integer,array['tables',(table_ord-1)::text,'data',(row_ord-1)::text],vnext_market.hash(raw_row),raw_row
   from jsonb_array_elements(parsed->'tables') with ordinality tab(table_body,table_ord)
   cross join lateral jsonb_array_elements(case when jsonb_typeof(table_body->'data')='array' then table_body->'data' else '[]'::jsonb end)
    with ordinality rows(raw_row,row_ord);
  if (select count(*) from vnext_market.capture_rows where capture_id=cid)>20000 then raise exception 'MARKET_CAPTURE_ROWS';end if;
 end if;
 return jsonb_build_object('schema','DAILY_AI_MARKET_CAPTURE_STAGED_V2','capture_id',cid,'receipt_hash',p_receipt_hash,'replayed',false);
end $$;

create function public.stage_daily_ai_market_work_plan_v2(p_universe_text text,p_plan_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u jsonb;p jsonb;uid text;pid text;source jsonb;c jsonb;s jsonb;cap vnext_market.captures;
 source_ord bigint;expected jsonb;at_time timestamptz:=clock_timestamp();old_u vnext_market.universes;old_p vnext_market.work_plans;
begin
 if p_universe_text is null or octet_length(p_universe_text) not between 2 and 12000000
  or p_plan_text is null or octet_length(p_plan_text) not between 2 and 2000000 then raise exception 'MARKET_PLAN_SIZE';end if;
 u:=p_universe_text::jsonb;p:=p_plan_text::jsonb;uid:=u->>'universe_hash';pid:=p->>'plan_hash';
 if coalesce(uid,'')!~'^[a-f0-9]{64}$' or uid<>vnext_market.hash(u-'universe_hash')
  or coalesce(pid,'')!~'^[a-f0-9]{64}$' or pid<>vnext_market.hash(p-'plan_hash')
  or u->>'schema' is distinct from 'TAIWAN_MARKET_UNIVERSE_V1' or u->'coverage_complete' is distinct from 'true'::jsonb
  or u->'historical_membership_established' is distinct from 'false'::jsonb or u->'cross_market_conflicts' is distinct from '[]'::jsonb
  or jsonb_typeof(u->'companies') is distinct from 'array' or jsonb_array_length(u->'companies') not between 1 and 10000
  or (u->>'total')::integer is distinct from jsonb_array_length(u->'companies')
  or jsonb_array_length(u->'sources') is distinct from 3
  or (u->>'formed_at')::timestamptz>at_time
  or p->>'schema' is distinct from 'DAILY_AI_MARKET_WORK_PLAN_V2' or p->>'universe_hash' is distinct from uid
  or p->'member_published' is distinct from 'false'::jsonb or p->'methodology_approved' is distinct from 'false'::jsonb
  or (p->>'shard_size')::integer is distinct from 64 or (p->>'securities')::integer is distinct from (u->>'total')::integer
  or (p->>'expected_cards')::integer is distinct from (u->>'total')::integer*3
  or (p->>'cutoff')::timestamptz<(u->>'formed_at')::timestamptz or (p->>'cutoff')::timestamptz>at_time
  or (p->>'business_date')::date is distinct from ((p->>'cutoff')::timestamptz at time zone 'Asia/Taipei')::date
  or jsonb_array_length(p->'shards') is distinct from ceil((u->>'total')::numeric/64)::integer
  then raise exception 'MARKET_PLAN_CONTRACT';end if;
 perform pg_advisory_xact_lock(hashtextextended('market-plan:'||pid,0));
 select * into old_p from vnext_market.work_plans where id=pid;
 if found then
  if old_p.body_text is distinct from p_plan_text or not exists(select from vnext_market.universes where id=uid and body_text=p_universe_text)
   then raise exception 'MARKET_PLAN_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_WORK_PLAN_STAGED_V2','plan_hash',pid,'universe_hash',uid,'shards',old_p.shard_count,'replayed',true,'member_published',false);
 end if;
 select * into old_u from vnext_market.universes where id=uid;
 if found and old_u.body_text is distinct from p_universe_text then raise exception 'MARKET_UNIVERSE_REPLAY_CONFLICT';end if;
 if not found then
  insert into vnext_market.universes(id,body_text,body,formed_at,snapshot_date,total)
   values(uid,p_universe_text,u,(u->>'formed_at')::timestamptz,((u->>'formed_at')::timestamptz at time zone 'Asia/Taipei')::date,(u->>'total')::integer);
  if (select count(distinct x->>'market') from jsonb_array_elements(u->'sources')x where x->>'market' in('TWSE','TPEX','EMERGING'))<>3
   then raise exception 'MARKET_ROSTER_SET';end if;
  for source in select * from jsonb_array_elements(u->'sources') loop
   select * into strict cap from vnext_market.captures where source_id=source->>'source_id' and source_url=source->>'source_url'
    and body_sha256=source->>'source_sha256' and received_at=(source->>'received_at')::timestamptz;
   if cap.received_at>(u->>'formed_at')::timestamptz or jsonb_typeof(cap.parsed)<>'array'
    or (source->>'company_count')::integer<>jsonb_array_length(cap.parsed)
    or (source->>'company_count')::integer<>(select count(*) from jsonb_array_elements(u->'companies')x where x->>'market'=source->>'market')
    or (u->'counts'->>(source->>'market'))::integer<>(source->>'company_count')::integer
    then raise exception 'MARKET_ROSTER_BINDING';end if;
   for c,source_ord in select x,ord from jsonb_array_elements(u->'companies') with ordinality t(x,ord) where x->>'market'=source->>'market' loop
    if c->>'security_id' is distinct from (c->>'market')||':'||(c->>'symbol') or c->>'symbol'!~'^[0-9]{4,6}$'
     or length(btrim(c->>'company')) not between 1 and 100 or c->>'source_id' is distinct from source->>'source_id'
     or (c->>'source_as_of')::date is distinct from (source->>'source_as_of')::date
     or not exists(select from vnext_market.capture_rows cr where cr.capture_id=cap.id and cr.row_hash=c->>'source_row_hash'
      and btrim(cr.row_body->>'公司代號')=c->>'symbol' and btrim(cr.row_body->>'公司名稱')=c->>'company') then raise exception 'MARKET_COMPANY_BINDING';end if;
    insert into vnext_market.companies(universe_id,security_id,market,symbol,company,ordinal,roster_as_of,roster_capture_id,body)
     values(uid,c->>'security_id',c->>'market',c->>'symbol',c->>'company',source_ord::integer,(c->>'source_as_of')::date,cap.id,c);
   end loop;
  end loop;
 end if;
 insert into vnext_market.work_plans(id,universe_id,business_date,cutoff,body_text,body,expected_cards,shard_count)
 values(pid,uid,(p->>'business_date')::date,(p->>'cutoff')::timestamptz,p_plan_text,p,(p->>'expected_cards')::integer,jsonb_array_length(p->'shards'));
 for s,source_ord in select x,ord-1 from jsonb_array_elements(p->'shards') with ordinality t(x,ord) loop
  select jsonb_agg(to_jsonb(security_id) order by c.ordinal) into expected from vnext_market.companies c
   where c.universe_id=uid and c.ordinal>source_ord*64 and c.ordinal<=(source_ord+1)*64;
  if s->>'shard_id' is distinct from vnext_market.hash(s-'shard_id'-'expected_cards') or s->>'schema' is distinct from 'DAILY_AI_MARKET_SHARD_V2'
   or s->>'universe_hash' is distinct from uid or s->>'business_date' is distinct from p->>'business_date'
   or s->>'cutoff' is distinct from p->>'cutoff' or (s->>'index')::integer is distinct from source_ord::integer
   or s->'security_ids' is distinct from expected or s->'horizons' is distinct from '["SHORT","MEDIUM","LONG"]'::jsonb
   or (s->>'expected_cards')::integer is distinct from jsonb_array_length(expected)*3 then raise exception 'MARKET_SHARD_SCOPE';end if;
  insert into vnext_market.shards(id,plan_id,ordinal,security_ids,body)
   values(s->>'shard_id',pid,source_ord::integer,array(select jsonb_array_elements_text(expected)),s);
 end loop;
 return jsonb_build_object('schema','DAILY_AI_MARKET_WORK_PLAN_STAGED_V2','plan_hash',pid,'universe_hash',uid,
  'shards',jsonb_array_length(p->'shards'),'replayed',false,'member_published',false);
end $$;

create function public.claim_daily_ai_market_shard_v2(p_plan_hash text,p_worker_ref text,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p vnext_market.work_plans;s vnext_market.shards;c vnext_market.claims;at_time timestamptz:=clock_timestamp();lease uuid;claim_state text;
begin
 if p_plan_hash is null or p_plan_hash!~'^[a-f0-9]{64}$' or p_request_key is null or length(btrim(coalesce(p_worker_ref,''))) not between 1 and 200
  then raise exception 'MARKET_CLAIM_SCOPE';end if;
 select * into strict p from vnext_market.work_plans where id=p_plan_hash;
 perform pg_advisory_xact_lock(hashtextextended('market-claim:'||p_request_key::text,0));
 select * into c from vnext_market.claims where request_key=p_request_key;
 if found then
  if c.plan_id<>p_plan_hash or c.worker_ref<>p_worker_ref then raise exception 'MARKET_CLAIM_REPLAY_CONFLICT';end if;
  select * into strict s from vnext_market.shards where id=c.shard_id;
  claim_state:=case when s.state='COMPLETE' then 'COMPLETED' when c.lease_until<=at_time or s.lease_id<>c.lease_id then 'LEASE_EXPIRED' else 'CLAIMED' end;
 else
  select * into s from vnext_market.shards where plan_id=p.id and attempts<3
   and (state='PENDING' or (state='LEASED' and lease_until<=at_time)) order by ordinal for update skip locked limit 1;
  if not found then return jsonb_build_object('schema','DAILY_AI_MARKET_SHARD_CLAIM_V2','state','NO_WORK','plan_hash',p.id,
   'remaining',(select count(*) from vnext_market.shards where plan_id=p.id and state<>'COMPLETE'),
   'exhausted',(select count(*) from vnext_market.shards where plan_id=p.id and state<>'COMPLETE' and attempts>=3));end if;
  lease:=gen_random_uuid();
  insert into vnext_market.claims values(p_request_key,p.id,s.id,lease,p_worker_ref,at_time,at_time+interval '2 minutes') returning * into c;
  update vnext_market.shards set state='LEASED',attempts=attempts+1,lease_id=lease,lease_until=c.lease_until,worker_ref=p_worker_ref where id=s.id;
  claim_state:='CLAIMED';
 end if;
 return jsonb_build_object('schema','DAILY_AI_MARKET_SHARD_CLAIM_V2','state',claim_state,'plan_hash',p.id,'universe_hash',p.universe_id,
  'business_date',p.business_date,'cutoff',vnext_market.iso(p.cutoff),'shard',s.body,'lease_id',c.lease_id,
  'result_hash',s.result_hash,
  'lease_until',vnext_market.iso(c.lease_until),'request_key',c.request_key,
  'companies',(select jsonb_agg(body order by ordinal) from vnext_market.companies where universe_id=p.universe_id and security_id=any(s.security_ids)));
end $$;

create function vnext_market.validate_packet(p_packet jsonb,p_security_id text,p_plan_id text) returns void
language plpgsql security definer set search_path='' as $$
declare p vnext_market.work_plans;c vnext_market.companies;e jsonb;content jsonb;binding jsonb;
 cap record;raw_row jsonb;raw_hash text;path_parts text[];field text;source_symbol text;old_e vnext_market.evidence;
begin
 select * into strict p from vnext_market.work_plans where id=p_plan_id;
 select * into strict c from vnext_market.companies where universe_id=p.universe_id and security_id=p_security_id;
 if jsonb_typeof(p_packet) is distinct from 'object' or p_packet->>'symbol' is distinct from c.symbol
  or p_packet->>'company' not in(c.company,coalesce(c.body->>'short_name',c.company))
  or (p_packet->>'cutoff')::timestamptz is distinct from p.cutoff
  or jsonb_typeof(p_packet->'evidence') is distinct from 'array' or jsonb_array_length(p_packet->'evidence') not between 1 and 100
  or jsonb_typeof(p_packet->'data_gaps') is distinct from 'array' or jsonb_array_length(p_packet->'data_gaps')>100
  or (p_packet->>'data_through')::date>p.business_date
  or (select count(distinct x->>'id') from jsonb_array_elements(p_packet->'evidence')x)<>jsonb_array_length(p_packet->'evidence')
  then raise exception 'MARKET_PACKET_SCOPE';end if;
 for e in select * from jsonb_array_elements(p_packet->'evidence') loop
  if not coalesce(vnext_market.exact(e,array['id','symbol','kind','source','published_at','available_at','time_basis','first_seen_at','as_of','evidence_hash','content']),false)
   or e->>'symbol' is distinct from c.symbol or coalesce(e->>'kind','') not in('MARKET','PRICE','FINANCIAL','NEWS')
   or jsonb_typeof(e->'available_at') is distinct from 'string' or jsonb_typeof(e->'first_seen_at') is distinct from 'string'
   or jsonb_typeof(e->'as_of') is distinct from 'string'
   or length(e->>'content') not between 2 and 200000 or e->>'evidence_hash' is distinct from vnext_market.digest(e->>'content')
   or e->>'id' is distinct from 'market-'||left(e->>'evidence_hash',40)
   then raise exception 'MARKET_EVIDENCE_HASH';end if;
  content:=(e->>'content')::jsonb;binding:=content->'source_capture';
  if jsonb_typeof(binding) is distinct from 'object' or coalesce(binding->>'capture_id','')!~'^[a-f0-9]{64}$'
   or jsonb_typeof(binding->'row_path') is distinct from 'array' or jsonb_array_length(binding->'row_path') not between 1 and 8
   or exists(select from jsonb_array_elements(binding->'row_path')x where jsonb_typeof(x) not in('string','number')
    or length(x#>>'{}') not between 1 and 100)
   or length(binding->>'symbol_field') not between 1 and 100 then raise exception 'MARKET_EVIDENCE_BINDING';end if;
  select id,source_id,source_url,body_sha256,body_bytes,received_at into strict cap
   from vnext_market.captures where id=binding->>'capture_id';
  if binding->>'source_id' is distinct from cap.source_id or binding->>'source_url' is distinct from cap.source_url
   or e->>'source' is distinct from cap.source_url or binding->>'source_sha256' is distinct from cap.body_sha256
   or (binding->>'source_bytes')::integer is distinct from cap.body_bytes
   or (binding->>'received_at')::timestamptz is distinct from cap.received_at
   or (e->>'first_seen_at')::timestamptz is distinct from cap.received_at
   or (e->>'available_at')::timestamptz<cap.received_at or (e->>'available_at')::timestamptz>p.cutoff
   or (e->>'as_of')::timestamptz is distinct from cap.received_at
   or not isfinite((e->>'available_at')::timestamptz)
   or not((e->'published_at'='null'::jsonb and e->>'time_basis'='OBSERVED_AFTER_RECEIPT')
    or (e->>'published_at' is not null and e->>'time_basis'='PUBLISHED'
     and isfinite((e->>'published_at')::timestamptz) and (e->>'published_at')::timestamptz<=(e->>'available_at')::timestamptz))
   then raise exception 'MARKET_EVIDENCE_TIME_OR_SOURCE';end if;
  path_parts:=array(select x#>>'{}' from jsonb_array_elements(binding->'row_path')x);
  if path_parts[cardinality(path_parts)]!~'^[0-9]{1,5}$'
   or (binding->>'row_index')::integer is distinct from path_parts[cardinality(path_parts)]::integer then raise exception 'MARKET_EVIDENCE_ROW_PATH';end if;
  select cr.row_body,cr.row_hash into raw_row,raw_hash from vnext_market.capture_rows cr
   where cr.capture_id=cap.id and cr.row_path=path_parts;
  field:=binding->>'symbol_field';
  if raw_row is null or raw_hash is distinct from binding->>'source_row_hash'
   then raise exception 'MARKET_EVIDENCE_RAW_ROW';end if;
  source_symbol:=case when jsonb_typeof(raw_row)='array' and field~'^[0-9]{1,3}$' then raw_row->>(field::integer)
    when jsonb_typeof(raw_row)='object' then raw_row->>field else null end;
  if btrim(source_symbol) is distinct from c.symbol then raise exception 'MARKET_EVIDENCE_SYMBOL';end if;
  select * into old_e from vnext_market.evidence where evidence_hash=e->>'evidence_hash';
  if found then
   if old_e.content_text is distinct from e->>'content' or old_e.body is distinct from e then raise exception 'MARKET_EVIDENCE_REPLAY_CONFLICT';end if;
  else
   insert into vnext_market.evidence(evidence_hash,content_text,source_capture_id,source_row_hash,first_seen_at,body)
    values(e->>'evidence_hash',e->>'content',cap.id,binding->>'source_row_hash',cap.received_at,e);
  end if;
  insert into vnext_market.plan_sources(plan_id,source_url) values(p.id,cap.source_url) on conflict do nothing;
 end loop;
end $$;

create function vnext_market.card_projection(p_packet jsonb,p_horizon jsonb,p_market text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare h jsonb:=p_horizon;c jsonb;refs jsonb;gap jsonb;begin
 if not coalesce(vnext_market.exact(h,array['horizon','status','reason','counter_evidence','confirmation','invalidation','gaps']),false)
  or coalesce(h->>'horizon','') not in('SHORT','MEDIUM','LONG') or coalesce(h->>'status','') not in('WATCH','WAIT','AVOID','INSUFFICIENT')
  or length(btrim(coalesce(h->>'confirmation',''))) not between 1 and 1500 or length(btrim(coalesce(h->>'invalidation',''))) not between 1 and 1500
  or jsonb_typeof(h->'counter_evidence') is distinct from 'array' or jsonb_array_length(h->'counter_evidence')>20
  or jsonb_typeof(h->'gaps') is distinct from 'array' or jsonb_array_length(h->'gaps')>30
  or (h->>'status'='INSUFFICIENT' and jsonb_array_length(h->'gaps')=0)
  or h::text~'(保證獲利|穩賺|必漲|必賺)' then raise exception 'MARKET_HORIZON_CONTRACT';end if;
 for c in select h->'reason' union all select * from jsonb_array_elements(h->'counter_evidence') loop
  if not coalesce(vnext_market.exact(c,array['text','evidence_ids']),false)
   or jsonb_typeof(c->'text') is distinct from 'string'
   or length(btrim(coalesce(c->>'text',''))) not between 1 and 1500 or jsonb_typeof(c->'evidence_ids') is distinct from 'array'
   or jsonb_array_length(c->'evidence_ids') not between 1 and 100
   or (select count(distinct x#>>'{}') from jsonb_array_elements(c->'evidence_ids')x)<>jsonb_array_length(c->'evidence_ids')
   or exists(select from jsonb_array_elements(c->'evidence_ids')x where jsonb_typeof(x)<>'string'
    or not exists(select from jsonb_array_elements(p_packet->'evidence')e where e->>'id'=x#>>'{}')) then raise exception 'MARKET_HORIZON_CITATION';end if;
 end loop;
 for gap in select * from jsonb_array_elements((h->'gaps')||(p_packet->'data_gaps')) loop
  if jsonb_typeof(gap)<>'string' or length(btrim(gap#>>'{}')) not between 1 and 1500 then raise exception 'MARKET_HORIZON_GAP';end if;
 end loop;
 select jsonb_agg(jsonb_build_object('id',e->>'id','source',e->>'source','kind',e->>'kind','published_at',e->'published_at',
  'available_at',e->>'available_at','time_basis',e->>'time_basis','first_seen_at',e->'first_seen_at','as_of',e->'as_of','evidence_hash',e->>'evidence_hash') order by e->>'id') into refs
  from jsonb_array_elements(p_packet->'evidence')e where h->'reason'->'evidence_ids' ? (e->>'id')
   or exists(select from jsonb_array_elements(h->'counter_evidence')ce where ce->'evidence_ids' ? (e->>'id'));
 return jsonb_build_object('market',p_market,'symbol',p_packet->>'symbol','company',p_packet->>'company','horizon',h->>'horizon',
  'status',h->>'status','reason',h->'reason','counter_evidence',h->'counter_evidence','confirmation',h->>'confirmation',
  'invalidation',h->>'invalidation','gaps',(select coalesce(jsonb_agg(to_jsonb(x) order by x),'[]') from
   (select distinct g#>>'{}' x from jsonb_array_elements((h->'gaps')||(p_packet->'data_gaps'))g)t),
  'sources',refs,'classification','INFERENCE','price',null);
end $$;

create function public.stage_daily_ai_market_shard_v2(p_plan_hash text,p_shard_id text,p_lease_id uuid,p_result_text text,p_result_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p vnext_market.work_plans;s vnext_market.shards;prior vnext_market.shard_results;r jsonb;item jsonb;packet jsonb;a jsonb;h jsonb;card jsonb;
 c vnext_market.companies;items_seen text[]:='{}';at_time timestamptz:=clock_timestamp();
begin
 if p_plan_hash is null or p_shard_id is null or p_lease_id is null or p_result_text is null
  or octet_length(p_result_text) not between 2 and 16000000 or p_result_hash is null
  or p_result_hash is distinct from vnext_market.digest(p_result_text) then raise exception 'MARKET_SHARD_RESULT_SCOPE';end if;
 select * into strict p from vnext_market.work_plans where id=p_plan_hash;
 select * into strict s from vnext_market.shards where id=p_shard_id and plan_id=p.id for update;
 select * into prior from vnext_market.shard_results where shard_id=s.id;
 if found then
  if prior.result_hash is distinct from p_result_hash or prior.result_text is distinct from p_result_text or prior.lease_id is distinct from p_lease_id
   then raise exception 'MARKET_SHARD_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_SHARD_STAGED_V2','plan_hash',p.id,'shard_id',s.id,'result_hash',prior.result_hash,
   'cards',cardinality(s.security_ids)*3,'replayed',true,'member_published',false,'review_required',true);
 end if;
 if s.state<>'LEASED' or s.lease_id is distinct from p_lease_id or s.lease_until<=at_time then raise exception 'MARKET_SHARD_LEASE';end if;
 r:=p_result_text::jsonb;
 if not coalesce(vnext_market.exact(r,array['schema','plan_hash','shard_id','items','member_published','methodology_approved']),false)
  or r->>'schema' is distinct from 'DAILY_AI_MARKET_SHARD_RESULT_V2' or r->>'plan_hash' is distinct from p.id or r->>'shard_id' is distinct from s.id
  or r->'member_published' is distinct from 'false'::jsonb or r->'methodology_approved' is distinct from 'false'::jsonb
  or jsonb_typeof(r->'items') is distinct from 'array' or jsonb_array_length(r->'items') is distinct from cardinality(s.security_ids)
  then raise exception 'MARKET_SHARD_RESULT_CONTRACT';end if;
 for item in select * from jsonb_array_elements(r->'items') loop
  if not coalesce(vnext_market.exact(item,array['security_id','packet_text','packet_hash','analysis_text','analysis_hash']),false)
   or not(item->>'security_id'=any(s.security_ids)) or item->>'security_id'=any(items_seen)
   or item->>'packet_hash' is distinct from vnext_market.digest(item->>'packet_text')
   or item->>'analysis_hash' is distinct from vnext_market.digest(item->>'analysis_text')
   or octet_length(item->>'packet_text') not between 2 and 1500000
   or octet_length(item->>'analysis_text') not between 2 and 200000 then raise exception 'MARKET_STOCK_RESULT_SCOPE';end if;
  items_seen:=array_append(items_seen,item->>'security_id');packet:=(item->>'packet_text')::jsonb;a:=(item->>'analysis_text')::jsonb;
  perform vnext_market.validate_packet(packet,item->>'security_id',p.id);
  select * into strict c from vnext_market.companies where universe_id=p.universe_id and security_id=item->>'security_id';
  if a->>'schema' is distinct from 'DAILY_AI_STOCK_ANALYSIS_V2' or a->>'symbol' is distinct from c.symbol
   or a->>'input_hash' is distinct from item->>'packet_hash' or (a->>'cutoff')::timestamptz is distinct from p.cutoff
   or a->>'analysis_origin' is distinct from 'DETERMINISTIC_SCREENING' or a->>'method_version' is distinct from 'TAIWAN_MARKET_RESEARCH_V1'
   or a->'model_generated' is distinct from 'false'::jsonb or a->'member_published' is distinct from 'false'::jsonb
   or a->'sources' is distinct from (select jsonb_agg(e-'content' order by ord) from jsonb_array_elements(packet->'evidence') with ordinality t(e,ord))
   or jsonb_typeof(a->'horizons') is distinct from 'array' or jsonb_array_length(a->'horizons')<>3
   or (select count(distinct x->>'horizon') from jsonb_array_elements(a->'horizons')x where x->>'horizon' in('SHORT','MEDIUM','LONG'))<>3
   then raise exception 'MARKET_ANALYSIS_PROVENANCE';end if;
  insert into vnext_market.stock_results values(p.id,s.id,c.security_id,item->>'packet_text',item->>'packet_hash',item->>'analysis_text',item->>'analysis_hash');
  for h in select * from jsonb_array_elements(a->'horizons') loop
   card:=vnext_market.card_projection(packet,h,c.market);
   insert into vnext_market.cards(plan_id,security_id,horizon,market,symbol,company,status,status_rank,market_rank,card,price_date,financial_available_at,news_available_at)
    values(p.id,c.security_id,h->>'horizon',c.market,c.symbol,packet->>'company',h->>'status',
     array_position(array['WATCH','WAIT','AVOID','INSUFFICIENT'],h->>'status')-1,array_position(array['TWSE','TPEX','EMERGING'],c.market)-1,card,
     (packet->>'data_through')::date,
     (select max((e->>'available_at')::timestamptz) from jsonb_array_elements(packet->'evidence')e where e->>'kind'='FINANCIAL'),
     (select max((e->>'available_at')::timestamptz) from jsonb_array_elements(packet->'evidence')e where e->>'kind'='NEWS'));
  end loop;
 end loop;
 insert into vnext_market.shard_results(shard_id,plan_id,lease_id,result_hash,result_text) values(s.id,p.id,p_lease_id,p_result_hash,p_result_text);
 update vnext_market.shards set state='COMPLETE',result_hash=p_result_hash where id=s.id;
 return jsonb_build_object('schema','DAILY_AI_MARKET_SHARD_STAGED_V2','plan_hash',p.id,'shard_id',s.id,'result_hash',p_result_hash,
  'cards',cardinality(s.security_ids)*3,'replayed',false,'member_published',false,'review_required',true);
end $$;

create function public.finish_daily_ai_market_edition_v2(p_plan_hash text,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p vnext_market.work_plans;e vnext_market.editions;result_hash text;eid text;at_time timestamptz:=clock_timestamp();
begin
 select * into strict p from vnext_market.work_plans where id=p_plan_hash;
 perform pg_advisory_xact_lock(hashtextextended('market-finish:'||p.id,0));
 select * into e from vnext_market.editions where plan_id=p.id;
 if found then
  if e.expires_at is distinct from p_expires_at then raise exception 'MARKET_EDITION_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_EDITION_STAGED_V2','edition_id',e.id,'plan_hash',p.id,'replayed',true,'review_required',true,'member_published',false);
 end if;
 if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=at_time or p_expires_at>at_time+interval '72 hours'
  or exists(select from vnext_market.shards where plan_id=p.id and state<>'COMPLETE')
  or (select count(*) from vnext_market.shard_results where plan_id=p.id)<>p.shard_count
  or (select count(*) from vnext_market.cards where plan_id=p.id)<>p.expected_cards then raise exception 'MARKET_EDITION_INCOMPLETE';end if;
 select vnext_market.digest(string_agg(s.id||':'||r.result_hash,',' order by s.ordinal)) into result_hash
  from vnext_market.shards s join vnext_market.shard_results r on r.shard_id=s.id where s.plan_id=p.id;
 eid:=vnext_market.hash(jsonb_build_object('schema','DAILY_AI_MARKET_EDITION_V2','plan_hash',p.id,'results_hash',result_hash,
  'expires_at',vnext_market.iso(p_expires_at),'analysis_origin','DETERMINISTIC_SCREENING','method_version','TAIWAN_MARKET_RESEARCH_V1'));
 insert into vnext_market.editions(id,plan_id,universe_id,business_date,cutoff,prepared_at,expires_at,results_hash,analysis_origin,method_version)
 values(eid,p.id,p.universe_id,p.business_date,p.cutoff,at_time,p_expires_at,result_hash,'DETERMINISTIC_SCREENING','TAIWAN_MARKET_RESEARCH_V1');
 insert into vnext_market.edition_sources(edition_id,source_url) select eid,source_url from vnext_market.plan_sources where plan_id=p.id;
 return jsonb_build_object('schema','DAILY_AI_MARKET_EDITION_STAGED_V2','edition_id',eid,'plan_hash',p.id,'replayed',false,'review_required',true,'member_published',false);
end $$;

create function vnext_market.rights_ready(p_edition_id text,p_now timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select from vnext_market.edition_sources where edition_id=p_edition_id)
 and not exists(select from vnext_market.edition_sources s where s.edition_id=p_edition_id and not exists(
  select from vnext_private.source_licenses l where l.source=s.source_url and l.storage_allowed and l.derived_allowed and l.commercial_allowed
   and l.reviewed_at<=p_now and (l.expires_at is null or l.expires_at>p_now) and l.document_url like 'https://%' and length(btrim(l.attribution))>0))
$$;

-- A separate reviewer must import four actual documents. No worker entrypoint
-- calls this function, creates PASS statuses or grants source-use rights.
create function public.stage_daily_ai_market_review_v2(p_review_text text,p_review_hash text,p_documents jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;e vnext_market.editions;prior vnext_market.reviews;d jsonb;doc_keys text[]:='{}';review_id uuid;
begin
 if p_review_text is null or octet_length(p_review_text) not between 2 and 20000 or p_review_hash is distinct from vnext_market.digest(p_review_text)
  or jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents)<>4
  or octet_length(p_documents::text)>1000000 then raise exception 'MARKET_REVIEW_SCOPE';end if;
 r:=p_review_text::jsonb;
 if not coalesce(vnext_market.exact(r,array['schema','edition_id','snapshot_hash','reviewer_ref','quality','time_status','licensing','methodology','document_hashes','reason','expires_at']),false)
  or r->>'schema' is distinct from 'DAILY_AI_MARKET_REVIEW_V2' or r->>'edition_id' is distinct from r->>'snapshot_hash'
  or length(btrim(coalesce(r->>'reviewer_ref',''))) not between 1 and 200
  or r->>'reviewer_ref' in('TAIWAN_MARKET_RESEARCH_V1','DETERMINISTIC_SCREENING')
  or coalesce(r->>'quality','') not in('PASS','FAIL','PENDING') or coalesce(r->>'time_status','') not in('PASS','FAIL','PENDING')
  or coalesce(r->>'licensing','') not in('PASS','FAIL','PENDING') or coalesce(r->>'methodology','') not in('PASS','FAIL','PENDING')
  or length(btrim(coalesce(r->>'reason',''))) not between 1 and 3000
  or not coalesce(vnext_market.exact(r->'document_hashes',array['QUALITY','TIME','SOURCE_USE','METHODOLOGY']),false)
  then raise exception 'MARKET_REVIEW_CONTRACT';end if;
 select * into strict e from vnext_market.editions where id=r->>'edition_id';
 perform pg_advisory_xact_lock(hashtextextended('market-review:'||e.id,0));
 select * into prior from vnext_market.reviews where review_hash=p_review_hash;
 if found then
  if prior.review_text is distinct from p_review_text or prior.documents is distinct from p_documents then raise exception 'MARKET_REVIEW_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_REVIEW_STAGED_V2','edition_id',e.id,'review_id',prior.id,'replayed',true,'member_published',false);
 end if;
 if (r->>'expires_at')::timestamptz<=clock_timestamp() or (r->>'expires_at')::timestamptz>e.expires_at then raise exception 'MARKET_REVIEW_EXPIRED';end if;
 for d in select * from jsonb_array_elements(p_documents) loop
  if not coalesce(vnext_market.exact(d,array['kind','text','hash']),false) or coalesce(d->>'kind','') not in('QUALITY','TIME','SOURCE_USE','METHODOLOGY')
   or jsonb_typeof(d->'text') is distinct from 'string' or coalesce(d->>'hash','')!~'^[a-f0-9]{64}$'
   or d->>'kind'=any(doc_keys) or octet_length(d->>'text') not between 20 and 200000
   or d->>'hash' is distinct from vnext_market.digest(d->>'text') or d->>'hash' is distinct from r->'document_hashes'->>(d->>'kind')
   then raise exception 'MARKET_REVIEW_DOCUMENT';end if;
  doc_keys:=array_append(doc_keys,d->>'kind');
 end loop;
 insert into vnext_market.reviews(edition_id,review_hash,review_text,reviewer_ref,quality,time_status,licensing,methodology,documents,expires_at)
 values(e.id,p_review_hash,p_review_text,r->>'reviewer_ref',r->>'quality',r->>'time_status',r->>'licensing',r->>'methodology',p_documents,(r->>'expires_at')::timestamptz)
 returning id into review_id;
 return jsonb_build_object('schema','DAILY_AI_MARKET_REVIEW_STAGED_V2','edition_id',e.id,'review_id',review_id,'replayed',false,'member_published',false);
end $$;

create function public.review_daily_ai_market_edition_v2(p_edition_id text,p_review_id uuid,p_action text,p_audience text,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e vnext_market.editions;r vnext_market.reviews;prior vnext_market.publication_events;event_id bigint;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' or not public.is_research_owner_v1()
  then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if p_request_key is null or p_review_id is null or coalesce(p_action,'') not in('APPROVE','REVOKE') or coalesce(p_audience,'') not in('free','premium')
  then raise exception 'MARKET_PUBLICATION_SCOPE';end if;
 perform pg_advisory_xact_lock(hashtextextended('market-review:'||p_edition_id,0));
 select * into prior from vnext_market.publication_events where request_key=p_request_key;
 if found then
  if prior.edition_id is distinct from p_edition_id or prior.review_id is distinct from p_review_id or prior.actor is distinct from auth.uid()
   or prior.action is distinct from p_action or prior.audience is distinct from p_audience then raise exception 'MARKET_PUBLICATION_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_PUBLICATION_V2','edition_id',prior.edition_id,'event_id',prior.id,'action',prior.action,'replayed',true);
 end if;
 select * into strict e from vnext_market.editions where id=p_edition_id;
 select * into strict r from vnext_market.reviews where edition_id=e.id order by sequence desc limit 1;
 if r.id is distinct from p_review_id then raise exception 'MARKET_REVIEW_SUPERSEDED';end if;
 if p_action='APPROVE' and (e.expires_at<=now() or e.prepared_at>now() or r.expires_at<=now()
  or r.quality<>'PASS' or r.time_status<>'PASS' or r.licensing<>'PASS' or r.methodology<>'PASS'
  or not vnext_market.rights_ready(e.id,now())) then raise exception 'MARKET_PUBLICATION_NOT_READY';end if;
 insert into vnext_market.publication_events(request_key,edition_id,review_id,actor,action,audience)
 values(p_request_key,e.id,r.id,auth.uid(),p_action,p_audience) returning id into event_id;
 return jsonb_build_object('schema','DAILY_AI_MARKET_PUBLICATION_V2','edition_id',e.id,'event_id',event_id,'action',p_action,'replayed',false);
end $$;

create function public.get_daily_ai_owner_market_page_v2(p_edition_id text,p_offset integer default 0,p_limit integer default 60)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e vnext_market.editions;r vnext_market.reviews;a vnext_market.publication_events;cards jsonb;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' or not public.is_research_owner_v1()
  then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if p_offset is null or p_offset<0 or p_offset>30000 or p_limit is null or p_limit not between 1 and 60 then raise exception 'MARKET_OWNER_PAGE_SCOPE';end if;
 select * into strict e from vnext_market.editions where id=p_edition_id;
 select * into r from vnext_market.reviews where edition_id=e.id order by sequence desc limit 1;
 select * into a from vnext_market.publication_events where edition_id=e.id order by id desc limit 1;
 select coalesce(jsonb_agg(x.card order by x.security_id,x.horizon),'[]') into cards from(
  select * from vnext_market.cards where plan_id=e.plan_id order by security_id,horizon offset p_offset limit p_limit)x;
 return jsonb_build_object('schema','VNEXT_AI_OWNER_MARKET_PAGE_V2','subject_user_id',auth.uid(),'preview_only',true,'research_only',true,
  'edition',jsonb_build_object('id',e.id,'plan_hash',e.plan_id,'edition_date',e.business_date,'evidence_cutoff',vnext_market.iso(e.cutoff),
   'prepared_at',vnext_market.iso(e.prepared_at),'expires_at',vnext_market.iso(e.expires_at),'analysis_origin',e.analysis_origin,
   'method_version',e.method_version,'mode','AS_OF_RESEARCH','forecast',false,'performance_available',false),
  'cards',cards,'total',(select count(*) from vnext_market.cards where plan_id=e.plan_id),'start',p_offset,
  'review',case when r.id is null then null else jsonb_build_object('id',r.id,'review_hash',r.review_hash,'review',r.review_text::jsonb)end,
  'publication',case when a.id is null then null else jsonb_build_object('id',a.id,'action',a.action,'review_id',a.review_id,'audience',a.audience)end,
  'rights_ready',vnext_market.rights_ready(e.id,now()));
end $$;

create function public.get_daily_ai_owner_market_input_v2(p_edition_id text,p_security_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e vnext_market.editions;r vnext_market.stock_results;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' or not public.is_research_owner_v1()
  then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 select * into strict e from vnext_market.editions where id=p_edition_id;
 select * into strict r from vnext_market.stock_results where plan_id=e.plan_id and security_id=p_security_id;
 return jsonb_build_object('schema','VNEXT_AI_OWNER_MARKET_INPUT_V2','subject_user_id',auth.uid(),'edition_id',e.id,'security_id',r.security_id,
  'preview_only',true,'research_only',true,'packet_text',r.packet_text,'packet_hash',r.packet_hash,'analysis_text',r.analysis_text,'analysis_hash',r.analysis_hash);
end $$;

create function public.get_daily_ai_member_market_page_v2(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tier text;subject uuid:=auth.uid();at_time timestamptz:=now();business_date date:=(now() at time zone 'Asia/Taipei')::date;
 q jsonb;cursor_value jsonb;known jsonb;qh text;e vnext_market.editions;u vnext_market.universes;
 edition_json jsonb:=null;revision text;price_revision text;publication_id bigint;review_id uuid;review_sequence bigint;
 universe_json jsonb;counts jsonb;by_status jsonb;available_total integer:=0;matching_total integer:=0;
 free_ids text[];market_rows jsonb;selected_cards jsonb:='[]';page_start integer:=0;page_returned integer:=0;
 next_cursor jsonb:=null;has_more boolean:=false;last_card jsonb;after_status integer;after_market integer;after_symbol text;
 actual_seen integer;response jsonb;known_matches boolean:=false;page_size integer;
begin
 tier:=academy_private.access_v11();
 if subject is null or coalesce(tier,'') not in('free','premium','owner') then raise exception 'MEMBER_REQUIRED' using errcode='42501';end if;
 if p_request is null or octet_length(p_request::text)>20000
  or not coalesce(vnext_market.exact(p_request,array['schema','query','query_hash','cursor','known']),false)
  or p_request->>'schema' is distinct from 'VNEXT_AI_MARKET_PAGE_REQUEST_V2'
  then raise exception 'AI_MARKET_PAGE_V2_CONTRACT';end if;
 q:=p_request->'query';cursor_value:=nullif(p_request->'cursor','null'::jsonb);known:=nullif(p_request->'known','null'::jsonb);
 if not coalesce(vnext_market.exact(q,array['horizon','market','status','search','sort','page_size']),false)
  or coalesce(q->>'horizon','') not in('SHORT','MEDIUM','LONG') or coalesce(q->>'market','') not in('ALL','TWSE','TPEX','EMERGING')
  or coalesce(q->>'status','') not in('ALL','WATCH','WAIT','AVOID','INSUFFICIENT') or q->>'sort' is distinct from 'STATUS_MARKET_SYMBOL_ASC'
  or jsonb_typeof(q->'search') is distinct from 'string' or length(q->>'search')>80 or q->>'search'<>btrim(q->>'search')
  or q->>'search'~'[[:cntrl:]]' or jsonb_typeof(q->'page_size') is distinct from 'number'
  or (q->>'page_size')::numeric<>trunc((q->>'page_size')::numeric) or (q->>'page_size')::numeric not between 1 and 60
  then raise exception 'AI_MARKET_PAGE_V2_QUERY';end if;
 page_size:=(q->>'page_size')::integer;qh:=vnext_market.hash(q);
 if p_request->>'query_hash' is distinct from qh then raise exception 'AI_MARKET_PAGE_V2_QUERY';end if;
 if known is not null and (not coalesce(vnext_market.exact(known,array['edition_id','research_revision','price_revision']),false)
  or exists(select from jsonb_each_text(known)t where coalesce(t.value,'')!~'^[a-f0-9]{64}$')) then raise exception 'AI_MARKET_PAGE_V2_CONTRACT';end if;
 select x.* into e from vnext_market.editions x
 join lateral(select * from vnext_market.publication_events a where a.edition_id=x.id order by a.id desc limit 1)a on true
 join lateral(select * from vnext_market.reviews r where r.edition_id=x.id order by r.sequence desc limit 1)r on true
 where a.action='APPROVE' and a.review_id=r.id and r.quality='PASS' and r.time_status='PASS' and r.licensing='PASS' and r.methodology='PASS'
  and x.expires_at>at_time and x.prepared_at<=at_time and r.expires_at>at_time
  and (tier<>'free' or a.audience='free') and vnext_market.rights_ready(x.id,at_time)
 order by x.prepared_at desc,x.id limit 1;
 if e.id is not null then
  select a.id,r.id,r.sequence into publication_id,review_id,review_sequence
   from vnext_market.publication_events a join vnext_market.reviews r on r.id=a.review_id where a.edition_id=e.id order by a.id desc limit 1;
  select * into strict u from vnext_market.universes where id=e.universe_id;
  edition_json:=jsonb_build_object('id',e.id,'edition_date',e.business_date,'evidence_cutoff',vnext_market.iso(e.cutoff),
   'prepared_at',vnext_market.iso(e.prepared_at),'expires_at',vnext_market.iso(e.expires_at),'analysis_origin',e.analysis_origin,
   'mode','AS_OF_RESEARCH','forecast',false,'performance_available',false);
  revision:=vnext_market.hash(jsonb_build_object('edition_id',e.id,'publication_id',publication_id,'review_id',review_id,'review_sequence',review_sequence));
  -- V2 prices have no publication path in this research-only rollout. The
  -- explicit revision prevents mixing a V1 edition's separately gated prices.
  price_revision:=vnext_market.hash(jsonb_build_object('schema','NO_PUBLISHED_V2_PRICE_PLANS_V1','edition_id',e.id));
  known_matches:=known->>'edition_id'=e.id and known->>'research_revision'=revision and known->>'price_revision'=price_revision;
  if tier='free' then select array_agg(x.security_id) into free_ids from(
   select security_id from vnext_market.companies where universe_id=u.id order by symbol collate "C",market limit 3)x;end if;
 else
  select * into u from vnext_market.universes order by formed_at desc,id limit 1;
 end if;
 if cursor_value is not null then
  if not coalesce(vnext_market.exact(cursor_value,array['schema','edition_id','research_revision','price_revision','subject_user_id','tier','business_date','query_hash','position','expires_at','binding_hash']),false)
   or cursor_value->>'schema' is distinct from 'VNEXT_AI_MARKET_CURSOR_V2'
   or cursor_value->>'binding_hash' is distinct from vnext_market.hash(cursor_value-'binding_hash')
   or not coalesce(vnext_market.exact(cursor_value->'position',array['seen','after']),false)
   or jsonb_typeof(cursor_value->'position'->'seen') is distinct from 'number'
   or not coalesce(vnext_market.exact(cursor_value->'position'->'after',array['status','market','symbol']),false)
   then raise exception 'AI_MARKET_PAGE_V2_CURSOR';end if;
  if e.id is null or cursor_value->>'edition_id' is distinct from e.id or cursor_value->>'research_revision' is distinct from revision
   or cursor_value->>'price_revision' is distinct from price_revision or cursor_value->>'subject_user_id' is distinct from subject::text
   or cursor_value->>'tier' is distinct from tier or cursor_value->>'business_date' is distinct from business_date::text
   or cursor_value->>'query_hash' is distinct from qh or (cursor_value->>'expires_at')::timestamptz is distinct from e.expires_at
   or (cursor_value->>'expires_at')::timestamptz<=at_time then raise exception 'AI_MARKET_PAGE_V2_CURSOR_STALE';end if;
  page_start:=(cursor_value->'position'->>'seen')::integer;
  after_status:=array_position(array['WATCH','WAIT','AVOID','INSUFFICIENT'],cursor_value->'position'->'after'->>'status')-1;
  after_market:=array_position(array['TWSE','TPEX','EMERGING'],cursor_value->'position'->'after'->>'market')-1;
  after_symbol:=cursor_value->'position'->'after'->>'symbol';
  if page_start is null or page_start<1 or after_status is null or after_market is null or coalesce(after_symbol,'')!~'^[0-9]{4,6}$'
   then raise exception 'AI_MARKET_PAGE_V2_CURSOR';end if;
 end if;
 if e.id is not null then
  select count(*) into available_total from vnext_market.cards c where c.plan_id=e.plan_id and c.horizon=q->>'horizon'
   and (tier<>'free' or c.security_id=any(free_ids)) and (q->>'market'='ALL' or c.market=q->>'market');
  select jsonb_build_object('WATCH',count(*) filter(where status='WATCH'),'WAIT',count(*) filter(where status='WAIT'),
   'AVOID',count(*) filter(where status='AVOID'),'INSUFFICIENT',count(*) filter(where status='INSUFFICIENT')) into by_status
   from vnext_market.cards c where c.plan_id=e.plan_id and c.horizon=q->>'horizon' and (tier<>'free' or c.security_id=any(free_ids))
   and (q->>'market'='ALL' or c.market=q->>'market') and strpos(lower(c.symbol||' '||c.company),lower(q->>'search'))>0;
  matching_total:=case when q->>'status'='ALL' then (select sum(value::integer) from jsonb_each_text(by_status)) else (by_status->>(q->>'status'))::integer end;
  if cursor_value is not null then
   select count(*) into actual_seen from vnext_market.cards c where c.plan_id=e.plan_id and c.horizon=q->>'horizon'
    and (tier<>'free' or c.security_id=any(free_ids)) and (q->>'market'='ALL' or c.market=q->>'market')
    and (q->>'status'='ALL' or c.status=q->>'status') and strpos(lower(c.symbol||' '||c.company),lower(q->>'search'))>0
    and (c.status_rank,c.market_rank,c.symbol collate "C")<=(after_status,after_market,after_symbol collate "C");
   if actual_seen<>page_start or page_start>=matching_total then raise exception 'AI_MARKET_PAGE_V2_CURSOR';end if;
  end if;
  select coalesce(jsonb_agg(case when coalesce(known_matches,false) then jsonb_build_object('status',x.status,'market',x.market,'symbol',x.symbol)
   when tier='free' then x.card||jsonb_build_object('sources',null,'counter_evidence',null,'price',null) else x.card end
   order by x.status_rank,x.market_rank,x.symbol collate "C"),'[]') into selected_cards from(
   select * from vnext_market.cards c where c.plan_id=e.plan_id and c.horizon=q->>'horizon' and (tier<>'free' or c.security_id=any(free_ids))
    and (q->>'market'='ALL' or c.market=q->>'market') and (q->>'status'='ALL' or c.status=q->>'status')
    and strpos(lower(c.symbol||' '||c.company),lower(q->>'search'))>0
    and (cursor_value is null or (c.status_rank,c.market_rank,c.symbol collate "C")>(after_status,after_market,after_symbol collate "C"))
    order by c.status_rank,c.market_rank,c.symbol collate "C" limit page_size)x;
  page_returned:=jsonb_array_length(selected_cards);has_more:=page_start+page_returned<matching_total;
  if has_more then
   last_card:=selected_cards->(page_returned-1);
   next_cursor:=jsonb_build_object('schema','VNEXT_AI_MARKET_CURSOR_V2','edition_id',e.id,'research_revision',revision,'price_revision',price_revision,
    'subject_user_id',subject,'tier',tier,'business_date',business_date,'query_hash',qh,
    'position',jsonb_build_object('seen',page_start+page_returned,'after',jsonb_build_object('status',last_card->>'status','market',last_card->>'market','symbol',last_card->>'symbol')),
    'expires_at',vnext_market.iso(e.expires_at));
   next_cursor:=next_cursor||jsonb_build_object('binding_hash',vnext_market.hash(next_cursor));
  end if;
 end if;
 if by_status is null then by_status:='{"WATCH":0,"WAIT":0,"AVOID":0,"INSUFFICIENT":0}';end if;
 select jsonb_agg(jsonb_build_object('market',m.market,'universe_count',case when u.id is null then null else (u.body->'counts'->>m.market)::integer end,
  'published_count',coalesce(c.total,0),'coverage',case when u.id is null then 'UNKNOWN' when coalesce(c.total,0)=(u.body->'counts'->>m.market)::integer then 'COMPLETE' else 'PARTIAL' end,
  'roster_as_of',(select s->>'source_as_of' from jsonb_array_elements(coalesce(u.body->'sources','[]'))s where s->>'market'=m.market),
  'data_as_of',jsonb_build_object('price_date',c.price_date,'financial_available_at',case when c.financial_at is null then null else vnext_market.iso(c.financial_at)end,
   'news_available_at',case when c.news_at is null then null else vnext_market.iso(c.news_at)end)) order by m.rank) into market_rows
 from(values('TWSE',0),('TPEX',1),('EMERGING',2))m(market,rank)
 left join lateral(select count(*) total,max(price_date) price_date,max(financial_available_at) financial_at,max(news_available_at) news_at
  from vnext_market.cards c where c.plan_id=e.plan_id and c.horizon=q->>'horizon' and c.market=m.market and (tier<>'free' or c.security_id=any(free_ids)))c on true;
 universe_json:=jsonb_build_object('snapshot_id',coalesce(u.id,vnext_market.hash(jsonb_build_object('schema','EMPTY_UNIVERSE_V2','business_date',business_date))),
  'snapshot_date',coalesce(u.snapshot_date,business_date),'markets',market_rows);
 counts:=jsonb_build_object('available_total',available_total,'matching_total',matching_total,'by_status',by_status);
 known_matches:=e.id is not null and known->>'edition_id'=e.id and known->>'research_revision'=revision and known->>'price_revision'=price_revision;
 response:=jsonb_build_object('schema','VNEXT_AI_MARKET_PAGE_V2','mode',case when coalesce(known_matches,false) then 'UNCHANGED' else 'FULL' end,
  'subject_user_id',subject,'tier',tier,'business_date',business_date,'research_only',true,'checked_at',vnext_market.iso(at_time),'query',q,'query_hash',qh,
  'edition',edition_json,'research_revision',revision,'price_revision',price_revision,'universe',universe_json,'counts',counts,
  'page',jsonb_build_object('start',page_start,'returned',page_returned,'has_more',has_more,'next_cursor',next_cursor));
 if not coalesce(known_matches,false) then response:=response||jsonb_build_object('cards',selected_cards);end if;
 return response;
end $$;

create function vnext_market.seal_completed_shard() returns trigger language plpgsql set search_path='' as $$
begin if old.state='COMPLETE' then raise exception 'MARKET_COMPLETED_SHARD_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;end $$;
create trigger completed_shard_seal before update or delete on vnext_market.shards
 for each row execute function vnext_market.seal_completed_shard();

-- The latest-dataset allowlist is frozen from the reviewed official catalog.
create function vnext_market.source_allowed(p_source_id text,p_url text,p_format text) returns boolean
language plpgsql immutable set search_path='' as $$
declare raw_date text;d date;expected text;begin
 if exists(select from(values
  ('twse_prices','https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL','json'),
  ('tpex_prices','https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes','json'),
  ('emerging_prices','https://www.tpex.org.tw/openapi/v1/tpex_esb_latest_statistics','json'),
  ('twse_revenue','https://openapi.twse.com.tw/v1/opendata/t187ap05_L','json'),
  ('tpex_revenue','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O','json'),
  ('emerging_revenue','https://www.tpex.org.tw/openapi/v1/t187ap05_R','json'),
  ('twse_valuation','https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d','json'),
  ('tpex_valuation','https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis','json'),
  ('twse_actions_announced','https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL','json'),
  ('tpex_actions_daily','https://www.tpex.org.tw/openapi/v1/tpex_exright_daily','json'),
  ('tpex_actions_announced','https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost','json'),
  ('twse_announcements','https://openapi.twse.com.tw/v1/opendata/t187ap04_L','json'),
  ('tpex_announcements','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O','json'),
  ('twse_eps_as_reported','https://openapi.twse.com.tw/v1/opendata/t187ap14_L','json'),
  ('tpex_eps_as_reported','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O','json'),
  ('emerging_eps_as_reported','https://www.tpex.org.tw/openapi/v1/tpex_esb_eps_rank','json'),
  ('twse_income_ci','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci','json'),
  ('twse_income_basi','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_basi','json'),
  ('twse_income_fh','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh','json'),
  ('twse_income_ins','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ins','json'),
  ('twse_income_bd','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_bd','json'),
  ('twse_income_mim','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_mim','json'),
  ('twse_balance_ci','https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci','json'),
  ('twse_balance_basi','https://openapi.twse.com.tw/v1/opendata/t187ap07_L_basi','json'),
  ('twse_balance_fh','https://openapi.twse.com.tw/v1/opendata/t187ap07_L_fh','json'),
  ('twse_balance_ins','https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ins','json'),
  ('twse_balance_bd','https://openapi.twse.com.tw/v1/opendata/t187ap07_L_bd','json'),
  ('twse_balance_mim','https://openapi.twse.com.tw/v1/opendata/t187ap07_L_mim','json'),
  ('tpex_income_ci','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_ci','json'),
  ('tpex_income_basi','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_basi','json'),
  ('tpex_income_fh','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_fh','json'),
  ('tpex_income_ins','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_ins','json'),
  ('tpex_income_bd','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_bd','json'),
  ('tpex_income_mim','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_mim','json'),
  ('tpex_balance_ci','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_ci','json'),
  ('tpex_balance_basi','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_basi','json'),
  ('tpex_balance_fh','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_fh','json'),
  ('tpex_balance_ins','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_ins','json'),
  ('tpex_balance_bd','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_bd','json'),
  ('tpex_balance_mim','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_mim','json'),
  ('emerging_income_ci','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_U_ci','json'),
  ('emerging_income_basi','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_U_basi','json'),
  ('emerging_income_fh','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_U_fh','json'),
  ('emerging_income_ins','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_U_ins','json'),
  ('emerging_income_bd','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_U_bd','json'),
  ('emerging_income_mim','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_U_mim','json'),
  ('emerging_balance_ci','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_U_ci','json'),
  ('emerging_balance_basi','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_U_basi','json'),
  ('emerging_balance_fh','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_U_fh','json'),
  ('emerging_balance_ins','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_U_ins','json'),
  ('emerging_balance_bd','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_U_bd','json'),
  ('emerging_balance_mim','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_U_mim','json'),
  ('twse_companies','https://openapi.twse.com.tw/v1/opendata/t187ap03_L','json'),
  ('tpex_companies','https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv','csv'),
  ('emerging_companies','https://mopsfin.twse.com.tw/opendata/t187ap03_R.csv','csv')
 )s(id,url,format) where s.id=p_source_id and s.url=p_url and s.format=p_format) then return true;end if;
 if p_format is distinct from 'json' or coalesce(p_source_id,'')!~'^(TWSE|TPEX)_DAILY_[0-9]{8}$' then return false;end if;
 raw_date:=right(p_source_id,8);d:=to_date(raw_date,'YYYYMMDD');
 if to_char(d,'YYYYMMDD')<>raw_date then return false;end if;
 expected:=case when p_source_id like 'TWSE_%' then
  'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date='||raw_date||'&type=ALLBUT0999&response=json'
 else 'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date='||to_char(d,'YYYY/MM/DD')||'&response=json' end;
 return p_url=expected;
end $$;


do $$declare item record;begin
 for item in select tablename from pg_tables where schemaname='vnext_market' loop
  execute format('alter table vnext_market.%I enable row level security',item.tablename);
  execute format('alter table vnext_market.%I force row level security',item.tablename);
  execute format('revoke all on vnext_market.%I from public,anon,authenticated,service_role',item.tablename);
  if item.tablename<>'shards' then execute format('create trigger immutable before update or delete on vnext_market.%I for each row execute function vnext_market.immutable()',item.tablename);end if;
 end loop;
end $$;
revoke all on all sequences in schema vnext_market from public,anon,authenticated,service_role;
revoke all on all functions in schema vnext_market from public,anon,authenticated,service_role;
revoke all on function public.stage_daily_ai_market_capture_v2(text,text,text),public.stage_daily_ai_market_work_plan_v2(text,text),
 public.claim_daily_ai_market_shard_v2(text,text,uuid),public.stage_daily_ai_market_shard_v2(text,text,uuid,text,text),
 public.finish_daily_ai_market_edition_v2(text,timestamptz),public.stage_daily_ai_market_review_v2(text,text,jsonb),
 public.review_daily_ai_market_edition_v2(text,uuid,text,text,uuid),public.get_daily_ai_owner_market_page_v2(text,integer,integer),
 public.get_daily_ai_owner_market_input_v2(text,text),public.get_daily_ai_member_market_page_v2(jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_market_capture_v2(text,text,text),public.stage_daily_ai_market_work_plan_v2(text,text),
 public.claim_daily_ai_market_shard_v2(text,text,uuid),public.stage_daily_ai_market_shard_v2(text,text,uuid,text,text),
 public.finish_daily_ai_market_edition_v2(text,timestamptz),public.stage_daily_ai_market_review_v2(text,text,jsonb) to service_role;
grant execute on function public.review_daily_ai_market_edition_v2(text,uuid,text,text,uuid),public.get_daily_ai_owner_market_page_v2(text,integer,integer),
 public.get_daily_ai_owner_market_input_v2(text,text),public.get_daily_ai_member_market_page_v2(jsonb) to authenticated;
commit;
