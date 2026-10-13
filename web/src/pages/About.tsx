// About panel shown on the login screen and at /about: what CareCall does,
// the AI call workflow (docs/AI_Patient_Scheduling_Automation_Workflow.png),
// roles and safeguards. Keep in step with docs/cc-wiki/overview.md.

const WORKFLOW_STEPS = [
  {
    title: "Campaign setup & patient import",
    body: "Staff build outreach campaigns — wellness visits, vaccinations, and more — from centrally managed patient records and provider schedules.",
  },
  {
    title: "Automated outreach launch",
    body: "One click instructs the AI voice assistants to begin outbound calls to the campaign list.",
  },
  {
    title: "Human-only connection",
    body: "Premium answering-machine detection ensures the AI only engages when a live person answers.",
  },
  {
    title: "Secure identity verification",
    body: "The AI verifies each patient's date of birth server-side before it can access any scheduling tools.",
  },
  {
    title: "Real-time slot disclosure",
    body: "The assistant retrieves and offers up to three open appointment slots based on live provider availability.",
  },
  {
    title: "Booked & logged",
    body: "The selected slot is reserved in the database and the call outcome is recorded for review.",
  },
];

const AI_TOOLS = [
  { name: "search_patient", body: "Verify patient identity securely" },
  { name: "get_available_slots", body: "Retrieve real-time appointment options" },
  { name: "create_appointment", body: "Reserve a selected slot in the database" },
];

const ROLES = [
  {
    name: "Platform admin",
    scope: "All clinics",
    body: "Manages clinics, all users and global settings, including records retention. Can make other platform admins.",
  },
  {
    name: "Clinic admin",
    scope: "One clinic",
    body: "Runs the clinic: patients, clinicians, campaigns, clinic settings and users.",
  },
  {
    name: "Staff",
    scope: "One clinic",
    body: "Runs campaigns, works the review queue, books and messages patients.",
  },
];

const CLINICAL_ROLES = [
  { name: "Front desk", body: "Bookings and messages; sees the urgency of an intake, not the symptoms." },
  { name: "Nurse / assistant", body: "Medicines and reminders, intake details, drafts clinical notes." },
  { name: "Doctor", body: "Everything a nurse can do; signs clinical notes with their password, linked to their PRC number." },
];

const SAFEGUARDS = [
  "Permissions enforced in the database (row-level security), never by hiding buttons alone",
  "Each user has an access level and a clinical role; front desk never sees clinical notes",
  "Consent recorded for every chat app, medicine reminders and consultation recordings",
  "Server-side identity verification before any scheduling action on a call",
  "Recordings for clinical notes are transcribed and never stored; signed notes can't be changed",
  "Automatic sign-out when the browser closes or after 20 minutes without activity",
  "Audit log of record changes, exports and signatures; Data Privacy Act (RA 10173) aware",
  "Records in the national health data format (FHIR R4, PH Core) on request",
];

import { useNavigate } from "react-router-dom";

// `onClose` is passed from the Login screen (pre-auth). When rendered as an
// in-app route it is omitted, and we fall back to navigating back / home.
export default function About({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();
  const handleClose = () => {
    if (onClose) onClose();
    else navigate(-1);
  };
  return (
    <div className="about-panel">
      <div className="about-head">
        <div>
          <h1>About CareCall</h1>
          <p className="muted">Patient engagement and clinical workflows for Philippine clinics</p>
        </div>
        <button type="button" className="link" onClick={handleClose}>
          {onClose ? "Back to sign in" : "Back"}
        </button>
      </div>

      <p className="about-lede">
        CareCall helps small private clinics in the Philippines reach patients on
        the chat apps they already use (Viber, Messenger, WhatsApp, Telegram),
        book visits, send appointment and medicine reminders, and guide patients
        with a symptom check. Doctors dictate clinical notes that CC, the built-in
        assistant, turns into a draft for them to sign. Records can be exported in
        the national health data format (FHIR, PH Core). AI voice calls are an
        optional add-on.
      </p>

      <figure className="about-figure">
        <img
          src="/workflow.png"
          alt="CareCall workflow: staff set up and launch outreach campaigns, then the AI answers on a live connection, verifies patient identity, offers real-time slots, and books the appointment."
          loading="lazy"
        />
        <figcaption className="muted small">
          From campaign launch to booked appointment — the management workflow
          and the smart AI conversation.
        </figcaption>
      </figure>

      <section className="about-section">
        <h2>How an AI call campaign works</h2>
        <ol className="about-steps">
          {WORKFLOW_STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="about-step-num">{i + 1}</span>
              <div>
                <strong>{s.title}</strong>
                <p className="muted small">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="about-section">
        <h2>What the AI can do on a call</h2>
        <div className="about-tools">
          {AI_TOOLS.map((t) => (
            <div key={t.name} className="about-tool">
              <code>{t.name}</code>
              <span className="muted small">{t.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="about-section">
        <h2>Who uses the portal</h2>
        <div className="about-roles">
          {ROLES.map((r) => (
            <div key={r.name} className="about-role">
              <strong>{r.name}</strong>
              <span className="small about-role-scope">{r.scope}</span>
              <p className="muted small">{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="about-section">
        <h2>Clinical roles</h2>
        <div className="about-roles">
          {CLINICAL_ROLES.map((r) => (
            <div key={r.name} className="about-role">
              <strong>{r.name}</strong>
              <p className="muted small">{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="about-section">
        <h2>Security &amp; compliance</h2>
        <ul className="about-safeguards">
          {SAFEGUARDS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <p className="muted small about-foot">
        Coming next: prescriptions signed in CareCall, vital signs by chat with the
        doctor's limits, and CareCallPH.com for patients to find care.
      </p>

      <footer className="copyright">&copy; 2026 CareCall</footer>
    </div>
  );
}
