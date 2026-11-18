/** Phone/email normalization shared by self-hosted login, deletion and binding. */

export class InvalidContactError extends Error {
  readonly code = "CONTACT_INVALID";
}

/**
 * Users are stored with 11-digit mainland numbers (Authing's format). Only
 * +86 is accepted for SMS: international SMS needs a separate signature.
 */
export function normalizeCnPhone(phone: string | undefined | null, countryCode?: string | null): string {
  const cc = (countryCode ?? "+86").replace(/\s+/g, "");
  if (cc !== "+86" && cc !== "86") throw new InvalidContactError("Only mainland China phone numbers are supported");
  let digits = (phone ?? "").replace(/[\s-]/g, "");
  if (digits.startsWith("+86")) digits = digits.slice(3);
  else if (digits.startsWith("0086")) digits = digits.slice(4);
  if (!/^1\d{10}$/.test(digits)) throw new InvalidContactError("Invalid phone number");
  return digits;
}

export function normalizeEmailAddress(email: string | undefined | null): string {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
    throw new InvalidContactError("Invalid email");
  }
  return normalized;
}

export function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}
