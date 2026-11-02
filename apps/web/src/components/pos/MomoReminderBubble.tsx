import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Smartphone } from "lucide-react";
import { usePendingMomoSales } from "@/hooks/usePendingMomoSales";
import { formatCurrency } from "@/lib/currency";

// Floating reminder on the POS while Mobile Money sales still await their SMS
// check -- the verification card lives on the Students page, easy to forget
// during a rush. Hidden when nothing is pending; tapping it opens that card.
export function MomoReminderBubble() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pending = usePendingMomoSales();

  if (!pending || pending.length === 0) return null;

  const total = pending.reduce((sum, sale) => sum + sale.total_amount, 0);
  const label = t("pos.momoReminder.label", { count: pending.length });

  return (
    <button
      type="button"
      onClick={() => navigate("/admin/wallets#momo")}
      title={t("pos.momoReminder.hint", { amount: formatCurrency(total) })}
      aria-label={label}
      // Above the mobile cart sheet (bottom-48), in the grid's corner on desktop.
      className="absolute bottom-48 right-4 z-20 flex items-center gap-2 rounded-full border border-warning/40 bg-surface py-2 pl-2 pr-4 text-sm font-medium text-foreground shadow-lg transition-transform hover:scale-105 md:bottom-4"
    >
      <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-warning text-white">
        <Smartphone className="h-4 w-4" aria-hidden />
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white">
          {pending.length}
        </span>
        <span className="absolute inset-0 animate-ping rounded-full bg-warning opacity-30" aria-hidden />
      </span>
      {label}
    </button>
  );
}
