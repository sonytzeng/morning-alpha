create table if not exists public.market_data_snapshots (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  name text,
  market text,
  value numeric,
  change_percent numeric,
  captured_at timestamptz not null,
  source text,
  phase text not null check (phase in ('premarket', 'intraday', 'close', 'manual_backfill')),
  trading_date date not null,
  raw jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_market_data_snapshots_symbol_date_phase
  on public.market_data_snapshots (symbol, trading_date, phase);

create index if not exists idx_market_data_snapshots_trading_date_phase
  on public.market_data_snapshots (trading_date, phase);

create index if not exists idx_market_data_snapshots_captured_at
  on public.market_data_snapshots (captured_at);
