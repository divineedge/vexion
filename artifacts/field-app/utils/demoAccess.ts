export const DEMO_FLAG_KEY = 'field_app_demo';
export const DEMO_TOKEN_KEY = 'field_app_demo_token';
export const DEMO_TOKEN = 'demo';

const memory = new Map<string, string>();

function storage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function write(key: string, value: string) {
  memory.set(key, value);
  storage()?.setItem(key, value);
}

function read(key: string): string | null {
  const stored = storage()?.getItem(key);
  if (stored != null) return stored;
  return memory.get(key) ?? null;
}

/** Marks this browser as a demo visitor. No account or server session is created. */
export function grantAccountFreeDemo(): void {
  write(DEMO_FLAG_KEY, 'true');
  write(DEMO_TOKEN_KEY, DEMO_TOKEN);
}

export function hasAccountFreeDemo(): boolean {
  return read(DEMO_FLAG_KEY) === 'true' && read(DEMO_TOKEN_KEY) === DEMO_TOKEN;
}

export function clearAccountFreeDemo(): void {
  memory.delete(DEMO_FLAG_KEY);
  memory.delete(DEMO_TOKEN_KEY);
  storage()?.removeItem(DEMO_FLAG_KEY);
  storage()?.removeItem(DEMO_TOKEN_KEY);
}
