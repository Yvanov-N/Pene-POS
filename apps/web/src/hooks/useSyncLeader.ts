import { useEffect, useState } from "react";

const LEADER_LOCK = "pene-pos-sync-leader";

// Several tabs of the app on one device share the same IndexedDB, so only
// one of them needs to poll Supabase and hold the Realtime socket; the
// others see its writes through Dexie's cross-tab live queries. The Web
// Locks API gives that for free: the first tab holds the lock for its whole
// life, the next one in line takes over the moment it closes. Without the
// API (very old browsers) every tab simply acts as leader, as before.
export function useSyncLeader(): boolean {
  const [isLeader, setIsLeader] = useState(() => !("locks" in navigator));

  useEffect(() => {
    if (!("locks" in navigator)) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;

    navigator.locks
      .request(LEADER_LOCK, { signal: controller.signal }, () => {
        setIsLeader(true);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => {
        // AbortError on unmount before we ever got the lock -- expected.
      });

    return () => {
      controller.abort();
      release?.();
      setIsLeader(false);
    };
  }, []);

  return isLeader;
}
