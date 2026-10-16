// Chat app buttons for an invite token: the /connect invite page and the
// /join sign-up page both hand the token to our bot on each platform.
// Each button only appears when its env var is set:
//   VITE_VIBER_CHAT_URI      → viber://pa?chatURI=<uri>&context=<token>
//   VITE_MESSENGER_PAGE      → https://m.me/<page>?ref=<token>
//   VITE_WHATSAPP_NUMBER     → https://wa.me/<digits>?text=CONNECT%20<token>
//   VITE_TELEGRAM_BOT        → https://t.me/<bot>?start=<token>
// Ordered by Philippine reach (MEF): Viber, Messenger, WhatsApp, Telegram.
const VIBER = import.meta.env.VITE_VIBER_CHAT_URI as string | undefined;
const MESSENGER = import.meta.env.VITE_MESSENGER_PAGE as string | undefined;
const WHATSAPP = (import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined)?.replace(/\D/g, "");
const TELEGRAM = import.meta.env.VITE_TELEGRAM_BOT as string | undefined;

export function chatAppLinks(token: string): { label: string; href: string }[] {
  const t = encodeURIComponent(token);
  return [
    VIBER && { label: "Viber", href: `viber://pa?chatURI=${encodeURIComponent(VIBER)}&context=${t}` },
    MESSENGER && { label: "Messenger", href: `https://m.me/${encodeURIComponent(MESSENGER)}?ref=${t}` },
    WHATSAPP && { label: "WhatsApp", href: `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`CONNECT ${token}`)}` },
    TELEGRAM && { label: "Telegram", href: `https://t.me/${encodeURIComponent(TELEGRAM)}?start=${t}` },
  ].filter(Boolean) as { label: string; href: string }[];
}
