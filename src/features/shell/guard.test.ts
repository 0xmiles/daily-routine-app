import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "drs" && state.token ? { name, value: state.token } : undefined),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`);
  },
}));
vi.mock("@/features/shell/AppShell", () => ({
  AppShell: ({ children }: { children: unknown }) => children,
}));

import AppLayout from "@/app/(app)/layout";
import { sessionCookieFor } from "@/server/auth/session";

async function useCookie(email?: string) {
  state.token = (await sessionCookieFor(email)).split("=")[1];
}

beforeEach(() => {
  state.token = undefined;
});

describe("(app) layout session guard", () => {
  it("redirects to /login without a session", async () => {
    await expect(AppLayout({ children: "본문" })).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects to /login for an email that is not allowed", async () => {
    await useCookie("someone@else.com");
    await expect(AppLayout({ children: "본문" })).rejects.toThrow("REDIRECT:/login");
  });

  it("renders the app with a valid session", async () => {
    await useCookie();
    const element = (await AppLayout({ children: "본문" })) as { props: { children: unknown } };
    expect(element.props.children).toBe("본문");
  });
});
