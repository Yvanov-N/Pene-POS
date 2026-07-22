// A module-level mirror of useNetworkStatus's `isOnline` state, for the few
// call sites that aren't React components/hooks (repository.ts, and
// refundService.ts which is a plain async function) and so can't read
// useNetworkStatus()/useSyncEngine() directly. useNetworkStatus.ts keeps this
// in sync every time it updates its own state -- this is a read-only mirror,
// never the source of truth.
let snapshot = typeof navigator !== "undefined" ? navigator.onLine : true;

export function getIsOnlineSnapshot(): boolean {
  return snapshot;
}

export function setIsOnlineSnapshot(value: boolean): void {
  snapshot = value;
}

// Shared by repository.ts (writes) and useNetworkFirstQuery.ts (reads) so
// every network-first attempt races the same bound.
export const NETWORK_FIRST_TIMEOUT_MS = 2500;
