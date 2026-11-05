import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccountFreeDemo, grantAccountFreeDemo, hasAccountFreeDemo } from './demoAccess';
import { DEMO_MODE_KEY, DEMO_SANDBOX_KEY } from './demoSandbox';

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

  it('sets is_demo_mode and populates the sandbox without an account', () => {
    grantAccountFreeDemo();
    expect(localStorage.getItem(DEMO_MODE_KEY)).toBe('true');
    expect(localStorage.getItem(DEMO_SANDBOX_KEY)).toContain('Willow Creek HOA');
    expect(hasAccountFreeDemo()).toBe(true);
  });

  it('clears demo mode and the sandbox', () => {
    grantAccountFreeDemo();
    clearAccountFreeDemo();
    expect(localStorage.getItem(DEMO_MODE_KEY)).toBeNull();
    expect(localStorage.getItem(DEMO_SANDBOX_KEY)).toBeNull();
    expect(hasAccountFreeDemo()).toBe(false);
  });
});
