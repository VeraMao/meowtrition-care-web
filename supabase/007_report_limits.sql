-- Meowtrition: limits on creating weekly reviews (enforced in the database, not just the UI).
--  Rule 1: a new review needs new information: something about this cat was added, changed or deleted
--          since the last review was generated (logs, water/litter incl. unknown-cat rows, weight,
--          doses, medications, vet visits). The very first review is always allowed.
--  Rule 2: at most 3 reviews per cat in any rolling 7 days.
-- Approving a review or editing its email draft does NOT count; only (re)generating its content does.
-- Paste into Supabase → SQL Editor → Run (choose "Run and enable RLS" if asked).

alter table public.cats add column if not exists data_changed_at timestamptz not null default now();

create table if not exists public.report_generations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cat_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (owner_id, cat_id) references public.cats(owner_id, id) on delete cascade
);
create index if not exists report_generations_cat_time on public.report_generations (owner_id, cat_id, created_at);
alter table public.report_generations enable row level security;
drop policy if exists "select own" on public.report_generations;
create policy "select own" on public.report_generations for select using (owner_id = auth.uid());
-- no insert/update/delete policies: rows are only written by the trigger below

-- 1) remember when this cat's data last changed (extends the existing stale-report trigger function)
create or replace function public.mark_reports_stale() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; t timestamptz; o uuid; c uuid;
begin
  foreach r in array array[
      case when tg_op <> 'INSERT' then to_jsonb(old) end,
      case when tg_op <> 'DELETE' then to_jsonb(new) end]::jsonb[] loop
    continue when r is null;
    o := (r->>'owner_id')::uuid;
    c := (r->>'cat_id')::uuid;
    -- unknown-cat rows could belong to any of the owner's cats
    update public.cats set data_changed_at = clock_timestamp()
     where owner_id = o and (c is null or id = c);
    if tg_table_name = 'medications' then
      continue;   -- the medication list changes context but has no date of its own
    elsif tg_table_name = 'vet_visits' then
      update public.care_reports set status = 'stale', approved_at = null
       where owner_id = o and cat_id = c
         and period_end > ((r->>'visit_date')::date)::timestamp at time zone 'America/Chicago'
         and status <> 'stale';
    else
      t := coalesce(r->>'occurred_at', r->>'observed_at', r->>'cleaned_at', r->>'measured_at', r->>'given_at')::timestamptz;
      update public.care_reports set status = 'stale', approved_at = null
       where owner_id = o and (c is null or cat_id = c)
         and t >= period_start and t < period_end
         and status <> 'stale';
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.mark_reports_stale() from public, anon, authenticated;
drop trigger if exists stale_reports on public.medications;
create trigger stale_reports after insert or update or delete on public.medications
  for each row execute function public.mark_reports_stale();

-- 2) gate every time a review's content is generated (insert, or upsert that rewrites metrics/summary)
create or replace function public.check_report_generation() returns trigger
language plpgsql security definer set search_path = public as $$
declare last_gen timestamptz; changed timestamptz; used int; oldest timestamptz;
begin
  if tg_op = 'UPDATE' and new.metrics is not distinct from old.metrics and new.summary is not distinct from old.summary then
    return new;   -- approve / edit draft / stale marking: not a new generation
  end if;
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text || new.cat_id::text));   -- no double-click races
  -- an upsert fires BEFORE INSERT and then BEFORE UPDATE in the same statement: count it once
  if exists (select 1 from public.report_generations
              where owner_id = new.owner_id and cat_id = new.cat_id and created_at = now()) then
    return new;
  end if;
  select max(created_at) into last_gen from public.report_generations where owner_id = new.owner_id and cat_id = new.cat_id;
  select data_changed_at into changed from public.cats where id = new.cat_id and owner_id = new.owner_id;
  if last_gen is not null and (changed is null or changed <= last_gen) then
    raise exception 'no_new_data' using hint = 'Nothing was logged, changed or deleted for this cat since the last review.';
  end if;
  select count(*), min(created_at) into used, oldest from public.report_generations
   where owner_id = new.owner_id and cat_id = new.cat_id and created_at > now() - interval '7 days';
  if used >= 3 then
    raise exception 'weekly_limit:%', to_char((oldest + interval '7 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      using hint = 'At most 3 reviews per cat in 7 days.';
  end if;
  insert into public.report_generations (owner_id, cat_id) values (new.owner_id, new.cat_id);
  return new;
end $$;
revoke execute on function public.check_report_generation() from public, anon, authenticated;
drop trigger if exists limit_generation on public.care_reports;
create trigger limit_generation before insert or update on public.care_reports
  for each row execute function public.check_report_generation();

-- 3) what the app shows next to the Create button (respects RLS: only your own cats)
create or replace function public.report_quota(p_cat_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  with g as (select created_at from public.report_generations where cat_id = p_cat_id),
       w as (select count(*) as used, min(created_at) as oldest from g where created_at > now() - interval '7 days')
  select jsonb_build_object(
    'used', (select used from w),
    'limit', 3,
    'next_available_at', case when (select used from w) >= 3 then (select oldest from w) + interval '7 days' end,
    'last_generated_at', (select max(created_at) from g),
    'data_changed_at', (select data_changed_at from public.cats where id = p_cat_id),
    'has_new_data', (select max(created_at) from g) is null
                    or (select data_changed_at from public.cats where id = p_cat_id) > (select max(created_at) from g));
$$;
revoke execute on function public.report_quota(uuid) from public, anon;
grant execute on function public.report_quota(uuid) to authenticated;
