-- Meowtrition: personal keys so Claude can read ONE user's data through the app's connector,
-- without anyone getting database-admin access.
-- Paste into Supabase → SQL Editor → Run (choose "Run and enable RLS" if asked).

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null default 'Claude' check (trim(label) <> ''),
  key_prefix text not null,                 -- first characters, only for recognising the key in the UI
  key_hash text not null unique,            -- sha256 of the full key; the key itself is never stored
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index on public.api_keys (owner_id);
alter table public.api_keys enable row level security;
create policy "select own" on public.api_keys for select using (owner_id = auth.uid());
create policy "insert own" on public.api_keys for insert with check (owner_id = auth.uid());
create policy "update own" on public.api_keys for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "delete own" on public.api_keys for delete using (owner_id = auth.uid());

-- Resolve a raw key to its owner. Internal only.
create or replace function public.key_owner(p_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o uuid; kid uuid;
begin
  if p_key is null or length(p_key) < 20 then raise exception 'invalid_key'; end if;
  select id, owner_id into kid, o from public.api_keys
   where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex') and revoked_at is null;
  if o is null then raise exception 'invalid_key'; end if;
  update public.api_keys set last_used_at = now() where id = kid;
  return o;
end $$;
revoke execute on function public.key_owner(text) from public, anon, authenticated;

-- Everything the weekly review needs, for the key's owner only.
create or replace function public.skill_export(p_key text, p_days int default 7, p_include_today boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o uuid; tz text; base timestamp; s timestamptz; e timestamptz; n int;
begin
  o := public.key_owner(p_key);
  select coalesce(timezone, 'America/Chicago') into tz from public.profiles where id = o;
  tz := coalesce(tz, 'America/Chicago');
  n := least(greatest(coalesce(p_days, 7), 1), 31);
  base := date_trunc('day', now() at time zone tz) + case when p_include_today then interval '1 day' else interval '0' end;
  e := base at time zone tz;
  s := (base - make_interval(days => n)) at time zone tz;
  return jsonb_build_object(
    'window', jsonb_build_object('start', s, 'end', e, 'timezone', tz, 'days', n, 'includes_today', p_include_today,
               'local_dates', (select jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d) from generate_series((base - make_interval(days => n))::date, (base - interval '1 day')::date, interval '1 day') d)),
    'cats', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'sex', c.sex, 'neutered', c.neutered, 'birth_date', c.birth_date,
        'daily_kcal_target', c.daily_kcal_target,
        'feeding', coalesce((select jsonb_agg(jsonb_build_object('local_date', (f.occurred_at at time zone tz)::date, 'at', f.occurred_at, 'kcal', f.kcal,
                        'amount', f.amount, 'amount_unit', f.amount_unit, 'food', f.food_name_snapshot, 'notes', f.notes) order by f.occurred_at)
                     from public.feeding_logs f where f.owner_id = o and f.cat_id = c.id and f.occurred_at >= s and f.occurred_at < e), '[]'),
        'water', coalesce((select jsonb_agg(jsonb_build_object('local_date', (h.observed_at at time zone tz)::date, 'at', h.observed_at, 'ml', h.volume_ml,
                        'method', h.method, 'notes', h.notes) order by h.observed_at)
                     from public.hydration_logs h where h.owner_id = o and h.cat_id = c.id and h.observed_at >= s and h.observed_at < e), '[]'),
        'litter', coalesce((select jsonb_agg(jsonb_build_object('local_date', (l.cleaned_at at time zone tz)::date, 'at', l.cleaned_at,
                        'urine_clumps', l.urine_count, 'stools', l.stool_count, 'stool_shape', l.stool_shape,
                        'hours_since_last', l.hours_since_last, 'symptoms', l.symptoms, 'notes', l.notes) order by l.cleaned_at)
                     from public.litter_logs l where l.owner_id = o and l.cat_id = c.id and l.cleaned_at >= s and l.cleaned_at < e), '[]'),
        'weight', coalesce((select jsonb_agg(jsonb_build_object('local_date', (w.measured_at at time zone tz)::date, 'kg', w.weight_kg) order by w.measured_at)
                     from public.weight_logs w where w.owner_id = o and w.cat_id = c.id and w.measured_at >= s and w.measured_at < e), '[]'),
        'medication_doses', coalesce((select jsonb_agg(jsonb_build_object('local_date', (m.given_at at time zone tz)::date, 'at', m.given_at, 'status', m.status,
                        'medication', m.med_name_snapshot, 'dose_as_prescribed', m.dose_snapshot, 'notes', m.notes) order by m.given_at)
                     from public.medication_logs m where m.owner_id = o and m.cat_id = c.id and m.given_at >= s and m.given_at < e), '[]'),
        'medications', coalesce((select jsonb_agg(jsonb_build_object('name', md.name, 'dose_as_prescribed', md.dose_as_prescribed, 'how_often', md.how_often,
                        'start_date', md.start_date, 'end_date', md.end_date) order by md.name)
                     from public.medications md where md.owner_id = o and md.cat_id = c.id and md.archived_at is null), '[]'),
        'vet_visits', coalesce((select jsonb_agg(jsonb_build_object('visit_date', v.visit_date, 'reason', v.reason, 'what_the_vet_said', v.diagnosis_as_written,
                        'medications', v.medications, 'next_checkup_date', v.next_checkup_date, 'notes', v.notes) order by v.visit_date desc)
                     from (select * from public.vet_visits v where v.owner_id = o and v.cat_id = c.id order by visit_date desc limit 20) v), '[]')
      ) order by c.created_at) from public.cats c where c.owner_id = o and c.archived_at is null), '[]'),
    'unknown_cat', jsonb_build_object(
        'water', coalesce((select jsonb_agg(jsonb_build_object('local_date', (h.observed_at at time zone tz)::date, 'ml', h.volume_ml, 'method', h.method) order by h.observed_at)
                     from public.hydration_logs h where h.owner_id = o and h.cat_id is null and h.observed_at >= s and h.observed_at < e), '[]'),
        'litter', coalesce((select jsonb_agg(jsonb_build_object('local_date', (l.cleaned_at at time zone tz)::date, 'urine_clumps', l.urine_count, 'stools', l.stool_count,
                        'stool_shape', l.stool_shape, 'symptoms', l.symptoms) order by l.cleaned_at)
                     from public.litter_logs l where l.owner_id = o and l.cat_id is null and l.cleaned_at >= s and l.cleaned_at < e), '[]'))
  );
end $$;

-- Save a vet visit the owner has confirmed (step 6 of the Skill). Only into the key owner's own cat.
create or replace function public.skill_save_vet_visit(p_key text, p_cat_id uuid, p_visit_date date,
  p_reason text default null, p_what_the_vet_said text default null, p_medications text default null,
  p_next_checkup_date date default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o uuid; vid uuid;
begin
  o := public.key_owner(p_key);
  if not exists (select 1 from public.cats where id = p_cat_id and owner_id = o) then raise exception 'cat_not_found'; end if;
  if exists (select 1 from public.vet_visits where owner_id = o and cat_id = p_cat_id and visit_date = p_visit_date) then
    raise exception 'visit_already_exists_for_date';
  end if;
  insert into public.vet_visits (owner_id, cat_id, visit_date, reason, diagnosis_as_written, medications, next_checkup_date, notes)
  values (o, p_cat_id, p_visit_date, p_reason, p_what_the_vet_said, p_medications, p_next_checkup_date,
          '[Saved via Claude connector ' || to_char(now(), 'YYYY-MM-DD') || '] ' || coalesce(p_notes, ''))
  returning id into vid;
  return jsonb_build_object('saved', true, 'id', vid, 'visit_date', p_visit_date);
end $$;

-- The app's server calls these with the public (anon) key; the raw personal key is what authorises.
revoke execute on function public.skill_export(text, int, boolean) from public;
revoke execute on function public.skill_save_vet_visit(text, uuid, date, text, text, text, date, text) from public;
grant execute on function public.skill_export(text, int, boolean) to anon, authenticated;
grant execute on function public.skill_save_vet_visit(text, uuid, date, text, text, text, date, text) to anon, authenticated;
