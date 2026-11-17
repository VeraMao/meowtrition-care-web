-- Regression check for 004_stale_reports.sql. Safe: everything is rolled back at the end.
-- Run in Supabase → SQL Editor. Expected: an "error" whose message starts with
-- "RESULTS (rolled back):" and lists PASS1 … PASS9. Any FAIL means the fix is broken.
do $$
declare res text := ''; s text;
begin
  insert into auth.users (id, aud, role, email) values ('00000000-0000-0000-0000-00000000000a','authenticated','authenticated','stale-a@test.invalid');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  insert into public.cats (id, name) values ('10000000-0000-0000-0000-00000000000a', 'A'), ('10000000-0000-0000-0000-00000000000b', 'B');
  insert into public.feeding_logs (id, cat_id, kcal, occurred_at) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a', 50, '2026-11-12T18:00:00Z');
  insert into public.care_reports (cat_id, period_start, period_end, metrics, summary, status, approved_at)
    values ('10000000-0000-0000-0000-00000000000a','2026-11-10T06:00:00Z','2026-11-17T06:00:00Z','{}','{}','approved',now());
  update public.feeding_logs set occurred_at = '2026-10-01T18:00:00Z';
  select status into s from public.care_reports; res := res || case when s='stale' then 'PASS1 moved-out | ' else 'FAIL1 '||s||' | ' end;
  update public.care_reports set status='approved', approved_at=now();
  update public.feeding_logs set occurred_at = '2026-11-13T18:00:00Z';
  select status into s from public.care_reports; res := res || case when s='stale' then 'PASS2 moved-in | ' else 'FAIL2 '||s||' | ' end;
  update public.care_reports set status='approved', approved_at=now();
  update public.feeding_logs set cat_id = '10000000-0000-0000-0000-00000000000b';
  select status into s from public.care_reports; res := res || case when s='stale' then 'PASS3 changed-cat | ' else 'FAIL3 '||s||' | ' end;
  update public.care_reports set status='approved', approved_at=now();
  insert into public.vet_visits (cat_id, visit_date, reason) values ('10000000-0000-0000-0000-00000000000a','2026-11-12','x');
  select status into s from public.care_reports; res := res || case when s='stale' then 'PASS4 new-visit | ' else 'FAIL4 '||s||' | ' end;
  update public.care_reports set status='approved', approved_at=now();
  update public.vet_visits set diagnosis_as_written = 'changed';
  select status into s from public.care_reports; res := res || case when s='stale' then 'PASS5 edited-visit | ' else 'FAIL5 '||s||' | ' end;
  update public.care_reports set status='approved', approved_at=now();
  insert into public.vet_visits (cat_id, visit_date) values ('10000000-0000-0000-0000-00000000000a','2026-12-20');
  select status into s from public.care_reports; res := res || case when s='approved' then 'PASS6 later-visit-ignored | ' else 'FAIL6 '||s||' | ' end;
  insert into public.weight_logs (cat_id, weight_kg, measured_at) values ('10000000-0000-0000-0000-00000000000b', 5, '2026-11-12T18:00:00Z');
  select status into s from public.care_reports; res := res || case when s='approved' then 'PASS7 other-cat-ignored | ' else 'FAIL7 '||s||' | ' end;
  insert into public.litter_logs (cat_id, urine_count, cleaned_at) values (null, 1, '2026-11-12T18:00:00Z');
  select status into s from public.care_reports; res := res || case when s='stale' then 'PASS8 unknown-cat-litter | ' else 'FAIL8 '||s||' | ' end;
  insert into public.medications (id, cat_id, name) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','M');
  insert into public.medication_logs (cat_id, medication_id, med_name_snapshot, given_at) values ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','M','2026-11-12T18:00:00Z');
  update public.care_reports set status='approved', approved_at=now();
  delete from public.medication_logs;
  select status into s from public.care_reports; res := res || case when s='stale' then 'PASS9 deleted-med-log' else 'FAIL9 '||s end;
  raise exception 'RESULTS (rolled back): %', res;
end $$;
