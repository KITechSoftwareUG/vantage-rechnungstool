export const EMAIL_ALLOWLIST = [
  "alex@helix-finance.de",
  "kitdienstleistungen@gmail.com",
];

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return EMAIL_ALLOWLIST.includes(email.toLowerCase());
}
