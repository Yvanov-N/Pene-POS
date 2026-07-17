import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StudentWalletRechargeCard } from "@/components/admin/StudentWalletRechargeCard";
import { MoMoVerificationCard } from "@/components/admin/MoMoVerificationCard";
import { StudentManagementModal } from "@/components/admin/StudentManagementModal";

type Tab = "recharge" | "momo" | "students";

const TABS = [
  { id: "recharge", labelKey: "admin.nav.recharge" },
  { id: "momo", labelKey: "admin.nav.momo" },
  { id: "students", labelKey: "admin.nav.students" },
] as const satisfies { id: Tab; labelKey: string }[];

// /admin/wallets combines three student-related admin tools under one route
// (Phase 9.1's spec only names StudentWalletRechargeCard + MoMoVerificationCard
// for this route, but StudentManagementModal -- student record CRUD -- has
// no other route mapping in the spec either. Leaving it unreachable for a
// whole phase would be a real, avoidable regression of an already-working
// feature, so it's folded in here as a third tab rather than dropped.)
export function AdminWalletsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("recharge");

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === item.id
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface2 text-muted hover:text-foreground"
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {tab === "recharge" && <StudentWalletRechargeCard />}
      {tab === "momo" && <MoMoVerificationCard />}
      {tab === "students" && <StudentManagementModal />}
    </div>
  );
}
