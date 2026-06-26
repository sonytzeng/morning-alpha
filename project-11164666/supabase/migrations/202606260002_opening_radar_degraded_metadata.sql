alter table public.opening_market_radar
  add column if not exists data_status text,
  add column if not exists missing_sources jsonb default '[]'::jsonb,
  add column if not exists radar_mode text,
  add column if not exists txf_status text,
  add column if not exists input_source text;

create index if not exists idx_opening_market_radar_data_status
  on public.opening_market_radar(data_status);
