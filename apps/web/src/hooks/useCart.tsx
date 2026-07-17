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

  const addItem = useCallback(
    (product: Product) => {
      if (product.stock === 0) {
        showToast("error", t("pos.cart.outOfStockError", { name: product.name }));
        return;
      }
      showToast("success", t("pos.cart.addedToast", { name: product.name }));
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
    [t, showToast],
  );

  const removeItem = useCallback((productId: string) => {
    void db.cart_items.delete(productId);
  }, []);

  const updateQuantity = useCallback((productId: string, delta: number) => {
    void (async () => {
      const existing = await db.cart_items.get(productId);
      if (!existing) return;
      const nextQuantity = existing.quantity + delta;
      if (nextQuantity <= 0) {
        await db.cart_items.delete(productId);
      } else {
        await db.cart_items.update(productId, { quantity: nextQuantity });
      }
    })();
  }, []);

  const clearCart = useCallback(() => {
    void db.cart_items.clear();
  }, []);

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
