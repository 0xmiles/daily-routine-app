import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/server/env";

// AES-256-GCM for secrets at rest (Google tokens).
// Token format: `v1.<iv>.<ciphertext>.<authTag>` (each part base64url).

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  return Buffer.from(getEnv().ENCRYPTION_KEY, "base64");
}

export function encrypt(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

/** Throws if the token is malformed, tampered with, or was encrypted with another key. */
export function decrypt(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Invalid encrypted token format");
  const iv = Buffer.from(parts[1], "base64url");
  const ciphertext = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("Invalid encrypted token format");
  const decipher = createDecipheriv(ALGORITHM, key(), iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
