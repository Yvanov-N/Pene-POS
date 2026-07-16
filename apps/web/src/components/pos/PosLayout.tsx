import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarcodeInput } from "./BarcodeInput";
import { ProductFilters } from "./ProductFilters";
import { ProductGrid } from "./ProductGrid";
import { PosCart } from "./PosCart";
import { TopBar } from "./TopBar";
import { ReceiptPrintHost } from "./ReceiptPrintHost";
import { CartProvider, useCart } from "@/hooks/useCart";
import { SyncProvider } from "@/hooks/useSyncEngine";
import { seedLocalProducts } from "@/lib/seedLocalProducts";
import { seedLocalProfiles } from "@/lib/seedLocalProfiles";
import { ALL_CATEGORIES_VALUE } from "@/lib/constants";

const ERROR_TOAST_DURATION_MS = 2000;

function PosLayoutContent() {
  const { t } = useTranslation();
  const cart = useCart();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES_VALUE);

  useEffect(() => {
    if (!cart.outOfStockError) return;
    const timeout = window.setTimeout(cart.clearOutOfStockError, ERROR_TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [cart.outOfStockError, cart.clearOutOfStockError]);

  return (
    <div className="pos-layout flex h-screen w-full bg-background text-foreground">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto border-r border-border p-4">
        <TopBar />
        <BarcodeInput onProductSelect={cart.addItem} />
        <ProductFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
        />
        <ProductGrid searchTerm={searchTerm} category={activeCategory} onProductSelect={cart.addItem} />
      </div>

      <PosCart />

      {cart.outOfStockError && (
        <div className="toast-viewport">
          <div className="toast-error">
            {t("pos.cart.outOfStockError", { name: cart.outOfStockError })}
          </div>
        </div>
      )}

      <ReceiptPrintHost />
    </div>
  );
}

export function PosLayout() {
  useEffect(() => {
    void seedLocalProducts();
    void seedLocalProfiles();
  }, []);

  return (
    <SyncProvider>
      <CartProvider>
        <PosLayoutContent />
      </CartProvider>
    </SyncProvider>
  );
}
