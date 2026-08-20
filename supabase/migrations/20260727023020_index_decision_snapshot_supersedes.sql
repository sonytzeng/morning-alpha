create index if not exists decision_snapshots_supersedes_idx
  on public.decision_snapshots (supersedes_id)
  where supersedes_id is not null;
