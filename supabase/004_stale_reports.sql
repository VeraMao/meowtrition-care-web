-- Meowtrition: a review goes "stale" whenever data it was built from changes.
-- Fixes: (1) checks BOTH the old and the new date/cat on edits, (2) vet visit changes count too,
-- (3) a stale review must be regenerated; it can't just be re-approved.
-- Paste into Supabase → SQL Editor → Run (choose "Run and enable RLS" if asked; RLS is already on).

alter table public.care_reports drop constraint if exists care_reports_status_check;
alter table public.care_reports add constraint care_reports_status_check
  check (status in ('needs_review','approved','stale'));

create or replace function public.mark_reports_stale() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; t timestamptz; o uuid; c uuid;
begin
  -- look at the row before AND after the change, so moving a log to another day or cat is caught
  foreach r in array array[
      case when tg_op <> 'INSERT' then to_jsonb(old) end,
      case when tg_op <> 'DELETE' then to_jsonb(new) end]::jsonb[] loop
    continue when r is null;
    o := (r->>'owner_id')::uuid;
    c := (r->>'cat_id')::uuid;
    if tg_table_name = 'vet_visits' then
      -- a visit is context for every review of that cat whose window ends after the visit
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

do $$ declare t text; begin
  foreach t in array array['feeding_logs','hydration_logs','litter_logs','weight_logs','medication_logs','vet_visits'] loop
    execute format('drop trigger if exists reset_review on public.%I', t);
    execute format('drop trigger if exists stale_reports on public.%I', t);
    execute format('create trigger stale_reports after insert or update or delete on public.%I for each row execute function public.mark_reports_stale()', t);
  end loop;
end $$;

drop function if exists public.reset_report_review();
