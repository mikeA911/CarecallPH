// Date-of-birth replies typed into a chat app → candidate ISO dates.
//
// Patients type dates many ways. Accepted:
//   1985-03-14 · 03/14/1985 · 14/03/1985 · 14-03-1985 · 14.03.1985
//   March 14, 1985 · 14 March 1985 · Mar 14 1985 · Marso 14, 1985 (Filipino months)
// Numeric day/month order is ambiguous in the Philippines (US-style MM/DD is
// common on forms), so when both parts are 12 or less, both readings are
// returned and the caller accepts a match on either. A four-digit year is
// required. Returns [] when the text isn't a date at all.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, enero: 1,
  feb: 2, february: 2, pebrero: 2, peb: 2,
  mar: 3, march: 3, marso: 3,
  apr: 4, april: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, june: 6, hunyo: 6,
  jul: 7, july: 7, hulyo: 7,
  aug: 8, august: 8, agosto: 8, ago: 8,
  sep: 9, sept: 9, september: 9, setyembre: 9, set: 9,
  oct: 10, october: 10, oktubre: 10, okt: 10,
  nov: 11, november: 11, nobyembre: 11,
  dec: 12, december: 12, disyembre: 12, dis: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > new Date().getUTCFullYear()) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function dobCandidates(text: string): string[] {
  const t = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  const out = new Set<string>();
  const add = (v: string | null) => { if (v) out.add(v); };

  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) add(iso(+m[1], +m[2], +m[3]));

  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    add(iso(y, a, b)); // month first (03/14/1985)
    add(iso(y, b, a)); // day first (14/03/1985)
  }

  m = t.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/);
  if (m && MONTHS[m[1]]) add(iso(+m[3], MONTHS[m[1]], +m[2]));

  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.? (\d{4})$/);
  if (m && MONTHS[m[2]]) add(iso(+m[3], MONTHS[m[2]], +m[1]));

  return [...out];
}
