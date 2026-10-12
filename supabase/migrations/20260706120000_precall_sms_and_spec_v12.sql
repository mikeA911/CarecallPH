-- CareCall — pre-call SMS portal integration + spec v1.2 deltas.
--
-- The pre-call SMS BACKEND (status 'notified', campaign_patients.dial_after,
-- campaign_stats counting 'notified' as in-queue) was shipped separately and
-- may already exist in prod. Everything here is written idempotently so it is
-- safe whether or not that earlier migration is present in this environment.
--
-- Adds the DATA the dev-team portal work needs:
--   • clinics.sms_precall_lead_seconds  (§3.2 — per-clinic lead time)
--   • patients.sms_consent              (§3.3 — SMS express-consent gate)
--   • providers.user_id                 (spec v1.2 D6 — optional login link)

-- ============================================================
-- Pre-call SMS schema (defensive: create only if the shipped
-- migration didn't already add these).
-- ============================================================

-- campaign_patient_status gains 'notified' (pending → notified → calling).
alter type campaign_patient_status add value if not exists 'notified';

-- Countdown target: when the SMS lead time elapses, Phase B dials the row.
alter table campaign_patients
  add column if not exists dial_after timestamptz;

create index if not exists idx_campaign_patients_dial_after
  on campaign_patients(campaign_id, status, dial_after);

-- ============================================================
-- §3.2 — per-clinic pre-call lead time.
-- null → use env SMS_PRECALL_LEAD_SECONDS; 0 → feature off for this clinic.
-- ============================================================
alter table clinics
  add column if not exists sms_precall_lead_seconds int;

-- ============================================================
-- §3.3 — SMS express consent (TCPA). Separate from do_not_call:
-- absence of SMS consent skips the text but must NOT block the call.
-- ============================================================
alter table patients
  add column if not exists sms_consent boolean not null default false;

-- ============================================================
-- Spec v1.2 D6 — optional link from a bookable clinician (providers) to a
-- portal login. Nullable + unique: a clinician may have no login, and a login
-- maps to at most one clinician.
-- ============================================================
alter table providers
  add column if not exists user_id uuid references auth.users(id);

create unique index if not exists idx_providers_user_id
  on providers(user_id) where user_id is not null;

-- ============================================================
-- campaign_stats view — count 'notified' as in-queue (part of pending).
-- Recreate defensively so environments missing the shipped SMS migration
-- still bucket the new status correctly. Column set/order is unchanged from
-- 20260705000000_portal_roles.sql so dependents keep working. Statuses are
-- compared as text: the new enum value can't be used as an enum literal in
-- the same transaction that adds it (supabase db push runs one per file).
-- ============================================================
drop view if exists campaign_stats;
create view campaign_stats as
select
  c.id as campaign_id,
  c.clinic_id,
  c.name,
  c.status,
  count(cp.patient_id) as total_patients,
  -- 'notified' patients are mid-countdown awaiting their call → still "in queue".
  count(*) filter (where cp.status::text in ('pending', 'notified')) as pending,
  count(*) filter (where cp.status::text = 'booked') as booked,
  count(*) filter (where cp.status::text = 'declined') as declined,
  count(*) filter (where cp.status::text in ('no_answer', 'voicemail')) as unreached,
  count(*) filter (where cp.status::text in ('verification_failed', 'needs_human')) as needs_human,
  round(
    100.0 * count(*) filter (where cp.status::text = 'booked')
    / nullif(count(*) filter (where cp.status::text not in ('pending', 'notified', 'calling')), 0), 1
  ) as booking_rate_pct
from campaigns c
left join campaign_patients cp on cp.campaign_id = c.id
group by c.id, c.clinic_id, c.name, c.status;
