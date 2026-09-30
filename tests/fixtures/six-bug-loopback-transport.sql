-- TEST ENVIRONMENT ONLY. This is NOT a migration, has no HTTP implementation
-- and must never run outside the named fresh local isolation database.
do $$begin
 if current_database() !~ '^ma_six_bug_test[0-9]+$'
 or (select scope from ma_isolated_guard.identity)<>'ma-six-bug-preventive-20260930'
 then raise exception 'LOCAL_ISOLATION_REQUIRED';end if;
end$$;
create schema net;
create table net.local_request_queue(id bigint generated always as identity primary key,url text,headers jsonb,body jsonb);
create table net._http_response(id bigint primary key,status_code int,content text,timed_out boolean default false,error_msg text);
create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 1000)
returns bigint language plpgsql as $$declare n bigint;begin
 if url<>'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-delivery-orchestrator'
 or headers->>'x-daily-delivery-token'<>'LOCAL_TEST_ONLY_NOT_PRODUCTION' then raise exception 'LOCAL_TRANSPORT_IDENTITY';end if;
 insert into net.local_request_queue(url,headers,body) values(url,headers,body) returning id into n;return n;
end$$;
create schema vault;
create view vault.decrypted_secrets as select 'morning_alpha_daily_delivery_token'::text as name,
 'LOCAL_TEST_ONLY_NOT_PRODUCTION'::text as decrypted_secret,clock_timestamp() as created_at;
insert into runtime_job_tokens(name,token_hash,is_active)
values('morning_alpha_daily_delivery',encode(sha256(convert_to('LOCAL_TEST_ONLY_NOT_PRODUCTION','UTF8')),'hex'),true);
-- Loopback bridge can read a queue and persist actual handler HTTP receipts;
-- it cannot invent a business result or a lifecycle state.
create function public.ma_local_take_dispatch() returns jsonb language sql as $$
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') from net.local_request_queue r
 where not exists(select 1 from net._http_response s where s.id=r.id)
$$;
create function public.ma_local_record_response(p_id bigint,p_status int,p_body jsonb) returns void language sql as $$
 insert into net._http_response(id,status_code,content)values(p_id,p_status,p_body::text)
$$;
grant usage on schema net,vault to service_role;
grant all on all tables in schema net to service_role;
grant execute on all functions in schema public to service_role;
notify pgrst,'reload schema';
