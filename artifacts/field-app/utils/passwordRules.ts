const RULES: Array<{ label: string; test: (password: string) => boolean }> = [
  { label: 'at least 8 characters', test: password => password.length >= 8 },
  { label: '1 uppercase letter', test: password => /[A-Z]/.test(password) },
  { label: '1 lowercase letter', test: password => /[a-z]/.test(password) },
  { label: '1 number', test: password => /\d/.test(password) },
  { label: '1 special character', test: password => /[^A-Za-z0-9]/.test(password) },
];

/** Returns an inline message when a signup password misses a required rule. */
export function passwordSecurityError(password: string): string | null {
  const missing = RULES.filter(rule => !rule.test(password)).map(rule => rule.label);
  if (missing.length === 0) return null;
  return `Password must include ${missing.join(', ')}.`;
}
