begin;
create or replace function public.get_emma_health_shared_secret()
returns text language sql stable security definer set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'emma_system_health_webhook_v1' limit 1 $$;
revoke all on function public.get_emma_health_shared_secret() from public, anon, authenticated, service_role;
grant execute on function public.get_emma_health_shared_secret() to service_role;
commit;;
