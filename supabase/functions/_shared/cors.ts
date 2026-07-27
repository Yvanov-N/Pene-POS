// Only needed by functions actually invoked from browser JS (dispatch-push,
// via supabase.functions.invoke). The Edge Functions runtime does not add
// CORS headers on its own -- Supabase's own docs call this out explicitly --
// so a preflight OPTIONS request gets no Access-Control-Allow-* headers back
// and the browser blocks the real request before it ever shows up as
// anything other than a generic "Failed to fetch"/CORS console error, even
// though the function ran fine (confirmed: the same call succeeds from
// curl/CI, which isn't CORS-checked). share-receipt and receipt-og-image are
// reached by top-level navigation/<img>/scrapers, never browser fetch(), so
// they don't need this; notify-shop-status and inventory-alerts are only
// ever called server-side (pg_net), which isn't CORS-checked either.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
