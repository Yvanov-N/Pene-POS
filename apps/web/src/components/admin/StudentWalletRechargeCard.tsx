import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { StudentWallet } from "@/types/db";

export function StudentWalletRechargeCard() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWallet, setSelectedWallet] = useState<StudentWallet | null>(null);
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const results = useLiveQuery(async () => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return [];
    const all = await db.student_wallets.toArray();
    return all.filter(
      (wallet) =>
        wallet.student_name.toLowerCase().includes(term) || wallet.badge_code.toLowerCase().includes(term),
    );
  }, [searchTerm]);

  // Scan-to-search via the shared pos:barcode-scan window event (dispatched
  // by useBarcodeScanner's one existing instance in BarcodeInput) instead of
  // mounting a second useBarcodeScanner() here -- that hook wraps a
  // *singleton* hardware connection, so a second instance would steal
  // BarcodeInput's callback registration and then dispose() the shared
  // connection on unmount, breaking the main POS scanner.
  useEffect(() => {
    const handleScan = (event: Event) => {
      const code = (event as CustomEvent<string>).detail;
      if (code) setSearchTerm(code);
    };
    window.addEventListener("pos:barcode-scan", handleScan);
    return () => window.removeEventListener("pos:barcode-scan", handleScan);
  }, []);

  const selectWallet = (wallet: StudentWallet) => {
    setSelectedWallet(wallet);
    setSearchTerm("");
    setAmount("");
    setFormError(null);
  };

  const handleRecharge = async () => {
    if (!selectedWallet) return;
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta <= 0) {
      setFormError(t("admin.recharge.errorAmountInvalid"));
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      const nextBalance = selectedWallet.balance + delta;
      await db.student_wallets.update(selectedWallet.id, { balance: nextBalance });
      await enqueueMutation("WALLET_RECHARGE", "student_wallets", {
        wallet_id: selectedWallet.id,
        delta,
      });
      void triggerManualSync();

      showToast(
        "success",
        t("admin.recharge.toastSuccess", {
          amount: formatCurrency(delta),
          name: selectedWallet.student_name,
        }),
      );

      setSelectedWallet({ ...selectedWallet, balance: nextBalance });
      setAmount("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <CardCustom className="mx-auto max-w-lg" title={t("admin.recharge.title")}>
      <div className="flex flex-col gap-4">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t("admin.recharge.searchPlaceholder")}
            className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
          />

          {searchTerm.trim() && (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {results === undefined || results.length === 0 ? (
                <p className="text-sm text-muted">{t("admin.recharge.noResults")}</p>
              ) : (
                results.map((wallet) => (
                  <li key={wallet.id}>
                    <button
                      type="button"
                      onClick={() => selectWallet(wallet)}
                      className="w-full rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-surface2"
                    >
                      {wallet.student_name} · {wallet.badge_code}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}

          {selectedWallet ? (
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium text-foreground">{selectedWallet.student_name}</p>
              <p className="text-xs text-muted">{selectedWallet.email || "—"}</p>
              <p className="mt-2 text-sm text-foreground">
                {t("admin.recharge.currentBalance", { balance: formatCurrency(selectedWallet.balance) })}
              </p>

              <div className="mt-4 flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">{t("admin.recharge.amountLabel")}</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                  />
                </label>

                {formError && <p className="text-xs text-destructive">{formError}</p>}

                <ButtonCustom
                  variant="success"
                  disabled={saving}
                  isLoading={saving}
                  onClick={() => void handleRecharge()}
                >
                  {t("admin.recharge.confirm")}
                </ButtonCustom>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">{t("admin.recharge.selectPrompt")}</p>
          )}
      </div>
    </CardCustom>
  );
}
