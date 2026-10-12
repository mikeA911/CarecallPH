export type Role = "admin" | "clinic_admin" | "staff";

export type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "completed";

export type CampaignPatientStatus =
  | "pending" | "notified" | "calling" | "booked" | "declined" | "callback_requested"
  | "no_answer" | "voicemail" | "wrong_number" | "verification_failed"
  | "needs_human" | "resolved" | "messaged" | "needs_invite";

export type OutreachMode = "call" | "chat";

// Human-friendly labels for campaign_patient statuses. Statuses not listed here
// fall back to the raw value with underscores replaced by spaces.
const STATUS_LABELS: Record<string, string> = {
  notified: "Text sent",
  callback_requested: "callback requested",
  verification_failed: "verification failed",
  no_answer: "no answer",
  wrong_number: "wrong number",
  needs_human: "needs review",
  messaged: "link sent",
  needs_invite: "needs chat invite",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export type Clinic = {
  id: string;
  name: string;
  phone_callback: string | null;
  timezone: string;
  calling_hours: Record<string, { start: string; end: string } | null>;
  sms_fallback: boolean;
  sms_precall_lead_seconds: number | null;
  greeting_default: string | null;
  self_booking_enabled: boolean;
  chat_optin_enabled: boolean;
  symptom_check_enabled: boolean;
  reminders_enabled: boolean;
  public_slug: string | null;
  local_emergency_numbers: string | null;
  active: boolean;
  created_at: string;
};

export type Patient = {
  id: string;
  clinic_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  date_of_birth: string;
  provider_id: string | null;
  notes: string | null;
  do_not_call: boolean;
  sms_consent: boolean;
  active: boolean;
  created_at: string;
};

export type Provider = {
  id: string;
  clinic_id: string;
  name: string;
  specialty: string | null;
  active: boolean;
  created_at: string;
};

export type Availability = {
  id: string;
  provider_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_length_minutes: number;
};

export type Campaign = {
  id: string;
  clinic_id: string;
  name: string;
  appointment_type: string;
  greeting_context: string;
  provider_id: string | null;
  slot_length_minutes: number;
  status: CampaignStatus;
  scheduled_start: string | null;
  telnyx_assistant_id: string | null;
  outreach_mode: OutreachMode;
  chat_reminder_hours: number;
  created_by: string | null;
  created_at: string;
};

export type AppointmentTypeAssistant = {
  id: string;
  clinic_id: string;
  appointment_type: string;
  label: string | null;
  telnyx_assistant_id: string;
  active: boolean;
  created_at: string;
};

// Campaign (appointment) types available to configure. Only "New Patient" is
// live today; add entries here as new campaign types are introduced and staff
// will supply the matching Telnyx assistant ID in Clinic settings.
export const CAMPAIGN_TYPES: { value: string; label: string }[] = [
  { value: "new_patient", label: "New Patient" },
];

export type CampaignStat = {
  campaign_id: string;
  clinic_id: string;
  name: string;
  status: CampaignStatus;
  total_patients: number;
  pending: number;
  booked: number;
  declined: number;
  unreached: number;
  needs_human: number;
  booking_rate_pct: number | null;
  messaged: number;
  needs_invite: number;
};

export type ChatChannel = "viber" | "messenger" | "whatsapp" | "telegram";

export const CHANNEL_LABELS: Record<string, string> = {
  sms: "SMS", viber: "Viber", messenger: "Messenger", whatsapp: "WhatsApp", telegram: "Telegram",
};

export type PatientChannel = {
  id: string;
  channel: ChatChannel;
  display_name: string | null;
  linked_at: string;
  opted_in_at: string | null;
  opted_out_at: string | null;
  verified_at: string | null;
  verify_attempts: number;
};

export type ChannelMessage = {
  id: string;
  channel: string;
  direction: "outbound" | "inbound";
  body: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

export type ReviewItem = {
  campaign_id: string;
  patient_id: string;
  status: CampaignPatientStatus;
  flag_reason: string | null;
  updated_at: string;
  patients?: { first_name: string; last_name: string };
  campaigns?: { name: string };
};

export type AuditEntry = {
  id: string;
  clinic_id: string | null;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: unknown;
  created_at: string;
};
