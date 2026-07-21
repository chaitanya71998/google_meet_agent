-- ============================================================================
-- Google Meet Agent — Supabase schema
-- Run this in the Supabase SQL editor (or `supabase db push`).
-- Enables Row Level Security so users only see their own data.
-- ============================================================================

-- Extensions ------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- Profiles (1:1 with auth.users) ---------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Meet sessions ---------------------------------------------------------------
create type public.session_status as enum (
  'idle', 'joining', 'in-call', 'transcribing', 'error', 'left'
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  name text not null default 'Meet Agent',
  mute boolean not null default true,
  video boolean not null default false,
  status public.session_status not null default 'idle',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on public.sessions (user_id);
create index if not exists sessions_updated_at_idx on public.sessions (updated_at desc);

-- Chat messages ---------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'agent')),
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_session_id_idx on public.messages (session_id, created_at);

-- Schedules (cron auto-join) --------------------------------------------------
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cron text not null,
  url text not null,
  name text not null default 'Meet Agent',
  mute boolean not null default true,
  video boolean not null default false,
  created_at timestamptz not null default now()
);

-- Row Level Security ----------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.schedules enable row level security;

-- Profiles
drop policy if exists "profiles own row" on public.profiles;
create policy "profiles own row" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Sessions
drop policy if exists "sessions owner" on public.sessions;
create policy "sessions owner" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Messages
drop policy if exists "messages owner" on public.messages;
create policy "messages owner" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Schedules
drop policy if exists "schedules owner" on public.schedules;
create policy "schedules owner" on public.schedules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime (listen to inserts/updates on messages + sessions) ----------------
do $$
begin
  alter publication supabase_realtime add table public.sessions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;
