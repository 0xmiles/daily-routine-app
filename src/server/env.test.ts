import { afterEach, describe, expect, it } from "vitest";
import { TEST_ENV, devLoginEnabled, getEnv, isAllowedEmail, parseEnv, resetEnvForTests, setTestEnv } from "./env";

afterEach(() => {
  setTestEnv();
});

describe("env", () => {
  it("setTestEnv provides valid defaults and accepts overrides", () => {
    expect(getEnv().ALLOWED_EMAIL).toBe(TEST_ENV.ALLOWED_EMAIL);
    setTestEnv({ ALLOWED_EMAIL: "other@example.com" });
    expect(getEnv().ALLOWED_EMAIL).toBe("other@example.com");
    expect(getEnv().AUTH_SECRET).toBe(TEST_ENV.AUTH_SECRET);
  });

  it("ALLOWED_EMAIL accepts a comma-separated list; the first is the primary", () => {
    const env = setTestEnv({ ALLOWED_EMAIL: " Work@Company.com , me@gmail.com " });
    expect(env.ALLOWED_EMAIL).toBe("work@company.com");
    expect(env.ALLOWED_EMAILS).toEqual(["work@company.com", "me@gmail.com"]);
    expect(isAllowedEmail("ME@gmail.com")).toBe(true);
    expect(isAllowedEmail("work@company.com")).toBe(true);
    expect(isAllowedEmail("someone@gmail.com")).toBe(false);
    expect(() => setTestEnv({ ALLOWED_EMAIL: "work@company.com, not-an-email" })).toThrowError(/ALLOWED_EMAIL/);
  });

  it("VAPID_SUBJECT needs an address after mailto: (Apple rejects a bare one)", () => {
    expect(() => setTestEnv({ VAPID_SUBJECT: "mailto:" })).toThrowError(/VAPID_SUBJECT/);
    expect(setTestEnv({ VAPID_SUBJECT: "https://daily.example.app" }).VAPID_SUBJECT).toBe("https://daily.example.app");
    expect(setTestEnv({ VAPID_SUBJECT: "mailto:me@example.com" }).VAPID_SUBJECT).toBe("mailto:me@example.com");
  });

  it("parseEnv names every missing key without echoing values", () => {
    expect(() => parseEnv({ AUTH_SECRET: "short" })).toThrowError(/ALLOWED_EMAIL/);
    expect(() => parseEnv({ AUTH_SECRET: "short" })).toThrowError(/AUTH_SECRET/);
    expect(() => parseEnv({ AUTH_SECRET: "short" })).not.toThrowError(/short/);
  });

  it("DATABASE_URL and DEV_LOGIN are optional; empty strings count as unset", () => {
    const env = parseEnv({ ...TEST_ENV, DATABASE_URL: "", DEV_LOGIN: "" });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.DEV_LOGIN).toBeUndefined();
  });

  it("rejects an ENCRYPTION_KEY that is not 32 bytes", () => {
    expect(() => parseEnv({ ...TEST_ENV, ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrowError(
      /ENCRYPTION_KEY/,
    );
  });

  it("getEnv reads process.env lazily once overrides are cleared", () => {
    resetEnvForTests();
    const saved = { ...process.env };
    try {
      for (const [k, v] of Object.entries(TEST_ENV)) if (v !== undefined) process.env[k] = v;
      process.env.ALLOWED_EMAIL = "from-process@example.com";
      expect(getEnv().ALLOWED_EMAIL).toBe("from-process@example.com");
    } finally {
      process.env = saved;
    }
  });

  it("devLoginEnabled requires DEV_LOGIN=1 outside production", () => {
    setTestEnv({ DEV_LOGIN: "1" });
    expect(devLoginEnabled()).toBe(true);
    setTestEnv({});
    expect(devLoginEnabled()).toBe(false);
  });
});
