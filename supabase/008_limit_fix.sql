-- Meowtrition: close a loophole in 007. The "count an upsert once" shortcut matched ANY generation in the
-- same transaction, so one request inserting several review windows could skip the limits.
-- Now: every INSERT is checked; an UPDATE is skipped only if THIS SAME window was just counted in this
-- transaction (the BEFORE INSERT half of an upsert). Paste into Supabase → SQL Editor → Run.

alter table public.report_generations add column if not exists period_start timestamptz;
alter table public.report_generations add column if not exists period_end timestamptz;

create or replace function public.check_report_generation() returns trigger
language plpgsql security definer set search_path = public as $$
declare last_gen timestamptz; changed timestamptz; used int; oldest timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.metrics is not distinct from old.metrics and new.summary is not distinct from old.summary then
      return new;   -- approve / edit draft / stale marking: not a new generation
    end if;
    if exists (select 1 from public.report_generations
                where owner_id = new.owner_id and cat_id = new.cat_id and created_at = now()
                  and period_start = new.period_start and period_end = new.period_end) then
      return new;   -- second half of an upsert that was already checked and counted
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text || new.cat_id::text));
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
  insert into public.report_generations (owner_id, cat_id, period_start, period_end)
  values (new.owner_id, new.cat_id, new.period_start, new.period_end);
  return new;
end $$;
revoke execute on function public.check_report_generation() from public, anon, authenticated;
