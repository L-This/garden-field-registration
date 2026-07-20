-- Daily report submission control for the contractor field app.
-- Run once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.daily_report_windows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null,
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  constraint daily_report_windows_valid_range check (closes_at > opens_at)
);

create unique index if not exists daily_report_windows_one_active_date
  on public.daily_report_windows(project_id, report_date)
  where active = true;

create table if not exists public.daily_report_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null,
  status text not null default 'processing'
    check (status in ('processing', 'submitted', 'failed')),
  worker_name text,
  expected_gardens integer not null default 0,
  submitted_gardens integer not null default 0,
  total_photos integer not null default 0,
  report_number text,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint daily_report_submissions_project_date_unique unique(project_id, report_date)
);

alter table public.reports
  add column if not exists daily_submission_id uuid references public.daily_report_submissions(id) on delete cascade;

-- Protect all future contractor-created rows without touching old legacy duplicates.
create unique index if not exists reports_daily_submission_garden_unique
  on public.reports(daily_submission_id, garden_id)
  where daily_submission_id is not null;

create index if not exists reports_project_report_date_idx
  on public.reports(project_id, report_date);

create index if not exists daily_report_windows_lookup_idx
  on public.daily_report_windows(project_id, active, opens_at, closes_at);

create or replace function public.riyadh_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Riyadh')::date;
$$;

create or replace function public.report_day_is_scheduled(
  p_project_id uuid,
  p_garden_id uuid,
  p_report_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.watering_schedules ws
    where ws.project_id = p_project_id
      and ws.garden_id = p_garden_id
      and (
        coalesce(ws.daily_watering, false)
        or case extract(dow from p_report_date)::int
          when 0 then coalesce(ws.sunday, false)
          when 1 then coalesce(ws.monday, false)
          when 2 then coalesce(ws.tuesday, false)
          when 3 then coalesce(ws.wednesday, false)
          when 4 then coalesce(ws.thursday, false)
          when 5 then coalesce(ws.friday, false)
          when 6 then coalesce(ws.saturday, false)
        end
      )
  );
$$;

drop function if exists public.field_report_context(uuid);

create or replace function public.field_report_context(p_project_id uuid)
returns table (
  report_date date,
  is_backfill boolean,
  submission_status text,
  submission_id uuid,
  report_number text,
  submitted_at timestamptz,
  existing_report_count integer,
  worker_name text,
  submitted_gardens integer,
  total_photos integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_date date;
  v_is_backfill boolean := false;
  v_submission public.daily_report_submissions%rowtype;
  v_legacy_count integer := 0;
  v_legacy_worker text;
  v_legacy_submitted_at timestamptz;
  v_legacy_photos integer := 0;
begin
  select w.report_date, true
    into v_date, v_is_backfill
  from public.daily_report_windows w
  where w.project_id = p_project_id
    and w.active = true
    and now() between w.opens_at and w.closes_at
  order by w.created_at desc
  limit 1;

  if v_date is null then
    v_date := public.riyadh_today();
    v_is_backfill := false;
  end if;

  select * into v_submission
  from public.daily_report_submissions s
  where s.project_id = p_project_id
    and s.report_date = v_date;

  select count(*)::int, min(r.worker_name), max(r.created_at)
    into v_legacy_count, v_legacy_worker, v_legacy_submitted_at
  from public.reports r
  where r.project_id = p_project_id
    and r.report_date = v_date;

  if v_legacy_count > 0 then
    select count(p.id)::int into v_legacy_photos
    from public.photos p
    join public.reports r on r.id = p.report_id
    where r.project_id = p_project_id
      and r.report_date = v_date;
  end if;

  return query
  select
    v_date,
    v_is_backfill,
    case
      when v_submission.id is not null
        and v_submission.status = 'processing'
        and v_submission.started_at < now() - interval '60 minutes' then 'open'
      when v_submission.id is not null then v_submission.status
      when v_legacy_count > 0 then 'submitted_legacy'
      else 'open'
    end,
    v_submission.id,
    v_submission.report_number,
    coalesce(v_submission.submitted_at, v_legacy_submitted_at),
    v_legacy_count,
    coalesce(v_submission.worker_name, v_legacy_worker),
    coalesce(v_submission.submitted_gardens, v_legacy_count),
    coalesce(v_submission.total_photos, v_legacy_photos);
end;
$$;

create or replace function public.begin_daily_report_submission(
  p_project_id uuid,
  p_report_date date,
  p_worker_name text,
  p_expected_gardens integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_id uuid;
  v_scheduled_count integer;
begin
  -- Clear an abandoned upload reservation after one hour.
  delete from public.photos p
  using public.reports r, public.daily_report_submissions s
  where p.report_id = r.id
    and r.daily_submission_id = s.id
    and s.project_id = p_project_id
    and s.report_date = p_report_date
    and s.status = 'processing'
    and s.started_at < now() - interval '60 minutes';

  delete from public.reports r
  using public.daily_report_submissions s
  where r.daily_submission_id = s.id
    and s.project_id = p_project_id
    and s.report_date = p_report_date
    and s.status = 'processing'
    and s.started_at < now() - interval '60 minutes';

  delete from public.daily_report_submissions s
  where s.project_id = p_project_id
    and s.report_date = p_report_date
    and s.status = 'processing'
    and s.started_at < now() - interval '60 minutes';

  select * into v_context from public.field_report_context(p_project_id);

  if v_context.report_date is distinct from p_report_date then
    raise exception 'REPORT_DATE_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if v_context.submission_status in ('submitted', 'submitted_legacy') then
    raise exception 'REPORT_ALREADY_SUBMITTED' using errcode = '23505';
  end if;

  if v_context.submission_status = 'processing' then
    raise exception 'REPORT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  select count(*)::int into v_scheduled_count
  from public.watering_schedules ws
  where ws.project_id = p_project_id
    and (
      coalesce(ws.daily_watering, false)
      or case extract(dow from p_report_date)::int
        when 0 then coalesce(ws.sunday, false)
        when 1 then coalesce(ws.monday, false)
        when 2 then coalesce(ws.tuesday, false)
        when 3 then coalesce(ws.wednesday, false)
        when 4 then coalesce(ws.thursday, false)
        when 5 then coalesce(ws.friday, false)
        when 6 then coalesce(ws.saturday, false)
      end
    );

  if v_scheduled_count <> p_expected_gardens then
    raise exception 'SCHEDULE_COUNT_CHANGED' using errcode = 'P0001';
  end if;

  insert into public.daily_report_submissions(
    project_id, report_date, status, worker_name, expected_gardens
  ) values (
    p_project_id, p_report_date, 'processing', nullif(trim(p_worker_name), ''), p_expected_gardens
  )
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'REPORT_ALREADY_SUBMITTED_OR_IN_PROGRESS' using errcode = '23505';
end;
$$;

create or replace function public.finalize_daily_report_submission(p_submission_id uuid)
returns table(report_number text, submitted_at timestamptz, submitted_gardens integer, total_photos integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.daily_report_submissions%rowtype;
  v_reports integer;
  v_photos integer;
  v_number text;
  v_submitted_at timestamptz := now();
begin
  select * into v_submission
  from public.daily_report_submissions
  where id = p_submission_id
  for update;

  if v_submission.id is null then
    raise exception 'SUBMISSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_submission.status = 'submitted' then
    return query select v_submission.report_number, v_submission.submitted_at,
      v_submission.submitted_gardens, v_submission.total_photos;
    return;
  end if;

  select count(*)::int into v_reports
  from public.reports
  where daily_submission_id = p_submission_id;

  if v_reports <> v_submission.expected_gardens then
    raise exception 'INCOMPLETE_DAILY_REPORT' using errcode = 'P0001';
  end if;

  select count(p.id)::int into v_photos
  from public.photos p
  join public.reports r on r.id = p.report_id
  where r.daily_submission_id = p_submission_id;

  v_number := 'IRR-' || to_char(v_submission.report_date, 'YYYYMMDD') || '-' || upper(substr(replace(p_submission_id::text, '-', ''), 1, 8));

  update public.daily_report_submissions
  set status = 'submitted',
      submitted_gardens = v_reports,
      total_photos = v_photos,
      report_number = v_number,
      submitted_at = v_submitted_at,
      updated_at = now()
  where id = p_submission_id;

  update public.daily_report_windows
  set active = false
  where project_id = v_submission.project_id
    and report_date = v_submission.report_date
    and active = true;

  return query select v_number, v_submitted_at, v_reports, v_photos;
end;
$$;

create or replace function public.abort_daily_report_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.photos p
  using public.reports r
  where p.report_id = r.id
    and r.daily_submission_id = p_submission_id;

  delete from public.reports
  where daily_submission_id = p_submission_id;

  delete from public.daily_report_submissions
  where id = p_submission_id
    and status = 'processing';
end;
$$;

grant execute on function public.field_report_context(uuid) to anon, authenticated;
grant execute on function public.begin_daily_report_submission(uuid, date, text, integer) to anon, authenticated;
grant execute on function public.finalize_daily_report_submission(uuid) to anon, authenticated;
grant execute on function public.abort_daily_report_submission(uuid) to anon, authenticated;
grant execute on function public.report_day_is_scheduled(uuid, uuid, date) to anon, authenticated;

-- Example: temporarily open yesterday for one project for 6 hours.
-- insert into public.daily_report_windows(project_id, report_date, closes_at, note)
-- values ('PROJECT_UUID', public.riyadh_today() - 1, now() + interval '6 hours', 'تعويض تقرير يوم سابق');

-- =========================================================
-- Backfill scope upgrade: all scheduled gardens or selected gardens
-- =========================================================

alter table public.daily_report_windows
  add column if not exists scope_mode text not null default 'all'
    check (scope_mode in ('all', 'selected')),
  add column if not exists opened_by text;

create table if not exists public.daily_report_window_gardens (
  window_id uuid not null references public.daily_report_windows(id) on delete cascade,
  garden_id uuid not null references public.gardens(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (window_id, garden_id)
);

create index if not exists daily_report_window_gardens_garden_idx
  on public.daily_report_window_gardens(garden_id);

create or replace function public.active_daily_report_window(p_project_id uuid)
returns table (
  window_id uuid,
  report_date date,
  scope_mode text,
  note text,
  opened_by text,
  closes_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, w.report_date, w.scope_mode, w.note, w.opened_by, w.closes_at
  from public.daily_report_windows w
  where w.project_id = p_project_id
    and w.active = true
    and now() between w.opens_at and w.closes_at
  order by w.created_at desc
  limit 1;
$$;

create or replace function public.report_garden_is_allowed(
  p_project_id uuid,
  p_garden_id uuid,
  p_report_date date
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_window public.daily_report_windows%rowtype;
begin
  select * into v_window
  from public.daily_report_windows w
  where w.project_id = p_project_id
    and w.report_date = p_report_date
    and w.active = true
    and now() between w.opens_at and w.closes_at
  order by w.created_at desc
  limit 1;

  if v_window.id is not null and v_window.scope_mode = 'selected' then
    return exists (
      select 1
      from public.daily_report_window_gardens wg
      join public.gardens g on g.id = wg.garden_id
      where wg.window_id = v_window.id
        and wg.garden_id = p_garden_id
        and g.project_id = p_project_id
        and coalesce(g.active, true)
    );
  end if;

  return public.report_day_is_scheduled(p_project_id, p_garden_id, p_report_date);
end;
$$;

drop function if exists public.field_report_context(uuid);

create or replace function public.field_report_context(p_project_id uuid)
returns table (
  report_date date,
  is_backfill boolean,
  submission_status text,
  submission_id uuid,
  report_number text,
  submitted_at timestamptz,
  existing_report_count integer,
  worker_name text,
  submitted_gardens integer,
  total_photos integer,
  backfill_window_id uuid,
  backfill_scope_mode text,
  backfill_note text,
  backfill_opened_by text,
  backfill_closes_at timestamptz,
  allowed_gardens integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_date date;
  v_is_backfill boolean := false;
  v_window public.daily_report_windows%rowtype;
  v_submission public.daily_report_submissions%rowtype;
  v_legacy_count integer := 0;
  v_legacy_worker text;
  v_legacy_submitted_at timestamptz;
  v_legacy_photos integer := 0;
  v_allowed integer := 0;
begin
  select * into v_window
  from public.daily_report_windows w
  where w.project_id = p_project_id
    and w.active = true
    and now() between w.opens_at and w.closes_at
  order by w.created_at desc
  limit 1;

  if v_window.id is not null then
    v_date := v_window.report_date;
    v_is_backfill := true;
  else
    v_date := public.riyadh_today();
  end if;

  select * into v_submission
  from public.daily_report_submissions s
  where s.project_id = p_project_id
    and s.report_date = v_date;

  select count(*)::int, min(r.worker_name), max(r.created_at)
    into v_legacy_count, v_legacy_worker, v_legacy_submitted_at
  from public.reports r
  where r.project_id = p_project_id
    and r.report_date = v_date;

  if v_legacy_count > 0 then
    select count(p.id)::int into v_legacy_photos
    from public.photos p
    join public.reports r on r.id = p.report_id
    where r.project_id = p_project_id
      and r.report_date = v_date;
  end if;

  if v_window.id is not null and v_window.scope_mode = 'selected' then
    select count(*)::int into v_allowed
    from public.daily_report_window_gardens wg
    join public.gardens g on g.id = wg.garden_id
    where wg.window_id = v_window.id
      and g.project_id = p_project_id
      and coalesce(g.active, true);
  else
    select count(*)::int into v_allowed
    from public.watering_schedules ws
    join public.gardens g on g.id = ws.garden_id
    where ws.project_id = p_project_id
      and g.project_id = p_project_id
      and coalesce(g.active, true)
      and (
        coalesce(ws.daily_watering, false)
        or case extract(dow from v_date)::int
          when 0 then coalesce(ws.sunday, false)
          when 1 then coalesce(ws.monday, false)
          when 2 then coalesce(ws.tuesday, false)
          when 3 then coalesce(ws.wednesday, false)
          when 4 then coalesce(ws.thursday, false)
          when 5 then coalesce(ws.friday, false)
          when 6 then coalesce(ws.saturday, false)
        end
      );
  end if;

  return query
  select
    v_date,
    v_is_backfill,
    case
      when v_submission.id is not null
        and v_submission.status = 'processing'
        and v_submission.started_at < now() - interval '60 minutes' then 'open'
      when v_submission.id is not null then v_submission.status
      when v_legacy_count > 0 then 'submitted_legacy'
      else 'open'
    end,
    v_submission.id,
    v_submission.report_number,
    coalesce(v_submission.submitted_at, v_legacy_submitted_at),
    v_legacy_count,
    coalesce(v_submission.worker_name, v_legacy_worker),
    coalesce(v_submission.submitted_gardens, v_legacy_count),
    coalesce(v_submission.total_photos, v_legacy_photos),
    v_window.id,
    case when v_window.id is null then null else v_window.scope_mode end,
    v_window.note,
    v_window.opened_by,
    v_window.closes_at,
    v_allowed;
end;
$$;

create or replace function public.field_report_gardens(p_project_id uuid)
returns table (garden_id uuid, garden_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_context record;
begin
  select * into v_context from public.field_report_context(p_project_id);

  if v_context.is_backfill
     and v_context.backfill_scope_mode = 'selected'
     and v_context.backfill_window_id is not null then
    return query
    select g.id, g.name
    from public.daily_report_window_gardens wg
    join public.gardens g on g.id = wg.garden_id
    where wg.window_id = v_context.backfill_window_id
      and g.project_id = p_project_id
      and coalesce(g.active, true)
    order by g.created_at, g.name;
    return;
  end if;

  return query
  select distinct g.id, g.name
  from public.watering_schedules ws
  join public.gardens g on g.id = ws.garden_id
  where ws.project_id = p_project_id
    and g.project_id = p_project_id
    and coalesce(g.active, true)
    and (
      coalesce(ws.daily_watering, false)
      or case extract(dow from v_context.report_date)::int
        when 0 then coalesce(ws.sunday, false)
        when 1 then coalesce(ws.monday, false)
        when 2 then coalesce(ws.tuesday, false)
        when 3 then coalesce(ws.wednesday, false)
        when 4 then coalesce(ws.thursday, false)
        when 5 then coalesce(ws.friday, false)
        when 6 then coalesce(ws.saturday, false)
      end
    )
  order by g.created_at, g.name;
end;
$$;

create or replace function public.open_daily_report_backfill(
  p_project_id uuid,
  p_report_date date,
  p_closes_at timestamptz,
  p_scope_mode text default 'all',
  p_selected_garden_ids uuid[] default null,
  p_note text default null,
  p_opened_by text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_id uuid;
  v_valid_selected integer := 0;
  v_requested integer := coalesce(array_length(p_selected_garden_ids, 1), 0);
begin
  if p_report_date >= public.riyadh_today() then
    raise exception 'BACKFILL_DATE_MUST_BE_IN_THE_PAST' using errcode = 'P0001';
  end if;

  if p_closes_at <= now() then
    raise exception 'BACKFILL_CLOSE_TIME_MUST_BE_FUTURE' using errcode = 'P0001';
  end if;

  if p_scope_mode not in ('all', 'selected') then
    raise exception 'INVALID_BACKFILL_SCOPE' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.daily_report_submissions s
    where s.project_id = p_project_id
      and s.report_date = p_report_date
      and s.status in ('processing', 'submitted')
  ) or exists (
    select 1 from public.reports r
    where r.project_id = p_project_id
      and r.report_date = p_report_date
  ) then
    raise exception 'REPORT_ALREADY_EXISTS_FOR_DATE' using errcode = '23505';
  end if;

  if p_scope_mode = 'selected' then
    if v_requested = 0 then
      raise exception 'SELECT_AT_LEAST_ONE_GARDEN' using errcode = 'P0001';
    end if;

    select count(distinct g.id)::int into v_valid_selected
    from public.gardens g
    where g.project_id = p_project_id
      and coalesce(g.active, true)
      and g.id = any(p_selected_garden_ids);

    if v_valid_selected <> v_requested then
      raise exception 'INVALID_SELECTED_GARDENS' using errcode = 'P0001';
    end if;
  end if;

  update public.daily_report_windows
  set active = false
  where project_id = p_project_id
    and active = true;

  insert into public.daily_report_windows(
    project_id, report_date, opens_at, closes_at, active,
    scope_mode, note, opened_by
  ) values (
    p_project_id, p_report_date, now(), p_closes_at, true,
    p_scope_mode, nullif(trim(p_note), ''), nullif(trim(p_opened_by), '')
  ) returning id into v_window_id;

  if p_scope_mode = 'selected' then
    insert into public.daily_report_window_gardens(window_id, garden_id)
    select v_window_id, distinct unnest(p_selected_garden_ids);
  end if;

  return v_window_id;
end;
$$;

create or replace function public.close_daily_report_backfill(p_window_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.daily_report_windows
  set active = false
  where id = p_window_id;
$$;

create or replace function public.begin_daily_report_submission(
  p_project_id uuid,
  p_report_date date,
  p_worker_name text,
  p_expected_gardens integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_id uuid;
  v_allowed_count integer;
begin
  delete from public.photos p
  using public.reports r, public.daily_report_submissions s
  where p.report_id = r.id
    and r.daily_submission_id = s.id
    and s.project_id = p_project_id
    and s.report_date = p_report_date
    and s.status = 'processing'
    and s.started_at < now() - interval '60 minutes';

  delete from public.reports r
  using public.daily_report_submissions s
  where r.daily_submission_id = s.id
    and s.project_id = p_project_id
    and s.report_date = p_report_date
    and s.status = 'processing'
    and s.started_at < now() - interval '60 minutes';

  delete from public.daily_report_submissions s
  where s.project_id = p_project_id
    and s.report_date = p_report_date
    and s.status = 'processing'
    and s.started_at < now() - interval '60 minutes';

  select * into v_context from public.field_report_context(p_project_id);

  if v_context.report_date is distinct from p_report_date then
    raise exception 'REPORT_DATE_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if v_context.submission_status in ('submitted', 'submitted_legacy') then
    raise exception 'REPORT_ALREADY_SUBMITTED' using errcode = '23505';
  end if;

  if v_context.submission_status = 'processing' then
    raise exception 'REPORT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  select count(*)::int into v_allowed_count
  from public.field_report_gardens(p_project_id);

  if v_allowed_count = 0 then
    raise exception 'NO_GARDENS_AVAILABLE_FOR_REPORT' using errcode = 'P0001';
  end if;

  if v_allowed_count <> p_expected_gardens then
    raise exception 'REPORT_SCOPE_CHANGED' using errcode = 'P0001';
  end if;

  insert into public.daily_report_submissions(
    project_id, report_date, status, worker_name, expected_gardens
  ) values (
    p_project_id, p_report_date, 'processing', nullif(trim(p_worker_name), ''), p_expected_gardens
  ) returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'REPORT_ALREADY_SUBMITTED_OR_IN_PROGRESS' using errcode = '23505';
end;
$$;

grant select on public.daily_report_window_gardens to anon, authenticated;
grant execute on function public.active_daily_report_window(uuid) to anon, authenticated;
grant execute on function public.report_garden_is_allowed(uuid, uuid, date) to anon, authenticated;
grant execute on function public.field_report_context(uuid) to anon, authenticated;
grant execute on function public.field_report_gardens(uuid) to anon, authenticated;
grant execute on function public.open_daily_report_backfill(uuid, date, timestamptz, text, uuid[], text, text) to authenticated;
grant execute on function public.close_daily_report_backfill(uuid) to authenticated;

-- Examples for the administration dashboard:
-- 1) Open all scheduled gardens for a previous date for 6 hours:
-- select public.open_daily_report_backfill(
--   'PROJECT_UUID', '2026-07-19', now() + interval '6 hours',
--   'all', null, 'تعويض كامل', 'اسم المدير'
-- );
--
-- 2) Open selected gardens only:
-- select public.open_daily_report_backfill(
--   'PROJECT_UUID', '2026-07-19', now() + interval '6 hours',
--   'selected', array['GARDEN_UUID_1','GARDEN_UUID_2']::uuid[],
--   'تعويض مواقع مختارة', 'اسم المدير'
-- );

create or replace function public.list_daily_report_backfills(p_project_id uuid default null)
returns table (
  window_id uuid,
  project_id uuid,
  project_name text,
  report_date date,
  scope_mode text,
  selected_gardens integer,
  active boolean,
  opens_at timestamptz,
  closes_at timestamptz,
  opened_by text,
  note text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id,
    w.project_id,
    p.name,
    w.report_date,
    w.scope_mode,
    case when w.scope_mode = 'selected' then count(wg.garden_id)::int else null end,
    (w.active and now() between w.opens_at and w.closes_at),
    w.opens_at,
    w.closes_at,
    w.opened_by,
    w.note
  from public.daily_report_windows w
  join public.projects p on p.id = w.project_id
  left join public.daily_report_window_gardens wg on wg.window_id = w.id
  where p_project_id is null or w.project_id = p_project_id
  group by w.id, p.name
  order by w.created_at desc;
$$;

grant execute on function public.list_daily_report_backfills(uuid) to authenticated;
