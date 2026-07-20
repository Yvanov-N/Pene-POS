import { useTranslation } from "react-i18next";
import { useShopStatus } from "@/hooks/useShopStatus";
import { useToast } from "@/hooks/useToast";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { Profile } from "@/types/db";

export function ShopStatusCard() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { shopOpen, toggleShopStatus } = useShopStatus();

  const handleToggle = async (profile?: Profile) => {
    if (!profile) return;
    const result = await toggleShopStatus(profile);
    if (!result.success) {
      showToast("error", t("admin.settings.shopStatusError"));
      return;
    }
    showToast("success", t("admin.settings.shopStatusUpdatedToast"));
  };

  return (
    <CardCustom title={t("admin.settings.shopStatusCardTitle")}>
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="grid w-full grid-cols-2 gap-3" aria-live="polite">
          <div
            className={`rounded-lg border py-3 text-center text-sm font-semibold transition-colors ${
              shopOpen === true
                ? "border-success bg-success/10 text-success"
                : "border-border bg-surface2 text-muted"
            }`}
          >
            {t("admin.settings.shopOpenBig")}
          </div>
          <div
            className={`rounded-lg border py-3 text-center text-sm font-semibold transition-colors ${
              shopOpen === false
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-border bg-surface2 text-muted"
            }`}
          >
            {t("admin.settings.shopCloseBig")}
          </div>
        </div>

        <ButtonCustom
          variant={shopOpen ? "danger" : "success"}
          size="lg"
          disabled={shopOpen === null}
          requiresAdminPin
          pinModalTitle={t("sidebar.shopTogglePinTitle")}
          onClick={handleToggle}
        >
          {shopOpen ? t("admin.settings.shopCloseBig") : t("admin.settings.shopOpenBig")}
        </ButtonCustom>
      </div>
    </CardCustom>
  );
}
