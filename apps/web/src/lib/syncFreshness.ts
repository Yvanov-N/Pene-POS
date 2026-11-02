// When this device last completed a full sync cycle -- in localStorage so
// every tab shares it (only one tab syncs, see useSyncLeader). Lets the
// stale-while-revalidate reads (useNetworkFirstQuery, usePaginatedQuery)
// skip their own background fetch while Dexie is known to be fresh: they
// only exist to cover a device whose sync hasn't caught up yet.
const STORAGE_KEY = "pene_pos.lastPullAt";
export const SYNC_FRESHNESS_MS = 60_000;

export function markSynced(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // Storage blocked: reads just keep doing their own fetch.
  }
}

export function isSyncFresh(maxAgeMs = SYNC_FRESHNESS_MS): boolean {
  try {
    const at = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < maxAgeMs;
  } catch {
    return false;
  }
}
