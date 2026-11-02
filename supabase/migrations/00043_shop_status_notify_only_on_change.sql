-- ============================================================================
-- Shop open/closed notifications: only when the status actually changes.
-- ============================================================================
--
-- Why: shop_status_notify (00003, endpoints 00014/00034) fired AFTER every
-- UPDATE of the row, and the notify-shop-status edge function doesn't compare
-- old and new values -- so any write to shop_status e-mailed every opted-in
-- student and pushed every staff device, even when the shop didn't open or
-- close: a sync retry re-sending the same value, the data import (00042)
-- upserting the row, or its data_epoch bump. The trigger now only fires when
-- is_open really changes.
-- ============================================================================

drop trigger if exists shop_status_notify on public.shop_status;

create trigger shop_status_notify
  after update of is_open on public.shop_status
  for each row
  when (old.is_open is distinct from new.is_open)
  execute function public.notify_shop_status_change();
