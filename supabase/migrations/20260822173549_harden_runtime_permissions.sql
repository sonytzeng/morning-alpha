-- Close legacy write access before the checkpoint-preserving runtime is released.
-- Public readers retain SELECT access; only the service role may mutate radar rows.

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'opening_market_radar'
      and policyname = 'Service role write'
  ) then
    alter policy "Service role write"
      on public.opening_market_radar
      to service_role
      using (true)
      with check (true);
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Users can read own profile'
  ) then
    alter policy "Users can read own profile"
      on public.profiles
      using ((select auth.uid()) = id);
  end if;
end;
$$;

revoke insert, update, delete, truncate, references, trigger
  on table public.opening_market_radar
  from anon, authenticated;

grant select on table public.opening_market_radar to anon, authenticated;
grant all on table public.opening_market_radar to service_role;

do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    revoke execute on function public.handle_new_user() from public, anon, authenticated;
  end if;

  if to_regprocedure('public.handle_user_email_update()') is not null then
    revoke execute on function public.handle_user_email_update() from public, anon, authenticated;
  end if;
end;
$$;
;
