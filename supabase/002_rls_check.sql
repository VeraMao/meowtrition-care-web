-- Meowtrition RLS check: proves user A can't read or write user B's data.
-- Run in the Supabase SQL editor AFTER 001_schema.sql. Everything is rolled back at the end.
-- Expected output: a series of "PASS" notices and no exceptions.

begin;

-- two fake users
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');

set local role authenticated;

-- act as A: create a cat and a feeding log
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
insert into public.cats (id, name) values ('10000000-0000-0000-0000-00000000000a', 'A cat');
insert into public.feeding_logs (cat_id, kcal) values ('10000000-0000-0000-0000-00000000000a', 85);

-- act as B
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.cats (id, name) values ('10000000-0000-0000-0000-00000000000b', 'B cat');

do $$ begin
  if (select count(*) from public.cats) <> 1 then raise exception 'FAIL: B can see A''s cat'; end if;
  raise notice 'PASS 1: B sees only their own cat';

  if (select count(*) from public.feeding_logs) <> 0 then raise exception 'FAIL: B can see A''s feeding log'; end if;
  raise notice 'PASS 2: B cannot read A''s feeding logs';

  begin
    insert into public.feeding_logs (cat_id, kcal) values ('10000000-0000-0000-0000-00000000000a', 50);
    raise exception 'FAIL: B logged food for A''s cat';
  exception when foreign_key_violation or insufficient_privilege or check_violation then
    raise notice 'PASS 3: B cannot attach a log to A''s cat';
  end;

  begin
    insert into public.cats (owner_id, name) values ('00000000-0000-0000-0000-00000000000a', 'sneaky');
    raise exception 'FAIL: B created a row owned by A';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS 4: B cannot create rows as A';
  end;

  update public.cats set name = 'hacked' where id = '10000000-0000-0000-0000-00000000000a';
  raise notice 'PASS 5: B update on A''s cat touched 0 rows (checked below as A)';
end $$;

-- back to A: check nothing changed, and test review reset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$ begin
  if (select name from public.cats where id = '10000000-0000-0000-0000-00000000000a') <> 'A cat' then
    raise exception 'FAIL: A''s cat was changed by B'; end if;
  raise notice 'PASS 6: A''s cat unchanged';

  insert into public.care_reports (cat_id, period_start, period_end, metrics, summary, status, approved_at)
  values ('10000000-0000-0000-0000-00000000000a', now() - interval '7 days', now() + interval '1 hour',
          '{}', '{}', 'approved', now());
  insert into public.feeding_logs (cat_id, kcal) values ('10000000-0000-0000-0000-00000000000a', 20);
  if (select status from public.care_reports limit 1) <> 'needs_review' then
    raise exception 'FAIL: report stayed approved after a log changed'; end if;
  raise notice 'PASS 7: new log sent approved report back to needs_review';
end $$;

-- not logged in at all
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  if (select count(*) from public.cats) <> 0 then raise exception 'FAIL: logged-out user sees cats'; end if;
  raise notice 'PASS 8: logged-out user sees nothing';
end $$;

rollback;
