-- Run once in the Supabase SQL editor.
create table public.scores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 20),
  name_key text generated always as (lower(name)) stored,
  level int not null check (level between 1 and 100),
  time_ms int not null check (time_ms between 1000 and 86400000),
  created_at timestamptz not null default now()
);

create index scores_level_time_idx on public.scores (level, time_ms);
create index scores_name_key_idx on public.scores (name_key);

alter table public.scores enable row level security;

create policy "Iedereen mag scores lezen" on public.scores
  for select to anon using (true);

create policy "Iedereen mag scores toevoegen" on public.scores
  for insert to anon with check (true);

grant select, insert on public.scores to anon;
