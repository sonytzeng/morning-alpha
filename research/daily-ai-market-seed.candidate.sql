-- Private, immutable bootstrap archive. No public member data, license,
-- recommendation, review or publication is created by seed transport.
-- SQL verifies exact archive bytes and ZIP directory structure. The Node
-- bootstrap additionally inflates each entry and checks its size/CRC before
-- atomically installing the cache. No endpoint lists or selects a latest seed.
begin;
do $$begin
 if to_regprocedure('vnext_market.hash(jsonb)')is null or to_regclass('vnext_market.worker_seeds')is not null
  then raise exception 'MARKET_SEED_PREREQUISITES';end if;
end $$;
create table vnext_market.worker_seeds(
 seed_id text primary key check(seed_id~'^[a-f0-9]{64}$'),manifest_hash text not null,
 manifest_text text not null check(octet_length(manifest_text)<=100000 and manifest_hash=vnext_market.digest(manifest_text)),
 manifest jsonb not null check(manifest=manifest_text::jsonb),archive_bytes integer not null check(archive_bytes between 22 and 268435456),
 chunk_count integer not null check(chunk_count between 1 and 256),entry_count integer not null check(entry_count between 2 and 20000),
 uncompressed_bytes bigint not null check(uncompressed_bytes between 2 and 1073741824),stored_at timestamptz not null default clock_timestamp()
);
create table vnext_market.worker_seed_chunks(
 seed_id text not null references vnext_market.worker_seeds(seed_id),chunk_index integer not null check(chunk_index between 0 and 255),
 chunk_sha256 text not null check(chunk_sha256~'^[a-f0-9]{64}$'),chunk_bytes bytea not null check(octet_length(chunk_bytes)between 1 and 1048576),
 stored_at timestamptz not null default clock_timestamp(),primary key(seed_id,chunk_index),check(chunk_sha256=encode(sha256(chunk_bytes),'hex'))
);
create table vnext_market.worker_seed_completions(
 seed_id text primary key references vnext_market.worker_seeds(seed_id),manifest_hash text not null,
 archive_sha256 text not null check(archive_sha256=seed_id),archive_bytes integer not null,chunk_count integer not null,
 entry_count integer not null,uncompressed_bytes bigint not null,completed_at timestamptz not null default clock_timestamp()
);

create function vnext_market.seed_u16(b bytea,p integer)returns integer language sql immutable set search_path=''as $$
 select get_byte(b,p)+get_byte(b,p+1)*256
$$;
create function vnext_market.seed_u32(b bytea,p integer)returns bigint language sql immutable set search_path=''as $$
 select get_byte(b,p)::bigint+get_byte(b,p+1)::bigint*256+get_byte(b,p+2)::bigint*65536+get_byte(b,p+3)::bigint*16777216
$$;
create function vnext_market.validate_seed_zip_v2(b bytea,expected_count integer,expected_size bigint)returns void
language plpgsql immutable set search_path=''as $$
declare n integer:=octet_length(b);eocd integer:=n-22;cd integer;cd_size integer;pos integer;local_pos integer:=0;i integer;
 flags integer;method integer;name_length integer;compressed bigint;expanded bigint;sum_expanded bigint:=0;external bigint;mode integer;
 name text;name_bytes bytea;names text[]:='{}';dirs boolean;state_found boolean:=false;latest_found boolean:=false;
begin
 if n<22 or vnext_market.seed_u32(b,eocd)<>101010256 or vnext_market.seed_u16(b,eocd+4)<>0 or vnext_market.seed_u16(b,eocd+6)<>0
  or vnext_market.seed_u16(b,eocd+20)<>0 or vnext_market.seed_u16(b,eocd+8)<>expected_count
  or vnext_market.seed_u16(b,eocd+10)<>expected_count then raise exception 'MARKET_SEED_ZIP_DIRECTORY';end if;
 cd:=vnext_market.seed_u32(b,eocd+16)::integer;cd_size:=vnext_market.seed_u32(b,eocd+12)::integer;
 if cd<0 or cd_size<46 or cd::bigint+cd_size<>eocd then raise exception 'MARKET_SEED_ZIP_DIRECTORY';end if;
 pos:=cd;
 for i in 1..expected_count loop
  if pos+46>eocd or vnext_market.seed_u32(b,pos)<>33639248 then raise exception 'MARKET_SEED_ZIP_ENTRY';end if;
  flags:=vnext_market.seed_u16(b,pos+8);method:=vnext_market.seed_u16(b,pos+10);name_length:=vnext_market.seed_u16(b,pos+28);
  compressed:=vnext_market.seed_u32(b,pos+20);expanded:=vnext_market.seed_u32(b,pos+24);external:=vnext_market.seed_u32(b,pos+38);mode:=((external>>16)&61440)::integer;
  if flags not in(0,2048)or method not in(0,8)or name_length not between 1 and 1024 or pos+46+name_length>eocd
   or vnext_market.seed_u16(b,pos+6)not in(10,20)or vnext_market.seed_u16(b,pos+30)<>0 or vnext_market.seed_u16(b,pos+32)<>0
   or vnext_market.seed_u16(b,pos+34)<>0 or expanded>268435456 or compressed>268435456
   or vnext_market.seed_u32(b,pos+42)<>local_pos then raise exception 'MARKET_SEED_ZIP_UNSUPPORTED';end if;
  name_bytes:=substring(b from pos+47 for name_length);name:=convert_from(name_bytes,'UTF8');dirs:=right(name,1)='/';
  if left(name,12)<>'input-cache/' or name~'[[:cntrl:]:\\]' or name~'(^|/)\.{1,2}(/|$)' or name like '%//%'
   or(flags=0 and octet_length(name)<>length(name))or lower(name)=any(names)
   or(name='input-cache/' and not dirs)or(mode not in(0,16384,32768))
   or(dirs and(mode not in(0,16384)or expanded<>0 or compressed<>0 or method<>0))or(not dirs and mode=16384)
   or name='input-cache/input-update.lock.json' then raise exception 'MARKET_SEED_ZIP_PATH';end if;
  names:=array_append(names,lower(name));
  if name='input-cache/cache-state.json' and not dirs then state_found:=true;end if;
  if name='input-cache/latest.json' and not dirs then latest_found:=true;end if;
  if local_pos+30+name_length>cd or vnext_market.seed_u32(b,local_pos)<>67324752
   or vnext_market.seed_u16(b,local_pos+4)<>vnext_market.seed_u16(b,pos+6)
   or vnext_market.seed_u16(b,local_pos+6)<>flags or vnext_market.seed_u16(b,local_pos+8)<>method
   or vnext_market.seed_u32(b,local_pos+10)<>vnext_market.seed_u32(b,pos+12)
   or vnext_market.seed_u32(b,local_pos+14)<>vnext_market.seed_u32(b,pos+16)
   or vnext_market.seed_u32(b,local_pos+18)<>compressed or vnext_market.seed_u32(b,local_pos+22)<>expanded
   or vnext_market.seed_u16(b,local_pos+26)<>name_length or vnext_market.seed_u16(b,local_pos+28)<>0
   or substring(b from local_pos+31 for name_length)<>name_bytes or local_pos::bigint+30+name_length+compressed>cd
   or(method=0 and compressed<>expanded)then raise exception 'MARKET_SEED_ZIP_LOCAL_BINDING';end if;
  sum_expanded:=sum_expanded+expanded;if sum_expanded>1073741824 then raise exception 'MARKET_SEED_ZIP_SIZE';end if;
  local_pos:=(local_pos::bigint+30+name_length+compressed)::integer;pos:=pos+46+name_length;
 end loop;
 if pos<>eocd or local_pos<>cd or sum_expanded<>expected_size or not state_found or not latest_found
  then raise exception 'MARKET_SEED_ZIP_TOTALS';end if;
end $$;

create function public.stage_daily_ai_market_worker_seed_v2(p_manifest_text text,p_manifest_hash text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m jsonb;prior vnext_market.worker_seeds;c jsonb;idx integer:=0;size integer;total integer;bytes integer;
begin
 if p_manifest_text is null or octet_length(p_manifest_text)not between 2 and 100000 or p_manifest_hash is distinct from vnext_market.digest(p_manifest_text)
  then raise exception 'MARKET_SEED_MANIFEST_HASH';end if;
 m:=p_manifest_text::jsonb;
 if not coalesce(vnext_market.exact(m,array['schema','seed_id','format','archive_sha256','archive_bytes','chunk_bytes','chunk_count','chunks','entry_count','uncompressed_bytes','root_directory','cache_state_sha256','latest_manifest_sha256','created_at']),false)
  or m->>'schema'is distinct from'DAILY_AI_MARKET_PRIVATE_SEED_V1'or m->>'format'is distinct from'ZIP'or m->>'root_directory'is distinct from'input-cache'
  or coalesce(m->>'seed_id','')!~'^[a-f0-9]{64}$'or m->>'archive_sha256'is distinct from m->>'seed_id'
  or coalesce(m->>'cache_state_sha256','')!~'^[a-f0-9]{64}$'or coalesce(m->>'latest_manifest_sha256','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(m->'seed_id')is distinct from'string'or jsonb_typeof(m->'archive_sha256')is distinct from'string'
  or jsonb_typeof(m->'cache_state_sha256')is distinct from'string'or jsonb_typeof(m->'latest_manifest_sha256')is distinct from'string'
  or jsonb_typeof(m->'archive_bytes')is distinct from'number'or coalesce(m->>'archive_bytes','')!~'^[0-9]{1,9}$'
  or jsonb_typeof(m->'chunk_count')is distinct from'number'or coalesce(m->>'chunk_count','')!~'^[0-9]{1,3}$'
  or m->'chunk_bytes'is distinct from'1048576'::jsonb or jsonb_typeof(m->'entry_count')is distinct from'number'
  or coalesce(m->>'entry_count','')!~'^[0-9]{1,5}$'or jsonb_typeof(m->'uncompressed_bytes')is distinct from'number'
  or coalesce(m->>'uncompressed_bytes','')!~'^[0-9]{1,10}$'or jsonb_typeof(m->'chunks')is distinct from'array'
  or jsonb_typeof(m->'created_at')is distinct from'string'then raise exception 'MARKET_SEED_MANIFEST_CONTRACT';end if;
 size:=(m->>'archive_bytes')::integer;total:=(m->>'chunk_count')::integer;
 if size not between 22 and 268435456 or total not between 1 and 256 or total<>(size+1048575)/1048576
  or jsonb_array_length(m->'chunks')<>total or(m->>'entry_count')::integer not between 2 and 20000
  or(m->>'uncompressed_bytes')::bigint not between 2 and 1073741824
  or not isfinite((m->>'created_at')::timestamptz)or(m->>'created_at')::timestamptz>clock_timestamp()
  then raise exception 'MARKET_SEED_MANIFEST_SIZE';end if;
 for c in select * from jsonb_array_elements(m->'chunks')loop
  bytes:=least(1048576,size-idx*1048576);
  if not coalesce(vnext_market.exact(c,array['index','bytes','sha256']),false)or c->'index'is distinct from to_jsonb(idx)
   or c->'bytes'is distinct from to_jsonb(bytes)or jsonb_typeof(c->'sha256')is distinct from'string'or coalesce(c->>'sha256','')!~'^[a-f0-9]{64}$'
   then raise exception 'MARKET_SEED_CHUNK_MANIFEST';end if;idx:=idx+1;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('market-seed:'||(m->>'seed_id'),0));
 select * into prior from vnext_market.worker_seeds where seed_id=m->>'seed_id';
 if found then
  if prior.manifest_hash is distinct from p_manifest_hash or prior.manifest_text is distinct from p_manifest_text then raise exception 'MARKET_SEED_MANIFEST_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_SEED_STAGED_V2','seed_id',prior.seed_id,'manifest_hash',prior.manifest_hash,'replayed',true);
 end if;
 insert into vnext_market.worker_seeds(seed_id,manifest_hash,manifest_text,manifest,archive_bytes,chunk_count,entry_count,uncompressed_bytes)
 values(m->>'seed_id',p_manifest_hash,p_manifest_text,m,size,total,(m->>'entry_count')::integer,(m->>'uncompressed_bytes')::bigint);
 return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_SEED_STAGED_V2','seed_id',m->>'seed_id','manifest_hash',p_manifest_hash,'replayed',false);
end $$;

create function public.stage_daily_ai_market_worker_seed_chunk_v2(p_seed_id text,p_chunk_index integer,p_chunk_sha256 text,p_chunk_bytes_base64 text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m vnext_market.worker_seeds;prior vnext_market.worker_seed_chunks;raw bytea;c jsonb;begin
 if p_chunk_bytes_base64 is null or octet_length(p_chunk_bytes_base64)not between 4 and 1398104
  or p_chunk_bytes_base64!~'^[A-Za-z0-9+/]*={0,2}$'or length(p_chunk_bytes_base64)%4<>0
  then raise exception 'MARKET_SEED_CHUNK_ENCODING';end if;
 perform pg_advisory_xact_lock(hashtextextended('market-seed:'||p_seed_id,0));
 select * into strict m from vnext_market.worker_seeds where seed_id=p_seed_id;
 if p_chunk_index is null or p_chunk_index<0 or p_chunk_index>=m.chunk_count then raise exception 'MARKET_SEED_CHUNK_INDEX';end if;
 raw:=decode(p_chunk_bytes_base64,'base64');c:=m.manifest->'chunks'->p_chunk_index;
 if replace(encode(raw,'base64'),E'\n','')is distinct from p_chunk_bytes_base64 or octet_length(raw)<>(c->>'bytes')::integer
  or p_chunk_sha256 is distinct from c->>'sha256'or p_chunk_sha256 is distinct from encode(sha256(raw),'hex')then raise exception 'MARKET_SEED_CHUNK_HASH';end if;
 select * into prior from vnext_market.worker_seed_chunks where seed_id=p_seed_id and chunk_index=p_chunk_index;
 if found then
  if prior.chunk_sha256 is distinct from p_chunk_sha256 or prior.chunk_bytes is distinct from raw then raise exception 'MARKET_SEED_CHUNK_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_SEED_CHUNK_STAGED_V2','seed_id',p_seed_id,'index',p_chunk_index,'sha256',p_chunk_sha256,'replayed',true);
 end if;
 if exists(select from vnext_market.worker_seed_completions where seed_id=p_seed_id)then raise exception 'MARKET_SEED_SEALED';end if;
 insert into vnext_market.worker_seed_chunks(seed_id,chunk_index,chunk_sha256,chunk_bytes)values(p_seed_id,p_chunk_index,p_chunk_sha256,raw);
 return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_SEED_CHUNK_STAGED_V2','seed_id',p_seed_id,'index',p_chunk_index,'sha256',p_chunk_sha256,'replayed',false);
end $$;

create function public.finalize_daily_ai_market_worker_seed_v2(p_seed_id text,p_manifest_hash text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m vnext_market.worker_seeds;prior vnext_market.worker_seed_completions;raw bytea;counted integer;size bigint;at_time timestamptz;begin
 perform pg_advisory_xact_lock(hashtextextended('market-seed:'||p_seed_id,0));
 select * into strict m from vnext_market.worker_seeds where seed_id=p_seed_id;
 if m.manifest_hash is distinct from p_manifest_hash then raise exception 'MARKET_SEED_FINALIZE_SCOPE';end if;
 select * into prior from vnext_market.worker_seed_completions where seed_id=p_seed_id;
 if found then return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_SEED_COMPLETE_V2','seed_id',p_seed_id,'manifest_hash',p_manifest_hash,'replayed',true);end if;
 select count(*),sum(octet_length(chunk_bytes))into counted,size from vnext_market.worker_seed_chunks where seed_id=p_seed_id;
 if counted<>m.chunk_count or size is distinct from m.archive_bytes::bigint then raise exception 'MARKET_SEED_INCOMPLETE';end if;
 select string_agg(chunk_bytes,''::bytea order by chunk_index)into raw from vnext_market.worker_seed_chunks where seed_id=p_seed_id;
 if octet_length(raw)<>m.archive_bytes or encode(sha256(raw),'hex')<>p_seed_id then raise exception 'MARKET_SEED_ARCHIVE_HASH';end if;
 perform vnext_market.validate_seed_zip_v2(raw,m.entry_count,m.uncompressed_bytes);at_time:=clock_timestamp();
 insert into vnext_market.worker_seed_completions values(p_seed_id,p_manifest_hash,p_seed_id,m.archive_bytes,m.chunk_count,m.entry_count,m.uncompressed_bytes,at_time);
 return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_SEED_COMPLETE_V2','seed_id',p_seed_id,'manifest_hash',p_manifest_hash,'replayed',false);
end $$;
create function public.get_daily_ai_market_worker_seed_manifest_v2(p_seed_id text)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m vnext_market.worker_seeds;c vnext_market.worker_seed_completions;begin
 if coalesce(p_seed_id,'')!~'^[a-f0-9]{64}$'then raise exception 'MARKET_SEED_READ_SCOPE';end if;
 select * into c from vnext_market.worker_seed_completions where seed_id=p_seed_id;
 if not found then raise exception 'MARKET_SEED_NOT_COMPLETE';end if;
 select * into strict m from vnext_market.worker_seeds where seed_id=p_seed_id;
 return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_SEED_MANIFEST_V2','seed_id',m.seed_id,'state','COMPLETE',
  'manifest_hash',m.manifest_hash,'manifest_text',m.manifest_text,'completed_at',vnext_market.iso(c.completed_at));
end $$;
create function public.get_daily_ai_market_worker_seed_chunk_v2(p_seed_id text,p_chunk_index integer)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare c vnext_market.worker_seed_chunks;begin
 if coalesce(p_seed_id,'')!~'^[a-f0-9]{64}$'or p_chunk_index is null or p_chunk_index not between 0 and 255 then raise exception 'MARKET_SEED_READ_SCOPE';end if;
 if not exists(select from vnext_market.worker_seed_completions where seed_id=p_seed_id)then raise exception 'MARKET_SEED_NOT_COMPLETE';end if;
 select * into strict c from vnext_market.worker_seed_chunks where seed_id=p_seed_id and chunk_index=p_chunk_index;
 return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_SEED_CHUNK_V2','seed_id',p_seed_id,'index',p_chunk_index,
  'bytes',octet_length(c.chunk_bytes),'sha256',c.chunk_sha256,'data_base64',replace(encode(c.chunk_bytes,'base64'),E'\n',''));
end $$;
do $$declare name text;begin
 foreach name in array array['worker_seeds','worker_seed_chunks','worker_seed_completions']loop
  execute format('alter table vnext_market.%I enable row level security',name);execute format('alter table vnext_market.%I force row level security',name);
  execute format('revoke all on vnext_market.%I from public,anon,authenticated,service_role',name);
  execute format('create trigger immutable before update or delete on vnext_market.%I for each row execute function vnext_market.immutable()',name);
 end loop;
end $$;
revoke all on function vnext_market.seed_u16(bytea,integer),vnext_market.seed_u32(bytea,integer),vnext_market.validate_seed_zip_v2(bytea,integer,bigint)from public,anon,authenticated,service_role;
revoke all on function public.stage_daily_ai_market_worker_seed_v2(text,text),public.stage_daily_ai_market_worker_seed_chunk_v2(text,integer,text,text),
 public.finalize_daily_ai_market_worker_seed_v2(text,text),public.get_daily_ai_market_worker_seed_manifest_v2(text),public.get_daily_ai_market_worker_seed_chunk_v2(text,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_market_worker_seed_v2(text,text),public.stage_daily_ai_market_worker_seed_chunk_v2(text,integer,text,text),
 public.finalize_daily_ai_market_worker_seed_v2(text,text),public.get_daily_ai_market_worker_seed_manifest_v2(text),public.get_daily_ai_market_worker_seed_chunk_v2(text,integer)to service_role;
commit;
