-- Same nullable, no-default, no-CHECK treatment as email (see 00001).
alter table public.student_wallets add column phone text;
