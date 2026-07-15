import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarcodeInput } from "./BarcodeInput";
import { ProductFilters } from "./ProductFilters";
import { ProductGrid } from "./ProductGrid";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { seedLocalProducts } from "@/lib/seedLocalProducts";
import { ALL_CATEGORIES_VALUE } from "@/lib/constants";
import type { Product } from "@/types/db";

const TOAST_DURATION_MS = 2000;

interface ToastMessage {
  id: number;
  text: string;
}

export function PosLayout() {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES_VALUE);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    void seedLocalProducts();
  }, []);

  // Temporary stand-in for real cart state -- Phase 2.2 replaces this with
  // actual cart management. This only proves the selection wiring works.
  const handleProductSelect = (product: Product) => {
    const id = Date.now();
    setToasts((current) => [...current, { id, text: t("pos.toast.added", { name: product.name }) }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TOAST_DURATION_MS);
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto border-r border-border p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold text-muted">Pene POS</h1>
          <LanguageSwitcher />
        </div>
        <BarcodeInput onProductSelect={handleProductSelect} />
        <ProductFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
        />
        <ProductGrid searchTerm={searchTerm} category={activeCategory} onProductSelect={handleProductSelect} />
      </div>

      <div className="hidden w-80 flex-col items-center justify-center gap-2 p-4 text-muted lg:flex">
        <span className="text-2xl">🛒</span>
        <p className="text-sm">{t("pos.cart.placeholder")}</p>
      </div>

      <div className="toast-viewport">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}
