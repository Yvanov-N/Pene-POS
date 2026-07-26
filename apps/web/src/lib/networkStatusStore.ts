// Shared bound for every network-first attempt (push.ts's pushOutbox,
// useNetworkFirstQuery, usePaginatedQuery, useShareReceipt) that races a
// direct Supabase call against a timeout rather than trusting any cached
// connectivity signal -- see pushOutbox's own comment for why gating these
// on useNetworkStatus's periodic health-check ping was a real production bug
// (that ping can read stale/false for a specific endpoint while the actual
// call below succeeds fine).
export const NETWORK_FIRST_TIMEOUT_MS = 2500;
