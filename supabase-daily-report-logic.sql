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

create or replace function public.field_report_context(p_project_id uuid)
returns table (
  report_date date,
  is_backfill boolean,
  submission_status text,
  submission_id uuid,
  report_number text,
  submitted_at timestamptz,
  existing_report_count integer
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

  select count(*)::int into v_legacy_count
  from public.reports r
  where r.project_id = p_project_id
    and r.report_date = v_date;

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
    v_submission.submitted_at,
    v_legacy_count;
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
