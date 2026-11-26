/** Date-bounded schedule lists omit waitlist rows unless the caller asked for that status. */
export function scheduleRangeOmitsWaitlist(status: string | undefined, hasRange: boolean): boolean {
  return !status && hasRange;
}
