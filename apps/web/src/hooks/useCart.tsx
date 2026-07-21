import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useToast } from "./useToast";
import type { CartItem, Product } from "@/types/db";

interface CartDataValue {
  items: CartItem[];
  totalItems: number;
  subtotal: number;
  totalAmount: number;
}

interface CartActionsValue {
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, delta: number) => void;
  clearCart: () => void;
}

type CartContextValue = CartDataValue & CartActionsValue;

// Split in two so a consumer that only needs a stable action (e.g. PosLayout
// handing addItem down to BarcodeInput/ProductGrid) doesn't re-render on
// every cart mutation just because it called useCart(). Data changes on
// every add/remove/quantity update; actions are useCallback-stable and only
// change identity when t/showToast do (language switch, effectively never
// otherwise).
const CartDataContext = createContext<CartDataValue | null>(null);
const CartActionsContext = createContext<CartActionsValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const items = useLiveQuery(() => db.cart_items.toArray(), []) ?? [];
  const { t } = useTranslation();
  const { showToast } = useToast();

  // Shared by addItem's "Annuler" action and the plain -1 button: both are
  // "take one unit off this line, dropping it entirely once it hits zero".
  const decrementItem = useCallback((productId: string) => {
    void (async () => {
      const existing = await db.cart_items.get(productId);
      if (!existing) return;
      if (existing.quantity <= 1) {
        await db.cart_items.delete(productId);
      } else {
        await db.cart_items.update(productId, { quantity: existing.quantity - 1 });
      }
    })();
  }, []);

  const addItem = useCallback(
    (product: Product) => {
      if (product.stock === 0) {
        showToast("error", t("pos.cart.outOfStockError", { name: product.name }));
        return;
      }
      showToast("success", t("pos.cart.addedToast", { name: product.name }), undefined, {
        label: t("pos.cart.undo"),
        onClick: () => decrementItem(product.id),
      });
      void (async () => {
        const existing = await db.cart_items.get(product.id);
        if (existing) {
          await db.cart_items.update(product.id, { quantity: existing.quantity + 1 });
        } else {
          const cartItem: CartItem = {
            id: product.id,
            product_id: product.id,
            name: product.name,
            price: product.price,
            quantity: 1,
            image_url: product.image_url,
            emoji: product.emoji,
          };
          await db.cart_items.put(cartItem);
        }
      })();
    },
    [t, showToast, decrementItem],
  );

  const removeItem = useCallback((productId: string) => {
    void db.cart_items.delete(productId);
  }, []);

  const updateQuantity = useCallback(
    (productId: string, delta: number) => {
      if (delta < 0) {
        decrementItem(productId);
        return;
      }
      void (async () => {
        const existing = await db.cart_items.get(productId);
        if (!existing) return;
        await db.cart_items.update(productId, { quantity: existing.quantity + delta });
      })();
    },
    [decrementItem],
  );

  const clearCart = useCallback(() => {
    void (async () => {
      const previousItems = await db.cart_items.toArray();
      if (previousItems.length === 0) return;
      await db.cart_items.clear();
      const totalUnits = previousItems.reduce((sum, item) => sum + item.quantity, 0);
      showToast("info", t("pos.cart.clearedToast", { count: totalUnits }), undefined, {
        label: t("pos.cart.undo"),
        onClick: () => {
          void (async () => {
            await db.cart_items.bulkPut(previousItems);
            showToast("success", t("pos.cart.restoredToast"));
          })();
        },
      });
    })();
  }, [t, showToast]);

  const dataValue = useMemo<CartDataValue>(() => {
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    return { items, totalItems, subtotal: totalAmount, totalAmount };
  }, [items]);

  const actionsValue = useMemo<CartActionsValue>(
    () => ({ addItem, removeItem, updateQuantity, clearCart }),
    [addItem, removeItem, updateQuantity, clearCart],
  );

  return (
    <CartActionsContext.Provider value={actionsValue}>
      <CartDataContext.Provider value={dataValue}>{children}</CartDataContext.Provider>
    </CartActionsContext.Provider>
  );
}

// Combined hook -- for consumers that genuinely need both data and actions
// (PosCart, MobileCartSheet). Re-renders on every cart mutation, same as
// before the split.
export function useCart(): CartContextValue {
  const data = useContext(CartDataContext);
  const actions = useContext(CartActionsContext);
  if (!data || !actions) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return { ...data, ...actions };
}

// Actions-only hook -- for consumers (e.g. PosLayout) that only need a
// stable callback like addItem and must NOT re-render when cart items change.
export function useCartActions(): CartActionsValue {
  const actions = useContext(CartActionsContext);
  if (!actions) {
    throw new Error("useCartActions must be used within a CartProvider");
  }
  return actions;
}
