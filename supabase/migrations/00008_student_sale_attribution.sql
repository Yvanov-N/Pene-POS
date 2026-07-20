-- student_wallet_id was declared from the start (migration 00001) but never
-- actually set by any checkout path -- "Student Wallet" as a payment method
-- was fully wired up in the UI (selectable button, badges, dashboard
-- colors) with no real balance-deduction or student-linkage logic behind
-- it. Fixing that means sales can now be attributed to a student for ANY
-- payment method (cash/MoMo attribution is optional, wallet is required
-- since a balance must be deducted from someone), not just wallet charges,
-- so the column is renamed to reflect what it actually now means. Safe,
-- plain rename: the column has never held real data.
alter table public.sales rename column student_wallet_id to student_id;
