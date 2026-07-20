import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { useAdminLock } from "@/hooks/useAdminLock";
import { PinPadModal } from "@/components/pos/PinPadModal";
import { ButtonCustom } from "@/components/ui/button-custom";

interface AdminRouteGuardProps {
  children: ReactNode;
}

// Now that a real router exists, "block direct URL access to an admin view"
// (Phase 7.1's requirement 3) actually applies -- previously there was no
// router, so the click-interception on the nav item was the only entry
// point by construction. This wraps every /admin/* route so arriving via a
// bookmark, a page refresh, or typing the URL directly is gated exactly the
// same as clicking the sidebar link.
export function AdminRouteGuard({ children }: AdminRouteGuardProps) {
  const { t } = useTranslation();
  const lock = useAdminLock();
  const [pinPending, setPinPending] = useState(false);

  if (lock.isAdminUnlocked) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <Lock className="h-10 w-10 text-muted" aria-hidden />
      <p className="text-sm text-muted">{t("admin.routeGuard.locked")}</p>
      <ButtonCustom variant="primary" onClick={() => setPinPending(true)}>
        {t("admin.routeGuard.unlock")}
      </ButtonCustom>

      {pinPending && (
        <PinPadModal
          title={t("admin.nav.pinTitle")}
          requiredRole="admin"
          onSuccess={() => {
            lock.unlock();
            setPinPending(false);
          }}
          onClose={() => setPinPending(false)}
        />
      )}
    </div>
  );
}
