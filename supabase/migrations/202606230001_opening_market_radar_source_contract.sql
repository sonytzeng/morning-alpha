alter table if exists public.opening_market_radar
  add column if not exists captured_at timestamptz,
  add column if not exists source_kind text,
  add column if not exists data_source text,
  add column if not exists market_data_date date;

do $$
begin
  if to_regclass('public.opening_market_radar') is not null then
    create index if not exists idx_opening_market_radar_captured_at_desc
      on public.opening_market_radar (captured_at desc);

    create index if not exists idx_opening_market_radar_market_data_date_desc
      on public.opening_market_radar (market_data_date desc);
  end if;
end $$;
