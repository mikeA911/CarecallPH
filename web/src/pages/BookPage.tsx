// Public self-service booking page — /book/:token (self-booking-link-spec §6).
//
// Outside the auth guard: no login, no cookies beyond essentials, no PHI in the
// URL. Mobile-first (nearly all traffic arrives from SMS): large touch targets,
// a single column, generous spacing. The page never renders the patient's full
// name, phone, or DOB; only the first name is shown post-verification. All
// times are displayed in the clinic's timezone with an explicit label.
//
// The page is a thin client over booking-api. Every rule (verification lockout,
// slot generation, idempotent + double-booking-safe booking) lives server-side.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  bookingApi,
  type BookingState,
  type ContextResp,
  type DayOption,
  type TimeOption,
} from "../lib/booking";

type Step = "loading" | "verify" | "day" | "time" | "confirm" | "success";

/** Explicit, human-readable timezone label, e.g. "all times Philippine Time (PHT)". */
function tzLabel(tz: string): string {
  const map: Record<string, string> = {
    "Asia/Manila": "Philippine Time (PHT)",
    "America/Chicago": "US Central",
    "America/New_York": "US Eastern",
    "America/Denver": "US Mountain",
    "America/Los_Angeles": "US Pacific",
    "America/Phoenix": "US Mountain (Arizona)",
    "America/Anchorage": "US Alaska",
    "Pacific/Honolulu": "US Hawaii",
  };
  return map[tz] ?? tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
}

export default function BookPage() {
  const { token = "" } = useParams();
  const [ctx, setCtx] = useState<ContextResp | null>(null);
  const [state, setState] = useState<BookingState | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Verification
  const [dob, setDob] = useState("");
  const [firstName, setFirstName] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);

  // Slots
  const [days, setDays] = useState<DayOption[]>([]);
  const [chosenDay, setChosenDay] = useState<DayOption | null>(null);
  const [times, setTimes] = useState<TimeOption[]>([]);
  const [chosenTime, setChosenTime] = useState<TimeOption | null>(null);

  // Confirmation
  const [spoken, setSpoken] = useState<string | null>(null);

  const tz = ctx?.timezone ?? "Asia/Manila";

  // Initial context load. Resolves the starting step from the link's state.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await bookingApi.context(token);
      if (cancelled) return;
      if (!data) { setState("expired"); setStep("verify"); return; }
      setCtx(data);
      setState(data.state);
      if (data.state === "ready") { void loadDays(); }
      else if (data.state === "needs_verification") setStep("verify");
      else setStep("verify"); // expired/locked/booked render from `state`, not `step`
    }
    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadDays = useCallback(async () => {
    setBusy(true); setErr("");
    const { data, error } = await bookingApi.days(token);
    setBusy(false);
    if (error || !data) {
      setErr("We couldn't load available times. Please try again.");
      setStep("day");
      return;
    }
    if (data.state && data.state !== "ready") { setState(data.state); return; }
    setDays(data.days ?? []);
    setStep("day");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submitDob(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!dob) { setErr("Please enter your date of birth."); return; }
    setBusy(true);
    const { data } = await bookingApi.verify(token, dob);
    setBusy(false);
    if (!data) { setErr("Something went wrong. Please try again."); return; }
    if (data.verified) {
      setFirstName(data.first_name ?? "");
      setState("ready");
      void loadDays();
      return;
    }
    if (data.state === "locked") { setState("locked"); return; }
    if (data.state === "expired" || data.state === "booked") { setState(data.state); return; }
    setRemaining(data.remaining_attempts ?? null);
    setErr(
      data.remaining_attempts && data.remaining_attempts > 0
        ? "That date of birth didn't match. Please try once more."
        : "That date of birth didn't match.",
    );
  }

  async function pickDay(day: DayOption) {
    setChosenDay(day);
    setBusy(true); setErr("");
    const { data, error } = await bookingApi.times(token, day.date);
    setBusy(false);
    if (error || !data) { setErr("We couldn't load times for that day. Please try again."); return; }
    if (data.state && data.state !== "ready") { setState(data.state); return; }
    setTimes(data.times ?? []);
    setStep("time");
  }

  function pickTime(t: TimeOption) {
    setChosenTime(t);
    setStep("confirm");
  }

  async function confirmBooking() {
    if (!chosenTime) return;
    setBusy(true); setErr("");
    const { data } = await bookingApi.book(token, chosenTime.slot_start);
    setBusy(false);
    if (!data) { setErr("Something went wrong. Please try again."); return; }
    if (data.booked) {
      setSpoken(data.spoken ?? null);
      setState("booked");
      setStep("success");
      return;
    }
    if (data.reason === "slot_taken") {
      setErr("Sorry, that time was just taken. Please pick another.");
      // Re-fetch the chosen day's times.
      if (chosenDay) await pickDay(chosenDay);
      else await loadDays();
      return;
    }
    if (data.state === "locked" || data.state === "expired") { setState(data.state); return; }
    setErr("We couldn't book that time. Please try again.");
  }

  // ---- Terminal / lifecycle screens (driven by `state`, not `step`) ----
  if (state === "expired") {
    return (
      <Shell clinic={ctx?.clinic_name}>
        <h1>Link expired or invalid</h1>
        <p className="book-muted">
          This booking link is no longer valid. If you still need to schedule an
          appointment, please contact the clinic directly.
        </p>
      </Shell>
    );
  }

  if (state === "locked") {
    return (
      <Shell clinic={ctx?.clinic_name}>
        <h1>We need to verify it's you</h1>
        <p className="book-muted">
          We couldn't confirm your identity from the information provided. A team
          member will follow up with you to finish scheduling. No further action
          is needed right now.
        </p>
      </Shell>
    );
  }

  if (state === "booked" && step !== "success") {
    return (
      <Shell clinic={ctx?.clinic_name}>
        <h1>You're all set</h1>
        <p className="book-muted">
          This appointment is already booked. You'll receive a reminder before
          your visit. If you need to make a change, please contact the clinic.
        </p>
      </Shell>
    );
  }

  // ---- Main flow ----
  return (
    <Shell clinic={ctx?.clinic_name} subtitle={ctx?.appointment_type_label}>
      {step === "loading" && <p className="book-muted">Loading…</p>}

      {step === "verify" && state === "needs_verification" && (
        <>
          <h1>Confirm your date of birth</h1>
          <p className="book-muted">
            For your privacy, please confirm your date of birth to continue.
          </p>
          <form onSubmit={submitDob}>
            <label htmlFor="dob">Date of birth</label>
            <input
              id="dob"
              type="date"
              className="book-input"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              autoComplete="bday"
            />
            {err && <p className="book-err" role="alert">{err}</p>}
            <button type="submit" className="book-btn" disabled={busy}>
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
        </>
      )}

      {step === "day" && (
        <>
          <h1>{firstName ? `Hi ${firstName} — pick a day` : "Pick a day"}</h1>
          <p className="book-tz">All times {tzLabel(tz)}</p>
          {days.length === 0 ? (
            <p className="book-muted">No openings are available right now. Please check back later or contact the clinic.</p>
          ) : (
            <div className="book-list">
              {days.map((d) => (
                <button key={d.date} className="book-option" onClick={() => pickDay(d)} disabled={busy}>
                  <span className="book-option-main">{d.label}</span>
                  <span className="book-option-sub">{d.count} time{d.count === 1 ? "" : "s"} available</span>
                </button>
              ))}
            </div>
          )}
          {err && <p className="book-err" role="alert">{err}</p>}
        </>
      )}

      {step === "time" && (
        <>
          <h1>Pick a time</h1>
          <p className="book-tz">{chosenDay?.label} · all times {tzLabel(tz)}</p>
          <div className="book-times">
            {times.map((t) => (
              <button key={t.slot_start} className="book-time" onClick={() => pickTime(t)} disabled={busy}>
                {t.label}
              </button>
            ))}
          </div>
          {err && <p className="book-err" role="alert">{err}</p>}
          <button className="book-link" onClick={() => setStep("day")}>← Back to days</button>
        </>
      )}

      {step === "confirm" && chosenDay && chosenTime && (
        <>
          <h1>Confirm your appointment</h1>
          <div className="book-confirm">
            <div className="book-confirm-when">{chosenDay.label} at {chosenTime.label}</div>
            <div className="book-tz">All times {tzLabel(tz)}</div>
          </div>
          {err && <p className="book-err" role="alert">{err}</p>}
          <button className="book-btn" onClick={confirmBooking} disabled={busy}>
            {busy ? "Booking…" : "Confirm booking"}
          </button>
          <button className="book-link" onClick={() => setStep("time")} disabled={busy}>← Choose a different time</button>
        </>
      )}

      {step === "success" && (
        <>
          <h1>You're booked!</h1>
          {spoken && <div className="book-confirm-when">{spoken}</div>}
          <p className="book-tz">All times {tzLabel(tz)}</p>
          <p className="book-muted" style={{ marginTop: 16 }}>
            You'll receive a reminder before your visit. You can close this page.
          </p>
        </>
      )}
    </Shell>
  );
}

function Shell({ clinic, subtitle, children }: { clinic?: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="book-screen">
      <div className="book-card">
        <div className="book-clinic">{clinic ?? "Booking"}</div>
        {subtitle && <div className="book-subtitle">{subtitle}</div>}
        <div className="book-body">{children}</div>
      </div>
    </div>
  );
}
