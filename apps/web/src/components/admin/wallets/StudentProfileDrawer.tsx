import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { GraduationCap, Wallet, ShoppingCart, Receipt, X } from "lucide-react";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { printService } from "@/services/hardware/printService";
import { PAYMENT_BADGE_CLASS, STATUS_BADGE_CLASS } from "@/lib/paymentMethodStyles";
import { StatCard } from "@/components/admin/StatCard";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { Profile, Sale, StudentWallet } from "@/types/db";

const SETTINGS_ID = "default";
const QUICK_ADD_AMOUNTS = [1000, 2000, 5000] as const;

type Tab = "analytics" | "history";

// Same revenue-relevance rule as useDashboardAnalytics/useTodayKPIs -- a
// rejected MoMo sale or a refunded sale must not inflate this student's
// lifetime value / basket size, even though both still appear (with their
// real status) in the plain purchase-history list below.
function isRevenueRelevant(sale: Sale): boolean {
  return (sale.status === "completed" || sale.status === "pending_sync") && sale.momo_verification_status !== "rejected";
}

interface StudentProfileDrawerProps {
  student: StudentWallet;
  onClose: () => void;
}

export function StudentProfileDrawer({ student, onClose }: StudentProfileDrawerProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();

  const [tab, setTab] = useState<Tab>("analytics");
  const [rechargeAmount, setRechargeAmount] = useState("");
  const [rechargeError, setRechargeError] = useState<string | null>(null);
  const [recharging, setRecharging] = useState(false);
  // Guards against a double-click landing two overlapping handleRecharge
  // calls before either has re-rendered (state alone can't catch this --
  // see ProductFormDrawer.tsx's savingRef) -- here that would mean crediting
  // the wallet twice for one entered amount, not just a confusing error.
  const rechargingRef = useRef(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  // Same double-debit hazard as rechargingRef above, mirrored for the
  // opposite direction.
  const withdrawingRef = useRef(false);
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [reprintingId, setReprintingId] = useState<string | null>(null);

  // Live so a recharge (or a sale made from another device) reflects
  // instantly without closing/reopening the drawer.
  const wallet = useLiveQuery(() => db.student_wallets.get(student.id), [student.id]) ?? student;

  const profile = useLiveQuery(async () => {
    const sales = await db.sales.where("student_id").equals(student.id).reverse().sortBy("created_at");
    const relevant = sales.filter(isRevenueRelevant);

    let lifetimeValue = 0;
    let walletSpend = 0;
    for (const sale of relevant) {
      lifetimeValue += sale.total_amount;
      if (sale.payment_method === "student_wallet") walletSpend += sale.total_amount;
    }
    const totalTransactions = relevant.length;
    const averageBasket = totalTransactions === 0 ? 0 : Math.round(lifetimeValue / totalTransactions);
    const walletUsagePct = lifetimeValue === 0 ? 0 : Math.round((walletSpend / lifetimeValue) * 100);

    const saleIds = relevant.map((sale) => sale.id);
    const items = saleIds.length > 0 ? await db.sale_items.where("sale_id").anyOf(saleIds).toArray() : [];
    const products = await db.products.toArray();
    const productNames = new Map(products.map((p) => [p.id, p.name]));

    const productTotals = new Map<string, { name: string; quantity: number }>();
    for (const item of items) {
      const bucket = productTotals.get(item.product_id) ?? {
        name: productNames.get(item.product_id) ?? t("admin.salesHistory.unknownProduct"),
        quantity: 0,
      };
      bucket.quantity += item.quantity;
      productTotals.set(item.product_id, bucket);
    }
    const topProducts = Array.from(productTotals.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    return {
      sales,
      lifetimeValue: Math.round(lifetimeValue),
      averageBasket,
      totalTransactions,
      walletUsagePct,
      topProducts,
    };
  }, [student.id]);

  const expandedItems = useLiveQuery(async () => {
    if (!expandedSaleId) return null;
    const [items, products] = await Promise.all([
      db.sale_items.where("sale_id").equals(expandedSaleId).toArray(),
      db.products.toArray(),
    ]);
    const productNames = new Map(products.map((p) => [p.id, p.name]));
    return items.map((item) => ({ ...item, productName: productNames.get(item.product_id) }));
  }, [expandedSaleId]);

  const handleRecharge = async () => {
    if (rechargingRef.current) return;
    rechargingRef.current = true;
    setRecharging(true);

    try {
      const delta = Number(rechargeAmount);
      if (!Number.isFinite(delta) || delta <= 0) {
        setRechargeError(t("admin.recharge.errorAmountInvalid"));
        return;
      }
      setRechargeError(null);

      const nextBalance = wallet.balance + delta;
      await db.student_wallets.update(wallet.id, { balance: nextBalance });
      await enqueueMutation("WALLET_RECHARGE", "student_wallets", { wallet_id: wallet.id, delta });
      void triggerManualSync();

      showToast("success", t("admin.recharge.toastSuccess", { amount: formatCurrency(delta), name: wallet.student_name }));
      setRechargeAmount("");
    } finally {
      rechargingRef.current = false;
      setRecharging(false);
    }
  };

  // profile is only populated when requiresAdminPin actually gated this
  // click (ButtonCustom resolves it via its own PinPadModal, requiredRole
  // "admin") -- a cashier's PIN never reaches this handler at all.
  const handleWithdraw = async (profile?: Profile) => {
    if (!profile || withdrawingRef.current) return;
    withdrawingRef.current = true;
    setWithdrawing(true);

    try {
      const amount = Number(withdrawAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setWithdrawError(t("admin.withdrawal.errorAmountInvalid"));
        return;
      }
      // Client-side cap mirrors what adjust_wallet_balance now enforces
      // server-side too (migration 00010) -- checked here first so the
      // cashier gets an immediate, specific message instead of waiting on a
      // round trip / sync cycle to discover the same thing as a conflict.
      if (amount > wallet.balance) {
        setWithdrawError(t("admin.withdrawal.errorInsufficientBalance"));
        return;
      }
      setWithdrawError(null);

      const nextBalance = wallet.balance - amount;
      await db.student_wallets.update(wallet.id, { balance: nextBalance });
      await enqueueMutation("WALLET_WITHDRAWAL", "student_wallets", { wallet_id: wallet.id, delta: -amount });
      void triggerManualSync();

      showToast(
        "success",
        t("admin.withdrawal.toastSuccess", { amount: formatCurrency(amount), name: wallet.student_name }),
      );
      setWithdrawAmount("");
    } finally {
      withdrawingRef.current = false;
      setWithdrawing(false);
    }
  };

  const handleReprint = async (sale: Sale) => {
    setReprintingId(sale.id);
    try {
      const items = await db.sale_items.where("sale_id").equals(sale.id).toArray();
      const settings = await db.local_settings.get(SETTINGS_ID);
      await printService.printReceipt(sale, items, settings?.printMode ?? "browser");
      showToast("success", t("admin.salesHistory.reprintToast"));
    } catch (error) {
      console.warn("[StudentProfileDrawer] reprint failed", error);
      showToast("error", t("admin.salesHistory.reprintError"));
    } finally {
      setReprintingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface2" aria-hidden>
              <GraduationCap className="h-6 w-6 text-muted" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-foreground">{wallet.student_name}</h2>
              <p className="truncate text-xs text-muted">
                {wallet.badge_code} · {wallet.email || "—"}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-muted hover:text-foreground" aria-label={t("pos.pin.close")}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mb-4 rounded-lg border border-border p-4">
          <p className="text-xs text-muted">{t("admin.wallets.currentBalance")}</p>
          <p
            className={`text-2xl font-bold ${
              wallet.balance > 0 ? "text-success" : wallet.balance < 0 ? "text-destructive" : "text-foreground"
            }`}
          >
            {formatCurrency(wallet.balance)}
          </p>

          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {QUICK_ADD_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setRechargeAmount(String(Number(rechargeAmount || "0") + amount))}
                  className="rounded-lg border border-border bg-surface2 px-3 py-1.5 text-sm font-medium text-foreground hover:border-accent"
                >
                  +{formatCurrency(amount)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="1"
                value={rechargeAmount}
                onChange={(e) => setRechargeAmount(e.target.value)}
                placeholder={t("admin.recharge.amountLabel")}
                className="flex-1 rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
              />
              <ButtonCustom variant="success" isLoading={recharging} onClick={() => void handleRecharge()}>
                {t("admin.recharge.confirm")}
              </ButtonCustom>
            </div>
            {rechargeError && <p className="text-xs text-destructive">{rechargeError}</p>}
          </div>

          {/* Withdrawal only ever appears once there's actual cash to hand
              back -- the business rule is balance > 0, not "always offer
              it and reject on submit". */}
          {wallet.balance > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-2 text-xs font-medium text-muted">{t("admin.withdrawal.title")}</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  max={wallet.balance}
                  step="1"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder={t("admin.withdrawal.amountLabel")}
                  className="flex-1 rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
                />
                <ButtonCustom
                  variant="danger"
                  isLoading={withdrawing}
                  requiresAdminPin
                  pinModalTitle={t("admin.withdrawal.pinTitle")}
                  onClick={handleWithdraw}
                >
                  {t("admin.withdrawal.confirm")}
                </ButtonCustom>
              </div>
              {withdrawError && <p className="mt-1 text-xs text-destructive">{withdrawError}</p>}
            </div>
          )}
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("analytics")}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "analytics"
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface2 text-muted hover:text-foreground"
            }`}
          >
            {t("admin.wallets.tabAnalytics")}
          </button>
          <button
            type="button"
            onClick={() => setTab("history")}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "history"
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface2 text-muted hover:text-foreground"
            }`}
          >
            {t("admin.wallets.tabHistory")}
          </button>
        </div>

        {profile === undefined ? (
          <p className="text-sm text-muted">{t("admin.wallets.loading")}</p>
        ) : tab === "analytics" ? (
          <div className="flex flex-col gap-4">
            <div className="stat-grid">
              <StatCard icon={<Wallet className="h-5 w-5" />} label={t("admin.wallets.lifetimeValue")} value={profile.lifetimeValue} formatValue={formatCurrency} />
              <StatCard icon={<ShoppingCart className="h-5 w-5" />} label={t("admin.wallets.averageBasket")} value={profile.averageBasket} formatValue={formatCurrency} />
              <StatCard icon={<Receipt className="h-5 w-5" />} label={t("admin.wallets.totalTransactions")} value={profile.totalTransactions} />
              <StatCard icon={<GraduationCap className="h-5 w-5" />} label={t("admin.wallets.walletUsage")} value={profile.walletUsagePct} formatValue={(v) => `${v}%`} />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("admin.wallets.favoriteProducts")}</p>
              {profile.topProducts.length === 0 ? (
                <p className="text-sm text-muted">{t("admin.wallets.noPurchases")}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {profile.topProducts.map((item, index) => (
                    <li key={item.name + index} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
                      <span className="text-foreground">{item.name}</span>
                      <span className="text-muted">{t("admin.wallets.unitsPurchased", { count: item.quantity })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {profile.sales.length === 0 ? (
              <p className="text-sm text-muted">{t("admin.wallets.noPurchases")}</p>
            ) : (
              profile.sales.map((sale) => {
                const isExpanded = expandedSaleId === sale.id;
                return (
                  <div key={sale.id} className="rounded-lg border border-border p-3">
                    <button
                      type="button"
                      onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={PAYMENT_BADGE_CLASS[sale.payment_method]}>
                          {t(`pos.cart.paymentMethod.${sale.payment_method}`)}
                        </span>
                        <span className={STATUS_BADGE_CLASS[sale.status]}>{t(`admin.salesHistory.status.${sale.status}`)}</span>
                        <span className="text-sm font-medium text-foreground">{formatCurrency(sale.total_amount)}</span>
                      </div>
                      <span className="text-xs text-muted">
                        #{sale.id.slice(0, 6).toUpperCase()} · {new Date(sale.created_at).toLocaleString()}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="mt-3 border-t border-border pt-3">
                        {expandedItems === undefined || expandedItems === null ? (
                          <p className="text-xs text-muted">{t("admin.salesHistory.loading")}</p>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {expandedItems.map((item) => (
                              <li key={item.id} className="flex justify-between text-xs text-foreground">
                                <span>
                                  {item.quantity} x {item.productName ?? t("admin.salesHistory.unknownProduct")}
                                </span>
                                <span>{formatCurrency(item.quantity * item.unit_price)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <button
                          type="button"
                          disabled={reprintingId === sale.id}
                          onClick={() => void handleReprint(sale)}
                          className="mt-3 rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50"
                        >
                          {t("admin.salesHistory.reprint")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
