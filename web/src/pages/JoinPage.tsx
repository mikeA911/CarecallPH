// Public patient sign-up page — /join/:slug.
//
// A new patient at the front desk scans the clinic's QR poster, types her
// name, mobile and date of birth, accepts the privacy notice and chooses chat
// messages and texts (both unticked: consent is opt-in). A new record that
// asked for chat gets chat app buttons right away; the chat then asks only for
// YES, since she has just typed her birthday. Someone already on file is asked
// to see the front desk, who send Invite to chat (patient-signup explains why).
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { chatAppLinks } from "../lib/chatApps";
import { type JoinResult, privacyNotice, signupApi } from "../lib/signup";

const ERRORS: Record<string, string> = {
  name_required: "Please enter your first and last name.",
  bad_phone: "Please check your mobile number, e.g. 0917 123 4567.",
  bad_dob: "Please check your date of birth.",
  privacy_required: "Please read the privacy notice and tick the box to agree.",
  old_notice: "The privacy notice has changed. Please reload this page.",
  rate_limited: "Too many sign-ups from this network just now. Please wait a minute and try again.",
};

export default function JoinPage() {
  const { slug = "" } = useParams();
  const [clinic, setClinic] = useState<{ name: string; phone: string | null } | null>(null);
  const [state, setState] = useState<"loading" | "form" | "missing">("loading");
  const [form, setForm] = useState({ first: "", last: "", phone: "", dob: "", privacy: false, chat: false, sms: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<JoinResult | null>(null);
  useEffect(() => setErr(""), [form]); // an old error goes once she changes something

  useEffect(() => {
    signupApi.start(slug).then(({ data }) => {
      if (data?.clinic) { setClinic(data.clinic); setState("form"); } else setState("missing");
    });
  }, [slug]);

  async function submit() {
    if (!form.privacy) { setErr(ERRORS.privacy_required); return; }
    setBusy(true); setErr("");
    const { data, error } = await signupApi.signup(slug, {
      first_name: form.first, last_name: form.last, phone: form.phone, date_of_birth: form.dob,
      chat: form.chat, sms: form.sms,
    });
    setBusy(false);
    if (data?.registered) { setDone(data); return; }
    const reason = data?.reason ?? error ?? "";
    setErr(data?.message ?? ERRORS[reason] ?? "Something went wrong. Please try again, or ask the front desk.");
  }

  const name = clinic?.name ?? "";
  return (
    <div className="book-screen">
      <div className="book-card">
        <div className="book-clinic">{name || "Patient sign-up"}</div>
        <div className="book-body">
          {state === "loading" && <p className="book-muted">Loading…</p>}
          {state === "missing" && (
            <>
              <h1>Sign-up not available</h1>
              <p className="book-muted">This sign-up page isn't available. Please ask the front desk to register you.</p>
            </>
          )}
          {state === "form" && done && <Done result={done} clinic={name} wantedChat={form.chat} />}
          {state === "form" && !done && (
            <>
              <h1>Sign up as a patient</h1>
              <p className="book-muted">Takes a minute. The front desk will check your details with your ID.</p>
              <label htmlFor="j-first">First name</label>
              <input id="j-first" className="book-input" autoComplete="given-name" value={form.first}
                onChange={(e) => setForm({ ...form, first: e.target.value })} />
              <label htmlFor="j-last">Last name</label>
              <input id="j-last" className="book-input" autoComplete="family-name" value={form.last}
                onChange={(e) => setForm({ ...form, last: e.target.value })} />
              <label htmlFor="j-phone">Mobile number</label>
              <input id="j-phone" className="book-input" inputMode="tel" autoComplete="tel" placeholder="0917 123 4567"
                value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <label htmlFor="j-dob">Date of birth</label>
              <input id="j-dob" className="book-input" type="date" value={form.dob}
                onChange={(e) => setForm({ ...form, dob: e.target.value })} />

              <h2 style={{ fontSize: 17, marginTop: 20 }}>Privacy notice</h2>
              <div className="book-muted small">
                {privacyNotice(name).map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
              </div>
              <div className="check-list">
                <label className={`check-option${form.privacy ? " on" : ""}`}>
                  <input type="checkbox" checked={form.privacy} onChange={(e) => setForm({ ...form, privacy: e.target.checked })} />
                  <span>I have read the privacy notice and agree that {name} may use my details as described. (Required)</span>
                </label>
                <label className={`check-option${form.chat ? " on" : ""}`}>
                  <input type="checkbox" checked={form.chat} onChange={(e) => setForm({ ...form, chat: e.target.checked })} />
                  <span>Send me appointment reminders and messages by chat app. (Optional)</span>
                </label>
                <label className={`check-option${form.sms ? " on" : ""}`}>
                  <input type="checkbox" checked={form.sms} onChange={(e) => setForm({ ...form, sms: e.target.checked })} />
                  <span>Text messages (SMS) are OK too. (Optional)</span>
                </label>
              </div>
              <p className="book-muted small">You can stop messages anytime by replying STOP.</p>
              {err && <p className="book-err" role="alert">{err}</p>}
              <button className="book-btn" disabled={busy} onClick={submit}>{busy ? "Signing up…" : "Sign up"}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Done({ result, clinic, wantedChat }: { result: JoinResult; clinic: string; wantedChat: boolean }) {
  if (result.existing) {
    return (
      <>
        <h1>You're already registered</h1>
        <p className="book-muted">
          {clinic} already has your details.{wantedChat ? " Please show this screen to the front desk; they'll connect your chat app." : ""}
        </p>
      </>
    );
  }
  const links = result.connect_token ? chatAppLinks(result.connect_token) : [];
  if (!links.length) {
    return (
      <>
        <h1>You're registered</h1>
        <p className="book-muted">
          Thank you. Please tell the front desk you've signed up.
          {wantedChat ? " They'll help you connect your chat app." : ""}
        </p>
      </>
    );
  }
  return (
    <>
      <h1>You're registered</h1>
      <p className="book-muted">
        Last step: choose your chat app. It opens a chat with {clinic}'s assistant. Reply YES there to get your
        reminders. Please tell the front desk you've signed up.
      </p>
      <div className="book-list" style={{ marginTop: 16 }}>
        {links.map((o) => (
          <a key={o.label} className="book-option" href={o.href} rel="noopener" style={{ textDecoration: "none" }}>
            <span className="book-option-main">Open in {o.label}</span>
          </a>
        ))}
      </div>
    </>
  );
}
