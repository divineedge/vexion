export type UnlockChoice = 'enabled' | 'skipped';
export function unlockChoiceKey(user: { tenantId: number; id: number }): string {
  return `field_app_unlock_choice_v1:${user.tenantId}:${user.id}`;
}
export function parseUnlockChoice(value: string | null): UnlockChoice | null {
  return value === 'enabled' || value === 'skipped' ? value : null;
}
export function unlockSignInPlan(native: boolean, choice: UnlockChoice | null, webHasUnlock = false) {
  return {
    phoneUnlock: native && choice === 'enabled',
    passwordOnly: choice === 'skipped',
    needsEnrollment: choice !== 'skipped' && (choice !== 'enabled' || (!native && !webHasUnlock)),
  };
}
