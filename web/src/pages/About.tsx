// About panel shown on the login screen. Combines the product workflow
// infographic (docs/AI_Patient_Scheduling_Automation_Workflow.png) with the
// roles & compliance model from docs/portal-ui-roles-spec.md.

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
    name: "Admin",
    scope: "Platform · all clinics",
    body: "Manages clinics, all users, and global settings. Can enter any clinic context.",
  },
  {
    name: "Provider",
    scope: "One clinic",
    body: "Runs the clinic's outreach: patients, clinicians, campaigns, settings, and Staff users.",
  },
  {
    name: "Staff",
    scope: "One clinic",
    body: "Runs, schedules, and pauses campaigns, watches live activity, and works the review queue.",
  },
];

const SAFEGUARDS = [
  "Permissions enforced server-side (row-level security), never by hiding buttons alone",
  "Answering-machine detection so the AI never speaks to voicemail",
  "Server-side identity verification before any scheduling action",
  "Do-not-call flags and per-clinic calling-hours windows (TCPA-aware)",
  "Audit log of user and record changes for HIPAA-conscious operations",
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
          <p className="muted">Automating patient scheduling with AI</p>
        </div>
        <button type="button" className="link" onClick={handleClose}>
          {onClose ? "Back to sign in" : "Back"}
        </button>
      </div>

      <p className="about-lede">
        CareCall is a web platform that automates outbound medical appointment
        scheduling using AI voice assistants. Built on Telnyx for
        telecommunications and Supabase for data, it lets clinic staff launch
        targeted campaigns while the AI handles live conversations, verifies
        patient identities, and books real-time slots.
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
        <h2>How it works</h2>
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
        <h2>Security &amp; compliance</h2>
        <ul className="about-safeguards">
          {SAFEGUARDS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <p className="muted small about-foot">
        Beyond scheduling, CareCall is a versatile campaign engine ready for
        future outreach such as medication reminders and intake surveys.
      </p>

      <footer className="copyright">&copy; BettrAI 2026</footer>
    </div>
  );
}
