// Philippine address fields (free text), shared by the patient and clinic forms.
import type { Address } from "../lib/types";

const FIELDS: { key: keyof Address; label: string; placeholder: string }[] = [
  { key: "address_line", label: "House / street / building", placeholder: "123 Mabini St" },
  { key: "barangay", label: "Barangay", placeholder: "Malinis" },
  { key: "city_municipality", label: "City / municipality", placeholder: "Quezon City" },
  { key: "province", label: "Province", placeholder: "Metro Manila" },
  { key: "postal_code", label: "Postal code", placeholder: "1100" },
];

export default function AddressFields({ value, onChange, idPrefix }: {
  value: Address; onChange: (a: Address) => void; idPrefix: string;
}) {
  return (
    <div className="address-grid">
      {FIELDS.map((f) => (
        <span key={f.key}>
          <label htmlFor={`${idPrefix}-${f.key}`}>{f.label}</label>
          <input id={`${idPrefix}-${f.key}`} placeholder={f.placeholder} value={value[f.key] ?? ""}
                 onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />
        </span>
      ))}
    </div>
  );
}

/** One line for display: "123 Mabini St, Malinis, Quezon City, Metro Manila 1100". */
export function addressText(a: Address): string {
  const main = [a.address_line, a.barangay, a.city_municipality, a.province].filter(Boolean).join(", ");
  return [main, a.postal_code].filter(Boolean).join(" ");
}

/** Trimmed values, empty → null (for saving). */
export function addressForSave(a: Address): Address {
  const t = (v?: string | null) => v?.trim() || null;
  return {
    address_line: t(a.address_line), barangay: t(a.barangay), city_municipality: t(a.city_municipality),
    province: t(a.province), postal_code: t(a.postal_code),
  };
}
