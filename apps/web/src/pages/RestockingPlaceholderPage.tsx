import { useTranslation } from "react-i18next";
import { CardCustom } from "@/components/ui/card-custom";

// Explicitly deferred by the Phase 9.1 spec ("Placeholder route for Phase
// 9.2") -- no restocking-specific workflow exists yet, distinct from the
// general product editing ProductManagementModal already provides at
// /admin/products.
export function RestockingPlaceholderPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-lg p-4">
      <CardCustom title={t("sidebar.restocking")}>
        <p className="text-sm text-muted">{t("sidebar.restockingComingSoon")}</p>
      </CardCustom>
    </div>
  );
}
