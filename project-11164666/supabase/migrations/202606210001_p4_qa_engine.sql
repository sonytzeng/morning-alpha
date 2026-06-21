create table if not exists public.system_health_logs (
  id uuid primary key default gen_random_uuid(),
  check_date date not null,
  report_exists boolean default false,
  report_date_correct boolean default false,
  has_market_bias boolean default false,
  has_confidence boolean default false,
  has_member_note_v2 boolean default false,
  has_opening_radar boolean default false,
  has_sector_rotation boolean default false,
  has_closing_verification boolean default false,
  health_score integer default 0,
  issues jsonb default '[]'::jsonb,
  raw_snapshot jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_system_health_logs_check_date_desc
  on public.system_health_logs (check_date desc);

create index if not exists idx_system_health_logs_created_at_desc
  on public.system_health_logs (created_at desc);

alter table public.system_health_logs enable row level security;

drop policy if exists "system_health_logs_authenticated_read" on public.system_health_logs;
create policy "system_health_logs_authenticated_read"
  on public.system_health_logs
  for select
  to authenticated
  using (true);

create table if not exists public.prediction_accuracy_logs (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  predicted_bias text,
  confidence integer,
  actual_taiex_change numeric,
  actual_direction text,
  prediction_result text,
  accuracy_score integer,
  reason jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_prediction_accuracy_logs_report_date_desc
  on public.prediction_accuracy_logs (report_date desc);

create index if not exists idx_prediction_accuracy_logs_created_at_desc
  on public.prediction_accuracy_logs (created_at desc);

alter table public.prediction_accuracy_logs enable row level security;

drop policy if exists "prediction_accuracy_logs_authenticated_read" on public.prediction_accuracy_logs;
create policy "prediction_accuracy_logs_authenticated_read"
  on public.prediction_accuracy_logs
  for select
  to authenticated
  using (true);
