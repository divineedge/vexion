import { describe, expect, it } from 'vitest';
import { passwordSecurityError } from './passwordRules';

describe('signup password rules', () => {
  it('accepts a password with length, case, a number, and a special character', () => {
    expect(passwordSecurityError('Abcdef1!')).toBeNull();
  });

  it('names every missing requirement', () => {
    expect(passwordSecurityError('abc')).toBe(
      'Password must include at least 8 characters, 1 uppercase letter, 1 number, 1 special character.',
    );
  });

  it('requires a non-alphanumeric special character', () => {
    expect(passwordSecurityError('Abcdefg1')).toBe('Password must include 1 special character.');
  });
});
