-- Pilot dashboard: the numbers the pilot is judged on, for one clinic.
--
--   clinics.baseline_no_show_pct  the clinic's no-show rate before CareCall
--                                 (percent, entered by a clinic admin)
--   pilot_dashboard(clinic, days) counts only, never names: today's work,
--                                 the period vs the previous one, and (nurses,
--                                 doctors, admins) care plans and notes
--
-- No-shows need attendance: front desk marks past appointments Came
-- (completed) or No-show on the dashboard. The audit trigger logs each one.

alter table clinics
  add column if not exists baseline_no_show_pct numeric(5,2)
    check (baseline_no_show_pct is null or baseline_no_show_pct between 0 and 100);

comment on column clinics.baseline_no_show_pct is
  'No-show rate before the pilot, in percent; the pilot dashboard compares against it.';

create or replace function pilot_dashboard(p_clinic uuid, p_days int default 7)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_days int := case when p_days in (7, 30) then p_days else 7 end;
  v_tz text;
  v_now timestamptz := now();
  v_from timestamptz := now() - make_interval(days => v_days);
  v_prev timestamptz := now() - make_interval(days => 2 * v_days);
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_clinical boolean := is_admin() or can_manage_care();
  v_out jsonb;
begin
  if p_clinic is null or not (is_admin() or p_clinic = jwt_clinic_id()) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  select coalesce(timezone, 'Asia/Manila') into v_tz from clinics where id = p_clinic;
  v_day_start := (date_trunc('day', v_now at time zone v_tz)) at time zone v_tz;
  v_day_end := v_day_start + interval '1 day';

  with appts as (
    select a.* from appointments a join providers pr on pr.id = a.provider_id
    where pr.clinic_id = p_clinic
  ),
  attended as (
    select
      count(*) filter (where status = 'completed' and starts_at >= v_from) as came,
      count(*) filter (where status = 'no_show' and starts_at >= v_from) as no_show,
      count(*) filter (where status = 'completed' and starts_at >= v_prev and starts_at < v_from) as came_prev,
      count(*) filter (where status = 'no_show' and starts_at >= v_prev and starts_at < v_from) as no_show_prev
    from appts where starts_at < v_now
  )
  select jsonb_build_object(
    'days', v_days,
    'clinical', v_clinical,
    'baseline_no_show_pct', (select baseline_no_show_pct from clinics where id = p_clinic),
    'today', jsonb_build_object(
      'appointments', (select count(*) from appts where starts_at >= v_day_start and starts_at < v_day_end and status <> 'cancelled'),
      'confirmed', (select count(*) from appts where starts_at >= v_day_start and starts_at < v_day_end and status = 'confirmed'),
      'not_confirmed', (select count(*) from appts where starts_at >= v_now and starts_at < v_day_end and status = 'booked'),
      'to_mark', (select count(*) from appts where starts_at < v_now and starts_at >= v_now - interval '14 days' and status in ('booked', 'confirmed')),
      'action_items', (select count(*) from cc_action_items where clinic_id = p_clinic and status = 'open' and (v_clinical or not clinical)),
      'readings_to_review', case when v_clinical then
        (select count(*) from vital_readings where clinic_id = p_clinic and flag <> 'ok' and reviewed_at is null) end,
      'critical_to_review', case when v_clinical then
        (select count(*) from vital_readings where clinic_id = p_clinic and flag = 'critical' and reviewed_at is null) end
    ),
    'period', jsonb_build_object(
      'signups', (select count(*) from patients where clinic_id = p_clinic and signed_up_at >= v_from),
      'new_patients', (select count(*) from patients where clinic_id = p_clinic and created_at >= v_from),
      'chat_connected', (select count(distinct patient_id) from patient_channels
                         where clinic_id = p_clinic and opted_in_at >= v_from and opted_out_at is null),
      'chat_total', (select count(distinct pc.patient_id) from patient_channels pc join patients p on p.id = pc.patient_id
                     where pc.clinic_id = p_clinic and pc.opted_in_at is not null and pc.opted_out_at is null and p.active),
      'patients_total', (select count(*) from patients where clinic_id = p_clinic and active),
      'booked', (select count(*) from appts where created_at >= v_from),
      'booked_by_source', (select coalesce(jsonb_object_agg(src, n), '{}') from (
        select coalesce(source, 'other') as src, count(*) as n from appts where created_at >= v_from group by 1) s),
      'reminders_sent', (select count(*) from appointment_reminders where clinic_id = p_clinic and status = 'sent' and created_at >= v_from),
      'replies', jsonb_build_object(
        'confirm', (select count(*) from appointment_reminders where clinic_id = p_clinic and response = 'confirm' and responded_at >= v_from),
        'reschedule', (select count(*) from appointment_reminders where clinic_id = p_clinic and response = 'reschedule' and responded_at >= v_from),
        'cancel', (select count(*) from appointment_reminders where clinic_id = p_clinic and response = 'cancel' and responded_at >= v_from)),
      'came', a.came, 'no_show', a.no_show,
      'no_show_pct', case when a.came + a.no_show > 0 then round(100.0 * a.no_show / (a.came + a.no_show), 1) end,
      'no_show_pct_prev', case when a.came_prev + a.no_show_prev > 0 then round(100.0 * a.no_show_prev / (a.came_prev + a.no_show_prev), 1) end
    ),
    'care', case when v_clinical then jsonb_build_object(
      'doses_taken', (select count(*) from medication_doses where clinic_id = p_clinic and status = 'taken' and due_at >= v_from),
      'doses_skipped', (select count(*) from medication_doses where clinic_id = p_clinic and status = 'skipped' and due_at >= v_from),
      'doses_missed', (select count(*) from medication_doses where clinic_id = p_clinic and status = 'missed' and due_at >= v_from),
      'readings_requested', (select count(*) from vital_requests where clinic_id = p_clinic and status in ('answered', 'missed') and due_at >= v_from),
      'readings_answered', (select count(*) from vital_requests where clinic_id = p_clinic and status = 'answered' and due_at >= v_from),
      'readings_out_of_range', (select count(*) from vital_readings where clinic_id = p_clinic and flag = 'out_of_range' and taken_at >= v_from),
      'readings_critical', (select count(*) from vital_readings where clinic_id = p_clinic and flag = 'critical' and taken_at >= v_from),
      'plans_running', (select count(*) from monitoring_plans where clinic_id = p_clinic and status = 'signed'),
      'notes_signed', (select count(*) from clinical_notes where clinic_id = p_clinic and status = 'signed' and signed_at >= v_from),
      'doctors_signing', (select count(distinct signed_by) from clinical_notes where clinic_id = p_clinic and status = 'signed' and signed_at >= v_from)
    ) end
  ) into v_out from attended a;
  return v_out;
end $$;

revoke all on function pilot_dashboard(uuid, int) from public, anon;
grant execute on function pilot_dashboard(uuid, int) to authenticated;
