import type { Session } from "@supabase/supabase-js";
import { db } from "@/lib/db";

// Keeps db.auth_session in step with the page's Supabase session (sign-in,
// token refresh, sign-out) for the service worker -- see AuthSessionMirror.
export async function mirrorSession(session: Session | null): Promise<void> {
  try {
    if (!session?.expires_at) {
      await db.auth_session.clear();
      return;
    }
    await db.auth_session.put({
      id: "current",
      access_token: session.access_token,
      expires_at: session.expires_at,
      user_id: session.user.id,
    });
  } catch (error) {
    // Only background sync depends on it; the app itself is unaffected.
    console.warn("[authSessionMirror] could not store the session", error);
  }
}
