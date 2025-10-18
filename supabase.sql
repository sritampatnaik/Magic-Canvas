-- Enable pgcrypto for gen_random_uuid (may already be enabled)
create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  created_at timestamptz not null default now(),
  created_by text
);

alter table public.rooms enable row level security;

-- Public read policy; writes limited to service role via API route using server key
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='rooms' and policyname='rooms_read_all'
  ) then
    create policy "rooms_read_all" on public.rooms for select using (true);
  end if;
end $$;


