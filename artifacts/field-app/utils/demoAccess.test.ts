import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_FLAG_KEY, DEMO_TOKEN, DEMO_TOKEN_KEY, clearAccountFreeDemo, grantAccountFreeDemo, hasAccountFreeDemo } from './demoAccess';

describe('account-free demo access', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
  });

  afterEach(() => {
    clearAccountFreeDemo();
    vi.unstubAllGlobals();
  });

  it('stores a demo flag and token in localStorage without an account', () => {
    grantAccountFreeDemo();
    expect(localStorage.getItem(DEMO_FLAG_KEY)).toBe('true');
    expect(localStorage.getItem(DEMO_TOKEN_KEY)).toBe(DEMO_TOKEN);
    expect(hasAccountFreeDemo()).toBe(true);
  });

  it('clears the demo flag', () => {
    grantAccountFreeDemo();
    clearAccountFreeDemo();
    expect(localStorage.getItem(DEMO_FLAG_KEY)).toBeNull();
    expect(hasAccountFreeDemo()).toBe(false);
  });
});
