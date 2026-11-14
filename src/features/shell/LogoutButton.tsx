import { Button } from "@/ui/primitives";

/**
 * A plain form POST to /api/auth/logout. The route clears the session and
 * answers 303 → /login, so the browser does a full page load and every
 * in-memory screen state is dropped.
 */
export function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="post">
      <Button variant="outline" type="submit">
        로그아웃
      </Button>
    </form>
  );
}
