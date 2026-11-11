-- PRIVATE DEPLOYMENT CANDIDATE. One durable checkpoint stream for encrypted
-- daily worker artifacts. No review, source-use approval or publication.
-- Key material remains in the private schema and service-only RPC responses.
begin;
do $$begin
 if to_regprocedure('vnext_market.hash(jsonb)')is null
  or to_regprocedure('extensions.gen_random_bytes(integer)')is null
  or to_regclass('vnext_market.worker_checkpoints')is not null
  then raise exception 'MARKET_CHECKPOINT_PREREQUISITES';end if;
end $$;

create table vnext_market.worker_checkpoints(
 checkpoint_id text primary key check(checkpoint_id~'^[a-f0-9]{64}$'),
 stream text not null default 'TAIWAN_MARKET_DAILY_V1' check(stream='TAIWAN_MARKET_DAILY_V1'),
 sequence bigint not null unique check(sequence between 1 and 9007199254740991),
 prior_checkpoint_id text references vnext_market.worker_checkpoints(checkpoint_id),
 context_text text not null check(octet_length(context_text)between 2 and 8192),
 context_hash text not null check(context_hash=vnext_market.digest(context_text)),
 key_bytes bytea not null check(octet_length(key_bytes)=32),
 issued_at timestamptz not null default clock_timestamp(),
 check((sequence=1)=(prior_checkpoint_id is null))
);
create table vnext_market.worker_checkpoint_archives(
 checkpoint_id text primary key references vnext_market.worker_checkpoints(checkpoint_id),
 archive_text text not null check(octet_length(archive_text)between 2 and 16384),
 archive_hash text not null check(archive_hash=vnext_market.digest(archive_text)),
 sealed_at timestamptz not null default clock_timestamp()
);
create table vnext_market.worker_checkpoint_stream(
 stream text primary key check(stream='TAIWAN_MARKET_DAILY_V1'),
 head_checkpoint_id text references vnext_market.worker_checkpoint_archives(checkpoint_id),
 pending_checkpoint_id text references vnext_market.worker_checkpoints(checkpoint_id),
 updated_at timestamptz not null default clock_timestamp(),
 check(head_checkpoint_id is distinct from pending_checkpoint_id or head_checkpoint_id is null)
);
insert into vnext_market.worker_checkpoint_stream(stream)values('TAIWAN_MARKET_DAILY_V1');

create function vnext_market.worker_checkpoint_record(p_id text)returns jsonb
language sql stable set search_path=''as $$
 select jsonb_build_object('checkpoint_id',c.checkpoint_id,'sequence',c.sequence,
  'prior_checkpoint_id',c.prior_checkpoint_id,'context_text',c.context_text,'context_hash',c.context_hash,
  'key_base64',replace(encode(c.key_bytes,'base64'),E'\n',''),'issued_at',vnext_market.iso(c.issued_at),
  'archive_text',a.archive_text,'archive_hash',a.archive_hash,'sealed_at',vnext_market.iso(a.sealed_at))
 from vnext_market.worker_checkpoints c left join vnext_market.worker_checkpoint_archives a using(checkpoint_id)
 where c.checkpoint_id=p_id
$$;

create function public.get_daily_ai_market_worker_checkpoint_v2()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare s vnext_market.worker_checkpoint_stream;begin
 select * into strict s from vnext_market.worker_checkpoint_stream where stream='TAIWAN_MARKET_DAILY_V1';
 return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_CHECKPOINT_V1',
  'head',vnext_market.worker_checkpoint_record(s.head_checkpoint_id),
  'pending',vnext_market.worker_checkpoint_record(s.pending_checkpoint_id));
end $$;

create function public.begin_daily_ai_market_worker_checkpoint_v2(p_context_text text,p_context_hash text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m jsonb;s vnext_market.worker_checkpoint_stream;c vnext_market.worker_checkpoints;
 prior_sequence bigint:=0;new_key bytea;at_time timestamptz;begin
 if p_context_text is null or octet_length(p_context_text)not between 2 and 8192
  or p_context_hash is distinct from vnext_market.digest(p_context_text)then raise exception 'MARKET_CHECKPOINT_CONTEXT_HASH';end if;
 m:=p_context_text::jsonb;
 if vnext_market.canonical(m)is distinct from p_context_text
  or not coalesce(vnext_market.exact(m,array['schema','checkpoint_id','prior_checkpoint_id','run_id','run_attempt','git_commit']),false)
  or m->>'schema'is distinct from'TAIWAN_MARKET_CHECKPOINT_BEGIN_V1'
  or jsonb_typeof(m->'checkpoint_id')is distinct from'string'or coalesce(m->>'checkpoint_id','')!~'^[a-f0-9]{64}$'
  or not(coalesce(jsonb_typeof(m->'prior_checkpoint_id')='null',false)
   or(jsonb_typeof(m->'prior_checkpoint_id')='string'and coalesce(m->>'prior_checkpoint_id','')~'^[a-f0-9]{64}$'))
  or jsonb_typeof(m->'run_id')is distinct from'string'or coalesce(m->>'run_id','')!~'^[0-9]{1,20}$'
  or jsonb_typeof(m->'run_attempt')is distinct from'number'or coalesce(m->>'run_attempt','')!~'^[0-9]{1,4}$'
  or jsonb_typeof(m->'git_commit')is distinct from'string'or coalesce(m->>'git_commit','')!~'^[a-f0-9]{40}$'
  then raise exception 'MARKET_CHECKPOINT_CONTEXT_CONTRACT';end if;
 if(m->>'run_attempt')::integer not between 1 and 1000 then raise exception 'MARKET_CHECKPOINT_CONTEXT_CONTRACT';end if;
 select * into strict s from vnext_market.worker_checkpoint_stream where stream='TAIWAN_MARKET_DAILY_V1' for update;
 select * into c from vnext_market.worker_checkpoints where checkpoint_id=m->>'checkpoint_id';
 if found then
  if c.context_text is distinct from p_context_text or c.context_hash is distinct from p_context_hash then raise exception 'MARKET_CHECKPOINT_CONTEXT_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_CHECKPOINT_ISSUED_V1','checkpoint_id',c.checkpoint_id,'sequence',c.sequence,
   'prior_checkpoint_id',c.prior_checkpoint_id,'context_hash',c.context_hash,'key_base64',replace(encode(c.key_bytes,'base64'),E'\n',''),
   'issued_at',vnext_market.iso(c.issued_at),'replayed',true);
 end if;
 if s.pending_checkpoint_id is not null then raise exception 'MARKET_CHECKPOINT_PENDING_UNCONFIRMED';end if;
 if(m->>'prior_checkpoint_id')is distinct from s.head_checkpoint_id then raise exception 'MARKET_CHECKPOINT_PRIOR_MISMATCH';end if;
 if s.head_checkpoint_id is not null then select sequence into strict prior_sequence from vnext_market.worker_checkpoints where checkpoint_id=s.head_checkpoint_id;end if;
 if prior_sequence>=9007199254740991 then raise exception 'MARKET_CHECKPOINT_SEQUENCE_LIMIT';end if;
 new_key:=extensions.gen_random_bytes(32);at_time:=clock_timestamp();
 if new_key is null or octet_length(new_key)<>32 then raise exception 'MARKET_CHECKPOINT_KEY_GENERATION';end if;
 insert into vnext_market.worker_checkpoints(checkpoint_id,sequence,prior_checkpoint_id,context_text,context_hash,key_bytes,issued_at)
 values(m->>'checkpoint_id',prior_sequence+1,s.head_checkpoint_id,p_context_text,p_context_hash,new_key,at_time) returning * into c;
 update vnext_market.worker_checkpoint_stream set pending_checkpoint_id=c.checkpoint_id,updated_at=at_time where stream='TAIWAN_MARKET_DAILY_V1';
 return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_CHECKPOINT_ISSUED_V1','checkpoint_id',c.checkpoint_id,'sequence',c.sequence,
  'prior_checkpoint_id',c.prior_checkpoint_id,'context_hash',c.context_hash,'key_base64',replace(encode(c.key_bytes,'base64'),E'\n',''),
  'issued_at',vnext_market.iso(c.issued_at),'replayed',false);
end $$;

create function public.seal_daily_ai_market_worker_checkpoint_v2(p_checkpoint_id text,p_archive_text text,p_archive_hash text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m jsonb;b jsonb;idx integer:=0;kind text;nonce bytea;tag bytea;nonces text[]:='{}';artifact_ids text[]:='{}';
 s vnext_market.worker_checkpoint_stream;c vnext_market.worker_checkpoints;a vnext_market.worker_checkpoint_archives;at_time timestamptz;prior_sequence bigint:=0;
begin
 if coalesce(p_checkpoint_id,'')!~'^[a-f0-9]{64}$'or p_archive_text is null or octet_length(p_archive_text)not between 2 and 16384
  or p_archive_hash is distinct from vnext_market.digest(p_archive_text)then raise exception 'MARKET_CHECKPOINT_ARCHIVE_HASH';end if;
 m:=p_archive_text::jsonb;
 if vnext_market.canonical(m)is distinct from p_archive_text
  or not coalesce(vnext_market.exact(m,array['schema','checkpoint_id','context_hash','work_state','bundles']),false)
  or m->>'schema'is distinct from'TAIWAN_MARKET_CHECKPOINT_ARCHIVES_V1'
  or jsonb_typeof(m->'checkpoint_id')is distinct from'string'or m->>'checkpoint_id'is distinct from p_checkpoint_id
  or jsonb_typeof(m->'context_hash')is distinct from'string'or coalesce(m->>'context_hash','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(m->'work_state')is distinct from'string'or length(coalesce(m->>'work_state',''))not between 1 and 80
  or jsonb_typeof(m->'bundles')is distinct from'array'then raise exception 'MARKET_CHECKPOINT_ARCHIVE_CONTRACT';end if;
 if jsonb_array_length(m->'bundles')<>2 then raise exception 'MARKET_CHECKPOINT_BUNDLES';end if;
 for b in select * from jsonb_array_elements(m->'bundles')loop
  kind:=case idx when 0 then 'AUDIT' else 'RESUME' end;
  if not coalesce(vnext_market.exact(b,array['kind','artifact_id','artifact_name','format','ciphertext_sha256','ciphertext_bytes','plaintext_sha256','plaintext_bytes','manifest_sha256','file_count','nonce_base64','tag_base64']),false)
   or b->>'kind'is distinct from kind or b->>'format'is distinct from'TAR_GZIP_AES_256_GCM_V1'
   or jsonb_typeof(b->'artifact_id')is distinct from'string'or coalesce(b->>'artifact_id','')!~'^[0-9]{1,20}$'
   or jsonb_typeof(b->'artifact_name')is distinct from'string'or b->>'artifact_name'is distinct from 'taiwan-market-'||lower(kind)||'-'||p_checkpoint_id
   or jsonb_typeof(b->'ciphertext_sha256')is distinct from'string'or coalesce(b->>'ciphertext_sha256','')!~'^[a-f0-9]{64}$'
   or jsonb_typeof(b->'plaintext_sha256')is distinct from'string'or coalesce(b->>'plaintext_sha256','')!~'^[a-f0-9]{64}$'
   or jsonb_typeof(b->'manifest_sha256')is distinct from'string'or coalesce(b->>'manifest_sha256','')!~'^[a-f0-9]{64}$'
   or jsonb_typeof(b->'ciphertext_bytes')is distinct from'number'or coalesce(b->>'ciphertext_bytes','')!~'^[0-9]{1,10}$'
   or jsonb_typeof(b->'plaintext_bytes')is distinct from'number'or coalesce(b->>'plaintext_bytes','')!~'^[0-9]{1,10}$'
   or jsonb_typeof(b->'file_count')is distinct from'number'or coalesce(b->>'file_count','')!~'^[0-9]{1,5}$'
   or jsonb_typeof(b->'nonce_base64')is distinct from'string'or coalesce(b->>'nonce_base64','')!~'^[A-Za-z0-9+/]{16}$'
   or jsonb_typeof(b->'tag_base64')is distinct from'string'or coalesce(b->>'tag_base64','')!~'^[A-Za-z0-9+/]{22}==$'
   then raise exception 'MARKET_CHECKPOINT_BUNDLE_CONTRACT';end if;
  if(b->>'ciphertext_bytes')::bigint not between 1 and 2147483648 or(b->>'plaintext_bytes')::bigint not between 1 and 8589934592
   or(b->>'file_count')::integer not between 1 and 50000 then raise exception 'MARKET_CHECKPOINT_BUNDLE_SIZE';end if;
  nonce:=decode(b->>'nonce_base64','base64');tag:=decode(b->>'tag_base64','base64');
  if octet_length(nonce)<>12 or octet_length(tag)<>16 or encode(nonce,'base64')is distinct from b->>'nonce_base64'
   or encode(tag,'base64')is distinct from b->>'tag_base64' then raise exception 'MARKET_CHECKPOINT_NONCE_TAG_ENCODING';end if;
  if(b->>'nonce_base64')=any(nonces)then raise exception 'MARKET_CHECKPOINT_NONCE_REUSE';end if;
  if(b->>'artifact_id')=any(artifact_ids)then raise exception 'MARKET_CHECKPOINT_ARTIFACT_REUSE';end if;
  nonces:=array_append(nonces,b->>'nonce_base64');artifact_ids:=array_append(artifact_ids,b->>'artifact_id');idx:=idx+1;
 end loop;
 select * into strict s from vnext_market.worker_checkpoint_stream where stream='TAIWAN_MARKET_DAILY_V1' for update;
 select * into c from vnext_market.worker_checkpoints where checkpoint_id=p_checkpoint_id;
 if not found then raise exception 'MARKET_CHECKPOINT_NOT_ISSUED';end if;
 if m->>'context_hash'is distinct from c.context_hash then raise exception 'MARKET_CHECKPOINT_ARCHIVE_CONTEXT';end if;
 select * into a from vnext_market.worker_checkpoint_archives where checkpoint_id=p_checkpoint_id;
 if found then
  if a.archive_hash is distinct from p_archive_hash or a.archive_text is distinct from p_archive_text then raise exception 'MARKET_CHECKPOINT_ARCHIVE_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_CHECKPOINT_SEALED_V1','checkpoint_id',c.checkpoint_id,'sequence',c.sequence,'archive_hash',a.archive_hash,'replayed',true);
 end if;
 if s.pending_checkpoint_id is distinct from p_checkpoint_id then raise exception 'MARKET_CHECKPOINT_NOT_PENDING';end if;
 if c.prior_checkpoint_id is distinct from s.head_checkpoint_id then raise exception 'MARKET_CHECKPOINT_PRIOR_MISMATCH';end if;
 if s.head_checkpoint_id is not null then select sequence into strict prior_sequence from vnext_market.worker_checkpoints where checkpoint_id=s.head_checkpoint_id;end if;
 if c.sequence<>prior_sequence+1 then raise exception 'MARKET_CHECKPOINT_SEQUENCE_MISMATCH';end if;
 at_time:=clock_timestamp();
 insert into vnext_market.worker_checkpoint_archives(checkpoint_id,archive_text,archive_hash,sealed_at)values(p_checkpoint_id,p_archive_text,p_archive_hash,at_time);
 update vnext_market.worker_checkpoint_stream set head_checkpoint_id=p_checkpoint_id,pending_checkpoint_id=null,updated_at=at_time where stream='TAIWAN_MARKET_DAILY_V1';
 return jsonb_build_object('schema','DAILY_AI_MARKET_WORKER_CHECKPOINT_SEALED_V1','checkpoint_id',c.checkpoint_id,'sequence',c.sequence,'archive_hash',p_archive_hash,'replayed',false);
end $$;

do $$declare name text;begin
 foreach name in array array['worker_checkpoints','worker_checkpoint_archives','worker_checkpoint_stream']loop
  execute format('alter table vnext_market.%I enable row level security',name);
  execute format('alter table vnext_market.%I force row level security',name);
  execute format('revoke all on vnext_market.%I from public,anon,authenticated,service_role',name);
  execute format('create trigger immutable_truncate before truncate on vnext_market.%I for each statement execute function vnext_market.immutable()',name);
  if name='worker_checkpoint_stream'then
   execute format('create trigger immutable_delete before delete on vnext_market.%I for each row execute function vnext_market.immutable()',name);
  else
   execute format('create trigger immutable before update or delete on vnext_market.%I for each row execute function vnext_market.immutable()',name);
  end if;
 end loop;
end $$;
revoke all on function vnext_market.worker_checkpoint_record(text)from public,anon,authenticated,service_role;
revoke all on function public.get_daily_ai_market_worker_checkpoint_v2(),public.begin_daily_ai_market_worker_checkpoint_v2(text,text),
 public.seal_daily_ai_market_worker_checkpoint_v2(text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_market_worker_checkpoint_v2(),public.begin_daily_ai_market_worker_checkpoint_v2(text,text),
 public.seal_daily_ai_market_worker_checkpoint_v2(text,text,text)to service_role;
commit;
