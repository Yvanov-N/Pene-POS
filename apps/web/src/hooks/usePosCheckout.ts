import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCart } from "@/hooks/useCart";
import { useNetworkFirstQuery } from "@/hooks/useNetworkFirstQuery";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { getDeviceLabel } from "@/lib/deviceLabel";
import { makeOutboxEntry, recordOutbox } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { mapWalletRow, writeBackIfNewer } from "@/services/sync/pull";
import { printService } from "@/services/hardware/printService";
import type { CartItem, PaymentMethod, Profile, Sale, SaleItem, StudentWallet } from "@/types/db";

const SETTINGS_ID = "default";

// Module-level, not component-scoped -- neither closes over any reactive
// state (the wallet search has no query params to react to, unlike
// ProductGrid's category filter), so there's nothing to re-derive per render.
async function fetchWalletsRemote(signal: AbortSignal) {
  const { data, error } = await supabase.from("student_wallets").select("*").abortSignal(signal);
  if (error) throw error;
  return data;
}
async function writeBackWallets(rows: Awaited<ReturnType<typeof fetchWalletsRemote>>) {
  // "Only accept if newer" (by sync_seq) -- this is a separate, direct
  // stale-while-revalidate fetch (useNetworkFirstQuery), not the cursor-
  // gated main pull, so it has no cursor-advance protection of its own.
  // Without this, a wallet search's background refetch landing right after
  // a wallet-payment checkout (optimistic local balance already
  // decremented, outbox push not necessarily landed yet) could overwrite
  // that fresher local balance with the stale pre-checkout one.
  await writeBackIfNewer(db.student_wallets, rows, mapWalletRow);
}

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
  // (only checkout still requires a PIN, kept deliberately as a lightweight
  // "an admin allowed this" gate -- it now accepts any admin's PIN rather
  // than matching a specific cashier profile, and the sale is attributed to
  // this device, not to whichever admin typed the PIN; see completeCheckout).
  const [pendingAction, setPendingAction] = useState<"checkout" | null>(null);
  const [studentSearchTerm, setStudentSearchTerm] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentWallet | null>(null);
  const [lastReceipt, setLastReceipt] = useState<CompletedReceipt | null>(null);

  const isEmpty = cart.items.length === 0;
  const isWalletPayment = paymentMethod === "student_wallet";
  // No longer gates checkout -- wallet-payment sales are allowed to drive a
  // student's balance negative (server-side already permits this via
  // adjust_wallet_balance, migration 00019). Kept purely to drive the inline
  // UI: red styling + a "this will create/increase debt" message instead of
  // a hard block.
  const walletInsufficient = isWalletPayment && selectedStudent !== null && selectedStudent.balance < cart.totalAmount;
  const canCheckout = !isEmpty && !!paymentMethod && (!isWalletPayment || selectedStudent !== null);

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
  const wallets =
    useNetworkFirstQuery(() => db.student_wallets.toArray(), [], {
      fetchRemote: fetchWalletsRemote,
      writeBack: writeBackWallets,
    }) ?? [];
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
    // Snapshotted before the transaction clears db.cart_items -- cart.items
    // itself is about to be emptied out from under us.
    const cartItemsSnapshot = cart.items;
    const studentNameSnapshot = selectedStudent?.student_name ?? null;

    // Fetched once up front (not re-read for the auto-print step below) --
    // also where the device's admin-set location name (Settings > Device)
    // lives, needed here to compute this sale's device_label.
    const settings = await db.local_settings.get(SETTINGS_ID);
    const deviceLabel = getDeviceLabel(settings?.deviceLocation);

    const sale: Sale = {
      id: saleId,
      created_at: now,
      // Which admin's PIN authorized this checkout -- an audit trail, not
      // the primary attribution shown to users anymore (see device_label).
      cashier_id: profile.id,
      device_label: deviceLabel,
      total_amount: cart.totalAmount,
      payment_method: paymentMethod!,
      student_id: selectedStudent?.id,
      // Always "completed" the instant it's committed locally, whether or
      // not the outbox push below has landed server-side yet -- sync state
      // lives entirely in the outbox now, never in this business field
      // (see types/db.ts's Sale.status comment).
      status: "completed",
      // Only Mobile Money sales need a shop-phone SMS checked before
      // they're considered settled -- cash and student_wallet sales
      // never enter this workflow at all.
      momo_verification_status: paymentMethod === "momo_mtn" || paymentMethod === "momo_orange" ? "pending" : undefined,
      updated_at: now,
    };
    const saleItems: SaleItem[] = cart.items.map((item) => ({
      id: crypto.randomUUID(),
      sale_id: saleId,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.price,
      updated_at: now,
    }));
    const entry = makeOutboxEntry("complete_sale", "sales", { sale, items: saleItems });

    // Commit-local-then-push-eager: everything below -- sale, items, stock
    // decrements, the optimistic wallet debit, and the outbox record itself
    // -- lands in ONE Dexie transaction before any network attempt. This is
    // the fix for the "lost sale" root cause this rebuild exists to close:
    // the old code awaited a direct Supabase call BEFORE ever touching
    // Dexie, so a tab closing mid-await could lose a sale that may have
    // already committed server-side, and a re-rung retry under a new id
    // would be a genuine duplicate. Here, the instant this transaction
    // resolves, the sale is fully durable locally and guaranteed to reach
    // Supabase eventually -- via the eager push right below, or the
    // periodic drain/reconnect backstop otherwise -- regardless of what
    // happens to the network next.
    //
    // The wallet debit for a student_wallet sale is deliberately NOT a
    // second, separate outbox entry: complete_sale (migration 00028) now
    // applies it server-side in the SAME transaction as the sale itself, so
    // a failure between "sale recorded" and "wallet debited" -- the old
    // code's two independent network calls -- can no longer happen.
    await db.transaction(
      "rw",
      // Array form -- Dexie's variadic-table-argument overloads cap out
      // below the 6 tables this transaction touches (adding student_wallets
      // pushed it over that limit).
      [db.sales, db.sale_items, db.products, db.student_wallets, db.sync_outbox, db.cart_items],
      async () => {
        await db.sales.put(sale);
        await db.sale_items.bulkPut(saleItems);

        for (const item of cart.items) {
          const product = await db.products.get(item.product_id);
          if (product) {
            // No clamp to 0 -- a genuine cross-terminal oversell is
            // expected to settle negative (migration 00019), surfaced via
            // the product grid/table's "Negative stock" badge, not hidden
            // locally until the next pull.
            await db.products.update(item.product_id, { stock: product.stock - item.quantity });
          }
        }

        if (isWalletPayment && selectedStudent) {
          const nextBalance = selectedStudent.balance - cart.totalAmount;
          await db.student_wallets.update(selectedStudent.id, { balance: nextBalance });
        }

        await recordOutbox(entry);
        await db.cart_items.clear();
      },
    );

    const outcome = await pushOutbox(entry);
    if (outcome !== "synced") {
      showToast("warning", t("sync.offlineFallbackToast"));
      // Every other write path in this app already fires this after
      // enqueueing; checkout was the one exception -- fixed here since the
      // fallback branch needs it to actually flush promptly.
      void triggerManualSync();
    }

    setPaymentMethod(null);
    setSelectedStudent(null);

    setLastReceipt({
      sale,
      items: saleItems,
      cartItems: cartItemsSnapshot,
      cashierName: deviceLabel,
      studentName: studentNameSnapshot,
    });

    // Auto-print is opt-in (admin.settings.autoPrintReceiptsLabel, off by
    // default) -- the receipt modal above is the default confirmation UI;
    // printing is something a cashier chooses per-terminal, not a silent
    // side effect on every sale. Still best-effort when enabled -- the sale
    // already succeeded, so a printer being unplugged/unpaired must never
    // surface as a checkout failure. Reuses the `settings` fetched at the
    // top of this function rather than re-reading local_settings again.
    if (settings?.autoPrintReceipts) {
      try {
        await printService.printReceipt(sale, saleItems, settings.printMode ?? "browser");
      } catch (error) {
        console.warn("[usePosCheckout] receipt print failed", error);
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
