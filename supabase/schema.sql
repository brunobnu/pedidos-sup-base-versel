create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  client_key text unique,
  name text not null,
  cnpj text default '',
  erp text default '',
  segment text default '',
  owner text default '',
  notes text default '',
  active boolean default true,
  dashboard_active boolean default true,
  created_at timestamp with time zone default now()
);

create table if not exists public.monthly_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  competencia text not null,
  quantity numeric default 0,
  source text default 'importado',
  observation text default '',
  created_at timestamp with time zone default now(),
  unique (client_id, competencia)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  competencia text,
  observation text default '',
  reason text default '',
  owner text default '',
  next_action text default '',
  action_date text default '',
  created_at timestamp with time zone default now()
);

create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  months_ahead integer not null,
  result jsonb not null,
  input jsonb default '{}'::jsonb,
  credits_used integer default 10,
  created_by text default '',
  created_at timestamp with time zone default now()
);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  active_year integer not null,
  forecast_method text default 'historicalMonthly',
  tolerance numeric default 10,
  created_at timestamp with time zone default now()
);

create index if not exists monthly_records_client_competencia_idx
  on public.monthly_records (client_id, competencia);

create index if not exists comments_client_competencia_idx
  on public.comments (client_id, competencia);

create index if not exists ai_insights_client_created_idx
  on public.ai_insights (client_id, created_at desc);
