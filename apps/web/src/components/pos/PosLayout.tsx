import { useState } from "react";
import { BarcodeInput } from "./BarcodeInput";
import { ProductFilters } from "./ProductFilters";
import { ProductGrid } from "./ProductGrid";
import { PosCart } from "./PosCart";
import { ReceiptPrintHost } from "./ReceiptPrintHost";
import { useCart } from "@/hooks/useCart";
import { ALL_CATEGORIES_VALUE } from "@/lib/constants";

// Providers (AdminLockProvider/SyncProvider/CartProvider) and the local-seed
// effects used to live here, but they're app-wide concerns now that
// SidebarNav and every /admin/* route need them too -- both moved up to
// AppShell, which is what actually mounts this component. h-full (not
// h-screen) because this now fills a flex child of AppShell's layout rather
// than being the full viewport itself.
export function PosLayout() {
  const cart = useCart();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES_VALUE);

  return (
    <div className="pos-layout flex h-full w-full bg-background text-foreground">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto border-r border-border p-4">
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

      <ReceiptPrintHost />
    </div>
  );
}
