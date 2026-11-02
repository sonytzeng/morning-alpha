-- CANDIDATE ONLY: incremental stage-only -> offline edition admission.
-- Applies only after offline-snapshot-stage-only.candidate.sql (SHA256
-- 277a0c1392f1001f6d65e4fc0e02117635e8563c34529a7cccbb91261b06fbf4).
-- Never run the full fresh-install candidate over an existing stage-only schema.
-- No snapshot/job/receipt/review/publication rows are inserted or changed here.
-- Owner/member projection compatibility and deployed frontend are separate prerequisites
-- before staging any actual offline edition. This migration grants no publication GO.
begin;
-- Freeze imports/reviews while checking the exact already-installed safety boundary.
lock table vnext_private.reviewed_analysis_snapshots_v1,
 vnext_private.ai_research_editions,vnext_private.ai_research_reviews,
 vnext_private.ai_research_use_reviews in share row exclusive mode;
do $guard$
declare r record;oid_value oid;actual jsonb;role_name text;table_name text;privilege_name text;
begin
 if to_regprocedure('public.stage_offline_reviewed_analysis_edition_v1(text,timestamptz)') is not null
  or to_regprocedure('vnext_private.offline_reviewed_payload_v1(text)') is not null
  or to_regprocedure('vnext_private.offline_reviewed_edition_integrity_v1(text)') is not null
  or to_regprocedure('vnext_private.ai_model_edition_integrity_legacy_v1(text)') is not null
  or to_regprocedure('vnext_private.offline_review_author_independence_v1()') is not null
  or exists(select from pg_attribute where attrelid='vnext_private.ai_research_editions'::regclass and attname='reviewed_snapshot_hash' and not attisdropped)
 then raise exception 'OFFLINE_UPGRADE_ALREADY_OR_PARTIALLY_INSTALLED';end if;
 for r in select * from(values
 ('public.get_daily_ai_member_research_v1()','75f25f11361c83e33297f4f7386339cdb959d02f4431a9571681eda59717cbc8'),
 ('public.get_daily_ai_owner_research_v1(text)','fe283bb23a71bbabf657909c5e62b6159079ae2fc40abfbcf3aeafaa250da7b7'),
 ('public.review_daily_ai_research_edition_v1(text, uuid, text, text, uuid)','326262e6cd53599fce04a58f5c1ec44a3362613a75e2672ddbbb94d387b8226f'),
 ('public.stage_daily_ai_research_edition_v1(text, text[], timestamp with time zone)','e744ae5fd8f0f31967e179ffdbdf3cc74672892564c0f6c454c8ff7847626b44'),
 ('public.stage_offline_reviewed_analysis_snapshot_v1(text, text, text)','872d8dee6f639aab6e8919cb8b53f612ee0ae03cfb3b3f4318dbb20a49ae6741'),
 ('vnext_private.ai_batch_commitment_v1(text)','1598813b358ecb1d914b6081b86d41caa33be9c431b6d0f9bc000f657ba5d261'),
 ('vnext_private.ai_edition_integrity_v1(text)','20ac6f1e7a36f5aac0f5ea74342b0edc2e9e2239ba8896a1c2da0b1d63076633'),
 ('vnext_private.ai_edition_rights_v1(text, timestamp with time zone)','a1d17f43ddc8c19103d436f84aed6cd59710da9e6e96a4de09efdd714101a054'),
 ('vnext_private.offline_claim_hash_v1(jsonb)','cdaebf6edc2370d02eac0b6800c9d88e809dd469de499d3ed7683b797a78e57f'),
 ('vnext_private.offline_numeric_operand_v1(jsonb, jsonb, jsonb)','ac3b7c70eed56455a33fcd3012339a055125cb082786e35c5da3b51abaa8c664'),
 ('vnext_private.validate_ai_research_review_v1()','758b92f64b341434ca6576c6bbf0e507ca78060df465925195e1502768c3df58'),
 ('vnext_private.validate_ai_research_use_review_v1()','2697aeaeec7c10e7c1be0c58c5d6fe92bc2526762569a703f90d1ae4a7430838'),
 ('vnext_runtime.documented_review_edition_expiry_v2(jsonb, timestamp with time zone)','4b3d1937dd435b8f951e55d4362c44340b6cca960373ff57c56a7af35bce9854'),
 ('vnext_runtime.documented_review_packet_fact_matches_v2(jsonb, jsonb)','083f9c0d6ae066378e43f7805f322f9ca8d167de1fcff4b01058eccb140172b6'),
 ('vnext_runtime.documented_review_packet_original_id_v2(jsonb)','c8370045f0874324832bb36719288013ad8dd35bfdd23105e132b1dc3a3f44af')
 )expected(signature,definition_sha256) loop
  oid_value:=to_regprocedure(r.signature);
  if oid_value is null or encode(sha256(convert_to(pg_get_functiondef(oid_value),'UTF8')),'hex') is distinct from r.definition_sha256
   then raise exception 'OFFLINE_UPGRADE_FUNCTION_DRIFT:%',r.signature;end if;
 end loop;
 select jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'not_null',attnotnull,'default',pg_get_expr(adbin,adrelid)) order by attnum) into actual
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='vnext_private.reviewed_analysis_snapshots_v1'::regclass and a.attnum>0 and not a.attisdropped;
 if actual is distinct from '[{"name":"snapshot_hash","type":"text","default":null,"not_null":true},{"name":"batch_id","type":"text","default":null,"not_null":true},{"name":"author_ref","type":"text","default":null,"not_null":true},{"name":"body_text","type":"text","default":null,"not_null":true},{"name":"body","type":"jsonb","default":null,"not_null":true},{"name":"validator_document_hash","type":"text","default":null,"not_null":true},{"name":"recorded_at","type":"timestamp with time zone","default":"clock_timestamp()","not_null":true}]'::jsonb then raise exception 'OFFLINE_UPGRADE_SNAPSHOT_COLUMNS_DRIFT';end if;
 select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname) into actual
  from pg_constraint where conrelid='vnext_private.reviewed_analysis_snapshots_v1'::regclass;
 if actual is distinct from '[{"name":"reviewed_analysis_snapshots_v1_author_ref_check","definition":"CHECK (((length(btrim(author_ref)) >= 1) AND (length(btrim(author_ref)) <= 200)))"},{"name":"reviewed_analysis_snapshots_v1_batch_id_fkey","definition":"FOREIGN KEY (batch_id) REFERENCES vnext_runtime.ai_stock_batches(id)"},{"name":"reviewed_analysis_snapshots_v1_body_text_check","definition":"CHECK (((octet_length(body_text) >= 2) AND (octet_length(body_text) <= 2000000)))"},{"name":"reviewed_analysis_snapshots_v1_check","definition":"CHECK ((body = (body_text)::jsonb))"},{"name":"reviewed_analysis_snapshots_v1_check1","definition":"CHECK ((encode(sha256(convert_to(body_text, ''UTF8''::name)), ''hex''::text) = snapshot_hash))"},{"name":"reviewed_analysis_snapshots_v1_pkey","definition":"PRIMARY KEY (snapshot_hash)"},{"name":"reviewed_analysis_snapshots_v1_snapshot_hash_check","definition":"CHECK ((snapshot_hash ~ ''^[a-f0-9]{64}$''::text))"},{"name":"reviewed_analysis_snapshots_v1_validator_document_hash_check","definition":"CHECK ((validator_document_hash ~ ''^[a-f0-9]{64}$''::text))"}]'::jsonb then raise exception 'OFFLINE_UPGRADE_SNAPSHOT_CONSTRAINT_DRIFT';end if;
 select jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid),'enabled',tgenabled) order by tgname) into actual
  from pg_trigger where tgrelid='vnext_private.reviewed_analysis_snapshots_v1'::regclass and not tgisinternal;
 if actual is distinct from '[{"name":"immutable","enabled":"O","definition":"CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON vnext_private.reviewed_analysis_snapshots_v1 FOR EACH ROW EXECUTE FUNCTION vnext_private.immutable_record()"},{"name":"immutable_truncate","enabled":"O","definition":"CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON vnext_private.reviewed_analysis_snapshots_v1 FOR EACH STATEMENT EXECUTE FUNCTION vnext_private.immutable_record()"}]'::jsonb then raise exception 'OFFLINE_UPGRADE_SNAPSHOT_TRIGGER_DRIFT';end if;
 if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='vnext_private.ai_research_editions'::regclass
  and conname='ai_research_editions_job_keys_check') is distinct from 'CHECK ((cardinality(job_keys) = 72))'
  then raise exception 'OFFLINE_UPGRADE_MODEL_JOB_CHECK_DRIFT';end if;
 foreach table_name in array array['reviewed_analysis_snapshots_v1','ai_research_editions','ai_research_reviews','ai_research_use_reviews','ai_research_publication_events'] loop
  if not exists(select from pg_class where oid=('vnext_private.'||table_name)::regclass and relrowsecurity and relforcerowsecurity)
   or exists(select from pg_policy where polrelid=('vnext_private.'||table_name)::regclass)
   or not exists(select from pg_trigger where tgrelid=('vnext_private.'||table_name)::regclass and tgname='immutable' and tgenabled='O' and not tgisinternal)
   then raise exception 'OFFLINE_UPGRADE_PRIVATE_TABLE_BOUNDARY_DRIFT:%',table_name;end if;
 end loop;
 select jsonb_agg(jsonb_build_object('schema',n.nspname,'table_name',c.relname,'tgname',t.tgname,'tgenabled',t.tgenabled,'tgtype',t.tgtype,'function_name',t.tgfoid::regprocedure::text,'definition',pg_get_triggerdef(t.oid)) order by c.relname,t.tgname) into actual
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='vnext_private' and c.relname in('ai_research_editions','ai_research_reviews','ai_research_use_reviews','ai_research_publication_events') and not t.tgisinternal;
 if actual is distinct from '[{"schema":"vnext_private","table_name":"ai_research_editions","tgname":"immutable","tgenabled":"O","tgtype":27,"function_name":"vnext_private.immutable_record()","definition":"CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON vnext_private.ai_research_editions FOR EACH ROW EXECUTE FUNCTION vnext_private.immutable_record()"},{"schema":"vnext_private","table_name":"ai_research_publication_events","tgname":"immutable","tgenabled":"O","tgtype":27,"function_name":"vnext_private.immutable_record()","definition":"CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON vnext_private.ai_research_publication_events FOR EACH ROW EXECUTE FUNCTION vnext_private.immutable_record()"},{"schema":"vnext_private","table_name":"ai_research_reviews","tgname":"immutable","tgenabled":"O","tgtype":27,"function_name":"vnext_private.immutable_record()","definition":"CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON vnext_private.ai_research_reviews FOR EACH ROW EXECUTE FUNCTION vnext_private.immutable_record()"},{"schema":"vnext_private","table_name":"ai_research_reviews","tgname":"validate_review","tgenabled":"O","tgtype":7,"function_name":"vnext_private.validate_ai_research_review_v1()","definition":"CREATE TRIGGER validate_review BEFORE INSERT ON vnext_private.ai_research_reviews FOR EACH ROW EXECUTE FUNCTION vnext_private.validate_ai_research_review_v1()"},{"schema":"vnext_private","table_name":"ai_research_use_reviews","tgname":"immutable","tgenabled":"O","tgtype":27,"function_name":"vnext_private.immutable_record()","definition":"CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON vnext_private.ai_research_use_reviews FOR EACH ROW EXECUTE FUNCTION vnext_private.immutable_record()"},{"schema":"vnext_private","table_name":"ai_research_use_reviews","tgname":"validate_use_review","tgenabled":"O","tgtype":7,"function_name":"vnext_private.validate_ai_research_use_review_v1()","definition":"CREATE TRIGGER validate_use_review BEFORE INSERT ON vnext_private.ai_research_use_reviews FOR EACH ROW EXECUTE FUNCTION vnext_private.validate_ai_research_use_review_v1()"}]'::jsonb then raise exception 'OFFLINE_UPGRADE_REVIEW_GATE_TRIGGER_DRIFT';end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  foreach table_name in array array['reviewed_analysis_snapshots_v1','ai_research_editions'] loop
   foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege(role_name,'vnext_private.'||table_name,privilege_name)
     then raise exception 'OFFLINE_UPGRADE_DIRECT_TABLE_GRANT:%:%:%',role_name,table_name,privilege_name;end if;
   end loop;
  end loop;
  foreach table_name in array array['ai_research_reviews','ai_research_use_reviews','ai_research_publication_events'] loop
   foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege(role_name,'vnext_private.'||table_name,privilege_name)
     is distinct from (role_name='service_role' and table_name in('ai_research_reviews','ai_research_use_reviews') and privilege_name in('SELECT','INSERT'))
    then raise exception 'OFFLINE_UPGRADE_REVIEW_TABLE_GRANT_DRIFT:%:%:%',role_name,table_name,privilege_name;end if;
   end loop;
  end loop;
  for r in select * from(values
   ('public.get_daily_ai_member_research_v1()','authenticated'),
   ('public.get_daily_ai_owner_research_v1(text)','authenticated'),
   ('public.review_daily_ai_research_edition_v1(text,uuid,text,text,uuid)','authenticated'),
   ('public.stage_daily_ai_research_edition_v1(text,text[],timestamptz)','service_role')
  )expected(signature,allowed_role) loop
   if has_function_privilege(role_name,r.signature,'EXECUTE') is distinct from (role_name=r.allowed_role)
    then raise exception 'OFFLINE_UPGRADE_EXISTING_API_GRANT_DRIFT:%:%',role_name,r.signature;end if;
  end loop;
  if has_function_privilege(role_name,'vnext_private.offline_claim_hash_v1(jsonb)','EXECUTE')
   or has_function_privilege(role_name,'vnext_private.offline_numeric_operand_v1(jsonb,jsonb,jsonb)','EXECUTE')
   or (role_name<>'service_role' and has_function_privilege(role_name,'public.stage_offline_reviewed_analysis_snapshot_v1(text,text,text)','EXECUTE'))
   or (role_name='service_role' and not has_function_privilege(role_name,'public.stage_offline_reviewed_analysis_snapshot_v1(text,text,text)','EXECUTE'))
   then raise exception 'OFFLINE_UPGRADE_SNAPSHOT_EXECUTE_GRANT_DRIFT:%',role_name;end if;
 end loop;
end $guard$;

-- Reviewed full candidate: edition-only schema additions, copied byte-for-byte.
-- Do not fill the model job_keys column with invented identifiers.
alter table vnext_private.ai_research_editions add column reviewed_snapshot_hash text
 references vnext_private.reviewed_analysis_snapshots_v1(snapshot_hash);
alter table vnext_private.ai_research_editions drop constraint ai_research_editions_job_keys_check;
alter table vnext_private.ai_research_editions add constraint ai_research_editions_origin_job_keys_v1 check(
 (reviewed_snapshot_hash is null and cardinality(job_keys)=72)
 or (reviewed_snapshot_hash is not null and cardinality(job_keys)=0));

create function vnext_private.offline_reviewed_payload_v1(p_snapshot_hash text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema','VNEXT_AI_RESEARCH_EDITION_V1','mode','AS_OF_RESEARCH','batch_id',s.batch_id,
  'job_set_hash',encode(sha256(convert_to('','UTF8')),'hex'),'cutoff',b.cutoff,'through',b.payload->>'through',
  'cards',s.body->'cards','source_urls',(select jsonb_agg(distinct ev->>'source' order by ev->>'source')
   from jsonb_array_elements(b.payload->'packets')p,jsonb_array_elements(p->'evidence')ev),
  'forecast',false,'performance_available',false,'analysis_origin','OFFLINE_REVIEWED','reviewed_snapshot_hash',s.snapshot_hash,
  'model_generated',false,'new_model_calls',0)
 from vnext_private.reviewed_analysis_snapshots_v1 s join vnext_runtime.ai_stock_batches b on b.id=s.batch_id where s.snapshot_hash=p_snapshot_hash;
$$;
revoke all on function vnext_private.offline_reviewed_payload_v1(text) from public,anon,authenticated,service_role;

create function vnext_private.offline_reviewed_edition_integrity_v1(p_id text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select from vnext_private.ai_research_editions e
 join vnext_private.reviewed_analysis_snapshots_v1 s on s.snapshot_hash=e.reviewed_snapshot_hash
 join vnext_runtime.ai_stock_batches b on b.id=s.batch_id
 where e.id=p_id and cardinality(e.job_keys)=0 and e.job_set_hash=encode(sha256(convert_to('','UTF8')),'hex')
  and e.batch_id=b.id and e.cutoff=b.cutoff and e.through=(b.payload->>'through')::date
  and s.body=s.body_text::jsonb and s.snapshot_hash=encode(sha256(convert_to(s.body_text,'UTF8')),'hex')
  and s.author_ref=s.body->>'author_ref' and s.body->>'provenance'='OFFLINE_REVIEWED' and s.body->'model_generated'='false'::jsonb
  and s.body->'packet_hashes'=b.payload->'packet_hashes' and (s.body->>'cutoff')::timestamptz=b.cutoff
  and (s.body->>'prepared_at')::timestamptz<=s.recorded_at and s.recorded_at<=e.created_at
  and e.expires_at<=(s.body->>'expires_at')::timestamptz and e.expires_at<=b.cutoff+interval '72 hours'
  and vnext_private.ai_batch_commitment_v1(b.id) and e.payload=vnext_private.offline_reviewed_payload_v1(s.snapshot_hash)
  and encode(sha256(convert_to(e.payload::text,'UTF8')),'hex')=e.id);
$$;
revoke all on function vnext_private.offline_reviewed_edition_integrity_v1(text) from public,anon,authenticated,service_role;

-- Preserve the existing model-integrity function's source byte-for-byte. The
-- new public-name wrapper selects offline records only by their explicit FK.
alter function vnext_private.ai_edition_integrity_v1(text) rename to ai_model_edition_integrity_legacy_v1;
create function vnext_private.ai_edition_integrity_v1(p_id text) returns boolean
language sql stable security definer set search_path='' as $$
 select case when exists(select from vnext_private.ai_research_editions e where e.id=p_id and e.reviewed_snapshot_hash is not null)
  then vnext_private.offline_reviewed_edition_integrity_v1(p_id)
  else vnext_private.ai_model_edition_integrity_legacy_v1(p_id) end;
$$;
revoke all on function vnext_private.ai_edition_integrity_v1(text) from public,anon,authenticated,service_role;

create function public.stage_offline_reviewed_analysis_edition_v1(p_snapshot_hash text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s vnext_private.reviewed_analysis_snapshots_v1;b vnext_runtime.ai_stock_batches;
 payload jsonb;eid text;at_time timestamptz:=clock_timestamp();existing vnext_private.ai_research_editions;
begin
 if p_snapshot_hash is null or p_snapshot_hash !~ '^[a-f0-9]{64}$' or p_expires_at is null or not isfinite(p_expires_at)
  then raise exception 'OFFLINE_EDITION_SCOPE';end if;
 select * into s from vnext_private.reviewed_analysis_snapshots_v1 where snapshot_hash=p_snapshot_hash;
 if s.snapshot_hash is null then raise exception 'OFFLINE_EDITION_SNAPSHOT';end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=s.batch_id;
 if s.recorded_at>at_time or p_expires_at<=at_time or p_expires_at>(s.body->>'expires_at')::timestamptz
  or p_expires_at>b.cutoff+interval '72 hours' then raise exception 'OFFLINE_EDITION_EXPIRY';end if;
 -- Reuse the current model-stage time cap; this can only shorten the requested expiry.
 p_expires_at:=vnext_runtime.documented_review_edition_expiry_v2(b.payload,p_expires_at);
 payload:=vnext_private.offline_reviewed_payload_v1(s.snapshot_hash);eid:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 insert into vnext_private.ai_research_editions(id,batch_id,business_date,cutoff,through,job_keys,job_set_hash,payload,expires_at,reviewed_snapshot_hash,created_at)
 values(eid,b.id,(b.cutoff at time zone 'Asia/Taipei')::date,b.cutoff,(b.payload->>'through')::date,'{}',
  encode(sha256(convert_to('','UTF8')),'hex'),payload,p_expires_at,s.snapshot_hash,at_time) on conflict do nothing;
 select * into strict existing from vnext_private.ai_research_editions where id=eid;
 if existing.expires_at<=at_time or not vnext_private.ai_edition_integrity_v1(eid) then raise exception 'OFFLINE_EDITION_INTEGRITY_OR_EXPIRED';end if;
 return jsonb_build_object('state','OFFLINE_EDITION_STAGED_FULL_REVIEW_REQUIRED','edition_id',eid,'snapshot_hash',s.snapshot_hash,
  'analysis_origin','OFFLINE_REVIEWED','model_jobs',0,'cards',216,'model_calls',0,'reviews_copied',false,'member_published',false);
end $$;
revoke all on function public.stage_offline_reviewed_analysis_edition_v1(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.stage_offline_reviewed_analysis_edition_v1(text,timestamptz) to service_role;

-- Existing full-review triggers still run; this adds author independence for
-- offline snapshots, which correctly have no provider model/job to compare.
create function vnext_private.offline_review_author_independence_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select from vnext_private.ai_research_editions e join vnext_private.reviewed_analysis_snapshots_v1 s
  on s.snapshot_hash=e.reviewed_snapshot_hash where e.id=new.edition_id and new.reviewer_ref=s.author_ref)
  then raise exception 'OFFLINE_AUTHOR_CANNOT_SELF_REVIEW';end if;return new;
end $$;
revoke all on function vnext_private.offline_review_author_independence_v1() from public,anon,authenticated,service_role;
create trigger offline_author_independence before insert on vnext_private.ai_research_reviews
 for each row execute function vnext_private.offline_review_author_independence_v1();
do $$begin
 if to_regclass('vnext_private.ai_research_use_reviews') is not null then
  execute 'create trigger offline_author_independence before insert on vnext_private.ai_research_use_reviews for each row execute function vnext_private.offline_review_author_independence_v1()';
 end if;
end $$;

-- The original model integrity source remains exact under its new private name.
do $post$
begin
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='vnext_private.ai_model_edition_integrity_legacy_v1(text)'::regprocedure)
  is distinct from 'ca848cb161426ee884898d48bc9a4f4b6af339d682f9354489b6fb10d3832588'
 then raise exception 'OFFLINE_UPGRADE_LEGACY_INTEGRITY_CHANGED';end if;
end $post$;
commit;
