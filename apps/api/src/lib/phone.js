/**
 * Normalise a phone number to the form WhatsApp uses: digits only, with country
 * code, no "+". Returns null when the input can't be a valid number.
 *
 * `defaultCountryCode` (digits, e.g. "91") is applied to local 10-digit numbers
 * and to local numbers written with a leading 0.
 */
export function normalizePhone(input, defaultCountryCode) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  const cc = defaultCountryCode ? String(defaultCountryCode).replace(/\D/g, '') : '';

  if (!hasPlus) {
    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    } else if (cc) {
      if (digits.length === 11 && digits.startsWith('0')) digits = cc + digits.slice(1);
      else if (digits.length === 10) digits = cc + digits;
    }
  }

  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return digits;
}

/** WhatsApp business-scoped user IDs look like "IN.1349120865530274". */
export const isBsuid = (value) => typeof value === 'string' && /^[A-Z]{2}\.[A-Za-z0-9.]{1,140}$/.test(value);
