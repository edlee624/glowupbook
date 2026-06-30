-- Glowup Book - combined migrations. Run in order in the Supabase SQL Editor.

-- ===== 0001_init.sql =====
-- ============================================================================
-- Glowbook — initial schema
-- Multi-tenant booking CRM for salons / barbers / hairdressers / nail studios.
--
-- Each salon is a tenant. Staff log in via Supabase Auth; their access is scoped
-- to the salon(s) they belong to. The PUBLIC storefront is anonymous: visitors
-- never query appointment rows directly — availability and booking go through
-- SECURITY DEFINER RPCs (see 0002) so no customer data leaks to the browser.
--
-- Security model: the browser talks to Postgres directly through Supabase, so
-- Row Level Security (RLS) is the real boundary. Every table has RLS enabled and
-- explicit policies. The anon/auth client can ONLY do what the policies allow.
-- ============================================================================

create extension if not exists "pgcrypto";

-- Forward references in policies call helper functions defined just below; defer
-- body validation until call time so creation order doesn't error.
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type user_role         as enum ('owner', 'staff', 'admin');
create type member_role        as enum ('owner', 'manager', 'staff');
create type appointment_status as enum ('booked', 'confirmed', 'completed', 'cancelled', 'no_show');
create type appointment_source as enum ('online', 'manual');

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so policies can call them without
-- recursing into RLS). STABLE; search_path pinned for safety.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Is the current user a member (any role) of this salon?
create or replace function public.is_salon_member(p_salon uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.salons s where s.id = p_salon and s.owner_id = auth.uid()
    union
    select 1 from public.salon_members m where m.salon_id = p_salon and m.profile_id = auth.uid()
  );
$$;

-- Is the current user an owner/manager of this salon (i.e. can manage settings)?
create or replace function public.is_salon_manager(p_salon uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.salons s where s.id = p_salon and s.owner_id = auth.uid()
    union
    select 1 from public.salon_members m
      where m.salon_id = p_salon and m.profile_id = auth.uid()
        and m.member_role in ('owner','manager')
  );
$$;

-- updated_at trigger helper
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ===========================================================================
-- IDENTITY
-- ===========================================================================

-- One row per auth.users. Created automatically on signup (trigger below).
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role   not null default 'owner',
  full_name   text,
  email       text,
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles: self read"   on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles: self update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
-- inserts happen via the signup trigger (security definer), not the client.

-- Provision a profile row when a new auth user is created. The name flows from
-- the signup metadata the frontend passes (data: { full_name }).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'owner')
  );
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- SALONS (tenants)
-- ===========================================================================
create table public.salons (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  slug          text not null unique,          -- public storefront URL: /book/<slug>
  business_type text,                           -- 'hair' | 'barber' | 'nails' | 'beauty' | ...
  about         text,
  phone         text,
  email         text,
  address       text,
  city          text,
  timezone      text not null default 'UTC',    -- IANA tz; availability is computed in it
  logo_url      text,
  cover_url     text,
  currency      text not null default 'USD',
  is_published  boolean not null default false, -- storefront live + bookable online?
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.salons enable row level security;
create trigger salons_touch before update on public.salons for each row execute function public.touch_updated_at();
create index on public.salons (owner_id);

-- Published salons are publicly readable (the storefront). Members always see
-- their own. Anyone authenticated/anon can read a published salon's profile.
create policy "salons: read published or member" on public.salons for select
  using (is_published or public.is_salon_member(id) or public.is_admin());
create policy "salons: owner insert" on public.salons for insert with check (owner_id = auth.uid());
create policy "salons: manager update" on public.salons for update
  using (public.is_salon_manager(id)) with check (public.is_salon_manager(id));
create policy "salons: owner delete" on public.salons for delete using (owner_id = auth.uid());

-- Staff who have a login. (Staff WITHOUT a login still exist as rows in `staff`.)
create table public.salon_members (
  salon_id    uuid not null references public.salons(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  member_role member_role not null default 'staff',
  created_at  timestamptz not null default now(),
  primary key (salon_id, profile_id)
);
alter table public.salon_members enable row level security;
create policy "members: read"   on public.salon_members for select
  using (public.is_salon_member(salon_id) or profile_id = auth.uid());
create policy "members: manage"  on public.salon_members for all
  using (public.is_salon_manager(salon_id)) with check (public.is_salon_manager(salon_id));

-- ===========================================================================
-- STAFF (service providers — may or may not have a login)
-- ===========================================================================
create table public.staff (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete set null,  -- null = no login
  name        text not null,
  title       text,                              -- 'Senior Stylist', 'Barber', ...
  bio         text,
  photo_url   text,
  color       text,                              -- calendar colour, e.g. '#FF5A3C'
  is_active   boolean not null default true,
  accepts_online_booking boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.staff enable row level security;
create trigger staff_touch before update on public.staff for each row execute function public.touch_updated_at();
create index on public.staff (salon_id);

-- Active staff at a published salon are public (shown on the storefront).
create policy "staff: read public or member" on public.staff for select
  using (
    public.is_salon_member(salon_id)
    or (is_active and exists (select 1 from public.salons s where s.id = salon_id and s.is_published))
    or public.is_admin()
  );
create policy "staff: manager write" on public.staff for all
  using (public.is_salon_manager(salon_id)) with check (public.is_salon_manager(salon_id));

-- ===========================================================================
-- SERVICES
-- ===========================================================================
create table public.service_categories (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references public.salons(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0
);
alter table public.service_categories enable row level security;
create index on public.service_categories (salon_id);
create policy "categories: read public or member" on public.service_categories for select
  using (
    public.is_salon_member(salon_id)
    or exists (select 1 from public.salons s where s.id = salon_id and s.is_published)
    or public.is_admin()
  );
create policy "categories: manager write" on public.service_categories for all
  using (public.is_salon_manager(salon_id)) with check (public.is_salon_manager(salon_id));

create table public.services (
  id            uuid primary key default gen_random_uuid(),
  salon_id      uuid not null references public.salons(id) on delete cascade,
  category_id   uuid references public.service_categories(id) on delete set null,
  name          text not null,
  description   text,
  duration_min  int not null default 30,        -- appointment length
  buffer_min    int not null default 0,         -- clean-up/turnaround after
  price         numeric(10,2) not null default 0,
  is_active     boolean not null default true,
  bookable_online boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.services enable row level security;
create trigger services_touch before update on public.services for each row execute function public.touch_updated_at();
create index on public.services (salon_id);

-- Active + online-bookable services at a published salon are public.
create policy "services: read public or member" on public.services for select
  using (
    public.is_salon_member(salon_id)
    or (is_active and bookable_online
        and exists (select 1 from public.salons s where s.id = salon_id and s.is_published))
    or public.is_admin()
  );
create policy "services: manager write" on public.services for all
  using (public.is_salon_manager(salon_id)) with check (public.is_salon_manager(salon_id));

-- Which staff can perform which service (many-to-many).
create table public.staff_services (
  staff_id   uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (staff_id, service_id)
);
alter table public.staff_services enable row level security;
-- Readable wherever the parent service is readable (reuse the services policy via join).
create policy "staff_services: read" on public.staff_services for select
  using (exists (select 1 from public.services sv where sv.id = service_id));
create policy "staff_services: manager write" on public.staff_services for all
  using (exists (select 1 from public.services sv where sv.id = service_id and public.is_salon_manager(sv.salon_id)))
  with check (exists (select 1 from public.services sv where sv.id = service_id and public.is_salon_manager(sv.salon_id)));

-- ===========================================================================
-- AVAILABILITY: recurring working hours + one-off time off
-- ===========================================================================
-- Weekly recurring hours per staff member. dow: 0=Sunday .. 6=Saturday.
-- Times are wall-clock in the salon's timezone.
create table public.working_hours (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references public.salons(id) on delete cascade,
  staff_id   uuid not null references public.staff(id) on delete cascade,
  dow        int  not null check (dow between 0 and 6),
  start_time time not null,
  end_time   time not null,
  check (end_time > start_time)
);
alter table public.working_hours enable row level security;
create index on public.working_hours (staff_id);
-- Public read so the storefront can compute slots (no customer data here).
create policy "hours: read public or member" on public.working_hours for select
  using (
    public.is_salon_member(salon_id)
    or exists (select 1 from public.salons s where s.id = salon_id and s.is_published)
    or public.is_admin()
  );
create policy "hours: manager write" on public.working_hours for all
  using (public.is_salon_manager(salon_id)) with check (public.is_salon_manager(salon_id));

-- One-off blocks (holidays, vacation, breaks). Overrides working_hours.
create table public.time_off (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references public.salons(id) on delete cascade,
  staff_id   uuid not null references public.staff(id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text,
  check (ends_at > starts_at)
);
alter table public.time_off enable row level security;
create index on public.time_off (staff_id, starts_at);
create policy "time_off: read public or member" on public.time_off for select
  using (
    public.is_salon_member(salon_id)
    or exists (select 1 from public.salons s where s.id = salon_id and s.is_published)
    or public.is_admin()
  );
create policy "time_off: manager write" on public.time_off for all
  using (public.is_salon_manager(salon_id)) with check (public.is_salon_manager(salon_id));

-- ===========================================================================
-- CUSTOMERS (private to the salon — NEVER public)
-- ===========================================================================
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  name        text not null,
  email       text,
  phone       text,
  notes       text,                              -- staff-only notes / preferences
  marketing_opt_in boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.customers enable row level security;
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();
create index on public.customers (salon_id);
create index on public.customers (salon_id, email);

-- Customers are visible ONLY to salon members. The public booking flow creates
-- customers via the SECURITY DEFINER book_appointment RPC, not direct insert.
create policy "customers: member read"  on public.customers for select using (public.is_salon_member(salon_id));
create policy "customers: member write" on public.customers for all
  using (public.is_salon_member(salon_id)) with check (public.is_salon_member(salon_id));

-- ===========================================================================
-- APPOINTMENTS (private to the salon — NEVER public)
-- ===========================================================================
create table public.appointments (
  id           uuid primary key default gen_random_uuid(),
  salon_id     uuid not null references public.salons(id) on delete cascade,
  customer_id  uuid references public.customers(id) on delete set null,
  staff_id     uuid references public.staff(id) on delete set null,
  service_id   uuid references public.services(id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       appointment_status not null default 'booked',
  source       appointment_source not null default 'manual',
  price        numeric(10,2),                    -- snapshot of price at booking time
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.appointments enable row level security;
create trigger appointments_touch before update on public.appointments for each row execute function public.touch_updated_at();
create index on public.appointments (salon_id, starts_at);
create index on public.appointments (staff_id, starts_at);

-- Appointments are visible ONLY to salon members. Online bookings are inserted
-- by the book_appointment RPC (security definer); manual bookings by members.
create policy "appointments: member read"  on public.appointments for select using (public.is_salon_member(salon_id));
create policy "appointments: member write" on public.appointments for all
  using (public.is_salon_member(salon_id)) with check (public.is_salon_member(salon_id));

-- ===== 0002_booking_rpcs.sql =====
-- ============================================================================
-- Glowbook — public booking RPCs
--
-- The storefront is anonymous. We deliberately do NOT give anon read access to
-- appointments/customers. Instead, two SECURITY DEFINER functions provide a
-- narrow, safe interface:
--
--   get_available_slots(...) -> only the FREE start times for a day. It reads
--     appointments internally to mask busy times, but returns only timestamps,
--     never appointment/customer details.
--
--   book_appointment(...) -> validates the slot is real & free, finds-or-creates
--     the customer, and inserts the appointment atomically. Returns the new id.
--
-- Both run as the function owner (bypassing RLS) but enforce their own checks:
-- the salon must be published, the service active+bookable_online, the staff
-- active+accepts_online_booking, and the slot must fall inside working hours,
-- outside time_off, and not overlap an existing appointment.
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- get_available_slots
-- For a given salon (by slug), service and date, return bookable start times.
-- p_staff is optional: null = "any available staff" (union of all eligible).
-- Slots are returned as timestamptz (UTC); the client renders them in the
-- salon's timezone.
-- ---------------------------------------------------------------------------
create or replace function public.get_available_slots(
  p_slug    text,
  p_service uuid,
  p_date    date,
  p_staff   uuid default null,
  p_slot_step_min int default 15
)
returns table (slot_start timestamptz, staff_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_salon   public.salons%rowtype;
  v_service public.services%rowtype;
  v_total_min int;
  v_dow     int;
begin
  -- Salon must exist and be published.
  select * into v_salon from public.salons where slug = p_slug and is_published;
  if not found then
    return;   -- empty set
  end if;

  -- Service must belong to the salon and be online-bookable.
  select * into v_service from public.services
    where id = p_service and salon_id = v_salon.id and is_active and bookable_online;
  if not found then
    return;
  end if;

  v_total_min := v_service.duration_min + coalesce(v_service.buffer_min, 0);
  -- day-of-week in the salon's timezone
  v_dow := extract(dow from (p_date::timestamp))::int;

  return query
  with candidate_staff as (
    -- Eligible staff: active, online-bookable, can perform this service, and
    -- (if p_staff given) only that one.
    select s.id
    from public.staff s
    join public.staff_services ss on ss.staff_id = s.id and ss.service_id = p_service
    where s.salon_id = v_salon.id
      and s.is_active and s.accepts_online_booking
      and (p_staff is null or s.id = p_staff)
  ),
  -- For each eligible staff member, expand their working hours for this dow into
  -- candidate start times at p_slot_step_min intervals.
  steps as (
    select cs.id as staff_id,
           gs as slot_start
    from candidate_staff cs
    join public.working_hours wh
      on wh.staff_id = cs.id and wh.dow = v_dow
    cross join lateral generate_series(
      -- localize the working window to an absolute timestamptz for this date
      (p_date::text || ' ' || wh.start_time::text)::timestamp at time zone v_salon.timezone,
      ((p_date::text || ' ' || wh.end_time::text)::timestamp at time zone v_salon.timezone)
        - make_interval(mins => v_total_min),
      make_interval(mins => p_slot_step_min)
    ) as gs
  )
  select st.slot_start, st.staff_id
  from steps st
  where
    -- not in the past
    st.slot_start >= now()
    -- not overlapping an existing (non-cancelled) appointment for that staff
    and not exists (
      select 1 from public.appointments a
      where a.staff_id = st.staff_id
        and a.status in ('booked','confirmed','completed')
        and a.starts_at < st.slot_start + make_interval(mins => v_total_min)
        and a.ends_at   > st.slot_start
    )
    -- not inside a time-off block for that staff
    and not exists (
      select 1 from public.time_off t
      where t.staff_id = st.staff_id
        and t.starts_at < st.slot_start + make_interval(mins => v_total_min)
        and t.ends_at   > st.slot_start
    )
  order by st.slot_start, st.staff_id;
end; $$;

-- Allow the storefront (anon) to call it.
grant execute on function public.get_available_slots(text, uuid, date, uuid, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- book_appointment
-- Validates and creates an online booking. Finds-or-creates the customer by
-- (salon, email). Re-checks availability inside a row lock to avoid double
-- booking. Returns the new appointment id.
-- ---------------------------------------------------------------------------
create or replace function public.book_appointment(
  p_slug          text,
  p_service       uuid,
  p_staff         uuid,
  p_start         timestamptz,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text default null,
  p_notes         text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_salon    public.salons%rowtype;
  v_service  public.services%rowtype;
  v_total_min int;
  v_end      timestamptz;
  v_dow      int;
  v_customer uuid;
  v_appt     uuid;
  v_ok       boolean;
begin
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'A name is required to book.';
  end if;

  select * into v_salon from public.salons where slug = p_slug and is_published;
  if not found then raise exception 'This salon is not accepting online bookings.'; end if;

  select * into v_service from public.services
    where id = p_service and salon_id = v_salon.id and is_active and bookable_online;
  if not found then raise exception 'That service is not available to book online.'; end if;

  -- Staff must be eligible for this service.
  if not exists (
    select 1 from public.staff s
    join public.staff_services ss on ss.staff_id = s.id and ss.service_id = p_service
    where s.id = p_staff and s.salon_id = v_salon.id
      and s.is_active and s.accepts_online_booking
  ) then
    raise exception 'That staff member cannot perform this service.';
  end if;

  v_total_min := v_service.duration_min + coalesce(v_service.buffer_min, 0);
  v_end := p_start + make_interval(mins => v_total_min);

  if p_start < now() then
    raise exception 'That time is in the past.';
  end if;

  -- Slot must fall within the staff member's working hours for that weekday.
  v_dow := extract(dow from (p_start at time zone v_salon.timezone))::int;
  select exists (
    select 1 from public.working_hours wh
    where wh.staff_id = p_staff and wh.dow = v_dow
      and (p_start at time zone v_salon.timezone)::time >= wh.start_time
      and (v_end   at time zone v_salon.timezone)::time <= wh.end_time
  ) into v_ok;
  if not v_ok then
    raise exception 'That time is outside the staff member''s working hours.';
  end if;

  -- Lock overlapping rows for this staff to prevent a race / double-booking.
  perform 1 from public.appointments a
   where a.staff_id = p_staff
     and a.status in ('booked','confirmed','completed')
     and a.starts_at < v_end and a.ends_at > p_start
   for update;
  if found then
    raise exception 'Sorry, that slot was just taken. Please pick another time.';
  end if;

  -- Also respect time-off blocks.
  if exists (
    select 1 from public.time_off t
    where t.staff_id = p_staff and t.starts_at < v_end and t.ends_at > p_start
  ) then
    raise exception 'That time is not available.';
  end if;

  -- Find-or-create the customer by email (fallback: always create if no email).
  if coalesce(trim(p_customer_email), '') <> '' then
    select id into v_customer from public.customers
      where salon_id = v_salon.id and lower(email) = lower(trim(p_customer_email))
      limit 1;
  end if;
  if v_customer is null then
    insert into public.customers (salon_id, name, email, phone)
    values (v_salon.id, trim(p_customer_name), nullif(trim(p_customer_email), ''), nullif(trim(p_customer_phone), ''))
    returning id into v_customer;
  end if;

  insert into public.appointments
    (salon_id, customer_id, staff_id, service_id, starts_at, ends_at, status, source, price, notes)
  values
    (v_salon.id, v_customer, p_staff, p_service, p_start, v_end, 'booked', 'online', v_service.price, p_notes)
  returning id into v_appt;

  return v_appt;
end; $$;

grant execute on function public.book_appointment(text, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;

-- ===== 0003_customer_accounts.sql =====
-- ============================================================================
-- Glowup Book — customer accounts
--
-- Customers self-register on glowupbook.com (profiles.role = 'customer') and can
-- view/cancel their own bookings across every salon. We link a customer record
-- to an auth account via customers.account_id. Reads/cancels go through
-- SECURITY DEFINER RPCs so we don't have to broaden table RLS.
--
-- (Employees are NOT created here — they remain admin-managed `staff` rows.)
-- ============================================================================

-- 1) New role value. (PG15: ADD VALUE is fine inside a tx as long as the new
--    value isn't *used* in the same tx — nothing below uses the literal.)
alter type user_role add value if not exists 'customer';

-- 2) Link customer records to an auth account.
alter table public.customers
  add column if not exists account_id uuid references auth.users(id) on delete set null;
create index if not exists customers_account_idx on public.customers (account_id);

-- 3) Re-create book_appointment so that when a logged-in customer books, their
--    account is linked to the customer record (claimed if it already existed by
--    email). Anonymous booking still works exactly as before.
create or replace function public.book_appointment(
  p_slug          text,
  p_service       uuid,
  p_staff         uuid,
  p_start         timestamptz,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text default null,
  p_notes         text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_salon    public.salons%rowtype;
  v_service  public.services%rowtype;
  v_total_min int;
  v_end      timestamptz;
  v_dow      int;
  v_customer uuid;
  v_appt     uuid;
  v_ok       boolean;
  v_uid      uuid := auth.uid();   -- null for anonymous bookings
begin
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'A name is required to book.';
  end if;

  select * into v_salon from public.salons where slug = p_slug and is_published;
  if not found then raise exception 'This salon is not accepting online bookings.'; end if;

  select * into v_service from public.services
    where id = p_service and salon_id = v_salon.id and is_active and bookable_online;
  if not found then raise exception 'That service is not available to book online.'; end if;

  if not exists (
    select 1 from public.staff s
    join public.staff_services ss on ss.staff_id = s.id and ss.service_id = p_service
    where s.id = p_staff and s.salon_id = v_salon.id
      and s.is_active and s.accepts_online_booking
  ) then
    raise exception 'That staff member cannot perform this service.';
  end if;

  v_total_min := v_service.duration_min + coalesce(v_service.buffer_min, 0);
  v_end := p_start + make_interval(mins => v_total_min);

  if p_start < now() then
    raise exception 'That time is in the past.';
  end if;

  v_dow := extract(dow from (p_start at time zone v_salon.timezone))::int;
  select exists (
    select 1 from public.working_hours wh
    where wh.staff_id = p_staff and wh.dow = v_dow
      and (p_start at time zone v_salon.timezone)::time >= wh.start_time
      and (v_end   at time zone v_salon.timezone)::time <= wh.end_time
  ) into v_ok;
  if not v_ok then
    raise exception 'That time is outside the staff member''s working hours.';
  end if;

  perform 1 from public.appointments a
   where a.staff_id = p_staff
     and a.status in ('booked','confirmed','completed')
     and a.starts_at < v_end and a.ends_at > p_start
   for update;
  if found then
    raise exception 'Sorry, that slot was just taken. Please pick another time.';
  end if;

  if exists (
    select 1 from public.time_off t
    where t.staff_id = p_staff and t.starts_at < v_end and t.ends_at > p_start
  ) then
    raise exception 'That time is not available.';
  end if;

  -- Find-or-create the customer. Prefer the logged-in account, then email.
  if v_uid is not null then
    select id into v_customer from public.customers
      where salon_id = v_salon.id and account_id = v_uid limit 1;
  end if;
  if v_customer is null and coalesce(trim(p_customer_email), '') <> '' then
    select id into v_customer from public.customers
      where salon_id = v_salon.id and lower(email) = lower(trim(p_customer_email)) limit 1;
  end if;

  if v_customer is null then
    insert into public.customers (salon_id, name, email, phone, account_id)
    values (v_salon.id, trim(p_customer_name),
            nullif(trim(p_customer_email), ''), nullif(trim(p_customer_phone), ''), v_uid)
    returning id into v_customer;
  elsif v_uid is not null then
    -- claim an existing (e.g. previously walk-in) record for this account
    update public.customers set account_id = v_uid
      where id = v_customer and account_id is null;
  end if;

  insert into public.appointments
    (salon_id, customer_id, staff_id, service_id, starts_at, ends_at, status, source, price, notes)
  values
    (v_salon.id, v_customer, p_staff, p_service, p_start, v_end, 'booked', 'online', v_service.price, p_notes)
  returning id into v_appt;

  return v_appt;
end; $$;

grant execute on function public.book_appointment(text, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;

-- 4) A customer's own bookings across all salons (joined for display).
create or replace function public.my_appointments()
returns table (
  id uuid, salon_name text, salon_slug text, service_name text, staff_name text,
  starts_at timestamptz, ends_at timestamptz, status appointment_status, price numeric
)
language sql stable security definer set search_path = public as $$
  select a.id, sl.name, sl.slug, sv.name, st.name, a.starts_at, a.ends_at, a.status, a.price
  from public.appointments a
  join public.customers c on c.id = a.customer_id and c.account_id = auth.uid()
  join public.salons sl on sl.id = a.salon_id
  left join public.services sv on sv.id = a.service_id
  left join public.staff st on st.id = a.staff_id
  order by a.starts_at desc;
$$;
grant execute on function public.my_appointments() to authenticated;

-- 5) Let a customer cancel their own upcoming booking.
create or replace function public.cancel_my_appointment(p_appt uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.appointments a set status = 'cancelled'
  where a.id = p_appt
    and a.starts_at > now()
    and exists (select 1 from public.customers c where c.id = a.customer_id and c.account_id = auth.uid());
  if not found then
    raise exception 'Booking not found, already started, or not yours to cancel.';
  end if;
end; $$;
grant execute on function public.cancel_my_appointment(uuid) to authenticated;

-- ===== 0004_directory_listings.sql =====
-- ============================================================================
-- Glowup Book — unclaimed directory listings + claim flow
--
-- We seed the directory with public salon listings (e.g. from NY Open Data).
-- These have no owner yet (owner_id null, claimed=false) and aren't bookable
-- (is_published=false). They show in the directory so customers can find them
-- and owners can "claim" their page to take it over.
-- ============================================================================

-- Seed listings have no owner until claimed.
alter table public.salons alter column owner_id drop not null;
alter table public.salons add column if not exists claimed boolean not null default true;
alter table public.salons add column if not exists source  text    not null default 'owner';

-- Public read now also covers unclaimed listings (their name/address is public
-- info), in addition to published salons and members/admins.
drop policy if exists "salons: read published or member" on public.salons;
create policy "salons: read published listed or member" on public.salons for select
  using (is_published or claimed = false or public.is_salon_member(id) or public.is_admin());

-- Claim an unclaimed listing: the first logged-in user to claim it becomes the
-- owner and can then set it up and publish it.
create or replace function public.claim_salon(p_salon uuid)
returns public.salons
language plpgsql security definer set search_path = public as $$
declare v_row public.salons%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in to claim a salon.';
  end if;
  update public.salons
     set owner_id = auth.uid(), claimed = true
   where id = p_salon and (owner_id is null or claimed = false)
   returning * into v_row;
  if not found then
    raise exception 'This salon has already been claimed.';
  end if;
  return v_row;
end; $$;
grant execute on function public.claim_salon(uuid) to authenticated;
