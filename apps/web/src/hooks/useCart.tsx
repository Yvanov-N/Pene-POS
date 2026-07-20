import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useToast } from "./useToast";
import type { CartItem, Product } from "@/types/db";

interface CartContextValue {
  items: CartItem[];
  totalItems: number;
  subtotal: number;
  totalAmount: number;
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, delta: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

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

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.price, 0);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      totalItems,
      subtotal: totalAmount,
      totalAmount,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
    }),
    [items, totalItems, totalAmount, addItem, removeItem, updateQuantity, clearCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
