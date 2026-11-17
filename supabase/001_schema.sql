-- Meowtrition Care Agent: web app schema (v0.1)
-- Target: Supabase project MeowAgent (dpockgdhspqavmvloryf). NOT the iOS project btbckyxnqstvxsmvuygl.
-- Applied as migration "meowtrition_care_web_schema" on 2026-11-16.
-- Every table: owner_id = the logged-in user. RLS on, with one policy per action.

create extension if not exists pgcrypto;

-- shared trigger to keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- tables ----------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (trim(name) <> ''),
  birth_date date,
  estimated_age_months int check (estimated_age_months >= 0),
  sex text not null default 'unknown' check (sex in ('male','female','unknown')),
  neutered boolean,
  daily_kcal_target numeric(8,2) check (daily_kcal_target > 0),
  is_demo boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create table public.foods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (trim(name) <> ''),
  brand text,
  default_serving_label text,
  default_kcal numeric(8,2) check (default_kcal > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  check (default_kcal is null or default_serving_label is not null)
);

-- composite FKs (owner_id, cat_id) stop a row from pointing at someone else's cat
create table public.feeding_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  cat_id uuid not null,
  occurred_at timestamptz not null default now(),
  kcal numeric(8,2) not null check (kcal > 0),
  food_id uuid,
  food_name_snapshot text,           -- saved at log time; editing the food later never changes this row
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, cat_id) references public.cats(owner_id, id) on delete cascade,
  foreign key (owner_id, food_id) references public.foods(owner_id, id) on delete set null (food_id)
);

create table public.hydration_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cat_id uuid,                        -- null = unknown cat (shared bowl)
  observed_at timestamptz not null default now(),
  volume_ml numeric(9,2) not null check (volume_ml >= 0),
  method text not null check (method in ('estimated_drunk','bowl_difference')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, cat_id) references public.cats(owner_id, id) on delete cascade
);

create table public.litter_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cat_id uuid,                        -- null = unknown cat
  cleaned_at timestamptz not null default now(),
  hours_since_last numeric(6,1) check (hours_since_last >= 0),
  urine_count int check (urine_count >= 0),   -- clumps seen at this cleaning, NOT urinations
  stool_count int check (stool_count >= 0),
  stool_shape text check (stool_shape in ('hard_pellets','formed','soft','watery','mixed','unknown')),
  symptoms text[] not null default '{}' check (symptoms <@ array[
    'frequent_visits','straining','no_or_drops_urine','pain','visible_blood','vomiting','lethargy','other']::text[]),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, cat_id) references public.cats(owner_id, id) on delete cascade,
  check (urine_count is not null or stool_count is not null or cardinality(symptoms) > 0)
);

create table public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  cat_id uuid not null,
  measured_at timestamptz not null default now(),
  weight_kg numeric(7,3) not null check (weight_kg > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, cat_id) references public.cats(owner_id, id) on delete cascade
);

create table public.vet_visits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  cat_id uuid not null,
  visit_date date not null,
  reason text,
  diagnosis_as_written text,
  medications text,
  next_checkup_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, cat_id) references public.cats(owner_id, id) on delete cascade
);

create table public.care_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  cat_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  metrics jsonb not null,             -- computed by code
  summary jsonb not null,             -- written by AI from metrics
  status text not null default 'needs_review' check (status in ('needs_review','approved')),
  approved_at timestamptz,
  vet_draft_body text,
  is_mock boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, cat_id) references public.cats(owner_id, id) on delete cascade,
  unique (owner_id, cat_id, period_start, period_end)
);

-- ---------- indexes ----------
create index on public.feeding_logs (owner_id, cat_id, occurred_at);
create index on public.hydration_logs (owner_id, cat_id, observed_at);
create index on public.litter_logs (owner_id, cat_id, cleaned_at);
create index on public.weight_logs (owner_id, cat_id, measured_at);
create index on public.vet_visits (owner_id, cat_id, visit_date);
create index on public.care_reports (owner_id, cat_id, period_start);

-- ---------- updated_at triggers ----------
do $$ declare t text; begin
  foreach t in array array['profiles','cats','foods','feeding_logs','hydration_logs','litter_logs',
                           'weight_logs','vet_visits','care_reports'] loop
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- review reset: editing a source log sends that cat's overlapping reports back to needs_review ----------
create or replace function public.reset_report_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb; t timestamptz; o uuid; c uuid;
begin
  -- jsonb lets one function read the time column of four different tables
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  t := coalesce(j->>'occurred_at', j->>'observed_at', j->>'cleaned_at', j->>'measured_at')::timestamptz;
  o := (j->>'owner_id')::uuid;
  c := (j->>'cat_id')::uuid;
  update public.care_reports
     set status = 'needs_review', approved_at = null
   where owner_id = o
     and (c is null or cat_id = c)
     and t >= period_start and t < period_end
     and status = 'approved';
  return null;  -- AFTER trigger: return value is ignored
end $$;

do $$ declare t text; begin
  foreach t in array array['feeding_logs','hydration_logs','litter_logs','weight_logs'] loop
    execute format('create trigger reset_review after insert or update or delete on public.%I for each row execute function public.reset_report_review()', t);
  end loop;
end $$;

-- ---------- RLS: each user sees and changes only their own rows ----------
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

do $$ declare t text; begin
  foreach t in array array['cats','foods','feeding_logs','hydration_logs','litter_logs',
                           'weight_logs','vet_visits','care_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "select own" on public.%I for select using (owner_id = auth.uid())', t);
    execute format('create policy "insert own" on public.%I for insert with check (owner_id = auth.uid())', t);
    execute format('create policy "update own" on public.%I for update using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('create policy "delete own" on public.%I for delete using (owner_id = auth.uid())', t);
  end loop;
end $$;

-- create a profile row automatically when someone signs up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id) values (new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger functions are only for triggers; don't expose them as API endpoints (Supabase security advisor 0028/0029).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.reset_report_review() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Migration food_label_units (2026-11-16): calories as printed on the label + optional amount eaten.
alter table public.foods
  add column kcal_basis text check (kcal_basis in ('cup','can','pouch','kg','100g','piece','serving'));
alter table public.feeding_logs
  add column amount numeric(10,3) check (amount > 0),
  add column amount_unit text check (amount_unit in ('cup','can','pouch','g','piece','serving'));

-- Migration food_label_multi_units (2026-11-16): a food can store every calorie figure on its label.
alter table public.foods
  add column kcal_per_kg numeric(8,2) check (kcal_per_kg > 0),
  add column kcal_per_cup numeric(8,2) check (kcal_per_cup > 0),
  add column kcal_per_unit numeric(8,2) check (kcal_per_unit > 0),
  add column unit_name text check (unit_name in ('can','pouch','piece','serving')),
  add constraint unit_needs_name check (kcal_per_unit is null or unit_name is not null);
-- (backfill from kcal_basis/default_kcal ran once on the live DB; those two columns are now legacy)
