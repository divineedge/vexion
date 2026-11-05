import { clearDemoSandbox, isDemoMode, seedDemoSandbox } from './demoSandbox';

/** Starts the account-free CRM sandbox and stores `is_demo_mode` in localStorage. */
export function grantAccountFreeDemo(): void {
  seedDemoSandbox();
}

export function hasAccountFreeDemo(): boolean {
  return isDemoMode();
}

export function clearAccountFreeDemo(): void {
  clearDemoSandbox();
}
