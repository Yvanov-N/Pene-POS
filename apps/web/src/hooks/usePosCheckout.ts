import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { useCart } from "@/hooks/useCart";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { submitSaleNetworkFirst, submitWalletAdjustmentNetworkFirst, type WriteMode } from "@/services/repository";
import { printService } from "@/services/hardware/printService";
import type { CartItem, PaymentMethod, Profile, Sale, SaleItem, SalePayload, StudentWallet } from "@/types/db";

const SETTINGS_ID = "default";

export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "momo_mtn", "momo_orange", "student_wallet"];

export interface CompletedReceipt {
  sale: Sale;
  items: SaleItem[];
  // Kept alongside `items` rather than derived from it -- items only have
  // product_id, and this modal (unlike ReceiptPage.tsx's standalone route)
  // has the cart's own name/price already in memory at checkout time, so
  // there's no reason to pay for a fresh product lookup just to redisplay
  // what was already on screen a moment ago.
  cartItems: CartItem[];
  cashierName: string;
  studentName: string | null;
}

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
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();
  const cart = useCart();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  // "clear" and "remove item" no longer need this -- frictionless per Page 2
  // (only checkout still identifies the cashier via PIN, kept deliberately;
  // see PosCart.tsx's own note on why that one PIN step isn't being removed).
  const [pendingAction, setPendingAction] = useState<"checkout" | null>(null);
  const [studentSearchTerm, setStudentSearchTerm] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentWallet | null>(null);
  const [lastReceipt, setLastReceipt] = useState<CompletedReceipt | null>(null);

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
  //
  // The wallet table is fetched once (no searchTerm in the query deps) and
  // stays live via useLiveQuery's own table subscription; filtering by
  // search term happens in memory via useMemo instead of re-reading
  // IndexedDB on every keystroke.
  const wallets = useLiveQuery(() => db.student_wallets.toArray(), []) ?? [];
  const studentResults = useMemo(() => {
    const term = studentSearchTerm.trim().toLowerCase();
    if (!term) return [];
    return wallets
      .filter((w) => w.student_name.toLowerCase().includes(term) || w.badge_code.toLowerCase().includes(term))
      .slice(0, 6);
  }, [wallets, studentSearchTerm]);

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
    // Snapshotted before the transaction clears db.cart_items -- cart.items
    // itself is about to be emptied out from under us.
    const cartItemsSnapshot = cart.items;
    const studentNameSnapshot = selectedStudent?.student_name ?? null;

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
      momo_verification_status: paymentMethod === "momo_mtn" || paymentMethod === "momo_orange" ? "pending" : undefined,
    };
    const saleItems: SaleItem[] = cart.items.map((item) => ({
      id: crypto.randomUUID(),
      sale_id: saleId,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.price,
    }));
    const salePayload: SalePayload = { sale, items: saleItems };

    // Network-first: attempt the direct Supabase write before touching Dexie
    // at all. On "cloud", the sale/wallet delta is already durably committed
    // server-side, so the local write below just mirrors that confirmed
    // state and skips enqueueing entirely -- there's nothing left to sync.
    // On "local" (offline, timed out, or a genuine conflict), this falls
    // back to exactly the local-first flow this app has always used.
    const saleMode = await submitSaleNetworkFirst(salePayload);
    let walletMode: WriteMode | null = null;
    if (isWalletPayment && selectedStudent) {
      walletMode = await submitWalletAdjustmentNetworkFirst({
        wallet_id: selectedStudent.id,
        delta: -cart.totalAmount,
      });
    }

    await db.transaction(
      "rw",
      // Array form -- Dexie's variadic-table-argument overloads cap out
      // below the 6 tables this transaction touches (adding student_wallets
      // pushed it over that limit).
      [db.sales, db.sale_items, db.products, db.student_wallets, db.sync_queue, db.cart_items],
      async () => {
        await db.sales.put({ ...sale, status: saleMode === "cloud" ? "completed" : "pending_sync" });
        await db.sale_items.bulkPut(saleItems);

        for (const item of cart.items) {
          const product = await db.products.get(item.product_id);
          if (product) {
            // No clamp to 0 -- a genuine cross-terminal oversell is now
            // expected to settle negative (migration 00019), surfaced via
            // the product grid/table's "Negative stock" badge, not hidden
            // locally until the next pull.
            await db.products.update(item.product_id, { stock: product.stock - item.quantity });
          }
        }

        if (saleMode === "local") await enqueueMutation("SALE", "sales", salePayload);

        if (isWalletPayment && selectedStudent) {
          const nextBalance = selectedStudent.balance - cart.totalAmount;
          await db.student_wallets.update(selectedStudent.id, { balance: nextBalance });
          if (walletMode === "local") {
            await enqueueMutation("WALLET_RECHARGE", "student_wallets", {
              wallet_id: selectedStudent.id,
              delta: -cart.totalAmount,
            });
          }
        }

        await db.cart_items.clear();

        committedSale = { ...sale, status: saleMode === "cloud" ? "completed" : "pending_sync" };
        committedItems = saleItems;
      },
    );

    if (saleMode === "local" || walletMode === "local") {
      showToast("warning", t("sync.offlineFallbackToast"));
      // Every other write path in this app already fires this after
      // enqueueing; checkout was the one exception -- fixed here since the
      // new fallback branch needs it to actually flush promptly.
      void triggerManualSync();
    }

    setPaymentMethod(null);
    setSelectedStudent(null);

    if (committedSale) {
      setLastReceipt({
        sale: committedSale,
        items: committedItems,
        cartItems: cartItemsSnapshot,
        cashierName: profile.full_name,
        studentName: studentNameSnapshot,
      });

      // Auto-print is opt-in (admin.settings.autoPrintReceiptsLabel, off by
      // default) -- the receipt modal above is the new default confirmation
      // UI; printing is now something a cashier chooses per-terminal, not a
      // silent side effect on every sale. Still best-effort when enabled --
      // the sale already succeeded, so a printer being unplugged/unpaired
      // must never surface as a checkout failure.
      const settings = await db.local_settings.get(SETTINGS_ID);
      if (settings?.autoPrintReceipts) {
        try {
          await printService.printReceipt(committedSale, committedItems, settings.printMode ?? "browser");
        } catch (error) {
          console.warn("[usePosCheckout] receipt print failed", error);
        }
      }
    }
  };

  const dismissReceipt = () => setLastReceipt(null);

  const printReceiptNow = async () => {
    if (!lastReceipt) return;
    try {
      const settings = await db.local_settings.get(SETTINGS_ID);
      await printService.printReceipt(lastReceipt.sale, lastReceipt.items, settings?.printMode ?? "browser");
    } catch (error) {
      console.warn("[usePosCheckout] manual receipt print failed", error);
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
    lastReceipt,
    dismissReceipt,
    printReceiptNow,
  };
}
