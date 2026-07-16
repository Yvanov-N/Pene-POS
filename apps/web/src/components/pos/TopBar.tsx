import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { SyncStatusIndicator } from "./SyncStatusIndicator";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { PinPadModal } from "./PinPadModal";
import { AdminConflictDashboard } from "@/components/admin/AdminConflictDashboard";
import logo from "@/assets/logo.png";

export function TopBar() {
  const { t } = useTranslation();
  const [showPinGate, setShowPinGate] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  const conflictCount = useLiveQuery(
    () => db.sales.where("status").equals("conflict_warning").count(),
    [],
  );

  return (
    <>
      <div className="flex items-center justify-between">
        <img src={logo} alt="Pene POS" className="h-6 object-contain w-auto" />
        <div className="flex items-center gap-3">
          {!!conflictCount && conflictCount > 0 && (
            <button
              type="button"
              onClick={() => setShowPinGate(true)}
              className="badge-red animate-pulse"
            >
              ⚠️ {t("admin.conflicts.badge", { count: conflictCount })}
            </button>
          )}
          <SyncStatusIndicator />
          <LanguageSwitcher />
        </div>
      </div>

      {showPinGate && (
        <PinPadModal
          title={t("admin.conflicts.pinTitle")}
          requiredRole="admin"
          onSuccess={() => {
            setShowPinGate(false);
            setShowDashboard(true);
          }}
          onClose={() => setShowPinGate(false)}
        />
      )}

      {showDashboard && <AdminConflictDashboard onClose={() => setShowDashboard(false)} />}
    </>
  );
}
