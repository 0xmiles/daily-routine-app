import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";
import { setTestEnv } from "./env";

function flipByte(b64url: string, index = 0): string {
  const buf = Buffer.from(b64url, "base64url");
  buf[index] ^= 0x01;
  return buf.toString("base64url");
}

describe("crypto (AES-256-GCM)", () => {
  it("decrypt(encrypt(x)) === x", () => {
    expect(decrypt(encrypt("x"))).toBe("x");
    expect(decrypt(encrypt(""))).toBe("");
    expect(decrypt(encrypt("ya29.토큰/한글+=="))).toBe("ya29.토큰/한글+==");
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("throws when the token is tampered", () => {
    const token = encrypt("refresh-token");
    const [v, iv, ct, tag] = token.split(".");
    expect(() => decrypt([v, iv, flipByte(ct), tag].join("."))).toThrow();
    expect(() => decrypt([v, iv, ct, flipByte(tag)].join("."))).toThrow();
    expect(() => decrypt([v, flipByte(iv), ct, tag].join("."))).toThrow();
    expect(() => decrypt(token.slice(0, -2))).toThrow();
    expect(() => decrypt("not-a-token")).toThrow();
  });

  it("throws with a different key", () => {
    const token = encrypt("secret");
    setTestEnv({ ENCRYPTION_KEY: randomBytes(32).toString("base64") });
    expect(() => decrypt(token)).toThrow();
    setTestEnv();
    expect(decrypt(token)).toBe("secret");
  });
});
