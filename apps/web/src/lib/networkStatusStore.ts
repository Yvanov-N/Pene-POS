// Shared bound for every network-first attempt (push.ts's pushOutbox,
// useNetworkFirstQuery, usePaginatedQuery, useShareReceipt) that races a
// direct Supabase call against a timeout rather than trusting any cached
// connectivity signal -- see pushOutbox's own comment for why gating these
// on useNetworkStatus's isOnline snapshot was a real production bug (it can
// read stale/false while the actual call succeeds fine).
export const NETWORK_FIRST_TIMEOUT_MS = 2500;
