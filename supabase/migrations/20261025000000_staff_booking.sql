-- Staff booking: front desk books, reschedules and cancels appointments in the
-- portal (user stories FD-03, FD-04). Bookings use the same open slots as
-- patients (get_available_slots: hours, holidays, closures) and the existing
-- no-double-booking constraint; a reschedule is one update, so the old time
-- is released and the new one taken together.

alter table appointments add column if not exists created_by uuid references auth.users(id);

-- The patient and the clinician must belong to the same clinic, and the
-- staff member's clinic (RLS checks the clinician only). Moves keep a record.
create or replace function fn_appointment_guard() returns trigger
language plpgsql as $$
declare
  v_patient_clinic uuid; v_provider_clinic uuid; v_active boolean;
  v_actor uuid := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
begin
  select clinic_id into v_patient_clinic from patients where id = new.patient_id;
  select clinic_id, active into v_provider_clinic, v_active from providers where id = new.provider_id;
  if v_patient_clinic is distinct from v_provider_clinic then
    raise exception 'The patient and the clinician belong to different clinics.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, v_actor);
    if not coalesce(v_active, false) then
      raise exception 'This clinician is not active.' using errcode = '22023';
    end if;
  elsif new.starts_at is distinct from old.starts_at or new.provider_id is distinct from old.provider_id then
    new.rescheduled_at := now();
  end if;
  if new.ends_at <= new.starts_at then
    raise exception 'The appointment must end after it starts.' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists trg_appointment_guard on appointments;
create trigger trg_appointment_guard before insert or update on appointments
  for each row execute function fn_appointment_guard();

-- Who booked, moved or cancelled what, and when. Appointments have no
-- clinic_id column, so the clinic comes from the clinician. The detail keeps
-- patient_id (so disposal can blank it) but no free text.
create or replace function fn_audit_appointment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r appointments := case when tg_op = 'DELETE' then old else new end;
  v_actor uuid;
begin
  begin
    v_actor := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then v_actor := null; end;
  insert into audit_log (clinic_id, actor_user_id, action, target_type, target_id, detail)
  values ((select clinic_id from providers where id = r.provider_id), v_actor, lower(tg_op), 'appointments', r.id,
          jsonb_build_object('patient_id', r.patient_id, 'provider_id', r.provider_id, 'starts_at', r.starts_at,
                             'status', r.status, 'source', r.source,
                             'previous', case when tg_op = 'UPDATE' then jsonb_build_object(
                               'starts_at', old.starts_at, 'provider_id', old.provider_id, 'status', old.status) end));
  return r;
end $$;

drop trigger if exists trg_audit_appointments on appointments;
create trigger trg_audit_appointments after insert or update or delete on appointments
  for each row execute function fn_audit_appointment();
