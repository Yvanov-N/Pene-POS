import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useCart } from "@/hooks/useCart";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { printService } from "@/services/hardware/printService";
import type { PaymentMethod, Profile, Sale, SaleItem, StudentWallet } from "@/types/db";

const SETTINGS_ID = "default";

export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "momo_mtn", "momo_orange", "student_wallet"];

// Shared by PosCart (desktop sidebar) and MobileCartSheet (mobile bottom
// sheet) -- both need the exact same payment/student-linking state and the
// exact same atomic checkout transaction. Each mounted instance of this hook
// keeps its own independent state, so PosLayout must only ever mount ONE of
// {PosCart, MobileCartSheet} at a time (via useMediaQuery, not a CSS
// hidden/flex toggle on both) -- two simultaneously-mounted instances would
// desync from each other exactly like the shop-status bug fixed earlier in
// this project: pick a payment method on one, and the other's independent
// state would never know.
export function usePosCheckout() {
  const cart = useCart();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  // "clear" and "remove item" no longer need this -- frictionless per Page 2
  // (only checkout still identifies the cashier via PIN, kept deliberately;
  // see PosCart.tsx's own note on why that one PIN step isn't being removed).
  const [pendingAction, setPendingAction] = useState<"checkout" | null>(null);
  const [studentSearchTerm, setStudentSearchTerm] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentWallet | null>(null);

  const isEmpty = cart.items.length === 0;
  const isWalletPayment = paymentMethod === "student_wallet";
  const walletInsufficient = isWalletPayment && selectedStudent !== null && selectedStudent.balance < cart.totalAmount;
  const canCheckout =
    !isEmpty && !!paymentMethod && (!isWalletPayment || (selectedStudent !== null && !walletInsufficient));

  // Deliberately not wired to useBarcodeScanner/the shared pos:barcode-scan
  // event the way StudentWalletsPage's search is: this screen also has
  // product scanning happening on it, so feeding scans into this search too
  // would make every product scan noisily (and wrongly) filter the student
  // picker as well. Plain typed search only.
  const studentResults = useLiveQuery(async () => {
    const term = studentSearchTerm.trim().toLowerCase();
    if (!term) return [];
    const all = await db.student_wallets.toArray();
    return all
      .filter((w) => w.student_name.toLowerCase().includes(term) || w.badge_code.toLowerCase().includes(term))
      .slice(0, 6);
  }, [studentSearchTerm]);

  const selectStudent = (wallet: StudentWallet) => {
    setSelectedStudent(wallet);
    setStudentSearchTerm("");
  };

  const requestCheckout = () => {
    if (!canCheckout) return;
    setPendingAction("checkout");
  };

  const completeCheckout = async (profile: Profile) => {
    const saleId = crypto.randomUUID();
    const now = new Date().toISOString();
    let committedSale: Sale | null = null;
    let committedItems: SaleItem[] = [];

    await db.transaction(
      "rw",
      // Array form -- Dexie's variadic-table-argument overloads cap out
      // below the 6 tables this transaction touches (adding student_wallets
      // pushed it over that limit).
      [db.sales, db.sale_items, db.products, db.student_wallets, db.sync_queue, db.cart_items],
      async () => {
        const sale: Sale = {
          id: saleId,
          created_at: now,
          cashier_id: profile.id,
          total_amount: cart.totalAmount,
          payment_method: paymentMethod!,
          student_id: selectedStudent?.id,
          status: "pending_sync",
          // Only Mobile Money sales need a shop-phone SMS checked before
          // they're considered settled -- cash and student_wallet sales
          // never enter this workflow at all.
          momo_verification_status:
            paymentMethod === "momo_mtn" || paymentMethod === "momo_orange" ? "pending" : undefined,
        };
        await db.sales.put(sale);

        const saleItems: SaleItem[] = cart.items.map((item) => ({
          id: crypto.randomUUID(),
          sale_id: saleId,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.price,
        }));
        await db.sale_items.bulkPut(saleItems);

        for (const item of cart.items) {
          const product = await db.products.get(item.product_id);
          if (product) {
            await db.products.update(item.product_id, {
              stock: Math.max(0, product.stock - item.quantity),
            });
          }
        }

        await enqueueMutation("SALE", "sales", { sale, items: saleItems });

        // Real balance deduction, reusing the exact same adjust_wallet_balance
        // RPC / WALLET_RECHARGE mutation the recharge flow already uses --
        // just a negative delta. The server's non-negative balance CHECK
        // constraint is the real backstop against a race between two devices
        // spending the same wallet before either has synced; this local
        // sufficiency check (canCheckout above) just avoids hitting that in
        // the overwhelmingly common single-device case.
        if (isWalletPayment && selectedStudent) {
          const nextBalance = selectedStudent.balance - cart.totalAmount;
          await db.student_wallets.update(selectedStudent.id, { balance: nextBalance });
          await enqueueMutation("WALLET_RECHARGE", "student_wallets", {
            wallet_id: selectedStudent.id,
            delta: -cart.totalAmount,
          });
        }

        await db.cart_items.clear();

        committedSale = sale;
        committedItems = saleItems;
      },
    );

    setPaymentMethod(null);
    setSelectedStudent(null);

    // Printing is best-effort -- the sale already succeeded, so a printer
    // being unplugged/unpaired must never surface as a checkout failure.
    if (committedSale) {
      try {
        const settings = await db.local_settings.get(SETTINGS_ID);
        await printService.printReceipt(committedSale, committedItems, settings?.printMode ?? "browser");
      } catch (error) {
        console.warn("[usePosCheckout] receipt print failed", error);
      }
    }
  };

  const handleCheckoutPinSuccess = (profile: Profile) => {
    void completeCheckout(profile);
    setPendingAction(null);
  };

  return {
    cart,
    isEmpty,
    paymentMethod,
    setPaymentMethod,
    isWalletPayment,
    walletInsufficient,
    canCheckout,
    studentSearchTerm,
    setStudentSearchTerm,
    studentResults,
    selectedStudent,
    selectStudent,
    clearStudent: () => setSelectedStudent(null),
    pendingAction,
    requestCheckout,
    cancelPendingAction: () => setPendingAction(null),
    handleCheckoutPinSuccess,
  };
}
