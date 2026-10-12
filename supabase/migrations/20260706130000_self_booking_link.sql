-- CareCall — Self-Service Booking Link (self-booking-link-spec.md).
--
-- Adds the public, SMS-delivered booking path that mirrors the AI voice flow's
-- server-side rules (slot generation, verification lockout, idempotent booking,
-- double-booking exclusion). Booking via the link IS the cancellation of the
-- pending AI call: the campaign_patients status flip to 'booked' removes the
-- patient from the dialer queue with no extra coordination.
--
-- Written idempotently so it is safe to re-run during development.

-- ============================================================
-- §2 — booking_links
-- Only the SHA-256 hash of the URL token is stored; the raw token lives only in
-- the SMS/URL, so a leaked database never leaks usable links.
-- ============================================================
create table if not exists booking_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,          -- sha256 hex of the URL token
  campaign_id uuid not null references campaigns(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  clinic_id uuid references clinics(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  verification_attempts int not null default 0,
  verified_at timestamptz,
  booked_appointment_id uuid references appointments(id),
  locked boolean not null default false     -- true after verification failures
);

create index if not exists idx_booking_links_campaign_patient
  on booking_links (campaign_id, patient_id);

-- ============================================================
-- §4/§7 — appointment source channel.
-- Lets reporting distinguish voice vs booking-link bookings without faking a
-- call_logs row. Existing rows backfill to 'voice'.
-- ============================================================
alter table appointments
  add column if not exists source text not null default 'voice';

-- ============================================================
-- §5 — per-clinic self-booking rollout flag (default OFF).
-- SMS link injection is gated on this so rollout is per-clinic.
-- ============================================================
alter table clinics
  add column if not exists self_booking_enabled boolean not null default false;

-- ============================================================
-- §7 — cross-channel double-booking guard.
-- Neither path currently checks whether the patient already holds an active
-- appointment for this campaign. A partial unique index closes this at the
-- database level so every present and future channel inherits it. Cancelled /
-- completed appointments do NOT block rebooking (partial predicate).
-- ============================================================
create unique index if not exists one_active_appointment_per_campaign
  on appointments (patient_id, campaign_id)
  where status in ('booked', 'confirmed');

-- Slot generation is unchanged here: the web booking-api calls the SAME
-- timezone-aware get_available_slots(p_provider_id, p_from, p_days, p_limit,
-- p_tz) added by the slot-tz migration (20260705000000_slot_tz.sql), exactly as
-- the voice assistant-tools do.

-- ============================================================
-- §2 — RLS: staff read for their own clinic (debug/support); NO client writes.
-- All writes go through the booking-api edge function (service role, bypasses
-- RLS). Enabling RLS with only a read policy means the anon/authenticated
-- clients can never insert/update/delete booking_links directly.
-- ============================================================
alter table booking_links enable row level security;

drop policy if exists booking_links_read on booking_links;
create policy booking_links_read on booking_links for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );

-- ============================================================
-- §4 — per-IP verify rate limit (basic counter table).
-- The booking-api increments a (ip, minute-bucket) counter and rejects once it
-- exceeds the threshold. Kept trivially simple; a WAF may supersede it later.
-- ============================================================
create table if not exists booking_rate_limits (
  ip text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (ip, window_start)
);

-- Atomically bump the counter for the current minute bucket and return the
-- running total for this IP in that minute. The booking-api compares it to its
-- own limit (e.g. 10/min).
create or replace function bump_booking_rate(p_ip text)
returns int
language plpgsql as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count int;
begin
  insert into booking_rate_limits (ip, window_start, count)
  values (p_ip, v_window, 1)
  on conflict (ip, window_start)
    do update set count = booking_rate_limits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup of buckets older than a few minutes.
  delete from booking_rate_limits where window_start < now() - interval '10 minutes';

  return v_count;
end $$;
