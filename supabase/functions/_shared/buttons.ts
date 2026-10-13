// Reply buttons on chat messages. A button sends the same reply the patient
// could type ("1", "YES", "A"…), so every app keeps working with typed replies
// and the webhook handles a tap like a message. Shown on Telegram (inline
// keyboard); other apps get the text alone, which always says what to reply.

export type ChatButton = { label: string; reply: string };

/** Telegram callback_data: "r:" + the reply (max 64 bytes). */
export const CALLBACK_PREFIX = "r:";

export function telegramKeyboard(rows: ChatButton[][]) {
  return {
    inline_keyboard: rows.map((row) => row.map((b) => ({
      text: b.label.slice(0, 60),
      callback_data: (CALLBACK_PREFIX + b.reply).slice(0, 64),
    }))),
  };
}

/** The reply carried by a tapped button, or null. */
export function replyFromCallback(data: unknown): string | null {
  return typeof data === "string" && data.startsWith(CALLBACK_PREFIX) ? data.slice(CALLBACK_PREFIX.length) : null;
}

// The buttons used across CareCall's messages.
export const BUTTONS = {
  reminder24: [[{ label: "✅ Confirm", reply: "1" }, { label: "🕒 Change time", reply: "2" }, { label: "❌ Cancel", reply: "3" }]],
  reminder2: [[{ label: "🕒 Change time", reply: "2" }, { label: "❌ Cancel", reply: "3" }]],
  dose: [[{ label: "✅ Taken", reply: "1" }, { label: "Skipped", reply: "2" }]],
  consent: [[{ label: "Yes, send reminders", reply: "YES" }, { label: "No", reply: "NO" }]],
  optIn: [[{ label: "Yes, send me messages", reply: "YES" }, { label: "Stop", reply: "STOP" }]],
  book: [[{ label: "📅 Book an appointment", reply: "BOOK" }]],
  bookOrCheck: [[{ label: "📅 Book an appointment", reply: "BOOK" }, { label: "🩺 Check symptoms", reply: "CHECK" }]],
} satisfies Record<string, ChatButton[][]>;
