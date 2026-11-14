import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/features/shell/AppShell";
import { requireUser, UnauthorizedError } from "@/server/auth/session";

// Every app page (할 일, 메모, 자산, 설정) is behind the session: no valid
// session for an allowed email → /login. API routes check on their own (withUser).

export const metadata: Metadata = {
  appleWebApp: { capable: true, title: "데일리", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let signedIn = false;
  try {
    await requireUser();
    signedIn = true;
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
  }
  if (!signedIn) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
