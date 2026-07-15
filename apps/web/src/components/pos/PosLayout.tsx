import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarcodeInput } from "./BarcodeInput";
import { ProductFilters } from "./ProductFilters";
import { ProductGrid } from "./ProductGrid";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { PosCart } from "./PosCart";
import { CartProvider, useCart } from "@/hooks/useCart";
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
    <div className="flex h-screen w-full bg-background text-foreground">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto border-r border-border p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold text-muted">Pene POS</h1>
          <LanguageSwitcher />
        </div>
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
    </div>
  );
}

export function PosLayout() {
  useEffect(() => {
    void seedLocalProducts();
    void seedLocalProfiles();
  }, []);

  return (
    <CartProvider>
      <PosLayoutContent />
    </CartProvider>
  );
}
