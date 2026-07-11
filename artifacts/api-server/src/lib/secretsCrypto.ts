/**
 * Symmetric encryption for integration credentials stored in tenantsTable.integrationsConfig.
 *
 * Uses AES-256-GCM with a key derived (via scrypt) from SESSION_SECRET, so no new
 * secret needs to be provisioned. Ciphertext is stored as a single base64 string:
 * base64(iv (12 bytes) || authTag (16 bytes) || encrypted payload).
 */
import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me";
const KEY = crypto.scryptSync(SECRET, "integrations-config-salt", 32);

export function encryptSecretConfig(value: Record<string, unknown>): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecretConfig(ciphertext: string | null | undefined): Record<string, unknown> {
  if (!ciphertext) return {};
  try {
    const raw = Buffer.from(ciphertext, "base64");
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return {};
  }
}

/** Masks a secret value for display, e.g. "sk_live_abc123" -> "••••••••f123" */
export function maskSecret(value: string | undefined | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return "••••••••";
  return `••••••••${value.slice(-4)}`;
}
