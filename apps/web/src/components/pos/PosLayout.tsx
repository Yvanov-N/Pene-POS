import { useState } from "react";
import { BarcodeInput } from "./BarcodeInput";
import { ProductFilters } from "./ProductFilters";
import { ProductGrid } from "./ProductGrid";
import { PosCart } from "./PosCart";
import { MobileCartSheet } from "./MobileCartSheet";
import { ReceiptPrintHost } from "./ReceiptPrintHost";
import { useCart } from "@/hooks/useCart";
import { useMediaQuery } from "@/hooks/useMediaQuery";
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
  // Matches Tailwind's own `md` breakpoint (768px, unmodified in this repo's
  // tailwind.config.ts) so the JS-mounted cart component and the CSS layout
  // around it flip at the exact same width. Deciding via JS (not just CSS
  // hidden/flex on both PosCart and MobileCartSheet) matters here: each owns
  // its own usePosCheckout() instance, and two mounted at once would desync
  // from each other the moment either one's payment method/student selection
  // changed -- see usePosCheckout.ts.
  const isDesktopCart = useMediaQuery("(min-width: 768px)");

  return (
    <div className="pos-layout flex h-full w-full bg-background text-foreground">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pb-44 md:border-r md:border-border md:pb-4">
        <BarcodeInput onProductSelect={cart.addItem} />
        <ProductFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
        />
        <ProductGrid searchTerm={searchTerm} category={activeCategory} onProductSelect={cart.addItem} />
      </div>

      {isDesktopCart ? <PosCart /> : <MobileCartSheet />}

      <ReceiptPrintHost />
    </div>
  );
}
