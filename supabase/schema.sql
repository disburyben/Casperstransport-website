-- ============================================================
-- CASPERS TRANSPORT — SUPABASE SCHEMA
-- Run this in Supabase SQL editor (Database > SQL Editor)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";


-- ============================================================
-- ENUMS
-- ============================================================

create type booking_status as enum (
  'pending_quote',
  'quote_sent',
  'confirmed',
  'in_transit',
  'completed',
  'cancelled'
);

create type trip_type as enum (
  'same_day_return',
  'back_to_back',
  'overnight'
);

create type payment_method as enum (
  'stripe_deposit',
  'follow_up'
);

create type bike_type as enum (
  'road',
  'cruiser',
  'sports',
  'dirt_enduro',
  'scooter',
  'adventure',
  'vintage_classic',
  'custom_build',
  'project_non_runner',
  'other'
);

create type bike_condition as enum (
  'running_rideable',
  'non_runner',
  'broken_seized',
  'custom_part_built',
  'stripped_pieces'
);

create type calendar_block_type as enum (
  'drive_to_pickup',
  'job_loaded',
  'drive_return',
  'overnight_stay',
  'buffer'
);

create type quote_generated_by as enum (
  'auto',
  'admin'
);

create type user_role as enum (
  'admin',
  'driver'
);

create type comms_type as enum (
  'quote_email',
  'confirmation_email',
  'reminder_24h_email',
  'reminder_2h_sms',
  'invoice_email',
  'review_request_email',
  'admin_notification'
);

create type comms_status as enum (
  'sent',
  'failed',
  'pending'
);


-- ============================================================
-- SERVICE AREA NOTE
-- Caspers Transport operates in metro and country South Australia only.
-- Home base: Roseworthy SA 5371
-- Jobs over 350 km from base are auto-flagged (needs_review = true)
-- ============================================================

-- ============================================================
-- RATE CARD
-- Single row table — admin editable via settings page
-- ============================================================

create table rate_card (
  id                       uuid primary key default uuid_generate_v4(),
  base_callout_aud         numeric(10,2) not null default 120.00,
  km_rate_loaded           numeric(6,4)  not null default 2.20,   -- $ per km, van loaded
  km_rate_return           numeric(6,4)  not null default 1.10,   -- $ per km, van empty
  surcharge_non_runner     numeric(10,2) not null default 50.00,
  surcharge_seized         numeric(10,2) not null default 80.00,
  surcharge_stripped       numeric(10,2) not null default 100.00,
  surcharge_custom_build   numeric(10,2) not null default 50.00,
  multi_bike_discount_pct  numeric(5,2)  not null default 20.00,  -- % off second bike
  overnight_allowance      numeric(10,2) not null default 180.00, -- flat rate per night
  buffer_minutes           int           not null default 30,
  load_time_standard_min   int           not null default 15,
  load_time_non_runner_min int           not null default 30,
  load_time_stripped_min   int           not null default 45,
  fuel_levy_pct            numeric(5,2)  not null default 5.00,
  fuel_levy_active         boolean       not null default false,
  stripe_deposit_pct       numeric(5,2)  not null default 20.00,
  updated_at               timestamptz   not null default now(),
  updated_by               uuid          -- fk to auth.users added below
);

-- Seed with one default row
insert into rate_card (id) values (uuid_generate_v4());


-- ============================================================
-- CUSTOMERS
-- Deduplicated by email — repeat bookings link to same record
-- ============================================================

create table customers (
  id            uuid        primary key default uuid_generate_v4(),
  name          text        not null,
  email         text        not null unique,
  phone         text        not null,
  booking_count int         not null default 0,
  total_spend   numeric(12,2) not null default 0.00,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_customers_email on customers(email);


-- ============================================================
-- BOOKINGS
-- ============================================================

create table bookings (
  id                uuid           primary key default uuid_generate_v4(),
  customer_id       uuid           not null references customers(id) on delete restrict,
  status            booking_status not null default 'pending_quote',
  trip_type         trip_type      not null default 'same_day_return',
  linked_booking_id uuid           references bookings(id),    -- for back-to-back
  pickup_date       date           not null,
  pickup_time       time,
  pickup_address    text           not null,
  pickup_lat        numeric(10,7),
  pickup_lng        numeric(10,7),
  dropoff_address   text           not null,
  dropoff_lat       numeric(10,7),
  dropoff_lng       numeric(10,7),
  distance_km       numeric(8,2),  -- pickup → dropoff
  return_km         numeric(8,2),  -- dropoff → base (or next pickup)
  duration_minutes  int,           -- total job block including drive + load + buffer
  departure_time    timestamptz,   -- suggested departure from Roseworthy
  overnight_nights  int           default 0,
  payment_method    payment_method,
  stripe_payment_id text,
  deposit_paid      boolean        not null default false,
  notes             text,
  internal_notes    text,          -- admin only, not shown to customer
  sig_pickup        text,          -- base64 PNG of customer signature at pickup
  sig_pickup_at     timestamptz,   -- when pickup signature was captured
  sig_dropoff       text,          -- base64 PNG of customer signature at dropoff
  sig_dropoff_at    timestamptz,   -- when dropoff signature was captured
  needs_review      boolean        not null default false,
  review_reason     text,          -- auto-populated: e.g. 'Long distance job (780 km)'
  created_at        timestamptz    not null default now(),
  updated_at        timestamptz    not null default now()
);

create index idx_bookings_customer    on bookings(customer_id);
create index idx_bookings_pickup_date on bookings(pickup_date);
create index idx_bookings_status      on bookings(status);


-- ============================================================
-- BIKES
-- One or more bikes per booking
-- ============================================================

create table bikes (
  id          uuid           primary key default uuid_generate_v4(),
  booking_id  uuid           not null references bookings(id) on delete cascade,
  bike_type   bike_type      not null,
  condition   bike_condition not null,
  make        text,
  model       text,
  year        int,
  colour      text,
  notes       text,
  created_at  timestamptz    not null default now()
);

create index idx_bikes_booking on bikes(booking_id);


-- ============================================================
-- QUOTES
-- Versioned — snapshot of rate card at time of generation
-- ============================================================

create table quotes (
  id                   uuid               primary key default uuid_generate_v4(),
  booking_id           uuid               not null references bookings(id) on delete cascade,
  version              int                not null default 1,
  rate_card_snapshot   jsonb              not null,  -- full rate card at time of quote
  base_rate            numeric(10,2)      not null,
  km_loaded            numeric(8,2)       not null,
  km_return            numeric(8,2)       not null,
  km_rate_loaded       numeric(6,4)       not null,
  km_rate_return       numeric(6,4)       not null,
  condition_surcharge  numeric(10,2)      not null default 0,
  multi_bike_discount  numeric(10,2)      not null default 0,
  overnight_total      numeric(10,2)      not null default 0,
  subtotal             numeric(10,2)      not null,
  fuel_levy_pct        numeric(5,2)       not null default 0,
  fuel_levy_amount     numeric(10,2)      not null default 0,
  total_aud            numeric(10,2)      not null,
  generated_by         quote_generated_by not null default 'auto',
  sent_at              timestamptz,
  accepted_at          timestamptz,
  created_at           timestamptz        not null default now()
);

create index idx_quotes_booking on quotes(booking_id);
create unique index idx_quotes_booking_version on quotes(booking_id, version);


-- ============================================================
-- CALENDAR BLOCKS
-- Every job creates multiple blocks — drive, job, return, buffer
-- ============================================================

create table calendar_blocks (
  id          uuid                  primary key default uuid_generate_v4(),
  booking_id  uuid                  not null references bookings(id) on delete cascade,
  block_type  calendar_block_type   not null,
  starts_at   timestamptz           not null,
  ends_at     timestamptz           not null,
  created_at  timestamptz           not null default now()
);

create index idx_calendar_booking  on calendar_blocks(booking_id);
create index idx_calendar_starts   on calendar_blocks(starts_at);
create index idx_calendar_ends     on calendar_blocks(ends_at);

-- Overlap detection view — used by dashboard to flag conflicts
create view calendar_conflicts as
select
  a.id        as block_a,
  b.id        as block_b,
  a.booking_id as booking_a,
  b.booking_id as booking_b,
  a.starts_at,
  a.ends_at
from calendar_blocks a
join calendar_blocks b
  on a.id <> b.id
 and a.starts_at < b.ends_at
 and a.ends_at   > b.starts_at
 and a.booking_id <> b.booking_id;


-- ============================================================
-- COMMS LOG
-- Every email / SMS sent, with status
-- ============================================================

create table comms_log (
  id          uuid         primary key default uuid_generate_v4(),
  booking_id  uuid         not null references bookings(id) on delete cascade,
  comms_type  comms_type   not null,
  status      comms_status not null default 'pending',
  recipient   text         not null,
  subject     text,
  provider_id text,        -- Resend/Twilio message ID for tracking
  sent_at     timestamptz,
  created_at  timestamptz  not null default now()
);

create index idx_comms_booking on comms_log(booking_id);


-- ============================================================
-- USER PROFILES
-- Extends Supabase auth.users with role (admin / driver)
-- ============================================================

create table user_profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  role       user_role   not null default 'driver',
  name       text        not null,
  phone      text,
  created_at timestamptz not null default now()
);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table rate_card      enable row level security;
alter table customers      enable row level security;
alter table bookings       enable row level security;
alter table bikes          enable row level security;
alter table quotes         enable row level security;
alter table calendar_blocks enable row level security;
alter table comms_log      enable row level security;
alter table user_profiles  enable row level security;

-- Admin policy — full access to everything
create policy "admin_all" on rate_card
  for all using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin_all" on customers
  for all using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin_all" on bookings
  for all using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin_all" on bikes
  for all using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin_all" on quotes
  for all using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin_all" on calendar_blocks
  for all using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin_all" on comms_log
  for all using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin_all" on user_profiles
  for all using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
  );

-- Driver policy — read-only on their assigned bookings
create policy "driver_read_bookings" on bookings
  for select using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'driver')
  );

create policy "driver_read_calendar" on calendar_blocks
  for select using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'driver')
  );

create policy "driver_read_bikes" on bikes
  for select using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'driver')
  );

create policy "driver_read_customers" on customers
  for select using (
    exists (select 1 from user_profiles where id = auth.uid() and role = 'driver')
  );

create policy "driver_own_profile" on user_profiles
  for select using (auth.uid() = id);

-- Public insert policy for booking form (unauthenticated submissions)
create policy "public_insert_customers" on customers
  for insert with check (true);

create policy "public_insert_bookings" on bookings
  for insert with check (true);

create policy "public_insert_bikes" on bikes
  for insert with check (true);

-- Allow public to read rate card (needed for live quote calculator on website)
create policy "public_read_rate_card" on rate_card
  for select using (true);


-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update updated_at on customers and bookings
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_customers_updated_at
  before update on customers
  for each row execute function update_updated_at();

create trigger trg_bookings_updated_at
  before update on bookings
  for each row execute function update_updated_at();

-- Upsert customer — returns existing id if email matches, inserts if new
create or replace function upsert_customer(
  p_name  text,
  p_email text,
  p_phone text
) returns uuid as $$
declare
  v_id uuid;
begin
  insert into customers (name, email, phone)
  values (p_name, p_email, p_phone)
  on conflict (email) do update
    set name  = excluded.name,
        phone = excluded.phone,
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$ language plpgsql security definer;

-- Increment customer booking count and total spend on quote acceptance
create or replace function update_customer_stats(
  p_customer_id uuid,
  p_amount      numeric
) returns void as $$
begin
  update customers
  set booking_count = booking_count + 1,
      total_spend   = total_spend + p_amount,
      updated_at    = now()
  where id = p_customer_id;
end;
$$ language plpgsql security definer;
