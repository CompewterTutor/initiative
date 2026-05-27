/**
 * Mask an email for display so the original isn't fully visible while still
 * giving the user enough of a hint to recognise it. Pattern:
 *
 *   a@b.co            ->  a***@b***o
 *
 * The local part is reduced to its first character followed by ``***``. The
 * domain is reduced to its first character + ``***`` + its last character,
 * with everything between (including dots) elided.
 *
 * Inputs that don't look like an email (missing ``@``, empty either side)
 * are returned as-is so callers don't have to special-case loading /
 * missing state. Whitespace around the input is ignored.
 */
export function obfuscateEmail(email: string | null | undefined): string {
  if (!email) return "";
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    // No ``@``, or ``@`` at either end — nothing valid to mask.
    return trimmed;
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const maskedLocal = `${local[0]}***`;
  const maskedDomain =
    domain.length === 1 ? `${domain[0]}***` : `${domain[0]}***${domain[domain.length - 1]}`;
  return `${maskedLocal}@${maskedDomain}`;
}
