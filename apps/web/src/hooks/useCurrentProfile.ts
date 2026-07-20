import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/db";

// This app's Supabase Auth session is a shared-device login (one terminal
// login, staff distinguished per-action via the PIN pad), not a per-cashier
// session -- so "the current user" here means whichever profile row matches
// this device's own auth.uid(), used for the identity chip and the Settings
// self-edit form. useLiveQuery (not a one-time fetch) means every mounted
// consumer of this hook stays in sync with a local Dexie write automatically
// -- no shared Context needed the way shop status needed one, since that bug
// was specifically about a plain useState with no live subscription at all.
export function useCurrentProfile(): Profile | undefined {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  return useLiveQuery(() => (userId ? db.profiles.get(userId) : undefined), [userId]);
}
