// Public chat opt-in page — /connect/:token (CareCall PH Phase 1).
//
// Reached from the invite link in an SMS. Purely static: it renders deep links
// that hand the token to our bot on each platform. No API call, no PHI — the
// token is resolved server-side by channel-webhook when the patient opens the
// chat, and nothing is sent there until they reply YES.
//
// Each button only appears when its env var is set:
//   VITE_VIBER_CHAT_URI      → viber://pa?chatURI=<uri>&context=<token>
//   VITE_MESSENGER_PAGE      → https://m.me/<page>?ref=<token>
//   VITE_WHATSAPP_NUMBER     → https://wa.me/<digits>?text=CONNECT%20<token>
//   VITE_TELEGRAM_BOT        → https://t.me/<bot>?start=<token>
// Buttons are ordered by Philippine reach (MEF): Viber, Messenger, WhatsApp, Telegram.
import { useParams } from "react-router-dom";

const VIBER = import.meta.env.VITE_VIBER_CHAT_URI as string | undefined;
const MESSENGER = import.meta.env.VITE_MESSENGER_PAGE as string | undefined;
const WHATSAPP = (import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined)?.replace(/\D/g, "");
const TELEGRAM = import.meta.env.VITE_TELEGRAM_BOT as string | undefined;

export default function ConnectPage() {
  const { token = "" } = useParams();
  const valid = /^[A-Za-z0-9_-]{16,64}$/.test(token);
  const t = encodeURIComponent(token);

  const options = [
    VIBER && { label: "Viber", href: `viber://pa?chatURI=${encodeURIComponent(VIBER)}&context=${t}` },
    MESSENGER && { label: "Messenger", href: `https://m.me/${encodeURIComponent(MESSENGER)}?ref=${t}` },
    WHATSAPP && { label: "WhatsApp", href: `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`CONNECT ${token}`)}` },
    TELEGRAM && { label: "Telegram", href: `https://t.me/${encodeURIComponent(TELEGRAM)}?start=${t}` },
  ].filter(Boolean) as { label: string; href: string }[];

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
