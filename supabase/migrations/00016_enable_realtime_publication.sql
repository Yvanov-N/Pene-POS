-- Cross-terminal live sync (additive latency optimization on top of the
-- existing poll/queue engine -- see useRealtimeSync.ts). Only the tables
-- where cross-terminal staleness actually causes friction: shared stock,
-- a sale needing to be reflected on other tills, shared wallet balances.
-- Categories/profiles/shop_status change rarely enough that the existing
-- 30s poll is already fine.
alter publication supabase_realtime add table public.products, public.sales, public.student_wallets;
