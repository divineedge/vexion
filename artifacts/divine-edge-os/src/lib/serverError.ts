/** Extract the real server error (e.g. payment policy block) from an API failure. */
export function serverErrorMessage(err: unknown, fallback: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const msg = e?.response?.data?.error ?? e?.data?.error ?? e?.message;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}
