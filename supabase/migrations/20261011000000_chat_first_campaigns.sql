-- CareCall PH — chat-first campaigns (pilot without a phone account).
--
-- A campaign now has an outreach mode:
--   call — today's behaviour: optional pre-call notice, then the AI calls.
--   chat — message each patient a self-booking link on their chat app (or SMS
--          with consent), send one reminder, never call.
--
-- Chat campaign patient lifecycle (campaign_patients.status):
--   pending → messaged (link sent; attempts = messages sent, last_attempt_at = last send)
--           → booked            (booking-api, when the patient books from the link)
--           → no_answer         (no booking after the reminder window)
--   pending → needs_invite      (no permitted channel yet; channel-webhook puts the
--                                patient back to pending when they reply YES)
--
-- The new enum values are compared as text in this file: a value added by
-- ALTER TYPE can't be used as an enum literal in the same transaction.

alter type campaign_patient_status add value if not exists 'messaged';
alter type campaign_patient_status add value if not exists 'needs_invite';

do $$ begin
  create type outreach_mode as enum ('call', 'chat');
exception when duplicate_object then null; end $$;

alter table campaigns
  add column if not exists outreach_mode outreach_mode not null default 'call',
  add column if not exists chat_reminder_hours int not null default 24
    check (chat_reminder_hours between 1 and 168);

comment on column campaigns.outreach_mode is 'call = AI phone calls; chat = booking link by chat app or SMS, no calls.';
comment on column campaigns.chat_reminder_hours is 'Chat campaigns: hours before the one reminder, and again before giving up.';

-- Same columns as before, plus two chat buckets at the end so existing
-- readers (portal, CC tools) keep working.
drop view if exists campaign_stats;
create view campaign_stats as
select
  c.id as campaign_id,
  c.clinic_id,
  c.name,
  c.status,
  count(cp.patient_id) as total_patients,
  count(*) filter (where cp.status::text in ('pending', 'notified')) as pending,
  count(*) filter (where cp.status::text = 'booked') as booked,
  count(*) filter (where cp.status::text = 'declined') as declined,
  count(*) filter (where cp.status::text in ('no_answer', 'voicemail')) as unreached,
  count(*) filter (where cp.status::text in ('verification_failed', 'needs_human')) as needs_human,
  round(
    100.0 * count(*) filter (where cp.status::text = 'booked')
    / nullif(count(*) filter (where cp.status::text not in
        ('pending', 'notified', 'calling', 'messaged', 'needs_invite')), 0), 1
  ) as booking_rate_pct,
  count(*) filter (where cp.status::text = 'messaged') as messaged,
  count(*) filter (where cp.status::text = 'needs_invite') as needs_invite
from campaigns c
left join campaign_patients cp on cp.campaign_id = c.id
group by c.id, c.clinic_id, c.name, c.status;
