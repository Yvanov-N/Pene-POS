import { useEffect, useState } from "react";
import { BarcodeInput } from "./BarcodeInput";
import { ProductFilters } from "./ProductFilters";
import { ProductGrid } from "./ProductGrid";
import { PosCart } from "./PosCart";
import { TopBar } from "./TopBar";
import { ReceiptPrintHost } from "./ReceiptPrintHost";
import { CartProvider, useCart } from "@/hooks/useCart";
import { SyncProvider } from "@/hooks/useSyncEngine";
import { AdminLockProvider } from "@/hooks/useAdminLock";
import { seedLocalProducts } from "@/lib/seedLocalProducts";
import { seedLocalProfiles } from "@/lib/seedLocalProfiles";
import { ALL_CATEGORIES_VALUE } from "@/lib/constants";

function PosLayoutContent() {
  const cart = useCart();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES_VALUE);

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
    <AdminLockProvider>
      <SyncProvider>
        <CartProvider>
          <PosLayoutContent />
        </CartProvider>
      </SyncProvider>
    </AdminLockProvider>
  );
}
