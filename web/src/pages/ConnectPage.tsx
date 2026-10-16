// Public chat opt-in page — /connect/:token (CareCall PH Phase 1).
//
// Reached from an invite link: sent by staff from the patient's page ("Invite
// to chat": link, QR code or message) or inside an SMS. Purely static: it renders deep links
// that hand the token to our bot on each platform. No API call, no PHI — the
// token is resolved server-side by channel-webhook when the patient opens the
// chat, and nothing is sent there until they reply YES.
// See lib/chatApps.ts for which buttons appear.
import { useParams } from "react-router-dom";
import { chatAppLinks } from "../lib/chatApps";

export default function ConnectPage() {
  const { token = "" } = useParams();
  const valid = /^[A-Za-z0-9_-]{16,64}$/.test(token);
  const options = chatAppLinks(token);

  return (
    <div className="book-screen">
      <div className="book-card">
        <div className="book-clinic">Appointment reminders</div>
        <div className="book-body">
          {!valid || options.length === 0 ? (
            <>
              <h1>Link not available</h1>
              <p className="book-muted">
                This invite link isn't valid. Please contact your clinic if you'd like
                reminders by chat.
              </p>
            </>
          ) : (
            <>
              <h1>Get reminders by chat</h1>
              <p className="book-muted">
                Choose an app. It will open a chat with your clinic's assistant — reply
                YES there to start receiving reminders and booking links. Reply STOP
                anytime to stop.
              </p>
              <div className="book-list" style={{ marginTop: 16 }}>
                {options.map((o) => (
                  <a key={o.label} className="book-option" href={o.href} rel="noopener" style={{ textDecoration: "none" }}>
                    <span className="book-option-main">Open in {o.label}</span>
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
