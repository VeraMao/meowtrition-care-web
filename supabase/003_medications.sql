-- Meowtrition: medications + dose log. Paste into Supabase → SQL Editor → Run.
create table public.medications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  cat_id uuid not null,
  name text not null check (trim(name) <> ''),
  dose_as_prescribed text,          -- copied exactly from the label / vet, never computed by the app
  how_often text,
  start_date date,
  end_date date check (end_date is null or start_date is null or end_date >= start_date),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, cat_id) references public.cats(owner_id, id) on delete cascade
);

create table public.medication_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  cat_id uuid not null,
  medication_id uuid,
  given_at timestamptz not null default now(),
  status text not null default 'given' check (status in ('given','missed','refused','partial','vomited')),
  med_name_snapshot text not null,
  dose_snapshot text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, cat_id) references public.cats(owner_id, id) on delete cascade,
  foreign key (owner_id, medication_id) references public.medications(owner_id, id) on delete set null (medication_id)
);

create index on public.medications (owner_id, cat_id);
create index on public.medication_logs (owner_id, cat_id, given_at);
create index on public.medication_logs (owner_id, medication_id);

create trigger touch before update on public.medications for each row execute function public.touch_updated_at();
create trigger touch before update on public.medication_logs for each row execute function public.touch_updated_at();

-- review reset now also knows medication_logs.given_at
create or replace function public.reset_report_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb; t timestamptz; o uuid; c uuid;
begin
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  t := coalesce(j->>'occurred_at', j->>'observed_at', j->>'cleaned_at', j->>'measured_at', j->>'given_at')::timestamptz;
  o := (j->>'owner_id')::uuid;
  c := (j->>'cat_id')::uuid;
  update public.care_reports
     set status = 'needs_review', approved_at = null
   where owner_id = o
     and (c is null or cat_id = c)
     and t >= period_start and t < period_end
     and status = 'approved';
  return null;
end $$;
revoke execute on function public.reset_report_review() from public, anon, authenticated;
create trigger reset_review after insert or update or delete on public.medication_logs
  for each row execute function public.reset_report_review();

do $$ declare t text; begin
  foreach t in array array['medications','medication_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "select own" on public.%I for select using (owner_id = auth.uid())', t);
    execute format('create policy "insert own" on public.%I for insert with check (owner_id = auth.uid())', t);
    execute format('create policy "update own" on public.%I for update using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('create policy "delete own" on public.%I for delete using (owner_id = auth.uid())', t);
  end loop;
end $$;
