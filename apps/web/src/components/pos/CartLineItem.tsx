import { memo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import type { CartItem } from "@/types/db";

export function CartLineVisual({ image_url, emoji }: { image_url?: string; emoji?: string }) {
  if (image_url) {
    return <img src={image_url} alt="" className="h-10 w-10 rounded-md object-cover" />;
  }
  return (
    <span className="text-2xl" aria-hidden>
      {emoji || "📦"}
    </span>
  );
}

interface CartLineItemProps {
  item: CartItem;
  size: "compact" | "touch";
  onQuantityChange: (productId: string, delta: number) => void;
  onRemove: (productId: string) => void;
}

// Shared by PosCart (desktop) and MobileCartSheet -- previously ~identical
// JSX duplicated in both. Memoized so an unrelated re-render (payment method
// selection, student search typing) only rebuilds the row whose own item
// data actually changed, not every line in the cart.
export const CartLineItem = memo(function CartLineItem({
  item,
  size,
  onQuantityChange,
  onRemove,
}: CartLineItemProps) {
  const { t } = useTranslation();
  const stepperSize = size === "touch" ? "h-8 w-8 text-base" : "h-6 w-6 text-sm";
  const removeSize = size === "touch" ? "h-9 w-9" : "h-8 w-8";

  return (
    <li className="flex items-center gap-3">
      <CartLineVisual image_url={item.image_url} emoji={item.emoji} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
        <p className="text-xs text-muted">{formatCurrency(item.price)}</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onQuantityChange(item.product_id, -1)}
          className={`rounded-md border border-border text-foreground hover:border-accent ${stepperSize}`}
        >
          -
        </button>
        <span className="w-5 text-center text-sm text-foreground">{item.quantity}</span>
        <button
          type="button"
          onClick={() => onQuantityChange(item.product_id, 1)}
          className={`rounded-md border border-border text-foreground hover:border-accent ${stepperSize}`}
        >
          +
        </button>
      </div>
      {/* Instant, no PIN -- Page 2's frictionless-POS requirement. Only
          checkout still identifies the cashier via PIN. */}
      <button
        type="button"
        onClick={() => onRemove(item.product_id)}
        aria-label={t("pos.cart.remove")}
        className={`flex shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground hover:opacity-90 ${removeSize}`}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );
});
