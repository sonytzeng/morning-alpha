\set account random(1, 10000)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('cto-member-'||:account)::uuid::text,true);
select public.get_academy_catalog_v11();
select public.get_academy_lesson_v11('candles');
select * from public.academy_progress_v11 where user_id=auth.uid();
commit;
